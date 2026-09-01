import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger OpenAPI configuration
  const config = new DocumentBuilder()
    .setTitle('Purple-BD API')
    .setDescription('Purple-BD REST API documentation with Prisma & NestJS')
    .setVersion('1.0')
    .addTag('App', 'General endpoints')
    .addTag('Users', 'User management operations')
    .addTag('Posts', 'Post & blog management operations')
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
