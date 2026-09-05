import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString, Length } from 'class-validator';
import { OtpPurpose } from '../../../generated/prisma/client';

export class VerifyOtpDto {
  @ApiProperty({
    example: 'developer@purple-bd.com',
    description: 'Email address of the account',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit one-time password (OTP)',
  })
  @IsString()
  @IsNotEmpty({ message: 'OTP code cannot be empty' })
  @Length(6, 6, { message: 'OTP code must be exactly 6 digits' })
  code: string;

  @ApiProperty({
    enum: OtpPurpose,
    example: OtpPurpose.EMAIL_VERIFICATION,
    description: 'Purpose of the OTP code',
  })
  @IsEnum(OtpPurpose, {
    message: 'Purpose must be either EMAIL_VERIFICATION or PASSWORD_RESET',
  })
  purpose: OtpPurpose;
}
