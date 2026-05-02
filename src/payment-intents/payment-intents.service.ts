import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PaymentIntentStatus, QuoteStatus, SalesConversationStatus, SalesMessageSender } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { AxiosError } from 'axios';
import { createHash } from 'crypto';
import { PrismaService } from '../config/prisma.service';
import { MailerService } from '../common/mailer/mailer.service';
import { CreateEpaycoSessionDto } from './dto/create-epayco-session.dto';

@Injectable()
export class PaymentIntentsService {
  private readonly logger = new Logger(PaymentIntentsService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  private get frontendUrl() {
    return (process.env.FRONTEND_URL ?? 'http://localhost:4200').replace(/\/$/, '');
  }

  private get apiBaseUrl() {
    return (process.env.PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
  }

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

    const paymentUrl = `${this.frontendUrl}/payment/simulate/${paymentIntent.id}`;

    return this.prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: { paymentUrl },
    });
  }

  async createChatCheckoutIntent(conversationId: string, amount: number, quoteId?: string) {
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
        metadata: {
          source: 'WEB_CHAT',
          checkoutProvider: 'EPAYCO',
        } as any,
      },
    });

    const paymentUrl = `${this.frontendUrl}/payment/checkout/${paymentIntent.id}`;

    return this.prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: { paymentUrl },
    });
  }

  async createEpaycoSession(dto: CreateEpaycoSessionDto) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });

    if (!plan || !plan.isActive || plan.isCustom) {
      throw new NotFoundException('Plan no disponible para compra en línea');
    }

    const monthlyPrice = Number(plan.price);
    if (!monthlyPrice || monthlyPrice <= 0) {
      throw new BadRequestException('Este plan requiere asesoría comercial para finalizar la compra');
    }

    const isAnnual = dto.billingCycle === 'ANNUAL';
    const amount = isAnnual
      ? Number((monthlyPrice * 12 * 0.85).toFixed(2))
      : Number(monthlyPrice.toFixed(2));

    const publicKey = process.env.EPAYCO_PUBLIC_KEY;
    const privateKey = process.env.EPAYCO_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
      throw new InternalServerErrorException('La integración de ePayco no está configurada');
    }

    const merchantName = process.env.EPAYCO_MERCHANT_NAME ?? 'Beccasoft';
    const checkoutType = process.env.EPAYCO_CHECKOUT_TYPE ?? 'onpage';
    const test = (process.env.EPAYCO_TEST ?? 'true').toLowerCase() === 'true';
    const invoice = `PLAN-${plan.name.toUpperCase()}-${Date.now()}`;

    try {
      const apifyToken = await this.getEpaycoApifyToken(publicKey, privateKey);

      const sessionPayload = {
        checkout_version: '2',
        name: merchantName,
        description: `${plan.displayName} - ${isAnnual ? 'pago anual' : 'pago mensual'}`,
        currency: plan.currency,
        amount,
        lang: 'ES',
        country: 'CO',
        invoice,
        response: `${this.frontendUrl}/payment/epayco/response`,
        confirmation: `${this.apiBaseUrl}/payment-intents/epayco/confirmation`,
        method: 'GET',
        noRedirectOnClose: true,
        forceResponse: true,
        uniqueTransactionPerBill: true,
        extra1: plan.id,
        extra2: dto.billingCycle,
        extra3: test ? 'sandbox' : 'production',
        extra4: plan.displayName,
      };

      const sessionId = await this.createEpaycoSessionId(apifyToken, sessionPayload);

      return {
        sessionId,
        type: checkoutType,
        test,
        planId: plan.id,
        planName: plan.displayName,
        billingCycle: dto.billingCycle,
        currency: plan.currency,
        amount,
        invoice,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `Error creando sesión ePayco. Status: ${error.response?.status ?? 'N/A'} Data: ${JSON.stringify(error.response?.data ?? {})}`,
          error.stack,
        );

        const providerMessage =
          (error.response?.data as { textResponse?: string; message?: string } | undefined)?.textResponse
          ?? (error.response?.data as { textResponse?: string; message?: string } | undefined)?.message;

        throw new InternalServerErrorException(
          providerMessage ?? 'No fue posible iniciar el checkout de ePayco',
        );
      }

      this.logger.error('Error creando sesión ePayco', (error as Error).stack);
      throw new InternalServerErrorException('No fue posible iniciar el checkout de ePayco');
    }
  }

  async createEpaycoSessionForPaymentIntent(paymentIntentId: string) {
    const paymentIntent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      include: {
        conversation: true,
      },
    });

    if (!paymentIntent) {
      throw new NotFoundException('Payment intent no encontrado');
    }

    const quote = paymentIntent.quoteId
      ? await this.prisma.quote.findUnique({
          where: { id: paymentIntent.quoteId },
          select: {
            id: true,
            number: true,
            total: true,
            currency: true,
            items: { select: { description: true }, take: 1 },
          },
        })
      : null;

    const publicKey = process.env.EPAYCO_PUBLIC_KEY;
    const privateKey = process.env.EPAYCO_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
      throw new InternalServerErrorException('La integración de ePayco no está configurada');
    }

    const merchantName = process.env.EPAYCO_MERCHANT_NAME ?? 'Beccasoft';
    const checkoutType = process.env.EPAYCO_CHECKOUT_TYPE ?? 'onpage';
    const test = (process.env.EPAYCO_TEST ?? 'true').toLowerCase() === 'true';
    const planName =
      quote?.items[0]?.description?.replace(/^Plan\s+/i, '').replace(/\s*-\s*BeccaFact$/i, '').trim()
      || paymentIntent.conversation.recommendedPlanName
      || 'BeccaFact';
    const invoice = quote?.number ?? `CHAT-${paymentIntent.id.slice(0, 8).toUpperCase()}`;
    const amount = Number(paymentIntent.amount);
    const currency = paymentIntent.currency || quote?.currency || 'COP';
    const customerName =
      paymentIntent.conversation.visitorName
      ?? paymentIntent.conversation.companyName
      ?? 'Cliente Beccasoft';

    try {
      const apifyToken = await this.getEpaycoApifyToken(publicKey, privateKey);
      const sessionPayload = {
        checkout_version: '2',
        name: merchantName,
        description: `Cotización ${invoice} - ${planName}`,
        currency,
        amount,
        lang: 'ES',
        country: 'CO',
        invoice,
        response: `${this.frontendUrl}/payment/epayco/response`,
        confirmation: `${this.apiBaseUrl}/payment-intents/epayco/confirmation`,
        method: 'GET',
        noRedirectOnClose: true,
        forceResponse: true,
        uniqueTransactionPerBill: true,
        extra1: paymentIntent.conversationId,
        extra2: paymentIntent.quoteId ?? '',
        extra3: invoice,
        extra4: planName,
        billing: {
          email: paymentIntent.conversation.email ?? undefined,
          name: customerName,
          mobilePhone: paymentIntent.conversation.phone ?? undefined,
        },
      };

      const sessionId = await this.createEpaycoSessionId(apifyToken, sessionPayload);

      await this.prisma.paymentIntent.update({
        where: { id: paymentIntentId },
        data: {
          metadata: {
            ...(this.asRecord(paymentIntent.metadata)),
            checkoutProvider: 'EPAYCO',
            checkoutType,
            epaycoSessionId: sessionId,
            quoteNumber: invoice,
            planName,
          } as any,
        },
      });

      return {
        sessionId,
        type: checkoutType,
        test,
        paymentIntentId,
        paymentUrl: paymentIntent.paymentUrl,
        quoteId: paymentIntent.quoteId,
        quoteNumber: invoice,
        planName,
        currency,
        amount,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `Error creando sesión ePayco para payment intent ${paymentIntentId}. Status: ${error.response?.status ?? 'N/A'} Data: ${JSON.stringify(error.response?.data ?? {})}`,
          error.stack,
        );

        const providerMessage =
          (error.response?.data as { textResponse?: string; message?: string } | undefined)?.textResponse
          ?? (error.response?.data as { textResponse?: string; message?: string } | undefined)?.message;

        throw new InternalServerErrorException(
          providerMessage ?? 'No fue posible iniciar el checkout de ePayco',
        );
      }

      throw error;
    }
  }

  async getEpaycoTransaction(refPayco: string) {
    if (!refPayco?.trim()) {
      throw new BadRequestException('Debe enviar un ref_payco válido');
    }

    try {
      const response = await axios.get(
        `https://secure.epayco.co/validation/v1/reference/${encodeURIComponent(refPayco)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const payload = response.data ?? {};
      const data = payload.data ?? payload;
      const transaction = Array.isArray(data) ? data[0] : data;

      if (!transaction || Object.keys(transaction).length === 0) {
        throw new NotFoundException('No se encontró información para la referencia indicada');
      }

      const responseText = String(
        transaction.x_response
        ?? transaction.response
        ?? transaction.status
        ?? 'Pendiente',
      );

      return {
        refPayco,
        status: this.normalizeEpaycoStatus(responseText),
        response: responseText,
        reason:
          transaction.x_response_reason_text
          ?? transaction.responseReason
          ?? transaction.reason
          ?? null,
        transactionId: transaction.x_transaction_id ?? transaction.transaction_id ?? null,
        invoice: transaction.x_id_invoice ?? transaction.x_id_factura ?? transaction.invoice ?? null,
        amount: transaction.x_amount ?? transaction.total ?? transaction.amount ?? null,
        currency: transaction.x_currency_code ?? transaction.currency ?? 'COP',
        franchise: transaction.x_franchise ?? transaction.franchise ?? null,
        description: transaction.x_description ?? transaction.description ?? null,
        customerName:
          transaction.x_customer_name
          ?? transaction.customerName
          ?? null,
        customerEmail:
          transaction.x_customer_email
          ?? transaction.customerEmail
          ?? null,
        test: transaction.x_test_request ?? transaction.test ?? null,
        raw: transaction,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof AxiosError) {
        this.logger.error(
          `Error consultando referencia ePayco ${refPayco}. Status: ${error.response?.status ?? 'N/A'} Data: ${JSON.stringify(error.response?.data ?? {})}`,
          error.stack,
        );
      } else {
        this.logger.error(`Error consultando referencia ePayco ${refPayco}`, (error as Error).stack);
      }

      throw new InternalServerErrorException('No fue posible consultar el estado de la transacción en ePayco');
    }
  }

  async processEpaycoConfirmation(payload: Record<string, unknown>) {
    const normalized = this.asRecord(payload);
    const refPayco = this.pickString(normalized, ['x_ref_payco', 'ref_payco']);
    const transactionId = this.pickString(normalized, ['x_transaction_id']);
    const amount = this.pickString(normalized, ['x_amount']);
    const currency = this.pickString(normalized, ['x_currency_code']) ?? 'COP';
    const responseText =
      this.pickString(normalized, ['x_response', 'x_response_reason_text', 'x_transaction_state'])
      ?? 'Pendiente';
    const reason = this.pickString(normalized, ['x_response_reason_text']);
    const quoteId = this.pickString(normalized, ['x_extra2']);
    const quoteNumber = this.pickString(normalized, ['x_extra3', 'x_id_invoice', 'x_id_factura']);
    const conversationId = this.pickString(normalized, ['x_extra1']);
    const signature = this.pickString(normalized, ['x_signature']);
    const testRequest = this.pickString(normalized, ['x_test_request']);
    const customerEmail = this.pickString(normalized, ['x_customer_email']);

    if (!refPayco || !transactionId || !amount) {
      throw new BadRequestException('La confirmación de ePayco no contiene los campos mínimos requeridos');
    }

    this.assertValidEpaycoSignature({
      refPayco,
      transactionId,
      amount,
      currency,
      signature,
    });

    const paymentIntent = await this.findPaymentIntentFromEpaycoConfirmation({
      refPayco,
      quoteId,
      quoteNumber,
      conversationId,
    });

    if (!paymentIntent) {
      this.logger.warn(
        `Webhook ePayco sin payment intent asociado ref=${refPayco} quoteId=${quoteId ?? '-'} quoteNumber=${quoteNumber ?? '-'} conversationId=${conversationId ?? '-'}`,
      );
      throw new NotFoundException('No se encontró un payment intent asociado a la confirmación');
    }

    const mappedStatus = this.mapEpaycoResponseToPaymentIntentStatus(responseText);
    const currentMetadata = this.asRecord(paymentIntent.metadata);
    const alreadyProcessedAsPaid =
      paymentIntent.providerReference === refPayco
      && paymentIntent.status === PaymentIntentStatus.PAID
      && mappedStatus === PaymentIntentStatus.PAID;

    if (alreadyProcessedAsPaid) {
      return { received: true, duplicated: true, paymentIntentId: paymentIntent.id };
    }

    const updatedIntent = await this.prisma.paymentIntent.update({
      where: { id: paymentIntent.id },
      data: {
        providerReference: refPayco,
        status: mappedStatus,
        metadata: {
          ...currentMetadata,
          checkoutProvider: 'EPAYCO',
          epaycoConfirmation: {
            refPayco,
            transactionId,
            amount,
            currency,
            response: responseText,
            reason,
            testRequest,
            customerEmail,
            receivedAt: new Date().toISOString(),
            raw: normalized,
          },
        } as any,
      },
    });

    await this.syncCommercialStateFromPayment(updatedIntent, {
      responseText,
      refPayco,
      quoteId,
      quoteNumber,
    });

    return {
      received: true,
      paymentIntentId: updatedIntent.id,
      status: updatedIntent.status,
      refPayco,
    };
  }

  private normalizeEpaycoStatus(value: string): 'accepted' | 'pending' | 'rejected' | 'failed' | 'unknown' {
    const normalized = value.trim().toLowerCase();

    if (normalized.includes('acept') || normalized.includes('aprob')) return 'accepted';
    if (normalized.includes('pend')) return 'pending';
    if (normalized.includes('rechaz')) return 'rejected';
    if (normalized.includes('fall')) return 'failed';
    return 'unknown';
  }

  private mapEpaycoResponseToPaymentIntentStatus(value: string): PaymentIntentStatus {
    const normalized = this.normalizeEpaycoStatus(value);
    switch (normalized) {
      case 'accepted':
        return PaymentIntentStatus.PAID;
      case 'pending':
        return PaymentIntentStatus.PENDING;
      case 'rejected':
      case 'failed':
        return PaymentIntentStatus.FAILED;
      default:
        return PaymentIntentStatus.PENDING;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private pickString(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private assertValidEpaycoSignature(input: {
    refPayco: string;
    transactionId: string;
    amount: string;
    currency: string;
    signature: string | null;
  }) {
    const customerId = process.env.EPAYCO_P_CUST_ID_CLIENTE;
    const pKey = process.env.EPAYCO_P_KEY;

    if (!customerId || !pKey || !input.signature) {
      this.logger.warn('Validación de firma ePayco omitida por configuración faltante');
      return;
    }

    const expected = createHash('sha256')
      .update(`${customerId}^${pKey}^${input.refPayco}^${input.transactionId}^${input.amount}^${input.currency}`)
      .digest('hex');

    if (expected !== input.signature) {
      throw new UnauthorizedException('Firma inválida en confirmación ePayco');
    }
  }

  private async findPaymentIntentFromEpaycoConfirmation(input: {
    refPayco: string;
    quoteId: string | null;
    quoteNumber: string | null;
    conversationId: string | null;
  }) {
    const byReference = await this.prisma.paymentIntent.findFirst({
      where: { providerReference: input.refPayco },
    });
    if (byReference) return byReference;

    if (input.quoteId) {
      const byQuoteId = await this.prisma.paymentIntent.findFirst({
        where: { quoteId: input.quoteId },
        orderBy: { createdAt: 'desc' },
      });
      if (byQuoteId) return byQuoteId;
    }

    if (input.conversationId) {
      const byConversation = await this.prisma.paymentIntent.findFirst({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: 'desc' },
      });
      if (byConversation) return byConversation;
    }

    if (input.quoteNumber) {
      const candidates = await this.prisma.paymentIntent.findMany({
        where: { quoteId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });

      return candidates.find((item) => this.asRecord(item.metadata)['quoteNumber'] === input.quoteNumber) ?? null;
    }

    return null;
  }

  private async syncCommercialStateFromPayment(
    paymentIntent: { id: string; conversationId: string; quoteId: string | null; status: PaymentIntentStatus },
    details: { responseText: string; refPayco: string; quoteId: string | null; quoteNumber: string | null },
  ) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: paymentIntent.conversationId },
      select: { metadata: true },
    });
    const conversationMetadata = this.asRecord(conversation?.metadata);

    if (paymentIntent.status === PaymentIntentStatus.PAID) {
      if (paymentIntent.quoteId) {
        const quote = await this.prisma.quote.findUnique({ where: { id: paymentIntent.quoteId } });
        if (quote && quote.status !== QuoteStatus.ACCEPTED && quote.status !== QuoteStatus.CONVERTED) {
          await this.prisma.quote.update({
            where: { id: paymentIntent.quoteId },
            data: { status: QuoteStatus.ACCEPTED },
          });
        }
      }

      await this.registerSystemMessage(
        paymentIntent.conversationId,
        `Pago confirmado por ePayco. Referencia ${details.refPayco}${details.quoteNumber ? ` · Cotización ${details.quoteNumber}` : ''}.`,
      );

      await this.activateCompany(paymentIntent.conversationId);
      return;
    }

    if (paymentIntent.status === PaymentIntentStatus.PENDING) {
      await this.prisma.salesConversation.update({
        where: { id: paymentIntent.conversationId },
        data: {
          status: SalesConversationStatus.PAYMENT_PENDING,
          metadata: {
            ...conversationMetadata,
            paymentStatus: 'PENDING',
            paymentRefPayco: details.refPayco,
            paymentLastResponse: details.responseText,
          } as any,
        },
      });

      await this.registerSystemMessage(
        paymentIntent.conversationId,
        `La transacción quedó pendiente en ePayco. Referencia ${details.refPayco}.`,
      );
      return;
    }

    await this.prisma.salesConversation.update({
      where: { id: paymentIntent.conversationId },
      data: {
        status: SalesConversationStatus.QUOTE_SENT,
        metadata: {
          ...conversationMetadata,
          paymentStatus: 'FAILED',
          paymentRefPayco: details.refPayco,
          paymentLastResponse: details.responseText,
        } as any,
      },
    });

    await this.registerSystemMessage(
      paymentIntent.conversationId,
      `La transacción fue rechazada o falló en ePayco. Referencia ${details.refPayco}.`,
    );
  }

  private async registerSystemMessage(conversationId: string, content: string) {
    await this.prisma.salesMessage.create({
      data: {
        conversationId,
        sender: SalesMessageSender.SYSTEM,
        content,
        metadata: {
          category: 'PAYMENT_STATUS',
        } as any,
      },
    });
  }

  private async getEpaycoApifyToken(publicKey: string, privateKey: string) {
    const basicAuth = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
    const loginResponse = await axios.post<{ token: string }>(
      'https://apify.epayco.co/login',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basicAuth}`,
        },
      },
    );

    const apifyToken = loginResponse.data?.token;
    if (!apifyToken) {
      throw new Error('No se recibió token de autenticación de ePayco');
    }

    return apifyToken;
  }

  private async createEpaycoSessionId(apifyToken: string, payload: Record<string, unknown>) {
    const sessionResponse = await axios.post<{ data?: { sessionId?: string } }>(
      'https://apify.epayco.co/payment/session/create',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apifyToken}`,
        },
      },
    );

    const sessionId = sessionResponse.data?.data?.sessionId;
    if (!sessionId) {
      throw new Error('No se recibió sessionId de ePayco');
    }

    return sessionId;
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
    if (conversation.companyId) {
      await this.prisma.salesConversation.update({
        where: { id: conversationId },
        data: {
          status: SalesConversationStatus.CONVERTED,
          metadata: {
            ...this.asRecord(conversation.metadata),
            paymentStatus: 'PAID',
          } as any,
        },
      });
      return;
    }

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
        data: {
          status: SalesConversationStatus.CONVERTED,
          companyId: company.id,
          metadata: {
            ...this.asRecord(conversation.metadata),
            paymentStatus: 'PAID',
          } as any,
        },
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
