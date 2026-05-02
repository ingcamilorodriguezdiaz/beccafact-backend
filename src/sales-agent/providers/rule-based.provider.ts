import { ISalesAgentProvider, SalesAgentContext, StructuredAgentDecision } from '../agent.interfaces';
import { SALES_KNOWLEDGE_BASE } from '../knowledge-base';

const KB = SALES_KNOWLEDGE_BASE;

export class RuleBasedSalesAgentProvider implements ISalesAgentProvider {
  private readonly salesAdminPhone = process.env.SALES_ADMIN_PHONE?.trim();
  private readonly salesAdminWhatsapp = process.env.SALES_ADMIN_WHATSAPP?.trim();
  private readonly salesAdminEmail = process.env.SALES_ADMIN_EMAIL?.trim() ?? 'info@beccafact.com';

  async generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision> {
    const { conversation, userMessage, availablePlans } = ctx;
    const lower = userMessage.toLowerCase();
    const msgs = conversation.messages;
    const agentMsgCount = msgs.filter((m) => m.sender === 'AGENT').length;
    const captured = this.extractData(userMessage);
    const companyName = conversation.companyName ?? this.asString(captured.companyName);
    const companyIndustry = this.asString(captured.companyIndustry);
    const historicalNeeds = this.extractNeedsFromMetadata(conversation.metadata);
    const combinedNeeds = this.mergeNeeds(historicalNeeds, this.asStringArray(captured.needs));
    const metadata = this.asMetadata(conversation.metadata);
    const lastIntent = this.asString(metadata.lastIntent);
    const lastNextAction = this.asString(metadata.lastNextAction);
    const hasContactInfo = Boolean(conversation.email || conversation.phone || captured.email || captured.phone);
    const hasBusinessContext = Boolean(
      companyName || companyIndustry || combinedNeeds.length > 0,
    );

    if (hasContactInfo && lastIntent === 'HUMAN_REQUEST') {
      return this.decide({
        message: this.buildHumanHandoffConfirmation(conversation.email ?? this.asString(captured.email), conversation.phone ?? this.asString(captured.phone)),
        intent: 'HUMAN_REQUEST',
        nextAction: 'escalate_to_human',
        shouldEscalateToHuman: true,
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (hasContactInfo && conversation.recommendedPlanName && (lastIntent === 'READY_TO_BUY' || lastNextAction === 'create_quote')) {
      return this.decide({
        message: `Perfecto, ya tengo tus datos. Voy a dejarte lista la cotización del plan ${conversation.recommendedPlanName} con el resumen y el enlace de pago.`,
        intent: 'READY_TO_BUY',
        nextAction: 'create_quote',
        shouldCreateQuote: true,
        shouldCreatePaymentLink: true,
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['asesor', 'humano', 'persona real', 'hablar con alguien', 'quiero hablar'])) {
      return this.decide({
        message: this.buildAdvisorReply(hasContactInfo),
        intent: 'HUMAN_REQUEST',
        nextAction: 'escalate_to_human',
        shouldEscalateToHuman: true,
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (agentMsgCount === 0) {
      return this.decide({
        message: 'Hola, qué bueno tenerte por aquí. Te ayudo a encontrar el plan que mejor te encaje y, si te interesa, te dejo listo el proceso de compra. Cuéntame cómo se llama tu empresa y qué necesitas resolver hoy.',
        intent: 'GENERAL_QUESTION',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['precio', 'costo', 'cuánto vale', 'cuánto cuesta', 'planes', 'qué plan'])) {
      const professionalPlan = availablePlans.find((p) => p.name === 'Profesional') ?? availablePlans[0];
      return this.decide({
        message: `Hoy tenemos opciones desde COP ${this.formatPrice(availablePlans[0]?.price)} al mes. El plan que más eligen las empresas en crecimiento es ${professionalPlan?.name ?? 'Profesional'} porque combina ventas, inventario y control. ¿Cuántas personas usarían el sistema contigo?`,
        intent: 'ASK_PRICE',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['comparar', 'diferencia', 'cuál es mejor', 'qué incluye', 'vs'])) {
      const summary = this.buildPlanComparison(availablePlans);
      return this.decide({
        message: `${summary} Si me dices si manejas inventario, punto de venta o varios usuarios, te digo cuál te conviene sin hacerte perder tiempo.`,
        intent: 'COMPARE_PLANS',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['demo', 'prueba', 'probar', 'demostración', 'ver el sistema'])) {
      return this.decide({
        message: `Sí, podemos mostrártelo. Si me compartes tu correo, te enviamos la demo y, si quieres, también te coordinamos una llamada corta para enseñarte lo más importante.`,
        intent: 'ASK_DEMO',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['pago', 'pagar', 'tarjeta', 'pse', 'transferencia', 'cómo pago'])) {
      return this.decide({
        message: `Puedes pagar por PSE, tarjeta o transferencia, y el cobro es claro y sin amarrarte a contratos largos. Si quieres, te preparo de una vez la cotización con el link de pago para que la revises con calma.`,
        intent: 'ASK_PAYMENT',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['soporte', 'ayuda', 'capacitación', 'implementación', 'quién me ayuda'])) {
      return this.decide({
        message: `No te dejamos solo. Todos los planes incluyen acompañamiento inicial y soporte, y la puesta en marcha suele ser bastante rápida. Si me cuentas tu operación, te digo qué tan bien se adapta a tu negocio.`,
        intent: 'ASK_SUPPORT',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['caro', 'costoso', 'no tengo presupuesto', 'mucho', 'precio alto'])) {
      const objection = KB.objections.find((o) => o.trigger.some((t) => lower.includes(t)));
      return this.decide({
        message: objection?.response ?? 'Te entiendo. La idea no es venderte por venderte, sino que pagues por algo que de verdad te ayude a ordenar ventas, facturación y operación. Si quieres, te ubico la opción más rentable según tu tamaño.',
        intent: 'OBJECTION_PRICE',
        nextAction: 'answer_question',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['lo pienso', 'déjame pensar', 'necesito tiempo', 'voy a consultar', 'después'])) {
      return this.decide({
        message: `Está bien, tómalo con calma. Si quieres, te aclaro la duda más importante ahora mismo y así decides con más seguridad.`,
        intent: 'OBJECTION_NEEDS_TIME',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['sí', 'si', 'quiero', 'me interesa', 'cotización', 'lo tomo', 'dale', 'procede', 'adelante', 'envíame', 'pagar', 'comprar'])) {
      const needsEmail = !conversation.email && !captured.email;
      if (needsEmail) {
        return this.decide({
          message: `Buenísimo. Te preparo la cotización y el link de pago para que lo tengas listo. Compárteme tu correo y te lo envío enseguida.`,
          intent: 'READY_TO_BUY',
          nextAction: 'ask_follow_up',
          capturedData: { ...captured, needs: combinedNeeds },
        });
      }
      return this.decide({
        message: `Perfecto, ya te dejo listo el resumen con tu enlace de pago para que puedas avanzar cuando quieras.`,
        intent: 'READY_TO_BUY',
        nextAction: 'create_quote',
        shouldCreateQuote: true,
        shouldCreatePaymentLink: true,
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    const numUsers = this.extractNumber(lower);
    if (numUsers !== null && !conversation.recommendedPlanName) {
      const plan = this.recommendPlan(numUsers, availablePlans, combinedNeeds);
      const pitch = this.buildPlanPitch(plan);
      return this.decide({
        message: `Para ${numUsers} usuario${numUsers === 1 ? '' : 's'}, te conviene ${pitch}. Si te hace sentido, te dejo lista la cotización para que veas el valor completo.`,
        intent: 'PROVIDING_INFO',
        nextAction: 'recommend_plan',
        capturedData: { ...captured, usersCount: numUsers, needs: combinedNeeds },
        recommendedPlanName: plan.name,
      });
    }

    if (!hasBusinessContext) {
      return this.decide({
        message: `Gracias por escribirnos. Para ayudarte mejor, ¿cuál es el nombre de tu empresa y a qué sector pertenece?`,
        intent: 'GENERAL_QUESTION',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    if (hasBusinessContext && !conversation.recommendedPlanName && numUsers === null) {
      const businessType = companyIndustry
        ? ` para tu ${companyIndustry}`
        : combinedNeeds.length > 0
          ? ` para tu ${combinedNeeds[0]}`
        : '';
      const companyPhrase = companyName ? `, ${companyName},` : '';
      return this.decide({
        message: `Perfecto${companyPhrase} ya te ubiqué mejor. Para recomendarte el plan ideal${businessType}, cuéntame cuántas personas lo usarían y si necesitas POS, inventario o ambas.`,
        intent: 'PROVIDING_INFO',
        nextAction: 'ask_follow_up',
        capturedData: {
          ...captured,
          companyIndustry,
          needs: combinedNeeds,
        },
      });
    }

    if (!conversation.email && !captured.email && agentMsgCount >= 2) {
      return this.decide({
        message: `Si quieres, te dejo esto listo por correo para que no pierdas el hilo. ¿Me compartes tu email y, si te queda fácil, también tu celular?`,
        intent: 'GENERAL_QUESTION',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, needs: combinedNeeds },
      });
    }

    return this.decide({
      message: `Cuéntame un poco más de tu operación. Con saber cuántas personas lo usarían y qué quieres mejorar primero, te digo qué plan te conviene más.`,
      intent: 'GENERAL_QUESTION',
      nextAction: 'ask_follow_up',
      capturedData: { ...captured, needs: combinedNeeds },
    });
  }

  private decide(partial: Partial<StructuredAgentDecision> & { message: string; intent: StructuredAgentDecision['intent']; nextAction: StructuredAgentDecision['nextAction'] }): StructuredAgentDecision {
    return {
      shouldCreateQuote: false,
      shouldCreatePaymentLink: false,
      shouldEscalateToHuman: false,
      capturedData: {},
      ...partial,
    };
  }

  private matches(lower: string, keywords: string[]): boolean {
    return keywords.some((k) => lower.includes(k));
  }

  private extractNumber(text: string): number | null {
    const match = text.match(/\b(\d{1,3})\b/);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    return n >= 1 && n <= 999 ? n : null;
  }

  private extractData(text: string): Record<string, string | number | string[]> {
    const data: Record<string, string | number | string[]> = {};
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) data['email'] = emailMatch[0];
    const phoneMatch = text.match(/\b(3\d{9}|\+57\s?\d{10}|\d{7,10})\b/);
    if (phoneMatch) data['phone'] = phoneMatch[0];
    const numUsers = this.extractNumber(text.toLowerCase());
    if (numUsers) data['usersCount'] = numUsers;
    const companyName = this.extractCompanyName(text);
    if (companyName) data['companyName'] = companyName;
    const businessNeeds = this.extractBusinessNeeds(text);
    if (businessNeeds.length > 0) data['needs'] = businessNeeds;
    if (businessNeeds[0]) data['companyIndustry'] = businessNeeds[0];
    return data;
  }

  private extractCompanyName(text: string): string | undefined {
    const compact = text.replace(/\s+/g, ' ').trim();
    const patterns = [
      /\bmi empresa (?:es|se llama)\s+([a-z0-9][a-z0-9 .&-]{1,60})/i,
      /\bla empresa (?:es|se llama)\s+([a-z0-9][a-z0-9 .&-]{1,60})/i,
      /\b(?:somos|soy) ([a-z0-9][a-z0-9 .&-]{1,60})\b/i,
    ];

    for (const pattern of patterns) {
      const match = compact.match(pattern);
      const value = match?.[1];
      if (!value) {
        continue;
      }
      const cleaned = value
        .replace(/\b(y|que|de|del|para)\b.*$/i, '')
        .replace(/\b(es|somos)\b.*$/i, '')
        .trim();
      if (cleaned.length >= 2) {
        return cleaned;
      }
    }

    return undefined;
  }

  private extractBusinessNeeds(text: string): string[] {
    const lower = text.toLowerCase();
    const tags = [
      { keywords: ['restaurante', 'comida', 'cafetería', 'bar'], label: 'restaurante' },
      { keywords: ['tienda', 'retail', 'almacén', 'negocio físico'], label: 'retail' },
      { keywords: ['inventario', 'stock'], label: 'inventario' },
      { keywords: ['pos', 'punto de venta'], label: 'pos' },
      { keywords: ['facturación', 'factura electrónica'], label: 'facturacion' },
    ];

    return tags
      .filter((tag) => tag.keywords.some((keyword) => lower.includes(keyword)))
      .map((tag) => tag.label);
  }

  private asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) return value.join(', ');
  return undefined;
}
  private asMetadata(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private formatPrice(value: unknown): string {
    const amount = Number(value ?? 0);
    return amount.toLocaleString('es-CO');
  }

  private buildPlanComparison(plans: { name: string; maxUsers: number | null; features: unknown }[]): string {
    const basic = plans.find((plan) => plan.name === 'Básico');
    const professional = plans.find((plan) => plan.name === 'Profesional');
    const enterprise = plans.find((plan) => plan.name === 'Empresarial');
    return `${basic?.name ?? 'Básico'} te sirve para empezar, ${professional?.name ?? 'Profesional'} te da más control comercial y operativo, y ${enterprise?.name ?? 'Empresarial'} es para equipos que necesitan todo integrado y más escala.`;
  }

  private buildPlanPitch(plan: { name: string; price: unknown; features: unknown }): string {
    const topFeatures = Array.isArray(plan.features)
      ? (plan.features as string[]).slice(0, 2).join(' y ')
      : 'las funciones clave que hoy necesitas';
    return `${plan.name} por COP ${this.formatPrice(plan.price)} al mes, porque te cubre ${topFeatures}`;
  }

  private recommendPlan(
    numUsers: number,
    plans: { name: string; price: unknown; features: unknown }[],
    needs: string[] = [],
  ): { name: string; price: unknown; features: unknown } {
    const needsPos = needs.includes('restaurante') || needs.includes('pos') || needs.includes('inventario');
    if (needsPos && numUsers <= 10) {
      return plans.find((p) => p.name === 'Profesional') ?? plans[1] ?? plans[0];
    }
    if (numUsers <= 3) return plans.find((p) => p.name === 'Básico') ?? plans[0];
    if (numUsers <= 10) return plans.find((p) => p.name === 'Profesional') ?? plans[1];
    return plans.find((p) => p.name === 'Empresarial') ?? plans[plans.length - 1];
  }

  private asStringArray(value: string | number | string[] | undefined): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private mergeNeeds(current: string[], incoming: string[]): string[] {
    return Array.from(new Set([...current, ...incoming]));
  }

  private extractNeedsFromMetadata(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    const needs = (value as Record<string, unknown>)['needs'];
    return Array.isArray(needs) ? needs.filter((item): item is string => typeof item === 'string') : [];
  }

  private buildAdvisorReply(hasContactInfo: boolean): string {
    const directContact = this.salesAdminWhatsapp ?? this.salesAdminPhone;
    if (directContact) {
      return `Claro. Puedes hablar con un asesor al ${directContact}. Si quieres, también puedo dejar tus datos registrados para que te contacten sin que tengas que esperar.`;
    }
    if (hasContactInfo) {
      return `Perfecto, ya tengo cómo ubicarte. Le paso tu caso a un asesor para que te contacte lo antes posible.`;
    }
    return `Con gusto te ayudo con eso. Si me compartes tu correo o teléfono, le paso tu caso a un asesor para que te contacte lo antes posible. También puedes escribirnos a ${this.salesAdminEmail}.`;
  }

  private buildHumanHandoffConfirmation(email?: string, phone?: string): string {
    const contactBits = [email, phone].filter(Boolean);
    const contactText = contactBits.length > 0 ? ` Ya dejé registrados tus datos${contactBits.length === 2 ? ` (${email} y ${phone})` : ` (${contactBits[0]})`}.` : '';
    const directContact = this.salesAdminWhatsapp ?? this.salesAdminPhone;
    if (directContact) {
      return `Perfecto.${contactText} Si prefieres hablar de una vez, también puedes comunicarte al ${directContact}.`;
    }
    return `Perfecto.${contactText} Un asesor de BeccaSoft te contactará lo antes posible.`;
  }
}
