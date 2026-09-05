import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { OtpPurpose } from '../../../generated/prisma/client';

export class ResendOtpDto {
  @ApiProperty({
    example: 'developer@purple-bd.com',
    description: 'Email address of the account',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

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
