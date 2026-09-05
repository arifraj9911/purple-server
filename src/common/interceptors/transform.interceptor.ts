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

export interface StandardApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
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
    const statusCode = response.statusCode ?? 200;

    const customMessage = this.reflector.get<string>(
      RESPONSE_MESSAGE_METADATA,
      context.getHandler(),
    );

    return next.handle().pipe(
      map((data) => {
        // If data already contains custom message property, extract it gracefully
        let message = customMessage || 'Operation completed successfully';
        let payload = data;

        if (
          data &&
          typeof data === 'object' &&
          'message' in data &&
          Object.keys(data).length <= 2 &&
          ('data' in data || Object.keys(data).length === 1)
        ) {
          message = (data as any).message || message;
          payload = (data as any).data !== undefined ? (data as any).data : null;
        }

        return {
          success: true,
          statusCode,
          message,
          data: payload ?? null,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
