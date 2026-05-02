import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PaymentIntentStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';
import { MailerService } from '../common/mailer/mailer.service';

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  async createSimulated(conversationId: string, amount: number, quoteId?: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const paymentIntent = await this.prisma.paymentIntent.create({
      data: {
        conversationId,
        quoteId: quoteId ?? null,
        amount,
        currency: 'COP',
        status: PaymentIntentStatus.CREATED,
      },
    });

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4200';
    const paymentUrl = `${frontendUrl}/payment/simulate/${paymentIntent.id}`;

    return this.prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: { paymentUrl },
    });
  }

  async processWebhook(body: { paymentIntentId: string; status: PaymentIntentStatus; secret: string }) {
    const expectedSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'beccasoft-webhook-secret';
    if (body.secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: body.paymentIntentId },
    });
    if (!intent) throw new NotFoundException('PaymentIntent not found');

    const updated = await this.prisma.paymentIntent.update({
      where: { id: body.paymentIntentId },
      data: { status: body.status },
    });

    if (body.status === PaymentIntentStatus.PAID) {
      await this.activateCompany(intent.conversationId);
    }

    return updated;
  }

  async activateCompany(conversationId: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return;

    const nit = `TEMP-${Date.now()}`;
    const email = conversation.email ?? `temp-${Date.now()}@beccasoft.com`;
    const companyName = conversation.companyName ?? 'Empresa BeccaSoft';
    const visitorName = conversation.visitorName ?? 'Administrador';
    const nameParts = visitorName.split(' ');
    const firstName = nameParts[0] ?? 'Admin';
    const lastName = nameParts.slice(1).join(' ') || 'BeccaSoft';

    try {
      const company = await this.prisma.company.create({
        data: {
          name: companyName,
          nit,
          razonSocial: companyName,
          email,
          phone: conversation.phone ?? undefined,
          status: 'ACTIVE',
        },
      });

      await this.prisma.branch.create({
        data: {
          companyId: company.id,
          name: 'Sede Principal',
          isMain: true,
        },
      });

      const hashedPassword = await bcrypt.hash('BeccaSoft2024!', 10);
      await this.prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone: conversation.phone ?? undefined,
          companyId: company.id,
          isActive: true,
        },
      });

      await this.prisma.salesConversation.update({
        where: { id: conversationId },
        data: { status: 'CONVERTED', companyId: company.id },
      });

      await this.sendActivationEmail(email, visitorName, companyName);
    } catch (error) {
      this.logger.error(`Error activating company for conversation ${conversationId}`, (error as Error).stack);
    }
  }

  private async sendActivationEmail(to: string, name: string, companyName: string) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT ?? 587) === 465,
        auth: {
          user: process.env.SMTP_USER ?? '',
          pass: process.env.SMTP_PASS ?? '',
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@beccafact.com',
        to,
        subject: 'Bienvenido a BeccaFact - Tu cuenta está lista',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1a407e; padding: 32px; color: white;">
              <h1 style="margin: 0;">Bienvenido a BeccaFact</h1>
            </div>
            <div style="padding: 32px;">
              <p>Hola <strong>${name}</strong>,</p>
              <p>Tu empresa <strong>${companyName}</strong> ya está activa en BeccaFact.</p>
              <p>Puedes ingresar con tu correo electrónico <strong>${to}</strong> y la contraseña temporal: <strong>BeccaSoft2024!</strong></p>
              <p>Te recomendamos cambiar tu contraseña al iniciar sesión por primera vez.</p>
              <p>Atentamente,<br/><strong>Equipo BeccaFact</strong></p>
            </div>
          </div>
        `,
      });
    } catch (error) {
      this.logger.error(`Error sending activation email to ${to}`, (error as Error).stack);
    }
  }
}
