# Purple-BD Authentication & RBAC Engine Documentation

A comprehensive, developer-friendly guide to the authentication, authorization, session management, and role-based access control (RBAC) architecture powering the **Purple-BD** backend.

---

## Table of Contents

1. [System Overview & Tech Stack](#1-system-overview--tech-stack)
2. [Architecture & Lifecycles (Flowcharts)](#2-architecture--lifecycles-flowcharts)
   - [User Registration & Email Verification Lifecycle](#user-registration--email-verification-lifecycle)
   - [Login & Session Creation Lifecycle](#login--session-creation-lifecycle)
   - [Refresh Token Rotation & Breach Detection Lifecycle](#refresh-token-rotation--breach-detection-lifecycle)
   - [Role Hierarchy & Guard Pipeline](#role-hierarchy--guard-pipeline)
   - [SuperAdmin Auto-Bootstrap Lifecycle](#superadmin-auto-bootstrap-lifecycle)
3. [Database Models & Schema (Prisma)](#3-database-models--schema-prisma)
4. [Security Policies & Mechanisms](#4-security-policies--mechanisms)
   - [Password Hashing (Argon2id)](#password-hashing-argon2id)
   - [Account Lockout Protection](#account-lockout-protection)
   - [Asynchronous Background Processing (BullMQ + Redis)](#asynchronous-background-processing-bullmq--redis)
   - [Dual-Token System & HTTP-Only Cookies](#dual-token-system--http-only-cookies)
   - [Google OAuth2 Authentication](#google-oauth2-authentication)
5. [Role-Based Access Control (RBAC)](#5-role-based-access-control-rbac)
   - [Role Definitions & Hierarchy](#role-definitions--hierarchy)
   - [Permission & Transition Rules](#permission--transition-rules)
   - [Guards & Custom Decorators](#guards--custom-decorators)
6. [Master API Route Reference (Tables & Schemas)](#6-master-api-route-reference-tables--schemas)
   - [Route Summary Table: Public Authentication](#route-summary-table-public-authentication)
   - [Route Summary Table: Session & Profile](#route-summary-table-session--profile)
   - [Route Summary Table: User & Role Management (RBAC)](#route-summary-table-user--role-management-rbac)
   - [Detailed Endpoint Specifications](#detailed-endpoint-specifications)
7. [Developer Implementation Guide](#7-developer-implementation-guide)
   - [Protecting Routes with `@Auth()`](#protecting-routes-with-auth)
   - [Extracting User Data with `@CurrentUser()`](#extracting-user-data-with-currentuser)
   - [Customizing Response Messages with `@ResponseMessage()`](#customizing-response-messages-with-responsemessage)
8. [Environment Variables Reference](#8-environment-variables-reference)

---

## 1. System Overview & Tech Stack

The authentication system is built using modern security best practices designed for defense-in-depth protection, zero-downtime scalability, and seamless developer ergonomics.

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | NestJS 11 (Express) | Modular enterprise backend architecture |
| **Database & ORM** | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) | High-performance type-safe relational persistence |
| **Authentication Strategy** | Passport.js (`passport-local`, `passport-jwt`, `passport-google-oauth20`) | Multi-strategy credential and token validation |
| **Password Hashing** | Argon2id (`argon2`) | Memory-hard password hashing resistant to GPU/ASIC attacks |
| **Token System** | JWT (15m Access Token + 7d Refresh Token) | Short-lived access credentials with persistent rotating sessions |
| **Background Queues** | BullMQ + Redis | Non-blocking asynchronous email delivery and OTP dispatch |
| **API Documentation** | NestJS Swagger / OpenAPI | Interactive documentation explorer at `http://localhost:4000/api/docs` |

---

## 2. Architecture & Lifecycles (Flowcharts)

### User Registration & Email Verification Lifecycle

```
[ Client ]                        [ Backend Server ]                   [ BullMQ / Redis / DB ]
    │                                     │                                       │
    │  1. POST /auth/register             │                                       │
    ├────────────────────────────────────►│                                       │
    │     (email, password, fullName)     │  2. Hash password with Argon2id       │
    │                                     │  3. Create User in DB (role: USER)    │
    │                                     ├──────────────────────────────────────►│
    │                                     │  4. Enqueue OTP email job             │
    │                                     ├──────────────────────────────────────►│
    │  5. 201 Created                     │                                       │
    │◄────────────────────────────────────┤                                       │
    │     ("Verification code sent")      │                                       │ 6. Worker sends email
    │                                     │                                       │    with 6-digit OTP
    │                                     │                                       ▼
    │  7. User checks email and receives 6-digit OTP code                         [ User Inbox ]
    │
    │  8. POST /auth/verify-otp (email, code, purpose: EMAIL_VERIFICATION)
    ├────────────────────────────────────►│
    │                                     │  9. Verify SHA-256 hash & expiry
    │                                     │ 10. Set isVerified: true in DB
    │                                     ├──────────────────────────────────────►│
    │ 11. 200 OK ("Email verified")       │
    │◄────────────────────────────────────┤
```

---

### Login & Session Creation Lifecycle

```
[ Client ]                        [ Backend Server ]                   [ Database ]
    │                                     │                                 │
    │  1. POST /auth/login                │                                 │
    ├────────────────────────────────────►│                                 │
    │     (email, password)               │  2. Check account lock status   │
    │                                     ├────────────────────────────────►│
    │                                     │  3. Verify Argon2 password hash │
    │                                     │  4. Reset failed login counter  │
    │                                     ├────────────────────────────────►│
    │                                     │  5. Issue Access Token (15m)    │
    │                                     │     Payload: { sub, email, role }│
    │                                     │  6. Issue Refresh Token (7d)   │
    │                                     │  7. Store SHA-256 token hash    │
    │                                     ├────────────────────────────────►│
    │  8. 200 OK                          │
    │◄────────────────────────────────────┤
    │     - Set HTTP-only Cookie: access_token (15 mins)
    │     - Set HTTP-only Cookie: refresh_token (7 days, path: /auth/refresh)
    │     - JSON body: { user: { id, email, fullName, role }, accessToken, refreshToken }
```

---

### Refresh Token Rotation & Breach Detection Lifecycle

```
                                  Client calls POST /auth/refresh
                                                 │
                                                 ▼
                                  Does Refresh Token exist in DB?
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        │ YES                                             │ NO / Already Revoked
                        ▼                                                 ▼
               Is Token Expired?                                  ⚠️ BREACH DETECTED!
                        │                                         (Token stolen or reused)
             ┌──────────┴──────────┐                                      │
             │ NO                  │ YES                                  ▼
             ▼                     ▼                              Revoke ALL active
       Active Token!         Token Expired                     refresh tokens for user!
             │                     │                                      │
             ▼                     ▼                                      ▼
   Revoke used token      Revoke token in DB                      Return 401 Unauthorized
   Generate new pair      Return 401 Unauthorized                 "Session compromised.
   Save new hash in DB                                             Please log in again."
   Return fresh tokens
```

---

### Role Hierarchy & Guard Pipeline

```
                              Incoming HTTP Request
                                       │
                                       ▼
                       [ JwtAccessGuard (AuthGuard) ]
                                       │
                    Is JWT token valid & unexpired?
                                       │
                      ┌────────────────┴────────────────┐
                      │ YES                             │ NO
                      ▼                                 ▼
         Attach user object to req.user        Return 401 Unauthorized
                      │
                      ▼
               [ RolesGuard ]
                      │
           Does route require @Roles(...)?
                      │
           ┌──────────┴──────────┐
           │ NO                  │ YES
           ▼                     ▼
     Access Granted        Is user.role === SUPER_ADMIN?
                                 │
                      ┌──────────┴──────────┐
                      │ YES                 │ NO
                      ▼                     ▼
                Access Granted      Does required roles list
                (Root bypass)       contain user.role?
                                           │
                                ┌──────────┴──────────┐
                                │ YES                 │ NO
                                ▼                     ▼
                          Access Granted        Return 403 Forbidden
                                                "Insufficient permissions"
```

---

### SuperAdmin Auto-Bootstrap Lifecycle

```
                         Application Starts (onApplicationBootstrap)
                                              │
                                              ▼
                         Does any user with role: SUPER_ADMIN exist in DB?
                                              │
                         ┌────────────────────┴────────────────────┐
                         │ YES                                     │ NO
                         ▼                                         ▼
            Log: "SuperAdmin already exists.         Read SUPER_ADMIN_EMAIL,
                  Skipping auto-bootstrap."          PASSWORD, NAME from .env
                         │                                         │
                         ▼                           Are .env values defined?
                   Ready to Serve                                  │
                                                    ┌──────────────┴──────────────┐
                                                    │ YES                         │ NO
                                                    ▼                             ▼
                                              Use .env values            Use safe code defaults
                                                    │                             │
                                                    └──────────────┬──────────────┘
                                                                   ▼
                                                       Hash password with Argon2id
                                                                   │
                                                       Does email exist in DB?
                                                                   │
                                                    ┌──────────────┴──────────────┐
                                                    │ YES                         │ NO
                                                    ▼                             ▼
                                              Elevate existing user        Create brand new user
                                              to SUPER_ADMIN & verified    with role: SUPER_ADMIN
                                                    │                             │
                                                    └──────────────┬──────────────┘
                                                                   ▼
                                                       Log: "Initial SuperAdmin created"
```

---

## 3. Database Models & Schema (Prisma)

Defined in `prisma/schema.prisma`:

```prisma
model User {
  id               String    @id @default(uuid())
  email            String    @unique
  fullName         String?
  password         String?   // Encrypted using Argon2id (null for Google OAuth accounts)
  role             Role      @default(USER)
  isVerified       Boolean   @default(false)
  provider         Provider  @default(LOCAL)
  googleId         String?   @unique
  failedLoginCount Int       @default(0)
  lockedUntil      DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  otps          Otp[]
  refreshTokens RefreshToken[]
}

enum Role {
  USER
  MODERATOR
  ADMIN
  SUPER_ADMIN
}

enum Provider {
  LOCAL
  GOOGLE
}

model Otp {
  id                   String     @id @default(uuid())
  userId               String
  user                 User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash             String     // SHA-256 hashed 6-digit OTP
  purpose              OtpPurpose
  attempts             Int        @default(0)
  maxAttemptsReachedAt DateTime?
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
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   // SHA-256 hashed refresh token string
  revoked    Boolean  @default(false)
  replacedBy String?
  userAgent  String?
  ip         String?
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  @@index([userId])
}
```

---

## 4. Security Policies & Mechanisms

### Password Hashing (Argon2id)
- Passwords are encrypted with **Argon2id**, the modern state-of-the-art password hashing standard.
- Resistant against GPU, FPGA, and ASIC brute-force attacks due to high memory difficulty.

### Account Lockout Protection
- Tracks consecutive failed logins in `User.failedLoginCount`.
- **Lockout Rule**: If failed attempts reach **5**, `lockedUntil` is set to **now + 5 minutes**.
- Any login attempts during the lock period immediately return HTTP **403 Forbidden**.
- Successful login automatically resets `failedLoginCount` to `0` and clears `lockedUntil`.

### Asynchronous Background Processing (BullMQ + Redis)
- 6-digit cryptographically random OTPs generated via Node.js `crypto.randomInt(100000, 999999)`.
- OTP strings are hashed via **SHA-256** before database storage.
- **Validity**: 5 minutes.
- **Attempt Limit**: Maximum 3 verification attempts before an OTP record is permanently locked.
- **Resend Cooldown**: Enforces a 15-minute rate-limiting window between requests.
- All outbound emails are offloaded to Redis BullMQ queues (`otp-queue`, `mail-queue`) with automatic exponential backoff retry.

### Dual-Token System & HTTP-Only Cookies
- **Access Token (15 Minutes)**:
  - Sent via `access_token` HTTP-Only cookie AND Bearer token header.
  - Payload contains: `{ sub: userId, email: string, role: Role }`.
- **Refresh Token (7 Days)**:
  - Sent via `refresh_token` HTTP-Only cookie (path scoped to `/auth/refresh`).
  - Stored in the database as a SHA-256 hash.
- **Cookie Attributes**:
  - `httpOnly: true` (inaccessible to JavaScript, zero XSS exposure).
  - `sameSite: 'strict'` (blocks cross-site request forgery).
  - `secure: true` when running in production (HTTPS).

### Google OAuth2 Authentication
- Authenticated via `passport-google-oauth20`.
- Users registering via Google are automatically verified (`isVerified: true`) with `provider: GOOGLE`.
- Existing accounts with the same email are automatically linked without creating duplicate accounts.
- Roles default strictly to `USER`.

---

## 5. Role-Based Access Control (RBAC)

### Role Definitions & Hierarchy

```
[ Level 4 ]  SUPER_ADMIN  ──► Root Authority (Strictly 1 instance. Can manage all roles & create Admins)
[ Level 3 ]  ADMIN        ──► Panel Manager  (Can list users & switch roles between USER <-> MODERATOR)
[ Level 2 ]  MODERATOR    ──► Content Mod    (Cannot alter any user roles or access admin panel)
[ Level 1 ]  USER         ──► Standard User  (Default public registration role)
```

| Role | Hierarchy Level | Key Permissions | Restrictions |
| :--- | :---: | :--- | :--- |
| **`SUPER_ADMIN`** | **4 (Root)** | - Full access to all endpoints<br>- Create `ADMIN` accounts<br>- Promote any user to `ADMIN`, `MODERATOR`, or `USER`<br>- Update own credentials | Cannot demote or delete self to prevent lockout |
| **`ADMIN`** | **3 (Manager)** | - View paginated users list & search<br>- Promote `USER` ➔ `MODERATOR`<br>- Demote `MODERATOR` ➔ `USER` | - Cannot create Admins<br>- Cannot promote anyone to `ADMIN`<br>- Cannot alter `ADMIN` or `SUPER_ADMIN` |
| **`MODERATOR`** | **2 (Moderator)** | - Access future moderation endpoints | Cannot change any user roles |
| **`USER`** | **1 (Public)** | - Standard authenticated account actions | Cannot change any user roles |

---

### Permission & Transition Rules

| Action | Caller Role | Target User Role | Allowed? | Error if Disallowed |
| :--- | :--- | :--- | :---: | :--- |
| **List Users (`GET /users`)** | `ADMIN`, `SUPER_ADMIN` | Any | ✅ **Yes** | 403 Forbidden (if USER/MODERATOR) |
| **Promote to Moderator** | `ADMIN`, `SUPER_ADMIN` | `USER` | ✅ **Yes** | — |
| **Demote to User** | `ADMIN`, `SUPER_ADMIN` | `MODERATOR` | ✅ **Yes** | — |
| **Promote to Admin** | `SUPER_ADMIN` | `USER` / `MODERATOR` | ✅ **Yes** | — |
| **Promote to Admin** | `ADMIN` | `USER` / `MODERATOR` | ❌ **No** | 403: "Admins are only permitted to switch roles between USER and MODERATOR." |
| **Modify Admin Account** | `ADMIN` | `ADMIN` | ❌ **No** | 403: "Admins are not permitted to modify other Admin accounts." |
| **Create Admin Account** | `SUPER_ADMIN` | N/A | ✅ **Yes** | — |
| **Create Admin Account** | `ADMIN` | N/A | ❌ **No** | 403: "Requires role [SUPER_ADMIN], but your role is [ADMIN]." |
| **Assign `SUPER_ADMIN`** | Any | Any | ❌ **No** | 403: "Cannot assign SUPER_ADMIN role. Only one unique SuperAdmin is permitted." |
| **Modify `SUPER_ADMIN`** | Any | `SUPER_ADMIN` | ❌ **No** | 403: "The SuperAdmin account role cannot be altered." |
| **Update SuperAdmin Profile** | `SUPER_ADMIN` | Self | ✅ **Yes** | 403 Forbidden (if not SuperAdmin) |

---

### Guards & Custom Decorators

#### 1. `@Auth(...roles: Role[])` Composite Decorator
The recommended decorator for clean, declarative endpoint protection:
- Combines `JwtAccessGuard` + `RolesGuard` + Swagger `@ApiBearerAuth()`.
- Automatically documents HTTP 401 and HTTP 403 OpenAPI responses.

```typescript
import { Auth } from '../common/decorators/auth.decorator';
import { Role } from '../common/enums/role.enum';

// Protect for any logged-in user:
@Auth()

// Protect strictly for ADMIN and SUPER_ADMIN:
@Auth(Role.ADMIN, Role.SUPER_ADMIN)

// Protect strictly for SUPER_ADMIN:
@Auth(Role.SUPER_ADMIN)
```

#### 2. Individual Guards & Decorators
```typescript
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
```

---

## 6. Master API Route Reference (Tables & Schemas)

Base URL: `http://localhost:4000`  
Swagger Documentation: `http://localhost:4000/api/docs`

---

### Route Summary Table: Public Authentication

| Method | Endpoint | Protection | Description | Request Body Summary | Success Status | Error Codes |
| :--- | :--- | :---: | :--- | :--- | :---: | :--- |
| `POST` | `/auth/register` | Public | Register new account & dispatch verification OTP | `{ email, password, fullName }` | `201 Created` | `409 Conflict` |
| `POST` | `/auth/verify-otp` | Public | Verify OTP for registration or password reset | `{ email, code, purpose }` | `200 OK` | `400 Bad Request` |
| `POST` | `/auth/resend-otp` | Public | Resend OTP (15-min cooldown) | `{ email, purpose }` | `200 OK` | `429 Too Many Requests` |
| `POST` | `/auth/login` | Public | Authenticate credentials & issue JWT tokens + cookies | `{ email, password }` | `200 OK` | `401 Unauthorized`<br>`403 Forbidden` |
| `POST` | `/auth/forgot-password` | Public | Request password reset OTP | `{ email }` | `200 OK` | `400 Bad Request` |
| `POST` | `/auth/reset-password` | Public | Reset password with OTP and revoke active sessions | `{ email, otp, newPassword }` | `200 OK` | `400 Bad Request` |
| `GET` | `/auth/google` | Public | Initiate Google OAuth2 login redirect | None | `302 Found` | — |
| `GET` | `/auth/google/callback` | Public | Google OAuth2 callback endpoint | None (Redirects to Frontend) | `302 Found` | `401 Unauthorized` |

---

### Route Summary Table: Session & Profile

| Method | Endpoint | Protection | Description | Request Payload | Success Status | Error Codes |
| :--- | :--- | :---: | :--- | :--- | :---: | :--- |
| `POST` | `/auth/refresh` | Refresh Token | Rotate tokens & issue fresh access token | Cookie or body `{ refreshToken }` | `200 OK` | `401 Unauthorized` |
| `POST` | `/auth/logout` | `@Auth()` | Invalidate all user sessions & clear cookies | None | `200 OK` | `401 Unauthorized` |
| `GET` | `/auth/me` | `@Auth()` | Get current authenticated user profile & role | None | `200 OK` | `401 Unauthorized` |

---

### Route Summary Table: User & Role Management (RBAC)

| Method | Endpoint | Protection | Description | Request Payload | Success Status | Error Codes |
| :--- | :--- | :---: | :--- | :--- | :---: | :--- |
| `GET` | `/users` | `@Auth(ADMIN, SUPER_ADMIN)` | List users with pagination, role filter, and search | Query: `page`, `limit`, `role`, `search` | `200 OK` | `401 Unauthorized`<br>`403 Forbidden` |
| `PATCH` | `/users/:id/role` | `@Auth(ADMIN, SUPER_ADMIN)` | Change role (Admin: USER ↔ MODERATOR; SuperAdmin: any) | Body: `{ role: Role }` | `200 OK` | `403 Forbidden`<br>`404 Not Found` |
| `POST` | `/users/admin` | `@Auth(SUPER_ADMIN)` | Create brand-new Admin account | Body: `{ email, password, fullName }` | `201 Created` | `403 Forbidden`<br>`409 Conflict` |
| `PATCH` | `/users/superadmin/profile` | `@Auth(SUPER_ADMIN)` | Update SuperAdmin email, password, or fullName | Body: `{ email?, password?, fullName? }` | `200 OK` | `403 Forbidden`<br>`409 Conflict` |

---

### Detailed Endpoint Specifications

#### 1. Register Account
- **Endpoint**: `POST /auth/register`
- **Request Body**:
  ```json
  {
    "email": "john.doe@example.com",
    "password": "StrongPassword123!",
    "fullName": "John Doe"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "statusCode": 201,
    "message": "Registration successful. Please check your email for the verification code.",
    "data": {
      "message": "Registration successful. A verification OTP has been sent to your email."
    }
  }
  ```

---

#### 2. Verify OTP
- **Endpoint**: `POST /auth/verify-otp`
- **Request Body**:
  ```json
  {
    "email": "john.doe@example.com",
    "code": "847291",
    "purpose": "EMAIL_VERIFICATION"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "statusCode": 200,
    "message": "OTP verified successfully.",
    "data": {
      "message": "Email successfully verified. You may now log in."
    }
  }
  ```

---

#### 3. Login
- **Endpoint**: `POST /auth/login`
- **Request Body**:
  ```json
  {
    "email": "john.doe@example.com",
    "password": "StrongPassword123!"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "statusCode": 200,
    "message": "Login successful.",
    "data": {
      "user": {
        "id": "27cfb2d1-5813-4f91-8dc9-d7e171b3e8aa",
        "email": "john.doe@example.com",
        "fullName": "John Doe",
        "role": "USER",
        "isVerified": true,
        "provider": "LOCAL"
      },
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **Cookies Set**:
  - `access_token` (`HttpOnly`, `Path=/`, `Max-Age=15m`)
  - `refresh_token` (`HttpOnly`, `Path=/auth/refresh`, `Max-Age=7d`)

---

#### 4. Get Current Profile
- **Endpoint**: `GET /auth/me`
- **Headers**: `Authorization: Bearer <accessToken>` (or automatically read from `access_token` cookie)
- **Response `200 OK`**:
  ```json
  {
    "statusCode": 200,
    "message": "User profile retrieved successfully.",
    "data": {
      "id": "27cfb2d1-5813-4f91-8dc9-d7e171b3e8aa",
      "email": "john.doe@example.com",
      "fullName": "John Doe",
      "role": "USER",
      "isVerified": true,
      "provider": "LOCAL",
      "createdAt": "2026-09-08T16:00:00.000Z",
      "updatedAt": "2026-09-08T16:00:00.000Z"
    }
  }
  ```

---

#### 5. List Users (Admin Dashboard)
- **Endpoint**: `GET /users?page=1&limit=10&role=USER&search=john`
- **Access**: `@Auth(Role.ADMIN, Role.SUPER_ADMIN)`
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Users list retrieved successfully.",
    "data": [
      {
        "id": "27cfb2d1-5813-4f91-8dc9-d7e171b3e8aa",
        "email": "john.doe@example.com",
        "fullName": "John Doe",
        "role": "USER",
        "isVerified": true,
        "provider": "LOCAL",
        "createdAt": "2026-09-08T16:00:00.000Z",
        "updatedAt": "2026-09-08T16:00:00.000Z"
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "limit": 10,
      "totalPages": 1
    },
    "timestamp": "2026-09-09T00:14:48.000Z"
  }
  ```

---

#### 6. Change User Role (User <-> Moderator)
- **Endpoint**: `PATCH /users/:id/role`
- **Access**: `@Auth(Role.ADMIN, Role.SUPER_ADMIN)`
- **Request Body**:
  ```json
  {
    "role": "MODERATOR"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "statusCode": 200,
    "message": "User role updated successfully.",
    "data": {
      "message": "User role successfully changed from USER to MODERATOR.",
      "user": {
        "id": "27cfb2d1-5813-4f91-8dc9-d7e171b3e8aa",
        "email": "john.doe@example.com",
        "fullName": "John Doe",
        "role": "MODERATOR",
        "isVerified": true
      }
    }
  }
  ```

---

#### 7. Create Admin Account
- **Endpoint**: `POST /users/admin`
- **Access**: `@Auth(Role.SUPER_ADMIN)`
- **Request Body**:
  ```json
  {
    "email": "admin.charlie@purple-bd.com",
    "password": "AdminSecurePassword123!",
    "fullName": "Charlie Admin"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "statusCode": 201,
    "message": "Admin account created successfully.",
    "data": {
      "message": "Admin account created successfully.",
      "user": {
        "id": "89eb12f4-...",
        "email": "admin.charlie@purple-bd.com",
        "fullName": "Charlie Admin",
        "role": "ADMIN",
        "isVerified": true,
        "provider": "LOCAL"
      }
    }
  }
  ```

---

#### 8. Update SuperAdmin Profile & Credentials
- **Endpoint**: `PATCH /users/superadmin/profile`
- **Access**: `@Auth(Role.SUPER_ADMIN)`
- **Request Body** (All fields optional):
  ```json
  {
    "email": "new.superadmin@purple-bd.com",
    "password": "BrandNewSuperSecret123!",
    "fullName": "Primary Super Administrator"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "statusCode": 200,
    "message": "SuperAdmin profile updated successfully.",
    "data": {
      "message": "SuperAdmin credentials updated successfully.",
      "user": {
        "id": "1b3a4c5d-...",
        "email": "new.superadmin@purple-bd.com",
        "fullName": "Primary Super Administrator",
        "role": "SUPER_ADMIN"
      }
    }
  }
  ```
- **Security Action**: If `password` is changed, all existing active refresh tokens are immediately revoked.

---

## 7. Developer Implementation Guide

### Protecting Routes with `@Auth()`

To add role-based authorization to any controller or handler, import `@Auth()` and `Role`:

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { Auth } from '../../common/decorators/auth.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('articles')
export class ArticleController {
  // Level 1: Open to any logged-in user (USER, MODERATOR, ADMIN, SUPER_ADMIN)
  @Get()
  @Auth()
  listArticles() {
    return [];
  }

  // Level 2: Moderation routes (MODERATOR, ADMIN, SUPER_ADMIN)
  @Patch(':id/flag')
  @Auth(Role.MODERATOR, Role.ADMIN, Role.SUPER_ADMIN)
  flagArticle(@Param('id') id: string) {
    return { flagged: true };
  }

  // Level 3: Administrative routes (ADMIN, SUPER_ADMIN)
  @Post()
  @Auth(Role.ADMIN, Role.SUPER_ADMIN)
  createArticle(@Body() dto: any) {
    return { created: true };
  }

  // Level 4: Root SuperAdmin only
  @Delete(':id/purge')
  @Auth(Role.SUPER_ADMIN)
  purgeArticle(@Param('id') id: string) {
    return { purged: true };
  }
}
```

---

### Extracting User Data with `@CurrentUser()`

Use `@CurrentUser()` parameter decorator to read authenticated user details from the request:

```typescript
import { Controller, Get } from '@nestjs/common';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dashboard')
export class DashboardController {
  // Inject just the user ID:
  @Get('my-id')
  @Auth()
  getMyId(@CurrentUser('id') userId: string) {
    return { userId };
  }

  // Inject the entire safe user object:
  @Get('summary')
  @Auth()
  getSummary(@CurrentUser() user: any) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
```

---

### Customizing Response Messages with `@ResponseMessage()`

All controllers utilize `TransformInterceptor` to produce a unified JSON wrapper:
```json
{
  "statusCode": 200,
  "message": "Your message here",
  "data": { ... }
}
```

Use `@ResponseMessage()` to declare the success string:

```typescript
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@Get('metrics')
@ResponseMessage('System metrics calculated successfully.')
getMetrics() {
  return { cpu: '12%' };
}
```

---

### Managing Pagination Metadata with `@WithMeta()`

To keep response envelopes clean and prevent redundant `meta` blocks on non-GET routes, use the custom `@WithMeta()` decorator:

- When `@WithMeta()` is added to a GET route returning `{ data, meta }`, `TransformInterceptor` automatically lifts `meta` to the root of the response envelope next to `data`.
- Endpoints **without** `@WithMeta()` will have zero `meta` field in their response output.

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { Auth } from '../../common/decorators/auth.decorator';
import { WithMeta } from '../../common/decorators/with-meta.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@Controller('users')
export class UserController {
  @Get()
  @Auth(Role.ADMIN, Role.SUPER_ADMIN)
  @WithMeta()
  @ResponseMessage('Users list retrieved successfully.')
  async findAll(@Query() query: QueryUsersDto) {
    return this.userService.findAll(query);
  }
}
```

---

### Architectural Pattern: Module > Controller > Service > Repository

All domain modules strictly adhere to the layered enterprise architecture:

```
[ UserModule ]
     │
     ├──► [ UserController ]          (Routing, DTO validation, Swagger, @Auth, @WithMeta)
     │          │
     │          ▼
     ├──► [ UserService ]             (Business rules, role validation, password hashing)
     │          │
     │          ▼
     └──► [ UserRepository ]          (Database queries, Prisma operations, projections)
```

1. **Controller**: Handles HTTP input, validation pipes, route decorators.
2. **Service**: Encapsulates business logic, authorization rules, and orchestration.
3. **Repository**: Directly interfaces with `PrismaService` for database querying, filtering, pagination, and data projection.

---

## 8. Environment Variables Reference

Configure these keys in your `.env` file:

| Environment Variable | Required | Default / Example Value | Description |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@localhost:5432/db` | PostgreSQL connection URL with schema |
| `PORT` | No | `4000` | Application port |
| `NODE_ENV` | No | `development` | Set to `production` in production environments |
| `FRONTEND_URL` | No | `http://localhost:3000` | Frontend client origin for CORS and OAuth redirects |
| `JWT_ACCESS_SECRET` | **Yes** | 64-character random hex string | Secret key for signing 15-minute Access Tokens |
| `JWT_REFRESH_SECRET` | **Yes** | 64-character random hex string | Distinct secret key for signing 7-day Refresh Tokens |
| `REDIS_HOST` | No | `localhost` | Redis server host for BullMQ queues |
| `REDIS_PORT` | No | `6379` | Redis server port |
| `REDIS_PASSWORD` | No | `""` | Optional Redis auth password |
| `GOOGLE_CLIENT_ID` | No | `your-google-client-id` | Google Cloud Console OAuth Client ID |
| `GOOGLE_CLIENT_SECRET`| No | `your-google-client-secret` | Google Cloud Console OAuth Client Secret |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:4000/auth/google/callback` | OAuth redirect callback URL |
| `SMTP_HOST` | **Yes** | `smtp.gmail.com` | SMTP email server host |
| `SMTP_PORT` | **Yes** | `587` | SMTP port (587 for TLS, 465 for SSL) |
| `SMTP_USER` | **Yes** | `your-email@gmail.com` | SMTP username / account |
| `SMTP_PASS` | **Yes** | `your-app-password` | SMTP password / App password |
| `SMTP_FROM` | **Yes** | `Purple BD <no-reply@purple-bd.com>` | Default sender signature |
| `SUPER_ADMIN_EMAIL` | No | `superadmin@purple-bd.com` | Email for initial SuperAdmin bootstrap |
| `SUPER_ADMIN_PASSWORD`| No | `SuperSecretPassword123!` | Password for initial SuperAdmin bootstrap |
| `SUPER_ADMIN_NAME` | No | `System Super Admin` | Full name for initial SuperAdmin bootstrap |
