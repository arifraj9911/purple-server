import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { AuthService } from './services/auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'User registered, verification OTP dispatched.' })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  @ResponseMessage('Registration successful. Please check your email for the verification code.')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password via Passport Local Strategy' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Authentication successful, JWT tokens issued.' })
  @ApiResponse({ status: 401, description: 'Invalid email or password.' })
  @ApiResponse({ status: 403, description: 'Account locked or email not verified.' })
  @ResponseMessage('Login successful.')
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() _dto: LoginDto,
  ) {
    const user = req.user as any;
    const tokens = await this.authService.issueTokens(user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return {
      user,
      ...tokens,
    };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email or password reset OTP code' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code.' })
  @ResponseMessage('OTP verified successfully.')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP code (max 3 requests per 15-minute cooldown)' })
  @ApiResponse({ status: 200, description: 'New OTP dispatched if email exists.' })
  @ApiResponse({ status: 429, description: 'Too many OTP requests in cooldown window.' })
  @ResponseMessage('If registered, a new OTP has been dispatched to your email.')
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP code' })
  @ApiResponse({ status: 200, description: 'Reset code dispatched if account exists.' })
  @ResponseMessage('If an account exists with this email, a reset code has been sent.')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm password reset with OTP and new password' })
  @ApiResponse({ status: 200, description: 'Password reset and all sessions revoked.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP.' })
  @ResponseMessage('Password has been reset successfully. Please login with your new password.')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token with refresh token rotation' })
  @ApiResponse({ status: 200, description: 'Tokens rotated and new access token issued.' })
  @ApiResponse({ status: 401, description: 'Invalid or compromised refresh token.' })
  @ResponseMessage('Token refreshed successfully.')
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, tokenRecordId } = req.user;
    const tokens = await this.authService.refreshTokens(userId, tokenRecordId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return tokens;
  }

  @UseGuards(JwtAccessGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout and revoke all active refresh tokens' })
  @ApiResponse({ status: 200, description: 'Logged out successfully.' })
  @ResponseMessage('Logged out successfully.')
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(userId);
    this.clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAccessGuard)
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get currently authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ResponseMessage('User profile retrieved successfully.')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth2 authentication flow' })
  async googleAuth() {
    // Passport redirects to Google login automatically
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth2 callback redirect' })
  async googleCallback(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.handleGoogleUser(req.user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(frontendUrl);
  }

  /**
   * Secure cookie management helper
   */
  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60 * 1000, // 15 mins
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/auth/refresh' });
  }
}
