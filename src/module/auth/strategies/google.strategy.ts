import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || 'dummy-google-client-id',
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET || 'dummy-google-client-secret',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:4000/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): Promise<any> {
    return {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      fullName: profile.displayName || undefined,
      isVerified: profile.emails?.[0]?.verified ?? true,
    };
  }
}
