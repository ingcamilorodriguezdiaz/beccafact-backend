import { SalesConversation, SalesMessage, SalesPlan } from '@prisma/client';

export type MessageIntent =
  | 'ASK_PRICE'
  | 'ASK_FEATURES'
  | 'ASK_DEMO'
  | 'ASK_SANDBOX'
  | 'ASK_PAYMENT'
  | 'ASK_SUPPORT'
  | 'ASK_QUOTE'
  | 'COMPARE_PLANS'
  | 'READY_TO_BUY'
  | 'OBJECTION_PRICE'
  | 'OBJECTION_NEEDS_TIME'
  | 'OBJECTION_ALREADY_HAS_SYSTEM'
  | 'HUMAN_REQUEST'
  | 'GENERAL_QUESTION'
  | 'PROVIDING_INFO'
  | 'UNKNOWN';

export type NextAction =
  | 'answer_question'
  | 'ask_follow_up'
  | 'recommend_plan'
  | 'offer_demo'
  | 'offer_sandbox'
  | 'request_contact'
  | 'create_quote'
  | 'create_payment_link'
  | 'escalate_to_human';

export type SalesStage =
  | 'DISCOVERY'
  | 'QUALIFICATION'
  | 'RECOMMENDATION'
  | 'OBJECTION'
  | 'DEMO'
  | 'DEMO_OR_SANDBOX'
  | 'QUOTATION'
  | 'QUOTE'
  | 'PAYMENT'
  | 'HANDOFF_HUMAN';

export interface CapturedCustomerData {
  companyName?: string;
  customerName?: string;
  companyIndustry?: string;
  phone?: string;
  email?: string;
  usersCount?: number;
  needs?: string[];
  city?: string;
  preferredPlan?: string;
  budgetSignal?: string;
  urgency?: string;
  requestedAction?: string;
  objections?: string[];
  wantsDemo?: boolean;
  wantsSandbox?: boolean;
  readyToBuy?: boolean;
}

export interface StructuredAgentDecision {
  message: string;
  intent: MessageIntent;
  nextAction: NextAction;
  salesStage?: SalesStage;
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
  salesStage?: SalesStage;
  metadata?: Record<string, unknown>;
  updateConversation?: Record<string, unknown>;
  updateMetadata?: Record<string, unknown>;
  shouldCreateQuote?: boolean;
  shouldEscalateToHuman?: boolean;
}

export interface ISalesAgentProvider {
  generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision>;
}
