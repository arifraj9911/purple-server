import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../../mail/mail.module';

// Repositories
import { UserRepository } from './repositories/user.repository';
import { OtpRepository } from './repositories/otp.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';

// Services
import { AuthService } from './services/auth.service';
import { OtpService } from './services/otp.service';

// Strategies
import { LocalStrategy } from './strategies/local.strategy';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

// Guards
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';

// Controller
import { AuthController } from './auth.controller';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    JwtModule.register({}),
    PrismaModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    // Data Access Repositories
    UserRepository,
    OtpRepository,
    RefreshTokenRepository,

    // Business Logic Services
    AuthService,
    OtpService,

    // Passport Strategies
    LocalStrategy,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    GoogleStrategy,

    // Guards
    LocalAuthGuard,
    JwtAccessGuard,
    JwtRefreshGuard,
    GoogleAuthGuard,
  ],
  exports: [
    AuthService,
    UserRepository,
    PassportModule,
    JwtModule,
  ],
})
export class AuthModule {}
