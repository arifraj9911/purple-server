import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'Arif Raj',
    description: 'Full name of the user',
  })
  @IsString({ message: 'Full name must be a string' })
  @IsNotEmpty({ message: 'Full name cannot be empty' })
  fullName: string;

  @ApiProperty({
    example: 'developer@purple-bd.com',
    description: 'Unique user email address',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiProperty({
    example: 'Secret@1234',
    description:
      'Password (min 8 characters, at least 1 uppercase, 1 lowercase, 1 number or special character)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password cannot be empty' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number or symbol',
  })
  password: string;
}
