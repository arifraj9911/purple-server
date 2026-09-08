import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

export class UpdateRoleDto {
  @ApiProperty({
    enum: Role,
    description: 'New role to assign to the user',
    example: Role.MODERATOR,
  })
  @IsNotEmpty()
  @IsEnum(Role, {
    message: `Role must be one of: ${Object.values(Role).join(', ')}`,
  })
  role: Role;
}
