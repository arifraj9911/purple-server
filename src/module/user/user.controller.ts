import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { Auth } from '../../common/decorators/auth.decorator';
import { WithMeta } from '../../common/decorators/with-meta.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Role } from '../../common/enums/role.enum';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateSuperAdminDto } from './dto/update-superadmin.dto';

@ApiTags('Users & Role Management')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Auth(Role.ADMIN, Role.SUPER_ADMIN)
  @WithMeta()
  @ApiOperation({
    summary: 'List all users with pagination, role filter, and search',
  })
  @ApiResponse({ status: 200, description: 'Paginated user list.' })
  @ApiResponse({ status: 403, description: 'Forbidden: Insufficient role.' })
  @ResponseMessage('Users list retrieved successfully.')
  async findAll(@Query() query: QueryUsersDto) {
    return this.userService.findAll(query);
  }

  @Post('admin')
  @Auth(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new Admin account (SuperAdmin only)',
  })
  @ApiBody({ type: CreateAdminDto })
  @ApiResponse({ status: 201, description: 'Admin account created successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden: Only SuperAdmin can create Admin.' })
  @ApiResponse({ status: 409, description: 'Email already exists.' })
  @ResponseMessage('Admin account created successfully.')
  async createAdmin(
    @Body() dto: CreateAdminDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.userService.createAdmin(dto, currentUser);
  }

  @Patch('superadmin/profile')
  @Auth(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update SuperAdmin email, password, or full name (SuperAdmin only)',
  })
  @ApiBody({ type: UpdateSuperAdminDto })
  @ApiResponse({ status: 200, description: 'SuperAdmin profile updated.' })
  @ApiResponse({ status: 403, description: 'Forbidden: Only SuperAdmin access.' })
  @ApiResponse({ status: 409, description: 'Email already taken by another account.' })
  @ResponseMessage('SuperAdmin profile updated successfully.')
  async updateSuperAdminProfile(
    @CurrentUser('id') currentUserId: string,
    @Body() dto: UpdateSuperAdminDto,
  ) {
    return this.userService.updateSuperAdminProfile(currentUserId, dto);
  }

  @Patch(':id/role')
  @Auth(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Change a user role (Admin: USER <-> MODERATOR; SuperAdmin: any role)',
  })
  @ApiParam({ name: 'id', description: 'Target user ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiResponse({ status: 200, description: 'User role updated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden: Unauthorized role transition.' })
  @ApiResponse({ status: 404, description: 'Target user not found.' })
  @ResponseMessage('User role updated successfully.')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.userService.updateRole(id, dto.role, currentUser);
  }
}
