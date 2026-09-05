import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { OtpRepository } from '../repositories/otp.repository';
import { OtpPurpose } from '../../../generated/prisma/client';
import { hashSha256 } from '../../../common/utils/hash.util';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly OTP_TTL_MIN = 5;
  private readonly MAX_ATTEMPTS = 3;
  private readonly COOLDOWN_MIN = 5;

  constructor(
    private readonly otpRepository: OtpRepository,
    @InjectQueue('mail-queue') private readonly mailQueue: Queue,
    @InjectQueue('otp-queue') private readonly otpQueue: Queue,
  ) {}

  async generateAndSend(
    userId: string,
    email: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    // Clean up any previously expired OTPs for this user
    await this.otpRepository.deleteExpiredForUser(userId);

    // 1. Generate cryptographically secure 4-digit OTP
    const otp = crypto.randomInt(1000, 10000).toString();
    const codeHash = hashSha256(otp);
    const expiresAt = new Date(Date.now() + this.OTP_TTL_MIN * 60 * 1000);

    // 2. Persist hashed OTP to repository
    const otpRecord = await this.otpRepository.create({
      userId,
      codeHash,
      purpose,
      expiresAt,
    });

    // 3. Dispatch to BullMQ mail-queue for non-blocking asynchronous email delivery
    try {
      await this.mailQueue.add(
        'send-otp-email',
        { email, otp, purpose },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Dispatched OTP job to mail-queue for ${email}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to add OTP email job to BullMQ queue: ${error.message}`,
        error.stack,
      );
      // Fallback: If Redis is unavailable in local dev, avoid blocking flow
    }

    // 4. Dispatch delayed job to BullMQ otp-queue to auto-delete expired OTP after 5 minutes (no cron needed!)
    try {
      await this.otpQueue.add(
        'cleanup-expired-otp',
        { otpId: otpRecord.id },
        {
          delay: this.OTP_TTL_MIN * 60 * 1000, // 5 minutes
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      this.logger.log(
        `Scheduled auto-removal for OTP #${otpRecord.id} in 5 minutes via BullMQ`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Could not schedule auto-removal job in BullMQ: ${error.message}`,
      );
    }
  }

  async verify(
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<boolean> {
    const otpRecord = await this.otpRepository.findLatestPending(
      userId,
      purpose,
    );

    if (!otpRecord) {
      throw new BadRequestException('OTP not found, expired, or already used.');
    }

    if (otpRecord.expiresAt < new Date()) {
      // Delete expired OTP immediately
      await this.otpRepository.deleteById(otpRecord.id);
      throw new BadRequestException('OTP code has expired. Please request a new one.');
    }

    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      await this.otpRepository.deleteById(otpRecord.id);
      throw new BadRequestException(
        'Maximum verification attempts exceeded. Please request a new OTP.',
      );
    }

    const inputHash = hashSha256(code);
    const isMatch = inputHash === otpRecord.codeHash;

    if (!isMatch) {
      await this.otpRepository.incrementAttempts(otpRecord.id);
      throw new BadRequestException('Invalid OTP code.');
    }

    // Successfully verified -> Remove OTP immediately from database
    await this.otpRepository.deleteById(otpRecord.id);
    return true;
  }

  async resend(
    userId: string,
    email: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const windowStart = new Date(Date.now() - this.COOLDOWN_MIN * 60 * 1000);
    const recentCount = await this.otpRepository.countRecentRequests(
      userId,
      purpose,
      windowStart,
    );

    if (recentCount >= this.MAX_ATTEMPTS) {
      throw new HttpException(
        `Too many OTP requests. Please wait ${this.COOLDOWN_MIN} minutes before trying again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Clean up expired or pending OTPs for the same purpose
    await this.otpRepository.deleteExpiredForUser(userId);
    await this.otpRepository.invalidatePendingOtps(userId, purpose);

    // Generate and send new OTP
    await this.generateAndSend(userId, email, purpose);
  }
}
