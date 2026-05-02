import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
      },
    });
  }

  async sendQuoteEmail(
    to: string,
    quoteNumber: string,
    customerName: string,
    pdfBuffer: Buffer,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><style>
  body { font-family: Arial, sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: #1a407e; padding: 32px 40px; }
  .header h1 { color: #fff; margin: 0; font-size: 22px; }
  .header p { color: #93c5fd; margin: 8px 0 0; font-size: 14px; }
  .body { padding: 40px; }
  .body p { font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 16px; }
  .cta-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }
  .cta-box p { margin: 0; font-size: 14px; color: #0369a1; }
  .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; }
  .footer p { font-size: 12px; color: #94a3b8; margin: 0; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Cotizacion ${quoteNumber}</h1>
    <p>BeccaFact &middot; Sistema de facturacion electronica</p>
  </div>
  <div class="body">
    <p>Estimado/a <strong>${customerName}</strong>,</p>
    <p>Adjunto encontrara la cotizacion <strong>${quoteNumber}</strong> que hemos preparado para usted.</p>
    <div class="cta-box">
      <p>Por favor revise el documento adjunto y no dude en contactarnos ante cualquier consulta.</p>
    </div>
    <p>Quedamos a su disposicion para atender cualquier solicitud adicional.</p>
    <p>Atentamente,<br/><strong>Equipo BeccaFact</strong></p>
  </div>
  <div class="footer">
    <p>Este correo fue generado automaticamente por BeccaFact. Por favor no responda a este mensaje.</p>
  </div>
</div>
</body>
</html>`;

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@beccafact.com',
        to,
        subject: `Cotizacion ${quoteNumber} - BeccaFact`,
        html,
        attachments: [
          {
            filename: `${quoteNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      this.logger.log(`Email de cotizacion ${quoteNumber} enviado a ${to}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email de cotizacion ${quoteNumber} a ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // No relanzar la excepcion — el flujo principal no debe fallar por email
    }
  }

  async sendPurchaseOrderEmail(
    to: string,
    orderNumber: string,
    customerName: string,
    pdfBuffer: Buffer,
  ): Promise<void> {
    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><style>
  body { font-family: Arial, sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: #1a407e; padding: 32px 40px; }
  .header h1 { color: #fff; margin: 0; font-size: 22px; }
  .header p { color: #bfdbfe; margin: 8px 0 0; font-size: 14px; }
  .body { padding: 40px; }
  .body p { font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 16px; }
  .cta-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }
  .cta-box p { margin: 0; font-size: 14px; color: #1d4ed8; }
  .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; }
  .footer p { font-size: 12px; color: #94a3b8; margin: 0; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Orden de compra ${orderNumber}</h1>
    <p>BeccaFact &middot; Gestion de compras</p>
  </div>
  <div class="body">
    <p>Estimado/a <strong>${customerName}</strong>,</p>
    <p>Adjunto encontrara la orden de compra <strong>${orderNumber}</strong> generada desde BeccaFact.</p>
    <div class="cta-box">
      <p>Le invitamos a revisar el documento adjunto. Si requiere algun ajuste o confirmacion, puede responder por nuestros canales habituales.</p>
    </div>
    <p>Gracias por su atencion.</p>
    <p>Atentamente,<br/><strong>Equipo BeccaFact</strong></p>
  </div>
  <div class="footer">
    <p>Este correo fue generado automaticamente por BeccaFact. Por favor no responda a este mensaje.</p>
  </div>
</div>
</body>
</html>`;

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@beccafact.com',
        to,
        subject: `Orden de compra ${orderNumber} - BeccaFact`,
        html,
        attachments: [
          {
            filename: `${orderNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      this.logger.log(`Email de orden de compra ${orderNumber} enviado a ${to}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email de orden de compra ${orderNumber} a ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async sendSalesPaymentLinkEmail(input: {
    to: string;
    customerName: string;
    companyName?: string;
    planName: string;
    amount: number;
    paymentUrl: string;
    quoteNumber: string;
  }): Promise<void> {
    const {
      to,
      customerName,
      companyName,
      planName,
      amount,
      paymentUrl,
      quoteNumber,
    } = input;
    const formattedAmount = amount.toLocaleString('es-CO');
    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><style>
  body { font-family: Arial, sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 0; }
  .container { max-width: 620px; margin: 32px auto; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: #1a407e; padding: 32px 40px; }
  .header h1 { color: #fff; margin: 0; font-size: 24px; }
  .header p { color: #dbeafe; margin: 8px 0 0; font-size: 14px; }
  .body { padding: 36px 40px; }
  .body p { font-size: 15px; line-height: 1.6; color: #374151; margin: 0 0 16px; }
  .summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px 22px; margin: 24px 0; }
  .summary p { margin: 0 0 10px; font-size: 14px; }
  .summary p:last-child { margin-bottom: 0; }
  .cta { margin: 28px 0; }
  .button { display: inline-block; background: #16a34a; color: #fff !important; text-decoration: none; padding: 14px 22px; border-radius: 10px; font-weight: 700; }
  .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 40px; }
  .footer p { font-size: 12px; color: #94a3b8; margin: 0; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Tu plan ya está listo</h1>
    <p>BeccaFact · Cierre de compra y activación</p>
  </div>
  <div class="body">
    <p>Hola <strong>${customerName}</strong>,</p>
    <p>Te compartimos el resumen de la compra${companyName ? ` para <strong>${companyName}</strong>` : ''}. Ya dejamos listo tu enlace de pago para que puedas activarlo cuando quieras.</p>
    <div class="summary">
      <p><strong>Cotización:</strong> ${quoteNumber}</p>
      <p><strong>Plan:</strong> ${planName}</p>
      <p><strong>Total:</strong> COP ${formattedAmount}</p>
    </div>
    <div class="cta">
      <a class="button" href="${paymentUrl}" target="_blank" rel="noopener noreferrer">Pagar y activar ahora</a>
    </div>
    <p>Apenas se confirme el pago, seguimos con la activación de tu cuenta y te enviamos el acceso por correo.</p>
    <p>Quedo atento si quieres que también te ayudemos a validar cuál plan te conviene más antes de pagar.</p>
  </div>
  <div class="footer">
    <p>Este mensaje fue generado automáticamente por BeccaFact.</p>
  </div>
</div>
</body>
</html>`;

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@beccafact.com',
        to,
        subject: `Activa tu plan ${planName} - ${quoteNumber}`,
        html,
      });
      this.logger.log(`Email comercial con link de pago ${quoteNumber} enviado a ${to}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email comercial ${quoteNumber} a ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
