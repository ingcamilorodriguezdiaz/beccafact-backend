import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ISalesAgentProvider, SalesAgentContext, StructuredAgentDecision } from '../agent.interfaces';
import { SALES_KNOWLEDGE_BASE } from '../knowledge-base';
import { RuleBasedSalesAgentProvider } from './rule-based.provider';

const SYSTEM_PROMPT = `Eres un asesor comercial experto de BeccaSoft. Ayudas a empresas colombianas a encontrar el plan de software ERP correcto.

Tu objetivo es conversar de forma natural, entender las necesidades del cliente y guiarlo hacia una compra. No suenas como bot ni como formulario.

REGLAS DE CONVERSACIÓN:
- Responde de forma breve: máximo 3 o 4 oraciones.
- Haz máximo 1 o 2 preguntas por mensaje. Nunca más.
- No repitas preguntas que el cliente ya respondió.
- Conecta las necesidades del cliente con beneficios concretos del plan.
- Si el cliente menciona precio, explica el valor que recibe.
- Si el cliente duda, resuelve la objeción de forma natural y sin presión.
- No uses listas ni bullet points en tu respuesta. Escribe en párrafo natural.
- Usa un tono cercano, profesional y colombiano.
- No inventes precios, módulos ni condiciones que no estén en la base de conocimiento.
- Usa la decisión base recomendada como guía fuerte, salvo que el mensaje del cliente justifique claramente otra dirección.

FORMATO DE RESPUESTA:
Debes responder ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "message": "respuesta para mostrar al cliente",
  "intent": "INTENT_CODE",
  "nextAction": "action_code",
  "capturedData": {
    "companyName": "nombre si lo mencionó, sino null",
    "customerName": "nombre si lo mencionó, sino null",
    "companyIndustry": "industria si la detectas, sino null",
    "phone": "teléfono si lo mencionó, sino null",
    "email": "email si lo mencionó, sino null",
    "usersCount": número_si_lo_mencionó_sino_null,
    "needs": ["array de módulos o necesidades mencionadas, sino vacío"]
  },
  "recommendedPlanName": "Básico|Profesional|Empresarial|null",
  "shouldCreateQuote": false,
  "shouldCreatePaymentLink": false,
  "shouldEscalateToHuman": false
}

Valores válidos para intent: ASK_PRICE, ASK_FEATURES, ASK_DEMO, ASK_PAYMENT, ASK_SUPPORT, COMPARE_PLANS, READY_TO_BUY, OBJECTION_PRICE, OBJECTION_NEEDS_TIME, HUMAN_REQUEST, GENERAL_QUESTION, PROVIDING_INFO

Valores válidos para nextAction: answer_question, ask_follow_up, recommend_plan, create_quote, create_payment_link, escalate_to_human

Pon shouldCreateQuote en true SOLO si el cliente indica claramente que quiere la cotización o quiere comprar.
Pon shouldCreatePaymentLink en true SOLO si el cliente ya está listo para pagar o activar.
Pon shouldEscalateToHuman en true SOLO si el cliente pide explícitamente hablar con una persona real o necesita coordinación humana.

NO respondas con nada más que el JSON. Sin texto adicional, sin markdown, sin explicaciones.`;

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

    const knowledgeContext = `
BASE DE CONOCIMIENTO:
Empresa: ${kb.businessName} - ${kb.description}

PLANES DISPONIBLES (usa estos precios, no inventes otros):
${plansContext.map((p) => `- ${p.name}: ${p.price}, hasta ${p.maxUsers} usuarios, incluye: ${p.features}`).join('\n')}

PREGUNTAS FRECUENTES:
${kb.faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n\n')}

CÓMO MANEJAR OBJECIONES:
${kb.objections.map((o) => `Si dicen "${o.trigger[0]}": ${o.response}`).join('\n')}

PLAYBOOKS POR INDUSTRIA:
${Object.entries(kb.industryPlaybooks)
  .map(([industry, playbook]) => `- ${industry}: dolores=${playbook.painPoints.join(', ')} | pitch=${playbook.valuePitch} | CTA sugerido=${playbook.recommendedCta}`)
  .join('\n')}

PLAYBOOKS POR INTENCIÓN:
${Object.entries(kb.intentPlaybooks)
  .map(([intent, playbook]) => `- ${intent}: objetivo=${playbook.goal} | CTA=${playbook.cta} | guía=${playbook.guidance.join(', ')}`)
  .join('\n')}

PROCESO DE ACTIVACIÓN: ${kb.activationProcess.join(' | ')}
MEDIOS DE PAGO: ${kb.paymentMethods.join(', ')}

DECISIÓN BASE RECOMENDADA:
intent=${baselineDecision.intent}
nextAction=${baselineDecision.nextAction}
recommendedPlan=${baselineDecision.recommendedPlanName ?? 'ninguno'}
industry=${baselineDecision.capturedData.companyIndustry ?? 'desconocida'}
needs=${baselineDecision.capturedData.needs?.join(', ') ?? 'ninguna'}
mensaje_base=${baselineDecision.message}
`;

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
      system: `${SYSTEM_PROMPT}\n\n${knowledgeContext}`,
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
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.message || typeof parsed.message !== 'string') {
        throw new Error('Invalid message field');
      }

      return {
        message: parsed.message,
        intent: parsed.intent ?? baselineDecision.intent,
        nextAction: parsed.nextAction ?? baselineDecision.nextAction,
        capturedData: {
          companyName: parsed.capturedData?.companyName ?? baselineDecision.capturedData.companyName ?? undefined,
          customerName: parsed.capturedData?.customerName ?? baselineDecision.capturedData.customerName ?? undefined,
          companyIndustry:
            parsed.capturedData?.companyIndustry ?? baselineDecision.capturedData.companyIndustry ?? undefined,
          phone: parsed.capturedData?.phone ?? baselineDecision.capturedData.phone ?? undefined,
          email: parsed.capturedData?.email ?? baselineDecision.capturedData.email ?? undefined,
          usersCount: parsed.capturedData?.usersCount ?? baselineDecision.capturedData.usersCount ?? undefined,
          needs: Array.isArray(parsed.capturedData?.needs)
            ? parsed.capturedData.needs
            : baselineDecision.capturedData.needs ?? [],
        },
        recommendedPlanName: parsed.recommendedPlanName ?? baselineDecision.recommendedPlanName ?? undefined,
        shouldCreateQuote:
          parsed.shouldCreateQuote === true || baselineDecision.shouldCreateQuote === true,
        shouldCreatePaymentLink:
          parsed.shouldCreatePaymentLink === true || baselineDecision.shouldCreatePaymentLink === true,
        shouldEscalateToHuman:
          parsed.shouldEscalateToHuman === true || baselineDecision.shouldEscalateToHuman === true,
      };
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
