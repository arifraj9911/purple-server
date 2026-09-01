import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePostDto {
  @ApiPropertyOptional({
    example: 'Updated Post Title',
    description: 'Updated title of the post',
  })
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated content of the post...',
    description: 'Updated content of the post',
  })
  content?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Publication status of the post',
  })
  published?: boolean;
}
