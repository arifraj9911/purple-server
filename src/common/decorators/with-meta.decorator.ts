import { SetMetadata } from '@nestjs/common';

export const WITH_META_KEY = 'WITH_META_KEY';

/**
 * Decorator to declare that the endpoint response includes pagination/query metadata.
 * When applied, the TransformInterceptor lifts the `meta` object to the top-level API envelope:
 * {
 *   success: true,
 *   statusCode: 200,
 *   message: "...",
 *   data: [ ... ],
 *   meta: { total, page, limit, totalPages },
 *   timestamp: "..."
 * }
 *
 * Requests without @WithMeta() will completely omit the `meta` property.
 *
 * @example
 * @Get()
 * @WithMeta()
 * async findAll() { ... }
 */
export const WithMeta = () => SetMetadata(WITH_META_KEY, true);
