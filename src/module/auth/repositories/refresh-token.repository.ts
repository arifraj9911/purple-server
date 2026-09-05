import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RefreshToken, Prisma } from '../../../generated/prisma/client';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        ip: data.ip,
        userAgent: data.userAgent,
      },
    });
  }

  async findByTokenHash(
    userId: string,
    tokenHash: string,
  ): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findFirst({
      where: {
        userId,
        tokenHash,
      },
    });
  }

  async revokeById(id: string, replacedBy?: string): Promise<RefreshToken> {
    return this.prisma.refreshToken.update({
      where: { id },
      data: {
        revoked: true,
        replacedBy,
      },
    });
  }

  async revokeAllForUser(userId: string): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
      },
      data: {
        revoked: true,
      },
    });
  }
}
