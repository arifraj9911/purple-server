import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export type OtpMailPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: { user, pass },
      });
      this.logger.log(`SMTP Mailer initialized using host: ${host}`);
    } else {
      this.logger.warn(
        'SMTP credentials not fully configured in .env. Emails will be logged to console in development mode.',
      );
    }
  }

  async sendOtpEmail(
    to: string,
    otp: string,
    purpose: OtpMailPurpose,
  ): Promise<void> {
    const isVerification = purpose === 'EMAIL_VERIFICATION';
    const subject = isVerification
      ? 'Verify Your Email — Purple-BD'
      : 'Password Reset Code — Purple-BD';

    const actionText = isVerification
      ? 'verify your email address'
      : 'reset your account password';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px;">
        <h2 style="color: #6366f1; margin-bottom: 16px;">Purple-BD Security</h2>
        <p style="font-size: 16px; color: #333;">Hello,</p>
        <p style="font-size: 15px; color: #555;">Use the one-time password (OTP) below to ${actionText}:</p>
        <div style="background-color: #f3f4f6; border-radius: 6px; padding: 16px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1f2937;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #6b7280;">This code is valid for <strong>5 minutes</strong>. If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">&copy; ${new Date().getFullYear()} Purple-BD. All rights reserved.</p>
      </div>
    `;

    // Always log in development for instant developer visibility
    this.logger.log(
      `[OTP Email to ${to}] Purpose: ${purpose} | Code: ${otp}`,
    );

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'no-reply@purple-bd.com',
          to,
          subject,
          html,
        });
        this.logger.log(`Email successfully dispatched via SMTP to ${to}`);
      } catch (err: any) {
        this.logger.error(`Failed to send email via SMTP to ${to}: ${err.message}`, err.stack);
        throw err; // Allow BullMQ to handle retry
      }
    }
  }
}
