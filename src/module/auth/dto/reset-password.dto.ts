import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'developer@purple-bd.com',
    description: 'Registered user email address',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP received via email',
  })
  @IsString()
  @IsNotEmpty({ message: 'OTP code cannot be empty' })
  @Length(6, 6, { message: 'OTP code must be exactly 6 digits' })
  otp: string;

  @ApiProperty({
    example: 'NewSecret@1234',
    description: 'New password (min 8 chars, 1 uppercase, 1 lowercase, 1 number/symbol)',
  })
  @IsString()
  @IsNotEmpty({ message: 'New password cannot be empty' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number or symbol',
  })
  newPassword: string;
}
