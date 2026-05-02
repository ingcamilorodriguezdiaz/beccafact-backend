import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SalesConversationStatus } from '@prisma/client';
import {
  AgentResponse,
  ISalesAgentProvider,
  SalesStage,
  SalesAgentContext,
  StructuredAgentDecision,
} from './agent.interfaces';
import { ClaudeSalesAgentProvider } from './providers/claude.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { RuleBasedSalesAgentProvider } from './providers/rule-based.provider';

@Injectable()
export class SalesAgentService implements OnModuleInit {
  private readonly logger = new Logger(SalesAgentService.name);
  private primaryProvider: ISalesAgentProvider | null = null;
  private ollamaProvider: OllamaProvider | null = null;
  private ruleProvider: ISalesAgentProvider;

  constructor(private config: ConfigService) {
    const claudeKey = this.config.get<string>('CLAUDE_API_KEY');
    const ollamaUrl = this.config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    const ollamaModel = this.config.get<string>('OLLAMA_MODEL', 'llama3.2:3b');
    const useOllama = this.config.get<string>('OLLAMA_ENABLED', 'true') === 'true';
    const ollamaTimeoutMs = this.config.get<number>('OLLAMA_TIMEOUT_MS', 180_000);
    const ollamaNumPredict = this.config.get<number>('OLLAMA_NUM_PREDICT', 160);
    const ollamaNumCtx = this.config.get<number>('OLLAMA_NUM_CTX', 2048);
    const ollamaHistoryLimit = this.config.get<number>('OLLAMA_HISTORY_LIMIT', 6);
    const ollamaMaxMessageChars = this.config.get<number>('OLLAMA_MAX_MESSAGE_CHARS', 500);
    const ollamaUseJsonFormat = this.config.get<string>('OLLAMA_USE_JSON_FORMAT', 'false') === 'true';

    if (claudeKey) {
      this.primaryProvider = new ClaudeSalesAgentProvider(claudeKey);
      this.logger.log('SalesAgent: Claude API activo');
    } else if (useOllama) {
      this.ollamaProvider = new OllamaProvider(ollamaUrl, ollamaModel, {
        timeoutMs: ollamaTimeoutMs,
        numPredict: ollamaNumPredict,
        numCtx: ollamaNumCtx,
        historyLimit: ollamaHistoryLimit,
        maxMessageChars: ollamaMaxMessageChars,
        useJsonFormat: ollamaUseJsonFormat,
      });
      this.primaryProvider = this.ollamaProvider;
      this.logger.log(
        `SalesAgent: Ollama activo → ${ollamaUrl} | modelo: ${ollamaModel} | timeoutMs: ${ollamaTimeoutMs} | numPredict: ${ollamaNumPredict} | numCtx: ${ollamaNumCtx} | jsonFormat: ${ollamaUseJsonFormat}`,
      );
    } else {
      this.logger.warn('SalesAgent: sin IA configurada — usando reglas');
    }

    this.ruleProvider = new RuleBasedSalesAgentProvider();
  }

  onModuleInit() {
    if (this.ollamaProvider) {
      this.ollamaProvider.warmUp();
    }
  }

  async generateResponse(ctx: SalesAgentContext): Promise<AgentResponse> {
    let decision: StructuredAgentDecision;

    if (this.primaryProvider) {
      try {
        decision = await this.primaryProvider.generate(ctx);
      } catch (err) {
        this.logger.error(
          `Proveedor IA falló para conversación ${ctx.conversation.id}: ${(err as Error).message} — fallback a reglas`,
        );
        decision = await this.ruleProvider.generate(ctx);
      }
    } else {
      decision = await this.ruleProvider.generate(ctx);
    }

    decision = {
      ...decision,
      salesStage: decision.salesStage ?? this.resolveSalesStage(decision),
    };

    return this.toAgentResponse(decision);
  }

  private toAgentResponse(d: StructuredAgentDecision): AgentResponse {
    const updateConversation: Record<string, unknown> = {};
    const updateMetadata: Record<string, unknown> = {};
    if (d.capturedData?.companyName) updateConversation['companyName'] = d.capturedData.companyName;
    if (d.capturedData?.customerName) updateConversation['visitorName'] = d.capturedData.customerName;
    if (d.capturedData?.email) updateConversation['email'] = d.capturedData.email;
    if (d.capturedData?.phone) updateConversation['phone'] = d.capturedData.phone;
    if (d.recommendedPlanName) updateConversation['recommendedPlanName'] = d.recommendedPlanName;
    if (d.capturedData?.companyIndustry) updateMetadata['companyIndustry'] = d.capturedData.companyIndustry;
    if (typeof d.capturedData?.usersCount === 'number') updateMetadata['usersCount'] = d.capturedData.usersCount;
    if (Array.isArray(d.capturedData?.needs) && d.capturedData.needs.length > 0) {
      updateMetadata['needs'] = d.capturedData.needs;
    }
    updateMetadata['lastIntent'] = d.intent;
    updateMetadata['lastNextAction'] = d.nextAction;
    updateMetadata['salesStage'] = d.salesStage;
    if (d.recommendedPlanName) updateMetadata['recommendedPlanName'] = d.recommendedPlanName;

    let newStatus: string | undefined;
    if (d.salesStage === 'HANDOFF_HUMAN' || d.shouldEscalateToHuman) {
      newStatus = SalesConversationStatus.HUMAN_REQUIRED;
    } else if (d.salesStage === 'PAYMENT') {
      newStatus = SalesConversationStatus.PAYMENT_PENDING;
    } else if (d.salesStage === 'QUOTATION' || d.shouldCreateQuote) {
      newStatus = SalesConversationStatus.QUOTE_SENT;
    } else if (d.salesStage === 'RECOMMENDATION' || d.nextAction === 'recommend_plan') {
      newStatus = SalesConversationStatus.QUALIFIED;
    } else if (['ask_follow_up', 'answer_question'].includes(d.nextAction)) {
      newStatus = SalesConversationStatus.IN_PROGRESS;
    }

    return {
      content: d.message,
      newStatus,
      salesStage: d.salesStage,
      updateConversation: Object.keys(updateConversation).length > 0 ? updateConversation : undefined,
      updateMetadata: Object.keys(updateMetadata).length > 0 ? updateMetadata : undefined,
      metadata: {
        intent: d.intent,
        nextAction: d.nextAction,
        salesStage: d.salesStage,
        ...(d.shouldCreateQuote ? { action: 'CREATE_QUOTE' } : {}),
        ...(d.shouldCreatePaymentLink ? { action: 'CREATE_PAYMENT_LINK' } : {}),
      },
      shouldCreateQuote: d.shouldCreateQuote,
      shouldEscalateToHuman: d.shouldEscalateToHuman,
    };
  }

  private resolveSalesStage(d: StructuredAgentDecision): SalesStage {
    if (d.shouldEscalateToHuman || d.nextAction === 'escalate_to_human' || d.intent === 'HUMAN_REQUEST') {
      return 'HANDOFF_HUMAN';
    }
    if (d.shouldCreatePaymentLink || d.nextAction === 'create_payment_link') {
      return 'PAYMENT';
    }
    if (d.shouldCreateQuote || d.nextAction === 'create_quote' || d.intent === 'READY_TO_BUY') {
      return 'QUOTATION';
    }
    if (d.intent === 'ASK_DEMO') {
      return 'DEMO';
    }
    if (d.intent === 'OBJECTION_PRICE' || d.intent === 'OBJECTION_NEEDS_TIME') {
      return 'OBJECTION';
    }
    if (d.nextAction === 'recommend_plan' || d.recommendedPlanName) {
      return 'RECOMMENDATION';
    }

    const hasQualificationSignals =
      Boolean(d.capturedData.companyIndustry) ||
      typeof d.capturedData.usersCount === 'number' ||
      Boolean(d.capturedData.needs?.length) ||
      d.intent === 'ASK_PRICE' ||
      d.intent === 'ASK_FEATURES' ||
      d.intent === 'ASK_SUPPORT' ||
      d.intent === 'COMPARE_PLANS' ||
      d.intent === 'PROVIDING_INFO';

    return hasQualificationSignals ? 'QUALIFICATION' : 'DISCOVERY';
  }
}
