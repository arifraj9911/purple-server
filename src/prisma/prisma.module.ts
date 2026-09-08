import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SuperAdminBootstrapService } from './superadmin-bootstrap.service';

@Global()
@Module({
  providers: [PrismaService, SuperAdminBootstrapService],
  exports: [PrismaService],
})
export class PrismaModule {}
