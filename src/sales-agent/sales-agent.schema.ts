import { CapturedCustomerData, MessageIntent, NextAction, SalesStage, StructuredAgentDecision } from './agent.interfaces';

type RawAgentPayload = Record<string, unknown>;

const VALID_FLOWS = new Set<SalesStage>([
  'DISCOVERY',
  'QUALIFICATION',
  'RECOMMENDATION',
  'DEMO_OR_SANDBOX',
  'QUOTE',
  'PAYMENT',
  'HANDOFF_HUMAN',
]);

const VALID_INTENTS = new Set<MessageIntent>([
  'GENERAL_QUESTION',
  'PROVIDING_INFO',
  'ASK_PRICE',
  'ASK_FEATURES',
  'COMPARE_PLANS',
  'ASK_DEMO',
  'ASK_SANDBOX',
  'ASK_SUPPORT',
  'ASK_PAYMENT',
  'READY_TO_BUY',
  'ASK_QUOTE',
  'HUMAN_REQUEST',
  'OBJECTION_PRICE',
  'OBJECTION_NEEDS_TIME',
  'OBJECTION_ALREADY_HAS_SYSTEM',
  'UNKNOWN',
]);

const VALID_ACTIONS = new Set<NextAction>([
  'ask_follow_up',
  'answer_question',
  'recommend_plan',
  'offer_demo',
  'offer_sandbox',
  'request_contact',
  'create_quote',
  'create_payment_link',
  'escalate_to_human',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return values.length > 0 ? values : [];
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeStage(flow: unknown, fallback?: SalesStage): SalesStage | undefined {
  if (typeof flow === 'string' && VALID_FLOWS.has(flow as SalesStage)) {
    return flow as SalesStage;
  }
  return fallback;
}

function normalizeIntent(value: unknown, fallback: MessageIntent): MessageIntent {
  if (typeof value === 'string' && VALID_INTENTS.has(value as MessageIntent)) {
    return value as MessageIntent;
  }
  return fallback;
}

function normalizeAction(value: unknown, fallback: NextAction): NextAction {
  if (typeof value === 'string' && VALID_ACTIONS.has(value as NextAction)) {
    return value as NextAction;
  }
  return fallback;
}

export function validateStructuredSalesDecision(args: {
  raw: string;
  baselineDecision: StructuredAgentDecision;
  minHistoryMessages?: number;
}): StructuredAgentDecision {
  const { raw, baselineDecision, minHistoryMessages = 0 } = args;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as RawAgentPayload;
  const answer = asOptionalString(parsed.answer ?? parsed.message);
  if (!answer) {
    throw new Error('Missing answer field');
  }

  const slotsRecord = asRecord(parsed.slots_to_update ?? parsed.capturedData);
  const nextAction = normalizeAction(parsed.next_action ?? parsed.nextAction, baselineDecision.nextAction);
  const salesStage = normalizeStage(parsed.flow, baselineDecision.salesStage);
  const intent = normalizeIntent(parsed.intent, baselineDecision.intent);
  const recommendedPlanName =
    asOptionalString(parsed.recommended_plan ?? parsed.recommendedPlanName)
    ?? baselineDecision.recommendedPlanName;
  const confidenceRaw = parsed.confidence;
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(confidenceRaw, 1))
      : 0.5;

  const capturedData: CapturedCustomerData = {
    companyName: asOptionalString(slotsRecord.company_name ?? slotsRecord.companyName) ?? baselineDecision.capturedData.companyName,
    customerName: asOptionalString(slotsRecord.customer_name ?? slotsRecord.customerName) ?? baselineDecision.capturedData.customerName,
    companyIndustry:
      asOptionalString(slotsRecord.company_industry ?? slotsRecord.companyIndustry) ?? baselineDecision.capturedData.companyIndustry,
    phone: asOptionalString(slotsRecord.phone) ?? baselineDecision.capturedData.phone,
    email: asOptionalString(slotsRecord.email) ?? baselineDecision.capturedData.email,
    usersCount: asOptionalNumber(slotsRecord.users_count ?? slotsRecord.usersCount) ?? baselineDecision.capturedData.usersCount,
    needs: asStringArray(slotsRecord.needs) ?? baselineDecision.capturedData.needs ?? [],
    city: asOptionalString(slotsRecord.city) ?? baselineDecision.capturedData.city,
    preferredPlan:
      asOptionalString(slotsRecord.preferred_plan ?? slotsRecord.preferredPlan) ?? baselineDecision.capturedData.preferredPlan,
    budgetSignal:
      asOptionalString(slotsRecord.budget_signal ?? slotsRecord.budgetSignal) ?? baselineDecision.capturedData.budgetSignal,
    urgency: asOptionalString(slotsRecord.urgency) ?? baselineDecision.capturedData.urgency,
    requestedAction:
      asOptionalString(slotsRecord.requested_action ?? slotsRecord.requestedAction) ?? baselineDecision.capturedData.requestedAction,
    objections: asStringArray(slotsRecord.objections) ?? baselineDecision.capturedData.objections,
    wantsDemo: asOptionalBoolean(slotsRecord.wants_demo ?? slotsRecord.wantsDemo) ?? baselineDecision.capturedData.wantsDemo,
    wantsSandbox:
      asOptionalBoolean(slotsRecord.wants_sandbox ?? slotsRecord.wantsSandbox) ?? baselineDecision.capturedData.wantsSandbox,
    readyToBuy:
      asOptionalBoolean(slotsRecord.ready_to_buy ?? slotsRecord.readyToBuy) ?? baselineDecision.capturedData.readyToBuy,
  };

  const shouldEscalateToHuman =
    parsed.should_escalate === true
    || parsed.shouldEscalateToHuman === true
    || nextAction === 'escalate_to_human'
    || confidence < 0.35;

  const shouldCreateQuote =
    nextAction === 'create_quote'
    && Boolean(capturedData.usersCount)
    && minHistoryMessages >= 3;

  const shouldCreatePaymentLink =
    nextAction === 'create_payment_link'
    && Boolean(recommendedPlanName || capturedData.preferredPlan || baselineDecision.recommendedPlanName);

  const safeNextAction =
    nextAction === 'create_quote' && !shouldCreateQuote
      ? 'request_contact'
      : nextAction === 'create_payment_link' && !shouldCreatePaymentLink
        ? 'ask_follow_up'
        : nextAction;

  return {
    message: answer,
    intent,
    nextAction: safeNextAction,
    salesStage,
    capturedData,
    recommendedPlanName,
    shouldCreateQuote: safeNextAction === 'create_quote',
    shouldCreatePaymentLink: safeNextAction === 'create_payment_link',
    shouldEscalateToHuman,
  };
}
