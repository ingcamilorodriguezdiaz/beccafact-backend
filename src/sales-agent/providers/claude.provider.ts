import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ISalesAgentProvider, SalesAgentContext, StructuredAgentDecision } from '../agent.interfaces';
import { SALES_KNOWLEDGE_BASE } from '../knowledge-base';
import { SALES_AGENT_SYSTEM_PROMPT, buildSalesKnowledgeContext } from '../sales-agent.prompt';
import { validateStructuredSalesDecision } from '../sales-agent.schema';
import { RuleBasedSalesAgentProvider } from './rule-based.provider';

export class ClaudeSalesAgentProvider implements ISalesAgentProvider {
  private readonly logger = new Logger(ClaudeSalesAgentProvider.name);
  private readonly client: Anthropic;
  private readonly ruleProvider = new RuleBasedSalesAgentProvider();

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision> {
    const { conversation, userMessage, availablePlans } = ctx;
    const baselineDecision = await this.ruleProvider.generate(ctx);
    const kb = SALES_KNOWLEDGE_BASE;

    const plansContext = availablePlans.map((p) => ({
      name: p.name,
      price: `COP ${Number(p.price).toLocaleString('es-CO')} / ${p.billingPeriod === 'MONTHLY' ? 'mes' : 'año'}`,
      maxUsers: p.maxUsers ?? 'ilimitados',
      features: Array.isArray(p.features) ? p.features.join(', ') : String(p.features ?? ''),
    }));

    const knowledgeContext = buildSalesKnowledgeContext({
      kb,
      plansContext,
      baselineDecision,
    });

    const historyMessages = conversation.messages.slice(-10).map((m) => ({
      role: (m.sender === 'VISITOR' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    const contextForClaude =
      conversation.companyName || conversation.email || conversation.visitorName
        ? `[Contexto: empresa="${conversation.companyName ?? ''}", contacto="${conversation.visitorName ?? ''}", email="${conversation.email ?? ''}", teléfono="${conversation.phone ?? ''}", plan recomendado="${conversation.recommendedPlanName ?? 'ninguno'}"]`
        : '';

    const messages: Anthropic.MessageParam[] = [
      ...(historyMessages.length > 0 ? historyMessages.slice(0, -1) : []),
      {
        role: 'user',
        content: contextForClaude
          ? `${contextForClaude}\n\nMensaje del cliente: ${userMessage}`
          : userMessage,
      },
    ];

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `${SALES_AGENT_SYSTEM_PROMPT}\n\n${knowledgeContext}`,
      messages,
    });

    const rawText = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    return this.parseResponse(rawText, userMessage, baselineDecision);
  }

  private parseResponse(
    raw: string,
    userMessage: string,
    baselineDecision: StructuredAgentDecision,
  ): StructuredAgentDecision {
    try {
      return validateStructuredSalesDecision({
        raw,
        baselineDecision,
        minHistoryMessages: 3,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to parse Claude response: ${(err as Error).message}. Raw: ${raw.substring(0, 200)}`,
      );
      return this.fallbackDecision(userMessage, raw, baselineDecision);
    }
  }

  private fallbackDecision(
    userMessage: string,
    rawMessage: string,
    baselineDecision: StructuredAgentDecision,
  ): StructuredAgentDecision {
    const lower = userMessage.toLowerCase();
    const wantsHuman = ['asesor', 'humano', 'persona', 'hablar con'].some((k) => lower.includes(k));
    const wantsBuy = ['sí', 'si', 'quiero', 'cotización', 'cotizacion', 'pagar', 'lo tomo', 'dale'].some((k) =>
      lower.includes(k),
    );

    return {
      ...baselineDecision,
      message:
        rawMessage || baselineDecision.message || 'Entendido, permíteme un momento para darte la mejor respuesta.',
      intent: wantsHuman ? 'HUMAN_REQUEST' : wantsBuy ? 'READY_TO_BUY' : baselineDecision.intent,
      nextAction: wantsHuman
        ? 'escalate_to_human'
        : wantsBuy
          ? 'create_quote'
          : baselineDecision.nextAction,
      shouldCreateQuote: wantsBuy || baselineDecision.shouldCreateQuote,
      shouldCreatePaymentLink: baselineDecision.shouldCreatePaymentLink,
      shouldEscalateToHuman: wantsHuman || baselineDecision.shouldEscalateToHuman,
    };
  }
}
