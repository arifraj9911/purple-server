import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { MailService, OtpMailPurpose } from './mail.service';

export interface SendOtpJobPayload {
  email: string;
  otp: string;
  purpose: OtpMailPurpose;
}

@Processor('mail-queue')
@Injectable()
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<SendOtpJobPayload>): Promise<any> {
    this.logger.log(
      `Processing background mail job #${job.id} [${job.name}] for ${job.data.email} (Attempt ${job.attemptsMade + 1})`,
    );

    switch (job.name) {
      case 'send-otp-email': {
        await this.mailService.sendOtpEmail(
          job.data.email,
          job.data.otp,
          job.data.purpose,
        );
        return { delivered: true, recipient: job.data.email };
      }
      default:
        this.logger.warn(`Unrecognized job name received: ${job.name}`);
        return { skipped: true };
    }
  }
}
