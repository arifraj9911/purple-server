import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE_METADATA } from '../decorators/response-message.decorator';
import { WITH_META_KEY } from '../decorators/with-meta.decorator';

export interface StandardApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: any;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, StandardApiResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardApiResponse<T>> {
    const response = context.switchToHttp().getResponse();
    const statusCode = response?.statusCode ?? 200;

    const customMessage = this.reflector.get<string>(
      RESPONSE_MESSAGE_METADATA,
      context.getHandler(),
    );

    const withMeta = this.reflector.getAllAndOverride<boolean>(
      WITH_META_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      map((data) => {
        // If response headers have already been sent (e.g. redirect or manual response), do not wrap
        if (response?.headersSent) {
          return data;
        }

        let message = customMessage || 'Operation completed successfully';
        let payload = data;
        let meta: any = undefined;

        // If route has @WithMeta() decorator and returned data has { data, meta }
        if (
          withMeta &&
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          payload = (data as any).data;
          meta = (data as any).meta;
          message = (data as any).message || message;
        } else if (
          data &&
          typeof data === 'object' &&
          'message' in data &&
          Object.keys(data).length <= 2 &&
          ('data' in data || Object.keys(data).length === 1)
        ) {
          message = (data as any).message || message;
          payload = (data as any).data !== undefined ? (data as any).data : null;
        }

        const result: StandardApiResponse<T> = {
          success: true,
          statusCode,
          message,
          data: payload ?? null,
          timestamp: new Date().toISOString(),
        };

        if (meta !== undefined) {
          result.meta = meta;
        }

        return result;
      }),
    );
  }
}

