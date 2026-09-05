import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cookie Parser Middleware
  app.use(cookieParser());

  // CORS Setup for Cookie-based Authentication
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global DTO Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Unified Response Interceptor
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(new TransformInterceptor(reflector));

  // Swagger OpenAPI configuration
  const config = new DocumentBuilder()
    .setTitle('Purple-BD API')
    .setDescription(
      'Production-Grade Authentication & API Documentation with NestJS, Prisma, BullMQ, and Passport',
    )
    .setVersion('1.0')
    .addTag('Authentication', 'Authentication, Registration, OTP, and Session Management')
    .addTag('App', 'Health & General endpoints')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT Access Token',
        in: 'header',
      },
      'access-token',
    )
    .addCookieAuth('access_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
      description: 'HTTP-only Cookie for JWT Access Token',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(
    `Swagger documentation is available at: http://localhost:${port}/api/docs`,
  );
}
bootstrap();

