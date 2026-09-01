import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'john.doe@example.com',
    description: 'Unique email address of the user',
  })
  email?: string;

  @ApiPropertyOptional({
    example: 'John Doe Updated',
    description: 'Full name of the user',
  })
  name?: string;
}
