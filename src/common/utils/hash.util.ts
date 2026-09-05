import * as argon2 from 'argon2';
import * as crypto from 'crypto';

/**
 * Hash a plain text password using Argon2id
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Verify a plain text password against an Argon2 hash
 */
export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Generate a SHA-256 hash for sensitive tokens and OTP codes before storing in DB
 */
export function hashSha256(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}
