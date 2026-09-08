import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({
    example: 'admin@purple-bd.com',
    description: 'Admin email address',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'AdminSecret123!',
    minLength: 8,
    description: 'Admin account password (min 8 chars)',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: 'Finance Admin',
    description: 'Admin full name',
  })
  @IsOptional()
  @IsString()
  fullName?: string;
}
