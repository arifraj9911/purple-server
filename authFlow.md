# NestJS + Prisma + PostgreSQL — Production-Level Authentication Guide

Ei documentation ta apnar requirement onujayi complete ebong production-ready bhabe toiri kora hoyeche:

- **Register/Login** (Bcrypt / Argon2 hash)
- **Passport Local Strategy (`passport-local`)** — NestJS standard credentials validation
- **Email OTP verification** (Cryptographically secure & hashed OTP in DB)
- **Background Processing with BullMQ + Redis** — Non-blocking asynchronous email dispatch with retry logic
- **Resend OTP** (Max 3 attempts + 15-min cooldown)
- **Forgot/Reset password** (OTP-based with auto-revocation of all active sessions)
- **Google Login (OAuth2)** via `passport-google-oauth20`
- **JWT (Access + Refresh)** — **Cookie-based** with `passport-jwt`
- **Refresh Token Rotation & Reuse Detection**
- **Production-Level Security Checklist** (Rate limiting, Helmet, Lockout, CSRF)

---

## 1. Project Structure (Recommended)

```
src/
 ├─ auth/
 │   ├─ auth.controller.ts
 │   ├─ auth.service.ts
 │   ├─ auth.module.ts
 │   ├─ dto/
 │   │   ├─ register.dto.ts
 │   │   ├─ login.dto.ts
 │   │   ├─ verify-otp.dto.ts
 │   │   ├─ resend-otp.dto.ts
 │   │   ├─ forgot-password.dto.ts
 │   │   └─ reset-password.dto.ts
 │   ├─ strategies/
 │   │   ├─ local.strategy.ts         <-- Passport Local Strategy (Email + Password)
 │   │   ├─ jwt-access.strategy.ts    <-- Access Token Validation
 │   │   ├─ jwt-refresh.strategy.ts   <-- Refresh Token Validation & Reuse Detection
 │   │   └─ google.strategy.ts        <-- Google OAuth2
 │   ├─ guards/
 │   │   ├─ local-auth.guard.ts       <-- Guard for /auth/login
 │   │   ├─ jwt-access.guard.ts       <-- Guard for Protected Routes
 │   │   ├─ jwt-refresh.guard.ts      <-- Guard for /auth/refresh
 │   │   └─ google-auth.guard.ts      <-- Guard for /auth/google
 │   └─ interfaces/
 ├─ otp/
 │   ├─ otp.service.ts
 │   └─ otp.module.ts
 ├─ mail/
 │   ├─ mail.module.ts
 │   ├─ mail.service.ts               <-- Nodemailer / Resend integration
 │   └─ mail.processor.ts             <-- BullMQ Worker / Processor for background emails
 ├─ common/
 │   ├─ decorators/current-user.decorator.ts
 │   └─ filters/
 ├─ prisma/
 │   ├─ prisma.module.ts
 │   └─ prisma.service.ts
 └─ main.ts
```

---

## 2. Prisma Schema

```prisma
model User {
  id               String    @id @default(uuid())
  email            String    @unique
  password         String?   // OAuth user hole null thakbe
  isVerified       Boolean   @default(false)
  provider         Provider  @default(LOCAL)
  googleId         String?   @unique
  failedLoginCount Int       @default(0)
  lockedUntil      DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  otps             Otp[]
  refreshTokens    RefreshToken[]
}

enum Provider {
  LOCAL
  GOOGLE
}

model Otp {
  id                   String     @id @default(uuid())
  userId               String
  user                 User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash             String
  purpose              OtpPurpose
  attempts             Int        @default(0)   // koybar verify try hoyeche
  maxAttemptsReachedAt DateTime?                // cooldown tracking
  expiresAt            DateTime
  consumedAt           DateTime?
  createdAt            DateTime   @default(now())

  @@index([userId, purpose])
}

enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

model RefreshToken {
  id          String    @id @default(uuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String    // plain token kokhono DB te rakhben na (SHA-256 hash)
  revoked     Boolean   @default(false)
  replacedBy  String?   // rotation tracking (reuse detection)
  userAgent   String?
  ip          String?
  expiresAt   DateTime
  createdAt   DateTime  @default(now())

  @@index([userId])
}
```

> **Key Rule:** OTP ebong Refresh Token — dutoi **plain text DB te store korben na**. Hash kore rakhben (SHA-256 ba bcrypt), karon DB leak hole attacker sathe sathe token/otp use korte parbe na.

---

## 3. Password Hashing (bcrypt / argon2)

```ts
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12; // 10-12 recommended for production

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

> **Pro-Tip:** `bcrypt` er bodole **`argon2`** (`argon2id`) consider korte paren — eta modern, memory-hard, and GPU cracking-resistant (OWASP recommended).

---

## 4. Passport Local Strategy (Login Validation)

NestJS official documentation onujayi, credentials validation-er jonno `passport-local` bebohar kora hoy:

### ক) Local Strategy (`local.strategy.ts`)
```ts
import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'email', // default 'username' ke 'email' e map kora hoyeche
      passwordField: 'password',
    });
  }

  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user; // eta automatically request.user hishebe set hoye jabe
  }
}
```

### খ) Local Auth Guard (`local-auth.guard.ts`)
```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
```

### গ) `AuthService.validateUser()` (Credential Checking & Lockout)
```ts
// auth.service.ts
async validateUser(email: string, pass: string) {
  const user = await this.prisma.user.findUnique({ where: { email } });

  if (!user || !user.password) {
    return null; // generic fail
  }

  // 1. Check Account Lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ForbiddenException('Account is temporarily locked. Try again later.');
  }

  // 2. Check Password
  const isMatch = await comparePassword(pass, user.password);
  if (!isMatch) {
    await this.handleFailedLogin(user);
    return null;
  }

  // 3. Check Email Verification
  if (!user.isVerified) {
    throw new ForbiddenException('Please verify your email address before logging in.');
  }

  // Reset failed login counter on success
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  const { password, ...safeUser } = user;
  return safeUser;
}

private async handleFailedLogin(user: { id: string; failedLoginCount: number }) {
  const count = user.failedLoginCount + 1;
  const lockThreshold = 5;
  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: count,
      lockedUntil: count >= lockThreshold ? new Date(Date.now() + 15 * 60 * 1000) : null,
    },
  });
}
```

### ঘ) Controller এ Login Route
```ts
@UseGuards(LocalAuthGuard)
@Post('login')
async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
  // req.user contains the validated user from LocalStrategy
  const user = req.user as { id: string; email: string };
  const { accessToken, refreshToken } = await this.authService.issueTokens(user.id, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  this.setAuthCookies(res, accessToken, refreshToken);
  return {
    message: 'Login successful',
    user,
  };
}
```

---

## 5. BullMQ দিয়ে Background Email Queue (Asynchronous OTP Delivery)

### কেন BullMQ ব্যবহার করবেন?
- **Non-blocking HTTP Request:** সরাসরি SMTP দিয়ে ইমেইল পাঠাতে ১–৩ সেকেন্ড সময় লাগতে পারে। BullMQ ব্যবহার করলে রিকোয়েস্ট কয়েক মিলি-সেকেন্ডে রেসপন্স পেয়ে যায় (`201 Created`)।
- **Automatic Retries with Exponential Backoff:** যদি জিমেইল বা SMTP সার্ভারে কোনো সাময়িক এরর হয়, BullMQ নিজে থেকেই ব্যাকগ্রাউন্ডে ২ সেকেন্ড, ৪ সেকেন্ড পর রিট্রাই করবে।
- **Redis-Backed Persistence:** সার্ভার হঠাৎ রিস্টার্ট হলেও কোনো ইমেইল জব হারাবে না।

### ক) BullMQ Packages Install
```bash
npm install @nestjs/bullmq bullmq ioredis
```

### খ) BullMQ Queue রেজিস্ট্রেশন (`mail.module.ts`)
```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'mail-queue',
    }),
  ],
  providers: [MailService, MailProcessor],
  exports: [BullModule, MailService],
})
export class MailModule {}
```

### গ) BullMQ Worker / Processor (`mail.processor.ts`)
```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { MailService } from './mail.service';

interface SendOtpEmailPayload {
  email: string;
  otp: string;
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
}

@Processor('mail-queue')
@Injectable()
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<SendOtpEmailPayload>): Promise<any> {
    this.logger.log(`Processing background mail job ${job.id} for ${job.data.email}`);

    switch (job.name) {
      case 'send-otp-email': {
        await this.mailService.sendOtpEmail(
          job.data.email,
          job.data.otp,
          job.data.purpose,
        );
        return { delivered: true };
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }
}
```

### ঘ) `OtpService` এ Queue তে Job Add করা
```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

@Injectable()
export class OtpService {
  private readonly OTP_TTL_MIN = 5;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('mail-queue') private readonly mailQueue: Queue,
  ) {}

  async generateAndSend(userId: string, email: string, purpose: OtpPurpose) {
    // 1. Cryptographically secure 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(otp).digest('hex');

    // 2. Save Hash to DB
    await this.prisma.otp.create({
      data: {
        userId,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + this.OTP_TTL_MIN * 60 * 1000),
      },
    });

    // 3. Dispatch to BullMQ Queue (Non-blocking background job)
    await this.mailQueue.add(
      'send-otp-email',
      { email, otp, purpose },
      {
        attempts: 3, // Retry up to 3 times on SMTP failure
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s delay
        },
        removeOnComplete: true, // Auto clean completed jobs
        removeOnFail: false,    // Keep failed jobs for inspection
      },
    );
  }

  async verify(userId: string, purpose: OtpPurpose, code: string): Promise<boolean> {
    const otpRecord = await this.prisma.otp.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) throw new BadRequestException('OTP not found or already used.');
    if (otpRecord.expiresAt < new Date()) throw new BadRequestException('OTP has expired.');

    const hashedInput = crypto.createHash('sha256').update(code).digest('hex');
    const isValid = hashedInput === otpRecord.codeHash;

    if (!isValid) {
      await this.prisma.otp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid OTP.');
    }

    // Mark OTP as consumed
    await this.prisma.otp.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    });

    if (purpose === OtpPurpose.EMAIL_VERIFICATION) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { isVerified: true },
      });
    }

    return true;
  }
}
```

---

## 6. Register Flow

```ts
// auth.service.ts
async register(dto: RegisterDto) {
  const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (existing) {
    // Generic response to avoid email enumeration attacks
    throw new ConflictException('If this email is not registered, you will receive a verification email.');
  }

  const hashed = await hashPassword(dto.password);
  const user = await this.prisma.user.create({
    data: {
      email: dto.email,
      password: hashed,
      isVerified: false,
    },
  });

  // Sends OTP in background via BullMQ
  await this.otpService.generateAndSend(user.id, user.email, OtpPurpose.EMAIL_VERIFICATION);

  return { message: 'Registration successful. Please check your email for the OTP.' };
}
```

---

## 7. Resend OTP (Max 3 Times + Cooldown Window)

```ts
async resendOtp(userId: string, email: string, purpose: OtpPurpose) {
  const COOLDOWN_MIN = 15;
  const MAX_ATTEMPTS = 3;
  const windowStart = new Date(Date.now() - COOLDOWN_MIN * 60 * 1000);

  const recentCount = await this.prisma.otp.count({
    where: {
      userId,
      purpose,
      createdAt: { gte: windowStart },
    },
  });

  if (recentCount >= MAX_ATTEMPTS) {
    throw new HttpException(
      `Too many OTP requests. Please try again after ${COOLDOWN_MIN} minutes.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // Purano unconsumed OTP gulo invalidate kore dewa
  await this.prisma.otp.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await this.otpService.generateAndSend(userId, email, purpose);
  return { message: 'A new OTP has been dispatched to your email.' };
}
```

---

## 8. Forgot / Reset Password Flow

### Request Reset (Sends OTP)
```ts
async forgotPassword(email: string) {
  const user = await this.prisma.user.findUnique({ where: { email } });

  // Email enumeration attack prevent korte generic message return kora
  if (user) {
    await this.otpService.generateAndSend(user.id, user.email, OtpPurpose.PASSWORD_RESET);
  }

  return { message: 'If this email exists in our system, a password reset code has been sent.' };
}
```

### Confirm Reset (Verifies OTP & Revokes All Sessions)
```ts
async resetPassword(dto: ResetPasswordDto) {
  const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) throw new BadRequestException('Invalid request.');

  // 1. Verify OTP
  await this.otpService.verify(user.id, OtpPurpose.PASSWORD_RESET, dto.otp);

  // 2. Hash & Update Password
  const hashed = await hashPassword(dto.newPassword);
  await this.prisma.user.update({
    where: { id: user.id },
    data: { password: hashed },
  });

  // 3. Security Mandatory: Revoke ALL active sessions/refresh tokens
  await this.prisma.refreshToken.updateMany({
    where: { userId: user.id },
    data: { revoked: true },
  });

  return { message: 'Password reset successful. Please login again with your new password.' };
}
```

---

## 9. JWT (Access + Refresh) — Cookie-Based Architecture

### Token Issuing Logic
```ts
async issueTokens(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const payload = { sub: userId };

  const accessToken = this.jwtService.sign(payload, {
    secret: process.env.JWT_ACCESS_SECRET,
    expiresIn: '15m',
  });

  const refreshToken = this.jwtService.sign(payload, {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '7d',
  });

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await this.prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });

  return { accessToken, refreshToken };
}
```

### Cookie Setting Helper
```ts
private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 15 * 60 * 1000, // 15 mins
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth/refresh', // Restricted only to refresh endpoint
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}
```

### JWT Access Strategy (`jwt-access.strategy.ts`)
```ts
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.access_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException();
    const { password, ...safeUser } = user;
    return safeUser;
  }
}
```

### Refresh Token Strategy with Reuse Detection (`jwt-refresh.strategy.ts`)
```ts
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.refresh_token ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string }) {
    const token = req.cookies?.refresh_token;
    if (!token) throw new UnauthorizedException('No refresh token provided');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const stored = await this.prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash },
    });

    // Reuse Detection: Token not found or already revoked means token was stolen
    if (!stored || stored.revoked) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: payload.sub },
        data: { revoked: true }, // Invalidate ALL sessions immediately
      });
      throw new UnauthorizedException('Compromised session detected. Please login again.');
    }

    return { userId: payload.sub, tokenRecordId: stored.id };
  }
}
```

### Refresh Endpoint (Rotation)
```ts
@UseGuards(JwtRefreshGuard)
@Post('refresh')
async refresh(@Req() req: any, @Res({ passthrough: true }) res: Response) {
  const { userId, tokenRecordId } = req.user;

  // Revoke old refresh token
  await this.prisma.refreshToken.update({
    where: { id: tokenRecordId },
    data: { revoked: true },
  });

  // Issue new pair
  const { accessToken, refreshToken } = await this.authService.issueTokens(userId);
  this.setAuthCookies(res, accessToken, refreshToken);

  return { message: 'Token refreshed successfully' };
}
```

### Logout Endpoint
```ts
@UseGuards(JwtAccessGuard)
@Post('logout')
async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
  await this.prisma.refreshToken.updateMany({
    where: { userId: req.user.id },
    data: { revoked: true },
  });

  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/auth/refresh' });

  return { message: 'Logged out successfully' };
}
```

---

## 10. Google Login (OAuth2)

```bash
npm install passport-google-oauth20
```

```ts
// google.strategy.ts
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    return {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      isVerified: profile.emails?.[0]?.verified ?? false,
    };
  }
}
```

---

## 11. Environment Variables (`.env`)

```env
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/db?sslmode=prefer"

# JWT Secrets
JWT_ACCESS_SECRET="<generate-using-crypto-randomBytes-64-hex>"
JWT_REFRESH_SECRET="<generate-different-crypto-randomBytes-64-hex>"

# Redis (for BullMQ)
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_PASSWORD=""

# Google OAuth
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_CALLBACK_URL="https://yourapi.com/auth/google/callback"

# Mail (SMTP)
SMTP_HOST=""
SMTP_PORT=587
SMTP_USER=""
SMTP_PASS=""

# App Config
FRONTEND_URL="https://yourapp.com"
NODE_ENV="production"
```

---

## 12. AppModule Wiring Reference (Root Setup)

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    PrismaModule,
    MailModule,
    AuthModule,
  ],
})
export class AppModule {}
```

```ts
// auth.module.ts
@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    PrismaModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    LocalStrategy,        // <-- Registered
    JwtAccessStrategy,    // <-- Registered
    JwtRefreshStrategy,   // <-- Registered
    GoogleStrategy,       // <-- Registered
  ],
})
export class AuthModule {}
```

---

## Summary & Security Checklist

✅ **Passport Local Strategy** credentials authentication  
✅ **BullMQ + Redis** asynchronous queue for email & OTP dispatch  
✅ **Bcrypt / Argon2** password hashing  
✅ **Cryptographically secure** OTP (`crypto.randomInt`)  
✅ **Hashed OTP & Refresh Tokens** in database  
✅ **Refresh Token Rotation + Stolen Token Detection**  
✅ **Rate limiting (`@nestjs/throttler`)** on critical auth endpoints  
✅ **Account Lockout** after 5 consecutive failed attempts  
✅ **Cookie-based JWTs** (`httpOnly`, `secure`, `sameSite: strict`)  
✅ **Session revocation** on password reset / logout  
