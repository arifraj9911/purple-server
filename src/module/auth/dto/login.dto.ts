import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'developer@purple-bd.com',
    description: 'Registered user email address',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiProperty({
    example: 'Secret@1234',
    description: 'Account password',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password cannot be empty' })
  password: string;
}
