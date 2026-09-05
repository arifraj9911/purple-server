import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRepository } from '../repositories/user.repository';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { OtpService } from './otp.service';
import { RegisterDto } from '../dto/register.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { ResendOtpDto } from '../dto/resend-otp.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import {
  comparePassword,
  hashPassword,
  hashSha256,
} from '../../../common/utils/hash.util';
import { OtpPurpose, Provider, User } from '../../../generated/prisma/client';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ClientMetadata {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Validates local login credentials for Passport LocalStrategy
   */
  async validateUser(email: string, pass: string): Promise<Partial<User> | null> {
    const user = await this.userRepository.findByEmail(email);

    if (!user || !user.password) {
      return null;
    }

    // 1. Account Lockout Check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
      );
    }

    // 2. Password Verification with Argon2
    const isPasswordValid = await comparePassword(pass, user.password);
    if (!isPasswordValid) {
      await this.userRepository.incrementFailedLogin(user.id, 5, 15);
      return null;
    }

    // 3. Email Verification Check
    if (!user.isVerified) {
      throw new ForbiddenException(
        'Please verify your email address before logging in.',
      );
    }

    // Reset failed login counter upon successful authentication
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.userRepository.resetFailedLogin(user.id);
    }

    const { password, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Register a new user and dispatch OTP
   */
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      // Prevents email enumeration by returning a generic response or conflict
      throw new ConflictException(
        'An account with this email address already exists.',
      );
    }

    const hashedPassword = await hashPassword(dto.password);
    const user = await this.userRepository.create({
      email: dto.email,
      password: hashedPassword,
      isVerified: false,
      provider: Provider.LOCAL,
    });

    // Generate and dispatch OTP via BullMQ background queue
    await this.otpService.generateAndSend(
      user.id,
      user.email,
      OtpPurpose.EMAIL_VERIFICATION,
    );

    return {
      message: 'Registration successful. A verification OTP has been sent to your email.',
    };
  }

  /**
   * Verify an OTP for Email Verification or Password Reset
   */
  async verifyOtp(dto: VerifyOtpDto): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('User not found or invalid request.');
    }

    await this.otpService.verify(user.id, dto.purpose, dto.code);

    if (dto.purpose === OtpPurpose.EMAIL_VERIFICATION) {
      await this.userRepository.verifyEmail(user.id);
    }

    return {
      message:
        dto.purpose === OtpPurpose.EMAIL_VERIFICATION
          ? 'Email successfully verified. You may now log in.'
          : 'OTP verified successfully. You may now reset your password.',
    };
  }

  /**
   * Resend an OTP code with 15-minute cooldown limit
   */
  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (user) {
      await this.otpService.resend(user.id, user.email, dto.purpose);
    }

    return {
      message: 'If the provided email is registered, a new OTP code has been dispatched.',
    };
  }

  /**
   * Initiate forgot password flow
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (user) {
      await this.otpService.generateAndSend(
        user.id,
        user.email,
        OtpPurpose.PASSWORD_RESET,
      );
    }

    return {
      message: 'If an account exists with this email, a password reset OTP has been dispatched.',
    };
  }

  /**
   * Complete password reset and revoke all existing refresh tokens
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Invalid request.');
    }

    // 1. Verify Reset OTP
    await this.otpService.verify(user.id, OtpPurpose.PASSWORD_RESET, dto.otp);

    // 2. Hash new password with Argon2
    const hashedPassword = await hashPassword(dto.newPassword);
    await this.userRepository.updatePassword(user.id, hashedPassword);

    // 3. Security Mandatory: Revoke all active sessions
    await this.refreshTokenRepository.revokeAllForUser(user.id);

    return {
      message: 'Password has been reset successfully. Please login with your new password.',
    };
  }

  /**
   * Issue JWT access and refresh token pair
   */
  async issueTokens(
    userId: string,
    meta?: ClientMetadata,
  ): Promise<TokenPair> {
    const payload = { sub: userId };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    const tokenHash = hashSha256(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.refreshTokenRepository.create({
      userId,
      tokenHash,
      expiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });

    return { accessToken, refreshToken };
  }

  /**
   * Refresh access token with Refresh Token Rotation
   */
  async refreshTokens(
    userId: string,
    tokenRecordId: string,
    meta?: ClientMetadata,
  ): Promise<TokenPair> {
    // Revoke old refresh token (Rotation)
    await this.refreshTokenRepository.revokeById(tokenRecordId);

    // Issue fresh pair
    return this.issueTokens(userId, meta);
  }

  /**
   * Logout user by revoking all refresh tokens
   */
  async logout(userId: string): Promise<void> {
    await this.refreshTokenRepository.revokeAllForUser(userId);
  }

  /**
   * Get user profile by ID
   */
  async getProfile(userId: string): Promise<Partial<User>> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }
    const { password, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Handle Google OAuth user authentication
   */
  async handleGoogleUser(
    profile: { googleId: string; email: string; isVerified: boolean },
    meta?: ClientMetadata,
  ): Promise<TokenPair> {
    let user = await this.userRepository.findByGoogleId(profile.googleId);

    if (!user) {
      user = await this.userRepository.findByEmail(profile.email);
      if (user) {
        user = await this.userRepository.update({
          where: { id: user.id },
          data: {
            googleId: profile.googleId,
            isVerified: true,
          },
        });
      } else {
        user = await this.userRepository.create({
          email: profile.email,
          googleId: profile.googleId,
          provider: Provider.GOOGLE,
          isVerified: profile.isVerified ?? true,
        });
      }
    }

    return this.issueTokens(user.id, meta);
  }
}
