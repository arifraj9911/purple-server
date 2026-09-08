import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSuperAdminDto {
  @ApiPropertyOptional({
    example: 'newsuperadmin@purple-bd.com',
    description: 'Updated SuperAdmin email address',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'NewSuperPassword123!',
    minLength: 8,
    description: 'Updated SuperAdmin password (min 8 characters)',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    example: 'Primary Super Administrator',
    description: 'Updated SuperAdmin full name',
  })
  @IsOptional()
  @IsString()
  fullName?: string;
}
