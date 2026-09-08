import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma, User } from '../../../generated/prisma/client';
import { Role } from '../../../common/enums/role.enum';

export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isVerified: true,
  provider: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find paginated users and total count in a single transaction
   */
  async findManyWithPagination(params: {
    where?: Prisma.UserWhereInput;
    skip: number;
    take: number;
  }): Promise<[SafeUser[], number]> {
    const { where, skip, take } = params;

    return Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        select: SAFE_USER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
  }

  /**
   * Find raw user by ID including security fields (password, lockedUntil, etc.)
   */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * Find safe user by ID excluding sensitive security fields
   */
  async findSafeById(id: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * Find user by unique email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Update role for a specific user
   */
  async updateRole(id: string, role: Role): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * Create a new user record
   */
  async create(data: Prisma.UserCreateInput): Promise<SafeUser> {
    return this.prisma.user.create({
      data,
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * Update user details (e.g. email, password, fullName)
   */
  async update(id: string, data: Prisma.UserUpdateInput): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_USER_SELECT,
    });
  }
}
