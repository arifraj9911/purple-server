import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { hashSha256 } from '../../../common/utils/hash.util';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.refresh_token ?? null,
        ExtractJwt.fromBodyField('refreshToken'),
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string }) {
    const rawToken =
      req.cookies?.refresh_token || req.body?.refreshToken;

    if (!rawToken) {
      throw new UnauthorizedException('Refresh token is required.');
    }

    const tokenHash = hashSha256(rawToken);
    const storedRecord = await this.refreshTokenRepository.findByTokenHash(
      payload.sub,
      tokenHash,
    );

    // Reuse Detection: If token does not exist or is marked revoked, session is compromised
    if (!storedRecord || storedRecord.revoked) {
      await this.refreshTokenRepository.revokeAllForUser(payload.sub);
      throw new UnauthorizedException(
        'Compromised or expired session detected. All sessions have been terminated. Please log in again.',
      );
    }

    if (storedRecord.expiresAt < new Date()) {
      await this.refreshTokenRepository.revokeById(storedRecord.id);
      throw new UnauthorizedException('Refresh token has expired. Please log in again.');
    }

    return {
      userId: payload.sub,
      tokenRecordId: storedRecord.id,
    };
  }
}
