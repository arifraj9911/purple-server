import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OtpRepository } from './repositories/otp.repository';

export interface CleanupOtpJobPayload {
  otpId: string;
}

@Processor('otp-queue')
@Injectable()
export class OtpProcessor extends WorkerHost {
  private readonly logger = new Logger(OtpProcessor.name);

  constructor(private readonly otpRepository: OtpRepository) {
    super();
  }

  @OnWorkerEvent('ready')
  onReady() {
    this.logger.log('🚀 BullMQ Worker is ready and listening for jobs in [otp-queue]');
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(`⚠️ BullMQ OtpProcessor error: ${error.message}`);
  }

  async process(job: Job<CleanupOtpJobPayload>): Promise<any> {
    switch (job.name) {
      case 'cleanup-expired-otp': {
        const result = await this.otpRepository.deleteById(job.data.otpId);
        if (result.count > 0) {
          this.logger.log(
            `[BullMQ] 🧹 Automatically removed expired OTP #${job.data.otpId} from database`,
          );
        }
        return { cleaned: true, count: result.count };
      }
      default:
        this.logger.warn(`Unrecognized job in otp-queue: ${job.name}`);
        return { skipped: true };
    }
  }
}
