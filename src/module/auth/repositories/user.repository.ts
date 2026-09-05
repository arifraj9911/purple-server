import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { User, Prisma, Provider } from '../../../generated/prisma/client';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { googleId },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async update(params: {
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;
    return this.prisma.user.update({
      where,
      data,
    });
  }

  async incrementFailedLogin(
    userId: string,
    lockThreshold = 5,
    lockMinutes = 15,
  ): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const newCount = (user?.failedLoginCount ?? 0) + 1;
    const lockedUntil =
      newCount >= lockThreshold
        ? new Date(Date.now() + lockMinutes * 60 * 1000)
        : null;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: newCount,
        lockedUntil,
      },
    });
  }

  async resetFailedLogin(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }

  async verifyEmail(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isVerified: true },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });
  }
}
