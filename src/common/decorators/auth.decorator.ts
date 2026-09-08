import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../../module/auth/guards/jwt-access.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '../enums/role.enum';

/**
 * Clean, production-grade composite decorator combining JWT Auth, Roles Guard, and Swagger documentation.
 *
 * @example
 * // Protect endpoint for logged-in users of any role:
 * @Auth()
 *
 * // Protect endpoint strictly for ADMIN or SUPER_ADMIN:
 * @Auth(Role.ADMIN, Role.SUPER_ADMIN)
 */
export function Auth(...roles: Role[]) {
  if (roles && roles.length > 0) {
    return applyDecorators(
      Roles(...roles),
      UseGuards(JwtAccessGuard, RolesGuard),
      ApiBearerAuth('access-token'),
      ApiUnauthorizedResponse({
        description: 'Unauthorized: Authentication token is invalid or expired.',
      }),
      ApiForbiddenResponse({
        description: 'Forbidden: Insufficient role permissions.',
      }),
    );
  }

  return applyDecorators(
    UseGuards(JwtAccessGuard),
    ApiBearerAuth('access-token'),
    ApiUnauthorizedResponse({
      description: 'Unauthorized: Authentication token is invalid or expired.',
    }),
  );
}
