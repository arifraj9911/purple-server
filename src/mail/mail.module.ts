import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'mail-queue',
    }),
  ],
  providers: [MailService, MailProcessor],
  exports: [BullModule, MailService],
})
export class MailModule {}
