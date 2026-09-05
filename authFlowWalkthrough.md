# 🛡️ Production Authentication System — Walkthrough & Implementation Guide

A comprehensive, developer-friendly guide detailing how authentication, authorization, session management, and security operate in this NestJS application.

The codebase strictly adheres to the clean 4-tier layered architecture:
$$\mathbf{Repository} \longrightarrow \mathbf{Service} \longrightarrow \mathbf{Controller} \longrightarrow \mathbf{Module}$$

---

## 📑 Table of Contents

1. [High-Level Architecture & Request Pipeline](#1-high-level-architecture--request-pipeline)
2. [Step-by-Step Authentication Flows](#2-step-by-step-authentication-flows)
   - [Flow 1: Registration & OTP Email Verification](#flow-1-registration--otp-email-verification)
   - [Flow 2: Login & Session Establishment](#flow-2-login--session-establishment)
   - [Flow 3: Token Refresh & Rotation (Theft Detection)](#flow-3-token-refresh--rotation-theft-detection)
   - [Flow 4: Forgot & Reset Password](#flow-4-forgot--reset-password)
   - [Flow 5: Google OAuth 2.0 Social Login](#flow-5-google-oauth-20-social-login)
   - [Flow 6: Secure Logout](#flow-6-secure-logout)
3. [Complete API Endpoints & Payload Reference](#3-complete-api-endpoints--payload-reference)
4. [Security Highlights & Defense-in-Depth](#4-security-highlights--defense-in-depth)
5. [Codebase Directory & File Responsibility Map](#5-codebase-directory--file-responsibility-map)
6. [Environment Setup & Testing Guide](#6-environment-setup--testing-guide)

---

## 1. High-Level Architecture & Request Pipeline

Every incoming request passes through an enterprise request-response pipeline designed for validation, security, and consistent API responses:

```text
[ Client (Browser / Mobile) ]
             │
             ▼
    [ main.ts Global Pipeline ]
        ├── Cookie Parser (Extracts HTTP-only cookies)
        ├── Validation Pipe (Validates DTO types & password strength)
        └── CORS (Configured with credentials: true)
             │
             ▼
      [ Route Guard & Strategy ]
        ├── Public / None (Register, OTP, Forgot Password)
        ├── LocalAuthGuard (Passport Local Strategy for Login)
        ├── JwtAccessGuard (Passport JWT Strategy for /auth/me, /auth/logout)
        ├── JwtRefreshGuard (Passport JWT Strategy for /auth/refresh)
        └── GoogleAuthGuard (Passport Google OAuth 2.0 Strategy)
             │
             ▼
       [ AuthController ]  ─── Handles HTTP requests, cookies & redirection
             │
             ▼
       [ Service Layer ]
        ├── AuthService    ─── Authentication rules, token lifecycle, lockout logic
        ├── OtpService     ─── OTP generation, hashing, rate limiting, cooldowns
        └── MailService    ─── Email HTML templates & Nodemailer transport
             │
             ├─── [ Background Asynchronous Queue ]
             │       └── BullMQ + Redis Worker (Handles emails with 3x retry & backoff)
             │
             ▼
      [ Repository Layer ]
        ├── UserRepository         ─── User CRUD, failed login counters, verification
        ├── OtpRepository          ─── OTP storage, attempt counter, expiry lookup
        └── RefreshTokenRepository ─── Token hashes, IP/UserAgent metadata, revocation
             │
             ▼
  [ PostgreSQL Database (Prisma ORM) ]
```

---

## 2. Step-by-Step Authentication Flows

### Flow 1: Registration & OTP Email Verification

This flow registers a new user with an unverified account and dispatches a one-time password (OTP) asynchronously.

#### Detailed Lifecycle Steps:
1. **Client Request**: The client submits `POST /auth/register` with `email` and `password`.
2. **DTO Validation**: `RegisterDto` validates the email format and enforces strong password rules (min 8 chars, 1 uppercase, 1 lowercase, 1 number/symbol).
3. **Duplicate Check**: `AuthService` queries `UserRepository.findByEmail()`. If already taken, it returns `409 Conflict`.
4. **Password Hashing**: The password is encrypted with **Argon2id** (resistant to GPU and ASIC brute-force attacks).
5. **User Creation**: The user is stored with `isVerified = false` and `provider = LOCAL`.
6. **OTP Generation & Hashing**:
   - `OtpService` creates a cryptographically secure 6-digit integer using `crypto.randomInt()`.
   - The plain code is hashed with **SHA-256** before database storage.
   - The OTP record is saved with a **5-minute expiration timestamp**.
7. **Background Queue Dispatch**:
   - A job named `send-otp-email` is placed into the **BullMQ** queue backed by Redis.
   - The HTTP response completes immediately with `201 Created` without waiting for SMTP network latency.
8. **Asynchronous Mail Worker**:
   - `MailProcessor` picks up the job in the background and sends the email via Nodemailer.
   - *Dev Fallback*: If SMTP credentials are not yet configured in `.env`, the code is printed directly to the terminal console (`[DEV MODE OTP]`).
9. **Account Verification**:
   - The user receives the 6-digit code and calls `POST /auth/verify-otp`.
   - The system checks the code hash and expiry, marks the user as `isVerified = true`, and consumes the OTP.

---

### Flow 2: Login & Session Establishment

Authenticates credentials, guards against brute-force attacks, and issues short-lived access and long-lived refresh tokens.

#### Detailed Lifecycle Steps:
1. **Client Request**: Client sends `POST /auth/login` with `{ email, password }`.
2. **Passport Local Guard Activation**:
   - `LocalAuthGuard` intercepts the request and invokes `LocalStrategy.validate()`.
   - `LocalStrategy` delegates to `AuthService.validateUser(email, password)`.
3. **Account Lockout Check**:
   - If `user.lockedUntil` is set and has not elapsed, the server throws `403 Forbidden` (`Account temporarily locked`).
4. **Password Verification**:
   - `comparePassword(password, user.password)` tests the input against the stored Argon2id hash.
   - **On Failure**: `UserRepository.incrementFailedLogin()` increases the failure counter. Once 5 failed attempts occur within a window, the account is locked for 15 minutes.
   - **On Success**: The failed login counter is immediately reset to 0.
5. **Verification Check**: If `user.isVerified === false`, login is blocked with `403 Forbidden`.
6. **Token Issuance**:
   - **Access Token**: Signed JWT with 15-minute expiration.
   - **Refresh Token**: Signed JWT with 7-day expiration.
   - The refresh token's **SHA-256 hash** is saved in `RefreshTokenRepository` along with client IP and User-Agent.
7. **HTTP-Only Cookies**:
   - `access_token`: Stored in an `HttpOnly`, `SameSite=Strict`, `path=/` cookie (15 min).
   - `refresh_token`: Stored in an `HttpOnly`, `SameSite=Strict`, `path=/auth/refresh` cookie (7 days).
8. **Client Response**: Returns user details and token payload wrapped in the standardized response envelope.

---

### Flow 3: Token Refresh & Rotation (Theft Detection)

Implements RFC 6749 Token Rotation to ensure that stolen refresh tokens cannot be reused indefinitely.

```text
[ Client Request: POST /auth/refresh with refresh_token cookie ]
                             │
                             ▼
             [ JwtRefreshGuard & Strategy ]
              Checks signature & extracts token hash
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   [ Token Already Revoked? ]       [ Token Valid & Active ]
            │                                 │
     (Theft Detected!)                        ├── Revoke current token
            │                                 ├── Issue new Access Token (15m)
            ▼                                 ├── Issue new Refresh Token (7d)
   Revoke ALL Sessions for User!              └── Store new token hash in DB
            │                                 │
            ▼                                 ▼
    401 Unauthorized                 200 OK + Updated Cookies
```

#### Detailed Lifecycle Steps:
1. When the 15-minute access token expires, the client calls `POST /auth/refresh`.
2. `JwtRefreshGuard` reads the token from the `refresh_token` cookie.
3. `JwtRefreshStrategy` computes the SHA-256 hash of the token and checks the database:
   - **Scenario A (Normal Rotation)**: The token exists and is active. The system immediately revokes the current token and issues a brand-new token pair.
   - **Scenario B (Token Reuse / Theft Detected)**: If someone submits a token that was **already revoked**, the system detects a potential replay attack and **immediately revokes all active refresh tokens for that user**, instantly invalidating every active session across all devices.

---

### Flow 4: Forgot & Reset Password

Provides safe password recovery without revealing user existence (anti-enumeration).

#### Detailed Lifecycle Steps:
1. **Initiate Reset (`POST /auth/forgot-password`)**:
   - Client sends `{ email }`.
   - If the user exists, `OtpService` generates a 6-digit code with `purpose = PASSWORD_RESET` (valid for 5 minutes) and enqueues a background email.
   - If the user does not exist, the API still returns the identical success message to prevent user enumeration.
2. **Complete Reset (`POST /auth/reset-password`)**:
   - Client submits `{ email, otp, newPassword }`.
   - `OtpService.verify()` validates the code against the stored SHA-256 hash.
   - The new password is encrypted with **Argon2id** and updated on the user record.
   - **Mandatory Security Action**: `RefreshTokenRepository.revokeAllForUser(user.id)` runs immediately, killing all existing logged-in sessions and forcing everyone to re-authenticate with the new credentials.

---

### Flow 5: Google OAuth 2.0 Social Login

Enables seamless Google authentication with automatic account creation or account linking.

#### Detailed Lifecycle Steps:
1. **Client Redirect**: Client navigates to `GET /auth/google`.
2. **Google Consent Screen**: `GoogleAuthGuard` redirects the browser to Google's authentication server.
3. **OAuth Callback**: Upon approval, Google redirects back to `GET /auth/google/callback` with profile details (email, googleId, name).
4. **Account Resolution**:
   - If a user with this `googleId` exists, log them in.
   - If not, but a local user with the same email exists, link the `googleId` and set `isVerified = true`.
   - If no record exists, create a new user with `provider = GOOGLE` and `isVerified = true`.
5. **Session Cookies & Redirect**: Issues JWT cookies and redirects the browser to `FRONTEND_URL` (e.g. `http://localhost:3000`).

---

### Flow 6: Secure Logout

1. The client calls `POST /auth/logout` (protected by `JwtAccessGuard`).
2. `AuthService.logout(userId)` invokes `RefreshTokenRepository.revokeAllForUser()`, permanently invalidating all stored refresh tokens for that user.
3. The server clears both `access_token` and `refresh_token` cookies on the client browser.

---

## 3. Complete API Endpoints & Payload Reference

All endpoints return a uniform response envelope structured by the global `TransformInterceptor`:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation description",
  "data": {},
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 1. Register User
- **Method & URL**: `POST /auth/register`
- **Protection**: Public (Validated via `RegisterDto`)
- **Request Body**:
```json
{
  "email": "developer@purple-bd.com",
  "password": "Password@123"
}
```
- **Password Requirements**: Minimum 8 characters, at least 1 uppercase, 1 lowercase, and 1 digit or symbol.
- **Success Response (201 Created)**:
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Registration successful. Please check your email for the verification code.",
  "data": {
    "message": "Registration successful. A verification OTP has been sent to your email."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 2. Verify OTP
- **Method & URL**: `POST /auth/verify-otp`
- **Protection**: Public (Validated via `VerifyOtpDto`)
- **Request Body**:
```json
{
  "email": "developer@purple-bd.com",
  "code": "123456",
  "purpose": "EMAIL_VERIFICATION"
}
```
*(Valid `purpose` values: `EMAIL_VERIFICATION`, `PASSWORD_RESET`)*
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "OTP verified successfully.",
  "data": {
    "message": "Email successfully verified. You may now log in."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 3. Resend OTP
- **Method & URL**: `POST /auth/resend-otp`
- **Protection**: Public (Rate-limited to max 3 requests per 15-minute window)
- **Request Body**:
```json
{
  "email": "developer@purple-bd.com",
  "purpose": "EMAIL_VERIFICATION"
}
```
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "If registered, a new OTP has been dispatched to your email.",
  "data": {
    "message": "If the provided email is registered, a new OTP code has been dispatched."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 4. User Login
- **Method & URL**: `POST /auth/login`
- **Protection**: `LocalAuthGuard` (Passport Local Strategy)
- **Request Body**:
```json
{
  "email": "developer@purple-bd.com",
  "password": "Password@123"
}
```
- **Cookies Attached**:
  - `access_token`: Max-Age 15 minutes, HttpOnly, SameSite=Strict, Path=/
  - `refresh_token`: Max-Age 7 days, HttpOnly, SameSite=Strict, Path=/auth/refresh
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "c0a80123-4567-89ab-cdef-0123456789ab",
      "email": "developer@purple-bd.com",
      "role": "USER",
      "isVerified": true,
      "provider": "LOCAL"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsIn..."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 5. Forgot Password
- **Method & URL**: `POST /auth/forgot-password`
- **Protection**: Public
- **Request Body**:
```json
{
  "email": "developer@purple-bd.com"
}
```
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "If an account exists with this email, a reset code has been sent.",
  "data": {
    "message": "If an account exists with this email, a password reset OTP has been dispatched."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 6. Reset Password
- **Method & URL**: `POST /auth/reset-password`
- **Protection**: Public
- **Request Body**:
```json
{
  "email": "developer@purple-bd.com",
  "otp": "654321",
  "newPassword": "NewStrongPassword@999"
}
```
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password has been reset successfully. Please login with your new password.",
  "data": {
    "message": "Password has been reset successfully. Please login with your new password."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 7. Refresh Tokens (Rotation)
- **Method & URL**: `POST /auth/refresh`
- **Protection**: `JwtRefreshGuard` (reads `refresh_token` HTTP-only cookie)
- **Request Body**: Empty
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Token refreshed successfully.",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsIn..."
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 8. Get Authenticated User Profile
- **Method & URL**: `GET /auth/me`
- **Protection**: `JwtAccessGuard` (reads `access_token` cookie or `Authorization: Bearer <token>`)
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "User profile retrieved successfully.",
  "data": {
    "id": "c0a80123-4567-89ab-cdef-0123456789ab",
    "email": "developer@purple-bd.com",
    "role": "USER",
    "isVerified": true,
    "provider": "LOCAL",
    "createdAt": "2026-09-05T10:00:00.000Z",
    "updatedAt": "2026-09-05T10:00:00.000Z"
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 9. User Logout
- **Method & URL**: `POST /auth/logout`
- **Protection**: `JwtAccessGuard`
- **Action**: Wipes refresh tokens from DB and instructs browser to clear cookies.
- **Success Response (200 OK)**:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logged out successfully.",
  "data": {
    "message": "Logged out successfully"
  },
  "timestamp": "2026-09-05T17:50:00.000Z"
}
```

---

### 10. Google OAuth Endpoints
- **Initiate**: `GET /auth/google` (Redirects to Google Sign-In)
- **Callback**: `GET /auth/google/callback` (Completes auth, attaches cookies, redirects to frontend)

---

## 4. Security Highlights & Defense-in-Depth

| Security Pillar | Implementation | Protection Provided |
| :--- | :--- | :--- |
| **Password Hashing** | **Argon2id** (`hash.util.ts`) | Resistant to GPU/ASIC attacks, far superior to legacy MD5/SHA or basic bcrypt. |
| **Data At Rest** | **SHA-256 Hashes** for OTPs & Refresh Tokens | If the database is ever compromised, attackers cannot read active OTPs or valid refresh tokens. |
| **Brute-Force Lockout** | 5 failed attempts $\rightarrow$ 15-minute lock | Neutralizes automated dictionary attacks and password guessing. |
| **Cross-Site Scripting (XSS)** | **HttpOnly, SameSite=Strict** Cookies | JavaScript running in the browser cannot access or steal auth tokens. |
| **Token Theft & Replay** | **Refresh Token Rotation & Reuse Detection** | Replaying an already-used refresh token instantly terminates all active sessions across all devices. |
| **Email Flooding Defense** | Max 3 OTP resends per 15-minute window | Prevents spamming users or depleting email provider quotas. |
| **Non-blocking Architecture** | **BullMQ + Redis Background Queue** | Network lag during SMTP email sending never slows down API response times. |

---

## 5. Codebase Directory & File Responsibility Map

```text
server/
├── prisma/
│   └── schema.prisma                           # User, Otp, RefreshToken models
├── src/
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts       # Extracts req.user cleanly
│   │   │   └── response-message.decorator.ts   # Defines @ResponseMessage()
│   │   ├── interceptors/
│   │   │   └── transform.interceptor.ts        # Wraps responses in standard format
│   │   └── utils/
│   │       └── hash.util.ts                    # Argon2id and SHA-256 helpers
│   ├── mail/
│   │   ├── mail.module.ts                      # BullMQ queue registration
│   │   ├── mail.processor.ts                   # Asynchronous email consumer (3x retry)
│   │   └── mail.service.ts                     # Nodemailer generator with dev console fallback
│   ├── module/
│   │   └── auth/
│   │       ├── dto/
│   │       │   ├── forgot-password.dto.ts      # Validates email
│   │       │   ├── login.dto.ts                # Validates email & password input
│   │       │   ├── register.dto.ts             # Validates strong password rules
│   │       │   ├── resend-otp.dto.ts           # Validates resend parameters
│   │       │   ├── reset-password.dto.ts       # Validates reset OTP & new password
│   │       │   └── verify-otp.dto.ts           # Validates 6-digit code & purpose enum
│   │       ├── guards/
│   │       │   ├── google-auth.guard.ts        # Passport Google OAuth guard
│   │       │   ├── jwt-access.guard.ts         # Access token route guard
│   │       │   ├── jwt-refresh.guard.ts        # Refresh token route guard
│   │       │   └── local-auth.guard.ts         # Passport local login guard
│   │       ├── repositories/
│   │       │   ├── otp.repository.ts           # OTP database operations & rate checks
│   │       │   ├── refresh-token.repository.ts # Token hash storage & session revocation
│   │       │   └── user.repository.ts          # User queries & lockout counter updates
│   │       ├── services/
│   │       │   ├── auth.service.ts             # Primary authentication logic
│   │       │   └── otp.service.ts              # OTP generation, hashing, queue dispatch
│   │       ├── strategies/
│   │       │   ├── google.strategy.ts          # Passport Google OAuth strategy
│   │       │   ├── jwt-access.strategy.ts      # Passport JWT Access strategy
│   │       │   ├── jwt-refresh.strategy.ts     # Passport JWT Refresh strategy
│   │       │   └── local.strategy.ts           # Passport Local strategy
│   │       ├── auth.controller.ts              # 11 REST API endpoints
│   │       └── auth.module.ts                  # NestJS module configuration
│   ├── app.module.ts                           # Root module with BullModule.forRoot()
│   └── main.ts                                 # Swagger, cookies, global pipes & interceptors
├── .env                                        # Environment variables
└── .env.example                                # Template environment variables
```

---

## 6. Environment Setup & Testing Guide

### Environment Variables (`.env`)

```env
# Application
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# PostgreSQL Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/purple_db?schema=public"

# JWT Secrets
JWT_ACCESS_SECRET="super-secure-jwt-access-secret-key-32chars"
JWT_REFRESH_SECRET="super-secure-jwt-refresh-secret-key-32chars"

# Redis (BullMQ Queue)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# SMTP Configuration (Optional in Development)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Purple BD <noreply@purple-bd.com>"

# Google OAuth (Optional)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_CALLBACK_URL="http://localhost:4000/auth/google/callback"
```

> [!TIP]
> **Zero-Friction Development Mode**: If SMTP credentials are not yet configured in your `.env`, the system automatically logs OTP codes directly to your terminal console (`[DEV MODE OTP]`). You can develop and test registration and password reset workflows immediately without setting up an email service.

### Database Migration
```bash
npx prisma migrate dev
npx prisma generate
```

### Running the Server
```bash
# Development mode with hot-reload
npm run start:dev

# Production build & start
npm run build
npm run start:prod
```

### Interactive Swagger Documentation
Open your browser and visit:
```text
http://localhost:4000/api/docs
```
You can view interactive documentation, inspect DTO schemas, test every endpoint, and execute requests directly in the browser.

### Running Automated E2E Tests
```bash
npm run test:e2e
```
* Result: **PASS** (`test/app.e2e-spec.ts`)
* Exit Code: 0 (No build or runtime errors)
