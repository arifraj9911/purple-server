import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { hashPassword } from '../common/utils/hash.util';
import { Role, Provider } from '../generated/prisma/client';

@Injectable()
export class SuperAdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrapService.name);

  // Default fallback credentials if not provided in .env
  private readonly DEFAULT_EMAIL = 'superadmin@purple-bd.com';
  private readonly DEFAULT_PASSWORD = 'SuperSecretPassword123!';
  private readonly DEFAULT_NAME = 'System Super Admin';

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.bootstrapSuperAdmin();
  }

  /**
   * Idempotently bootstraps a single SuperAdmin account upon application start.
   * Guarantees strictly one SuperAdmin can exist in the system.
   */
  async bootstrapSuperAdmin(): Promise<void> {
    try {
      // 1. Check if ANY SuperAdmin already exists in the database
      const existingSuperAdmin = await this.prisma.user.findFirst({
        where: { role: Role.SUPER_ADMIN },
      });

      if (existingSuperAdmin) {
        this.logger.log(
          `SuperAdmin account already exists (${existingSuperAdmin.email}). Skipping auto-bootstrap.`,
        );
        return;
      }

      // 2. Fetch credentials from environment or fall back to safe code defaults
      const email =
        process.env.SUPER_ADMIN_EMAIL?.trim() || this.DEFAULT_EMAIL;
      const rawPassword =
        process.env.SUPER_ADMIN_PASSWORD || this.DEFAULT_PASSWORD;
      const fullName =
        process.env.SUPER_ADMIN_NAME?.trim() || this.DEFAULT_NAME;

      // 3. Hash password using Argon2id
      const hashedPassword = await hashPassword(rawPassword);

      // 4. Check if an account already exists with that email
      const userWithEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (userWithEmail) {
        // Upgrade existing user to SUPER_ADMIN
        await this.prisma.user.update({
          where: { id: userWithEmail.id },
          data: {
            role: Role.SUPER_ADMIN,
            password: hashedPassword,
            isVerified: true,
            fullName: fullName || userWithEmail.fullName,
          },
        });
        this.logger.log(
          `Existing user (${email}) upgraded to unique SUPER_ADMIN successfully.`,
        );
      } else {
        // Create brand new SUPER_ADMIN
        await this.prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            fullName,
            role: Role.SUPER_ADMIN,
            isVerified: true,
            provider: Provider.LOCAL,
          },
        });
        this.logger.log(
          `Initial SUPER_ADMIN account created successfully for: ${email}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to bootstrap SuperAdmin account: ${error.message}`,
        error.stack,
      );
    }
  }
}
