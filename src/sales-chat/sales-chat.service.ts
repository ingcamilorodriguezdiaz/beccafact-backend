import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { SalesConversationStatus, SalesMessageSender, QuoteStatus, SalesPlan } from '@prisma/client';
import { PrismaService } from '../config/prisma.service';
import { SalesAgentService } from '../sales-agent/sales-agent.service';
import { PaymentIntentsService } from '../payment-intents/payment-intents.service';
import { MailerService } from '../common/mailer/mailer.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationStatusDto } from './dto/update-conversation-status.dto';

@Injectable()
export class SalesChatService {
  private readonly logger = new Logger(SalesChatService.name);

  constructor(
    private prisma: PrismaService,
    private salesAgent: SalesAgentService,
    private paymentIntents: PaymentIntentsService,
    private mailer: MailerService,
  ) {}

  async createConversation(dto: CreateConversationDto) {
    return this.prisma.salesConversation.create({
      data: {
        visitorName: dto.visitorName,
        companyName: dto.companyName,
        email: dto.email,
        phone: dto.phone,
        source: dto.source,
        status: SalesConversationStatus.NEW,
      },
    });
  }

  async getMessages(conversationId: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.salesMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendMessage(conversationId: string, dto: SendMessageDto) {
    const startedAt = Date.now();
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        paymentIntents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    this.logger.log(
      `Sales chat request conversation=${conversationId} status=${conversation.status} history=${conversation.messages.length} messagePreview="${this.preview(dto.content)}"`,
    );

    const visitorMessage = await this.prisma.salesMessage.create({
      data: {
        conversationId,
        sender: SalesMessageSender.VISITOR,
        content: dto.content,
      },
    });

    const existingCheckout = await this.getExistingCheckoutSummary(conversationId, conversation);
    if (existingCheckout && this.isCheckoutFollowUpRequest(dto.content)) {
      const agentMessage = await this.prisma.salesMessage.create({
        data: {
          conversationId,
          sender: SalesMessageSender.AGENT,
          content: existingCheckout.content,
          metadata: existingCheckout.metadata as any,
        },
      });

      this.logger.log(
        `Sales chat checkout reuse conversation=${conversationId} durationMs=${Date.now() - startedAt}`,
      );

      return { visitorMessage, agentMessage };
    }

    const availablePlans = await this.prisma.salesPlan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });

    const agentResponse = await this.salesAgent.generateResponse({
      conversation,
      userMessage: dto.content,
      availablePlans,
    });

    if (agentResponse.newStatus || agentResponse.updateConversation || agentResponse.updateMetadata) {
      const currentMetadata = this.asRecord(conversation.metadata);
      await this.prisma.salesConversation.update({
        where: { id: conversationId },
        data: {
          ...(agentResponse.newStatus ? { status: agentResponse.newStatus } : {}),
          ...(agentResponse.updateConversation as any ?? {}),
          ...(agentResponse.updateMetadata
            ? { metadata: { ...currentMetadata, ...agentResponse.updateMetadata } as any }
            : {}),
        },
      });
    }

    let agentMessage = await this.prisma.salesMessage.create({
      data: {
        conversationId,
        sender: SalesMessageSender.AGENT,
        content: agentResponse.content,
        metadata: (agentResponse.metadata ?? {}) as any,
      },
    });

    if (
      agentResponse.metadata?.action === 'CREATE_QUOTE'
      || agentResponse.metadata?.action === 'CREATE_PAYMENT_LINK'
    ) {
      try {
        const checkoutSummary = existingCheckout ?? await this.generateOrReuseCheckoutSummary(conversationId);
        agentMessage = await this.prisma.salesMessage.update({
          where: { id: agentMessage.id },
          data: {
            content: checkoutSummary.content,
            metadata: { ...(agentResponse.metadata ?? {}), ...checkoutSummary.metadata } as any,
          },
        });

        const email = checkoutSummary.email;
        if (email && checkoutSummary.paymentUrl) {
          await this.mailer.sendSalesPaymentLinkEmail({
            to: email,
            customerName: checkoutSummary.customerName,
            companyName: checkoutSummary.companyName,
            planName: checkoutSummary.planName,
            amount: checkoutSummary.amount,
            paymentUrl: checkoutSummary.paymentUrl,
            quoteNumber: checkoutSummary.quoteNumber,
          });
        }
      } catch (error) {
        this.logger.error(`Error generating quote for conversation ${conversationId}`, (error as Error).stack);
      }
    }

    this.logger.log(
      `Sales chat response conversation=${conversationId} durationMs=${Date.now() - startedAt} intent=${String(agentResponse.metadata?.['intent'] ?? 'unknown')} nextAction=${String(agentResponse.metadata?.['nextAction'] ?? 'unknown')} salesStage=${String(agentResponse.metadata?.['salesStage'] ?? agentResponse.salesStage ?? 'unknown')}`,
    );

    return { visitorMessage, agentMessage };
  }

  async getPlans() {
    return this.prisma.salesPlan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  async listConversations(filters?: {
    status?: SalesConversationStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, search, page = 1, limit = 20 } = filters ?? {};
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { visitorName: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.salesConversation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { messages: true } } },
      }),
      this.prisma.salesConversation.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getConversation(id: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        paymentIntents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async updateStatus(id: string, dto: UpdateConversationStatusDto) {
    const conversation = await this.prisma.salesConversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.prisma.salesConversation.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async generateQuote(conversationId: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const internalCompanyId = process.env.BECCASOFT_INTERNAL_COMPANY_ID;
    if (!internalCompanyId) throw new Error('BECCASOFT_INTERNAL_COMPANY_ID not configured');

    const email = conversation.email ?? `visitor-${conversationId}@beccasoft.com`;
    const customerName = conversation.companyName ?? conversation.visitorName ?? 'Prospecto';

    let customer = await this.prisma.customer.findFirst({
      where: { companyId: internalCompanyId, email, deletedAt: null },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          companyId: internalCompanyId,
          name: customerName,
          email,
          phone: conversation.phone ?? undefined,
          documentType: 'NIT',
          documentNumber: `TEMP-${Date.now()}`,
        },
      });
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateStr = `${y}${m}${d}`;
    const todayStart = new Date(`${y}-${m}-${d}`);

    const countToday = await this.prisma.quote.count({
      where: {
        companyId: internalCompanyId,
        createdAt: { gte: todayStart },
      },
    });
    const quoteNumber = `COT-${dateStr}-${String(countToday + 1).padStart(3, '0')}`;

    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 7);

    const plan = await this.resolvePlanForConversation(conversation);
    const planName = plan.name;
    const planPrice = Number(plan.price);
    const taxRate = 19;
    const subtotal = planPrice;
    const taxAmount = Math.round(subtotal * (taxRate / 100));
    const total = subtotal + taxAmount;

    const quote = await this.prisma.quote.create({
      data: {
        companyId: internalCompanyId,
        customerId: customer.id,
        number: quoteNumber,
        sourceChannel: 'WEB_CHAT',
        opportunityName: `Venta BeccaSoft - ${conversation.companyName ?? customerName}`,
        salesOwnerName: 'Agente IA',
        currency: 'COP',
        status: QuoteStatus.SENT,
        issueDate: now,
        expiresAt,
        subtotal,
        taxAmount,
        total,
        items: {
          create: {
            description: `Plan ${planName} - BeccaFact`,
            quantity: 1,
            unitPrice: subtotal,
            taxRate,
            taxAmount,
            discount: 0,
            total,
            position: 1,
          },
        },
      },
      include: { items: true },
    });

    await this.prisma.salesConversation.update({
      where: { id: conversationId },
      data: { quoteId: quote.id },
    });

    const paymentIntent = await this.paymentIntents.createChatCheckoutIntent(
      conversationId,
      total,
      quote.id,
    );

    return { quote, paymentIntent, conversation, plan };
  }

  private async generateOrReuseCheckoutSummary(conversationId: string) {
    const existingConversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { paymentIntents: { orderBy: { createdAt: 'desc' } } },
    });
    if (!existingConversation) {
      throw new NotFoundException('Conversation not found');
    }

    const existingSummary = await this.getExistingCheckoutSummary(conversationId, existingConversation);
    if (existingSummary) {
      return existingSummary;
    }

    const quoteResult = await this.generateQuote(conversationId);
    const followUp = this.buildPaymentFollowUp({
        planName: quoteResult.plan.name,
        amount: Number(quoteResult.paymentIntent.amount),
        paymentUrl: quoteResult.paymentIntent.paymentUrl ?? '',
        quoteNumber: quoteResult.quote.number,
      });

    return {
      content: followUp.content,
      metadata: {
        paymentUrl: quoteResult.paymentIntent.paymentUrl,
        quoteId: quoteResult.quote.id,
        quoteNumber: quoteResult.quote.number,
        recommendedPlanName: quoteResult.plan.name,
        totalAmount: Number(quoteResult.paymentIntent.amount),
        paymentCtaLabel: 'Pagar ahora',
        paymentSummary: followUp.summary,
      },
      email: quoteResult.conversation.email ?? null,
      customerName: quoteResult.conversation.visitorName ?? quoteResult.conversation.companyName ?? 'Cliente',
      companyName: quoteResult.conversation.companyName ?? undefined,
      planName: quoteResult.plan.name,
      amount: Number(quoteResult.paymentIntent.amount),
      paymentUrl: quoteResult.paymentIntent.paymentUrl ?? '',
      quoteNumber: quoteResult.quote.number,
    };
  }

  private preview(value: string, maxChars: number = 160): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, maxChars - 3)}...`;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private async resolvePlanForConversation(conversation: {
    recommendedPlanName?: string | null;
    interestedPlanName?: string | null;
    metadata?: unknown;
  }): Promise<SalesPlan> {
    const metadata = this.asRecord(conversation.metadata);
    const recommendedPlanName =
      conversation.recommendedPlanName
      ?? conversation.interestedPlanName
      ?? (typeof metadata['recommendedPlanName'] === 'string' ? metadata['recommendedPlanName'] : null)
      ?? null;

    if (recommendedPlanName) {
      const plan = await this.prisma.salesPlan.findFirst({
        where: { isActive: true, name: recommendedPlanName },
      });
      if (plan) {
        return plan;
      }
    }

    const fallbackPlan = await this.prisma.salesPlan.findFirst({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
    if (!fallbackPlan) {
      throw new Error('No hay planes activos configurados para ventas');
    }
    return fallbackPlan;
  }

  private buildPaymentFollowUp(input: { planName: string; amount: number; paymentUrl: string; quoteNumber: string }) {
    const formattedAmount = input.amount.toLocaleString('es-CO');
    return {
      content: `Ya dejé lista tu propuesta comercial. Incluye el plan ${input.planName}, la cotización ${input.quoteNumber} y un enlace de pago para que puedas avanzar de inmediato cuando quieras.`,
      summary: `Cotización ${input.quoteNumber} · Plan ${input.planName} · Total COP ${formattedAmount}`,
    };
  }

  private isCheckoutFollowUpRequest(content: string): boolean {
    const lower = content.toLowerCase();
    const keywords = [
      'resumen',
      'link',
      'enlace',
      'pago',
      'cotización',
      'cotizacion',
      'dámela',
      'damela',
      'muéstrame',
      'muestrame',
      'dame eso',
      'envíamelo',
      'enviamelo',
    ];
    return keywords.some((keyword) => lower.includes(keyword));
  }

  private async getExistingCheckoutSummary(
    conversationId: string,
    conversation?: {
      quoteId?: string | null;
      companyName?: string | null;
      visitorName?: string | null;
      email?: string | null;
      paymentIntents?: Array<{ amount: unknown; paymentUrl: string | null; quoteId: string | null }>;
    },
  ) {
    const sourceConversation = conversation ?? await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { paymentIntents: { orderBy: { createdAt: 'desc' } } },
    });
    if (!sourceConversation) {
      return null;
    }

    const paymentIntent = sourceConversation.paymentIntents?.find((item) => Boolean(item.paymentUrl));
    if (!sourceConversation.quoteId || !paymentIntent?.paymentUrl) {
      return null;
    }

    const quote = await this.prisma.quote.findUnique({
      where: { id: sourceConversation.quoteId },
      select: { id: true, number: true, total: true, items: { select: { description: true }, take: 1 } },
    });
    if (!quote) {
      return null;
    }

    const planName = quote.items[0]?.description?.replace(/^Plan\s+/i, '').replace(/\s*-\s*BeccaFact$/i, '').trim() || 'BeccaFact';
    const amount = Number(paymentIntent.amount ?? quote.total ?? 0);
    const followUp = this.buildPaymentFollowUp({
        planName,
        amount,
        paymentUrl: paymentIntent.paymentUrl,
        quoteNumber: quote.number,
      });

    return {
      content: followUp.content,
      metadata: {
        paymentUrl: paymentIntent.paymentUrl,
        quoteId: quote.id,
        quoteNumber: quote.number,
        recommendedPlanName: planName,
        totalAmount: amount,
        paymentCtaLabel: 'Pagar ahora',
        paymentSummary: followUp.summary,
      },
      email: sourceConversation.email ?? null,
      customerName: sourceConversation.visitorName ?? sourceConversation.companyName ?? 'Cliente',
      companyName: sourceConversation.companyName ?? undefined,
      planName,
      amount,
      paymentUrl: paymentIntent.paymentUrl,
      quoteNumber: quote.number,
    };
  }
}
