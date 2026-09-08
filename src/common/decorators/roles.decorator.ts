import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for a route or controller
 * @param roles Roles that have access to the endpoint
 * @example @Roles(Role.ADMIN, Role.SUPER_ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
