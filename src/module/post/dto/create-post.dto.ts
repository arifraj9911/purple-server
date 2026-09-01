import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePostDto {
  @ApiProperty({
    example: 'Getting Started with NestJS & Prisma',
    description: 'Title of the post',
  })
  title: string;

  @ApiPropertyOptional({
    example: 'This is an informative post about architecture in NestJS...',
    description: 'Detailed content of the post',
  })
  content?: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email of the author (must belong to an existing user)',
  })
  authorEmail: string;
}
