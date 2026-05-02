import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ISalesAgentProvider, SalesAgentContext, StructuredAgentDecision } from '../agent.interfaces';
import { SALES_KNOWLEDGE_BASE } from '../knowledge-base';

const SYSTEM_PROMPT = `Eres un asesor comercial experto de BeccaSoft. Ayudas a empresas colombianas a encontrar el plan de software ERP correcto.

Tu objetivo es conversar de forma natural, entender las necesidades del cliente y guiarlo hacia una compra. No suenas como bot ni como formulario.

REGLAS DE CONVERSACIÓN:
- Responde de forma breve: máximo 3–4 oraciones.
- Haz máximo 1 o 2 preguntas por mensaje. Nunca más.
- No repitas preguntas que el cliente ya respondió.
- Conecta las necesidades del cliente con beneficios concretos del plan.
- Si el cliente menciona precio, explica el valor que recibe.
- Si el cliente duda, resuelve la objeción de forma natural y sin presión.
- No uses listas ni bullet points en tu respuesta. Escribe en párrafo natural.
- Usa un tono cercano, profesional y colombiano.
- No inventes precios, módulos ni condiciones que no estén en la base de conocimiento.

FORMATO DE RESPUESTA:
Debes responder ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "message": "respuesta para mostrar al cliente",
  "intent": "INTENT_CODE",
  "nextAction": "action_code",
  "capturedData": {
    "companyName": "nombre si lo mencionó, sino null",
    "customerName": "nombre si lo mencionó, sino null",
    "phone": "teléfono si lo mencionó, sino null",
    "email": "email si lo mencionó, sino null",
    "usersCount": número_si_lo_mencionó_sino_null,
    "needs": ["array de módulos mencionados, sino vacío"]
  },
  "recommendedPlanName": "Básico|Profesional|Empresarial|null",
  "shouldCreateQuote": false,
  "shouldCreatePaymentLink": false,
  "shouldEscalateToHuman": false
}

Valores válidos para intent: ASK_PRICE, ASK_FEATURES, ASK_DEMO, ASK_PAYMENT, ASK_SUPPORT, COMPARE_PLANS, READY_TO_BUY, OBJECTION_PRICE, OBJECTION_NEEDS_TIME, HUMAN_REQUEST, GENERAL_QUESTION, PROVIDING_INFO

Valores válidos para nextAction: answer_question, ask_follow_up, recommend_plan, create_quote, create_payment_link, escalate_to_human

Pon shouldCreateQuote en true SOLO si el cliente indica claramente que quiere la cotización o quiere comprar (ejemplos: "sí", "me interesa", "envíame la cotización", "quiero pagar", "lo tomo", "dale", "procede").
Pon shouldEscalateToHuman en true SOLO si el cliente pide explícitamente hablar con una persona real.

NO respondas con nada más que el JSON. Sin texto adicional, sin markdown, sin explicaciones.`;

export class ClaudeSalesAgentProvider implements ISalesAgentProvider {
  private readonly logger = new Logger(ClaudeSalesAgentProvider.name);
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision> {
    const { conversation, userMessage, availablePlans } = ctx;

    const plansContext = availablePlans.map((p) => ({
      name: p.name,
      price: `COP ${Number(p.price).toLocaleString('es-CO')} / ${p.billingPeriod === 'MONTHLY' ? 'mes' : 'año'}`,
      maxUsers: p.maxUsers ?? 'ilimitados',
      features: p.features,
    }));

    const kb = SALES_KNOWLEDGE_BASE;

    const knowledgeContext = `
BASE DE CONOCIMIENTO:
Empresa: ${kb.businessName} - ${kb.description}

PLANES DISPONIBLES (usa estos precios, no inventes otros):
${plansContext.map((p) => `- ${p.name}: ${p.price}, hasta ${p.maxUsers} usuarios, incluye: ${Array.isArray(p.features) ? p.features.join(', ') : p.features}`).join('\n')}

PREGUNTAS FRECUENTES:
${kb.faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join('\n\n')}

CÓMO MANEJAR OBJECIONES:
${kb.objections.map((o) => `Si dicen "${o.trigger[0]}": ${o.response}`).join('\n')}

PROCESO DE ACTIVACIÓN: ${kb.activationProcess.join(' | ')}
MEDIOS DE PAGO: ${kb.paymentMethods.join(', ')}
`;

    const historyMessages = conversation.messages.slice(-10).map((m) => ({
      role: (m.sender === 'VISITOR' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    const contextForClaude = conversation.companyName || conversation.email || conversation.visitorName
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

    const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    return this.parseResponse(rawText, userMessage);
  }

  private parseResponse(raw: string, userMessage: string): StructuredAgentDecision {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.message || typeof parsed.message !== 'string') {
        throw new Error('Invalid message field');
      }

      return {
        message: parsed.message,
        intent: parsed.intent ?? 'GENERAL_QUESTION',
        nextAction: parsed.nextAction ?? 'answer_question',
        capturedData: {
          companyName: parsed.capturedData?.companyName ?? undefined,
          customerName: parsed.capturedData?.customerName ?? undefined,
          phone: parsed.capturedData?.phone ?? undefined,
          email: parsed.capturedData?.email ?? undefined,
          usersCount: parsed.capturedData?.usersCount ?? undefined,
          needs: Array.isArray(parsed.capturedData?.needs) ? parsed.capturedData.needs : [],
        },
        recommendedPlanName: parsed.recommendedPlanName ?? undefined,
        shouldCreateQuote: parsed.shouldCreateQuote === true,
        shouldCreatePaymentLink: parsed.shouldCreatePaymentLink === true,
        shouldEscalateToHuman: parsed.shouldEscalateToHuman === true,
      };
    } catch (err) {
      this.logger.warn(`Failed to parse Claude response: ${(err as Error).message}. Raw: ${raw.substring(0, 200)}`);
      return this.fallbackDecision(userMessage, raw);
    }
  }

  private fallbackDecision(userMessage: string, rawMessage: string): StructuredAgentDecision {
    const lower = userMessage.toLowerCase();
    const wantsHuman = ['asesor', 'humano', 'persona', 'hablar con'].some((k) => lower.includes(k));
    const wantsBuy = ['sí', 'si', 'quiero', 'cotización', 'pagar', 'lo tomo', 'dale'].some((k) => lower.includes(k));

    return {
      message: rawMessage || 'Entendido, permíteme un momento para darte la mejor respuesta.',
      intent: 'GENERAL_QUESTION',
      nextAction: wantsHuman ? 'escalate_to_human' : wantsBuy ? 'create_quote' : 'answer_question',
      capturedData: {},
      shouldCreateQuote: wantsBuy,
      shouldCreatePaymentLink: false,
      shouldEscalateToHuman: wantsHuman,
    };
  }
}
