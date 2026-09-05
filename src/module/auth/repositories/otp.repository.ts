import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Otp, OtpPurpose, Prisma } from '../../../generated/prisma/client';

@Injectable()
export class OtpRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<Otp> {
    return this.prisma.otp.create({
      data: {
        userId: data.userId,
        codeHash: data.codeHash,
        purpose: data.purpose,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findLatestPending(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<Otp | null> {
    return this.prisma.otp.findFirst({
      where: {
        userId,
        purpose,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countRecentRequests(
    userId: string,
    purpose: OtpPurpose,
    since: Date,
  ): Promise<number> {
    return this.prisma.otp.count({
      where: {
        userId,
        purpose,
        createdAt: { gte: since },
      },
    });
  }

  async invalidatePendingOtps(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.otp.updateMany({
      where: {
        userId,
        purpose,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });
  }

  async incrementAttempts(id: string): Promise<Otp> {
    return this.prisma.otp.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
      },
    });
  }

  async markConsumed(id: string): Promise<Otp> {
    return this.prisma.otp.update({
      where: { id },
      data: {
        consumedAt: new Date(),
      },
    });
  }

  async deleteById(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.otp.deleteMany({
      where: { id },
    });
  }

  async deleteExpiredForUser(userId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.otp.deleteMany({
      where: {
        userId,
        expiresAt: { lt: new Date() },
      },
    });
  }
}
