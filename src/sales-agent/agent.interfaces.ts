import { SalesConversation, SalesMessage, SalesPlan } from '@prisma/client';

export type MessageIntent =
  | 'ASK_PRICE'
  | 'ASK_FEATURES'
  | 'ASK_DEMO'
  | 'ASK_PAYMENT'
  | 'ASK_SUPPORT'
  | 'COMPARE_PLANS'
  | 'READY_TO_BUY'
  | 'OBJECTION_PRICE'
  | 'OBJECTION_NEEDS_TIME'
  | 'HUMAN_REQUEST'
  | 'GENERAL_QUESTION'
  | 'PROVIDING_INFO';

export type NextAction =
  | 'answer_question'
  | 'ask_follow_up'
  | 'recommend_plan'
  | 'create_quote'
  | 'create_payment_link'
  | 'escalate_to_human';

export interface CapturedCustomerData {
  companyName?: string;
  customerName?: string;
  companyIndustry?: string;
  phone?: string;
  email?: string;
  usersCount?: number;
  needs?: string[];
}

export interface StructuredAgentDecision {
  message: string;
  intent: MessageIntent;
  nextAction: NextAction;
  capturedData: CapturedCustomerData;
  recommendedPlanName?: string;
  shouldCreateQuote: boolean;
  shouldCreatePaymentLink: boolean;
  shouldEscalateToHuman: boolean;
  newStatus?: string;
}

export interface SalesAgentContext {
  conversation: SalesConversation & { messages: SalesMessage[] };
  userMessage: string;
  availablePlans: SalesPlan[];
}

export interface AgentResponse {
  content: string;
  newStatus?: string;
  metadata?: Record<string, unknown>;
  updateConversation?: Record<string, unknown>;
  updateMetadata?: Record<string, unknown>;
  shouldCreateQuote?: boolean;
  shouldEscalateToHuman?: boolean;
}

export interface ISalesAgentProvider {
  generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision>;
}
