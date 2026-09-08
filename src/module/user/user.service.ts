import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from '../auth/repositories/refresh-token.repository';
import { Role } from '../../common/enums/role.enum';
import { Provider } from '../../generated/prisma/client';
import { hashPassword } from '../../common/utils/hash.util';
import { QueryUsersDto } from './dto/query-users.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateSuperAdminDto } from './dto/update-superadmin.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  /**
   * List all users with pagination, role filtering, and search
   * Accessible by: ADMIN, SUPER_ADMIN
   */
  async findAll(query: QueryUsersDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.search?.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { fullName: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await this.userRepository.findManyWithPagination({
      where,
      skip,
      take: limit,
    });

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update role of a target user
   * Business Rules:
   * - No one can assign SUPER_ADMIN role (single SuperAdmin rule).
   * - No one can modify the existing SUPER_ADMIN account's role.
   * - ADMIN can only switch roles between USER and MODERATOR.
   * - SUPER_ADMIN can assign ADMIN, MODERATOR, or USER.
   */
  async updateRole(
    targetUserId: string,
    newRole: Role,
    currentUser: { id: string; role: Role },
  ) {
    // 1. Strict Rule: SUPER_ADMIN role cannot be assigned to any user
    if (newRole === Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Cannot assign SUPER_ADMIN role. Only one unique SuperAdmin is permitted in the system.',
      );
    }

    // 2. Fetch target user
    const targetUser = await this.userRepository.findById(targetUserId);

    if (!targetUser) {
      throw new NotFoundException('Target user not found.');
    }

    // 3. Strict Rule: The SuperAdmin account role cannot be tampered with
    if (targetUser.role === Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'The SuperAdmin account role cannot be altered.',
      );
    }

    // 4. Role Transition Rules for ADMIN
    if (currentUser.role === Role.ADMIN) {
      // Admin cannot touch another Admin or SuperAdmin
      if (targetUser.role === Role.ADMIN) {
        throw new ForbiddenException(
          'Admins are not permitted to modify other Admin accounts.',
        );
      }

      // Admin can ONLY switch between USER and MODERATOR
      if (newRole !== Role.USER && newRole !== Role.MODERATOR) {
        throw new ForbiddenException(
          'Admins are only permitted to switch roles between USER and MODERATOR.',
        );
      }
    }

    // 5. Update user role via repository
    const updatedUser = await this.userRepository.updateRole(
      targetUserId,
      newRole,
    );

    return {
      message: `User role successfully changed from ${targetUser.role} to ${newRole}.`,
      user: updatedUser,
    };
  }

  /**
   * Create an ADMIN account directly
   * Accessible strictly by: SUPER_ADMIN
   */
  async createAdmin(
    dto: CreateAdminDto,
    currentUser: { id: string; role: Role },
  ) {
    if (currentUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only the SuperAdmin is authorized to create Admin accounts.',
      );
    }

    const existingUser = await this.userRepository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException(
        'An account with this email address already exists.',
      );
    }

    const hashedPassword = await hashPassword(dto.password);

    const newAdmin = await this.userRepository.create({
      email: dto.email,
      password: hashedPassword,
      fullName: dto.fullName,
      role: Role.ADMIN,
      isVerified: true,
      provider: Provider.LOCAL,
    });

    return {
      message: 'Admin account created successfully.',
      user: newAdmin,
    };
  }

  /**
   * Securely update SuperAdmin's own profile and credentials
   * Accessible strictly by: SUPER_ADMIN
   */
  async updateSuperAdminProfile(
    currentUserId: string,
    dto: UpdateSuperAdminDto,
  ) {
    const superAdmin = await this.userRepository.findById(currentUserId);

    if (!superAdmin || superAdmin.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only the SuperAdmin is permitted to access this endpoint.',
      );
    }

    const updateData: any = {};

    // 1. Email change check
    if (dto.email && dto.email !== superAdmin.email) {
      const emailExists = await this.userRepository.findByEmail(dto.email);
      if (emailExists) {
        throw new ConflictException('Email is already taken by another account.');
      }
      updateData.email = dto.email;
    }

    // 2. Full Name change
    if (dto.fullName !== undefined) {
      updateData.fullName = dto.fullName;
    }

    // 3. Password change
    if (dto.password) {
      updateData.password = await hashPassword(dto.password);
      // Revoke all existing sessions upon password reset for strict security
      await this.refreshTokenRepository.revokeAllForUser(currentUserId);
    }

    const updatedUser = await this.userRepository.update(
      currentUserId,
      updateData,
    );

    return {
      message: 'SuperAdmin credentials updated successfully.',
      user: updatedUser,
    };
  }
}
