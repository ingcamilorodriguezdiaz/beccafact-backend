import { ISalesAgentProvider, SalesAgentContext, StructuredAgentDecision } from '../agent.interfaces';
import { SALES_KNOWLEDGE_BASE } from '../knowledge-base';

const KB = SALES_KNOWLEDGE_BASE;

type IndustryKey = keyof typeof KB.industryPlaybooks;
type IntentStage = keyof typeof KB.intentPlaybooks;
type PlanLike = { name: string; price: unknown; features: unknown };

export class RuleBasedSalesAgentProvider implements ISalesAgentProvider {
  private readonly salesAdminPhone = process.env.SALES_ADMIN_PHONE?.trim();
  private readonly salesAdminWhatsapp = process.env.SALES_ADMIN_WHATSAPP?.trim();
  private readonly salesAdminEmail = process.env.SALES_ADMIN_EMAIL?.trim() ?? 'info@beccafact.com';

  async generate(ctx: SalesAgentContext): Promise<StructuredAgentDecision> {
    const { conversation, userMessage, availablePlans } = ctx;
    const lower = userMessage.toLowerCase();
    const msgs = conversation.messages;
    const agentMsgCount = msgs.filter((m) => m.sender === 'AGENT').length;
    const metadata = this.asMetadata(conversation.metadata);
    const captured = this.extractData(userMessage);
    const historicalNeeds = this.extractNeedsFromMetadata(conversation.metadata);
    const combinedNeeds = this.mergeNeeds(historicalNeeds, this.asStringArray(captured.needs));
    const companyIndustry = this.normalizeIndustry(
      this.asString(metadata.companyIndustry) ?? this.asString(captured.companyIndustry),
      combinedNeeds,
    );
    const playbook = companyIndustry ? KB.industryPlaybooks[companyIndustry] : undefined;
    const lastIntent = this.asString(metadata.lastIntent);
    const lastNextAction = this.asString(metadata.lastNextAction);
    const intentStage = this.detectIntentStage(lower, lastIntent, lastNextAction);
    const hasContactInfo = Boolean(conversation.email || conversation.phone || captured.email || captured.phone);
    const needsEmail = !conversation.email && !captured.email;
    const companyName = conversation.companyName ?? this.asString(captured.companyName);
    const hasBusinessContext = Boolean(companyName || companyIndustry || combinedNeeds.length > 0);
    const storedPlan = conversation.recommendedPlanName
      ? availablePlans.find((plan) => plan.name === conversation.recommendedPlanName)
      : undefined;

    // Solo confirmar handoff cuando el bot ACABA de pedirle al cliente sus datos (lastNextAction === 'escalate_to_human')
    // y el cliente acaba de proveerlos. Si el usuario hace una pregunta nueva, dejarlo fluir normalmente.
    const justProvidedContact = Boolean(captured.email || captured.phone);
    if (lastNextAction === 'escalate_to_human' && justProvidedContact && hasContactInfo && lastIntent === 'HUMAN_REQUEST') {
      return this.decide({
        message: this.buildHumanHandoffConfirmation(
          conversation.email ?? this.asString(captured.email),
          conversation.phone ?? this.asString(captured.phone),
        ),
        intent: 'HUMAN_REQUEST',
        nextAction: 'escalate_to_human',
        shouldEscalateToHuman: true,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (
      hasContactInfo &&
      conversation.recommendedPlanName &&
      (lastIntent === 'READY_TO_BUY' || lastNextAction === 'create_quote')
    ) {
      return this.decide({
        message: `Perfecto, ya tengo tus datos. Voy a dejarte lista la cotización del plan ${conversation.recommendedPlanName} con el resumen y el enlace de pago.`,
        intent: 'READY_TO_BUY',
        nextAction: 'create_quote',
        shouldCreateQuote: true,
        shouldCreatePaymentLink: true,
        recommendedPlanName: conversation.recommendedPlanName,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    const humanRequestKeywords = (KB.escalationRules ?? [])
      .find((rule) => rule.id === 'human_explicit_request')
      ?.customerSignals ?? ['asesor', 'humano', 'persona real', 'hablar con alguien', 'quiero hablar'];

    if (this.matches(lower, humanRequestKeywords)) {
      return this.decide({
        message: this.buildAdvisorReply(hasContactInfo),
        intent: 'HUMAN_REQUEST',
        nextAction: 'escalate_to_human',
        shouldEscalateToHuman: true,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (agentMsgCount === 0) {
      return this.decide({
        message:
          'Hola, bienvenido a BeccaSoft. Soy tu asesor. Cuéntame, ¿en qué tipo de negocio están y qué es lo que más trabajo les está dando hoy?',
        intent: 'GENERAL_QUESTION',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (intentStage === 'payment_ready') {
      if (needsEmail) {
        return this.decide({
          message:
            'Perfecto, ya estás en el punto de activar. Si me compartes tu correo, te dejo lista la cotización con el enlace de pago para que avances sin vueltas.',
          intent: 'ASK_PAYMENT',
          nextAction: 'ask_follow_up',
          recommendedPlanName: storedPlan?.name,
          capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
        });
      }

      return this.decide({
        message: `Perfecto, ya estás a un paso de activar${storedPlan?.name ? ` el plan ${storedPlan.name}` : ''}. Te dejo lista la cotización con el enlace de pago y apenas se confirme, arrancamos activación y acompañamiento.`,
        intent: 'READY_TO_BUY',
        nextAction: 'create_quote',
        shouldCreateQuote: true,
        shouldCreatePaymentLink: true,
        recommendedPlanName: storedPlan?.name,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['precio', 'costo', 'cuánto vale', 'cuánto cuesta', 'planes', 'qué plan', 'que plan'])) {
      const highlightedPlan = this.selectHighlightedPlan(availablePlans);
      return this.decide({
        message: `Hoy tenemos opciones desde COP ${this.formatPrice(availablePlans[0]?.price)} al mes.${highlightedPlan ? ` Una alternativa muy completa para empresas en crecimiento es ${highlightedPlan.name}${this.describePlanCapabilities(highlightedPlan) ? ` porque ${this.describePlanCapabilities(highlightedPlan)}` : ''}.` : ''}${playbook ? ` En negocios como el tuyo, ${playbook.valuePitch}` : ''} ${this.buildStageQuestion(intentStage, playbook)}`,
        intent: 'ASK_PRICE',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['sandbox', 'ambiente de prueba', 'ambiente de pruebas', 'entorno de prueba', 'modo prueba'])) {
      const sandboxPlan = this.findSandboxPlan(availablePlans);
      return this.decide({
        message: this.buildSandboxMessage(sandboxPlan, hasContactInfo),
        intent: 'ASK_DEMO',
        nextAction: hasContactInfo ? 'escalate_to_human' : 'ask_follow_up',
        shouldEscalateToHuman: hasContactInfo,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['características', 'caracteristicas', 'funciones', 'módulos', 'modulos']) || (this.matches(lower, ['qué incluye', 'que incluye']) && Boolean(storedPlan))) {
      const relevantPlan = this.findRelevantPlan(lower, availablePlans, storedPlan);
      return this.decide({
        message: this.buildPlanFeaturesMessage(relevantPlan, availablePlans),
        intent: 'ASK_FEATURES',
        nextAction: relevantPlan ? 'answer_question' : 'ask_follow_up',
        recommendedPlanName: relevantPlan?.name ?? storedPlan?.name,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['comparar', 'diferencia', 'cuál es mejor', 'cual es mejor', 'qué incluye', 'que incluye', 'vs'])) {
      return this.decide({
        message: `${this.buildPlanComparison(availablePlans)} ${playbook ? `En ${companyIndustry}, normalmente lo que más pesa es que ${playbook.valuePitch}` : ''} ${this.buildComparatorQuestion(playbook)}`,
        intent: 'COMPARE_PLANS',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['demo', 'prueba', 'probar', 'demostración', 'demostracion', 'ver el sistema'])) {
      if (hasContactInfo) {
        return this.decide({
          message: `Perfecto. La demo te sirve mucho para ver el flujo real${companyIndustry ? ` de un ${companyIndustry}` : ' de tu operación'}. Te la enfocamos en ${this.describeFocus(playbook, combinedNeeds)} y te coordinamos el siguiente paso con un asesor.`,
          intent: 'ASK_DEMO',
          nextAction: 'escalate_to_human',
          shouldEscalateToHuman: true,
          capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
        });
      }

      return this.decide({
        message: `Sí, podemos mostrártelo. ${playbook ? `En tu caso la demo tendría más valor si la enfocamos en ${this.describeFocus(playbook, combinedNeeds)}.` : ''} Si me compartes tu correo, te la coordinamos y te mostramos primero lo más importante.`,
        intent: 'ASK_DEMO',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['pago', 'pagar', 'tarjeta', 'pse', 'transferencia'])) {
      return this.decide({
        message:
          'Puedes pagar por PSE, tarjeta o transferencia, y el cobro es claro y sin amarrarte a contratos largos. Si quieres, te preparo de una vez la cotización con el link de pago para que la revises con calma.',
        intent: 'ASK_PAYMENT',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['soporte', 'ayuda', 'capacitación', 'capacitacion', 'implementación', 'implementacion', 'quién me ayuda', 'quien me ayuda'])) {
      return this.decide({
        message:
          'No te dejamos solo. Todos los planes incluyen acompañamiento inicial y soporte, y la puesta en marcha suele ser bastante rápida. Si me cuentas tu operación, te digo qué tan bien se adapta a tu negocio.',
        intent: 'ASK_SUPPORT',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['caro', 'costoso', 'no tengo presupuesto', 'mucho', 'precio alto'])) {
      const objection = KB.objections.find((o) => o.trigger.some((t) => lower.includes(t)));
      return this.decide({
        message: `${objection?.response ?? 'Te entiendo. La idea no es venderte por venderte, sino que pagues por algo que de verdad te ayude a ordenar ventas, facturación y operación.'} ${this.buildObjectionFollowUp(playbook)}`,
        intent: 'OBJECTION_PRICE',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['lo pienso', 'déjame pensar', 'dejame pensar', 'necesito tiempo', 'voy a consultar', 'después', 'despues'])) {
      return this.decide({
        message:
          'Está bien, tómalo con calma. Si quieres, te aclaro la duda más importante ahora mismo y así decides con más seguridad.',
        intent: 'OBJECTION_NEEDS_TIME',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (this.matches(lower, ['sí', 'si', 'quiero', 'me interesa', 'cotización', 'cotizacion', 'lo tomo', 'dale', 'procede', 'adelante', 'envíame', 'enviame', 'comprar'])) {
      if (needsEmail) {
        return this.decide({
          message: `Buenísimo. ${storedPlan?.name ? `Con ${storedPlan.name} ya tendrías una base muy bien ajustada para tu operación. ` : ''}Te preparo la cotización y el link de pago para que lo tengas listo. Compárteme tu correo y te lo envío enseguida.`,
          intent: 'READY_TO_BUY',
          nextAction: 'ask_follow_up',
          recommendedPlanName: storedPlan?.name,
          capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
        });
      }

      return this.decide({
        message:
          'Perfecto, ya te dejo listo el resumen con tu enlace de pago para que puedas avanzar cuando quieras.',
        intent: 'READY_TO_BUY',
        nextAction: 'create_quote',
        shouldCreateQuote: true,
        shouldCreatePaymentLink: true,
        recommendedPlanName: storedPlan?.name,
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    const numUsers = this.extractNumber(lower);
    if (numUsers !== null && !conversation.recommendedPlanName) {
      const plan = this.recommendPlan(numUsers, availablePlans, combinedNeeds, companyIndustry);
      return this.decide({
        message: `Para ${numUsers} usuario${numUsers === 1 ? '' : 's'}, te conviene ${this.buildPlanPitch(plan)}${playbook ? `, sobre todo porque ${playbook.valuePitch}` : ''}. ${this.buildRecommendationClose(plan.name, intentStage, playbook)}`,
        intent: 'PROVIDING_INFO',
        nextAction: 'recommend_plan',
        recommendedPlanName: plan.name,
        capturedData: { ...captured, companyIndustry, usersCount: numUsers, needs: combinedNeeds },
      });
    }

    if (!conversation.recommendedPlanName && (combinedNeeds.length > 0 || companyIndustry)) {
      const inferredUsersCount = this.asNumber(captured.usersCount) ?? this.asNumber(metadata.usersCount as unknown);
      const hasUsersData = typeof inferredUsersCount === 'number';
      const hasPlanRecommended = Boolean(conversation.recommendedPlanName);
      const qualificationComplete = hasUsersData && hasPlanRecommended;

      // Solo avanzar a cotización si la cualificación está completa:
      // debe tener usuarios conocidos Y plan ya recomendado Y email disponible Y cliente lo pidió explícitamente.
      if (intentStage === 'quote_ready' && !needsEmail && qualificationComplete) {
        const inferredPlan = this.recommendPlan(
          inferredUsersCount!,
          availablePlans,
          combinedNeeds,
          companyIndustry,
        );
        return this.decide({
          message: `Con lo que me cuentas, ya te puedo orientar una cotización bastante aterrizada. La opción que más te encaja sería ${inferredPlan.name} por el tipo de operación que manejan. Te dejo listo el siguiente paso para enviártela.`,
          intent: 'READY_TO_BUY',
          nextAction: 'create_quote',
          shouldCreateQuote: true,
          recommendedPlanName: inferredPlan.name,
          capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
        });
      }

      // Si hay necesidades pero faltan datos de cualificación, preguntar usuarios.
      if (!hasUsersData) {
        const companyPhrase = companyName ? `¡${companyName}! ` : '';
        const needsPhrase = this.buildNeedsAcknowledgement(combinedNeeds, companyIndustry);
        return this.decide({
          message: `${companyPhrase}${needsPhrase} Para recomendarte el plan ideal, ¿cuántas personas estarían usando el sistema y más o menos cuántas ${this.buildVolumeQuestion(combinedNeeds)} al mes?`,
          intent: 'PROVIDING_INFO',
          nextAction: 'ask_follow_up',
          capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
        });
      }
    }

    if (!hasBusinessContext) {
      return this.decide({
        message:
          'Gracias por escribirnos. Para ayudarte mejor, ¿cuál es el nombre de tu empresa y a qué sector pertenece?',
        intent: 'GENERAL_QUESTION',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (hasBusinessContext && !conversation.recommendedPlanName && numUsers === null) {
      const companyPhrase = companyName ? `, ${companyName},` : '';
      return this.decide({
        message: `Perfecto${companyPhrase} ya te ubiqué mejor. ${playbook ? `En negocios como el tuyo normalmente lo clave es que ${playbook.valuePitch}` : ''} Para recomendarte el plan ideal${companyIndustry ? ` para tu ${companyIndustry}` : ''}, ${this.buildDiscoveryQuestion(playbook, combinedNeeds)}.`,
        intent: 'PROVIDING_INFO',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    if (!conversation.email && !captured.email && agentMsgCount >= 2) {
      return this.decide({
        message:
          'Si quieres, te dejo esto listo por correo para que no pierdas el hilo. ¿Me compartes tu email y, si te queda fácil, también tu celular?',
        intent: 'GENERAL_QUESTION',
        nextAction: 'ask_follow_up',
        capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
      });
    }

    return this.decide({
      message: `Cuéntame un poco más de tu operación. ${playbook ? `En ${companyIndustry} suele ser clave resolver ${playbook.painPoints.slice(0, 2).join(' y ')}.` : ''} Con saber cuántas personas lo usarían y qué quieres mejorar primero, te digo qué plan te conviene más.`,
      intent: 'GENERAL_QUESTION',
      nextAction: 'ask_follow_up',
      capturedData: { ...captured, companyIndustry, needs: combinedNeeds },
    });
  }

  private decide(
    partial: Partial<StructuredAgentDecision> & {
      message: string;
      intent: StructuredAgentDecision['intent'];
      nextAction: StructuredAgentDecision['nextAction'];
    },
  ): StructuredAgentDecision {
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
    if (emailMatch) data.email = emailMatch[0];
    const phoneMatch = text.match(/\b(3\d{9}|\+57\s?\d{10}|\d{7,10})\b/);
    if (phoneMatch) data.phone = phoneMatch[0];
    const numUsers = this.extractNumber(text.toLowerCase());
    if (numUsers) data.usersCount = numUsers;
    const companyName = this.extractCompanyName(text);
    if (companyName) data.companyName = companyName;
    const needs = this.extractBusinessNeeds(text);
    if (needs.length > 0) data.needs = needs;
    const industry = this.inferIndustryFromText(text.toLowerCase());
    if (industry) data.companyIndustry = industry;
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
      if (!value) continue;
      const cleaned = value
        .replace(/\b(y|que|de|del|para)\b.*$/i, '')
        .replace(/\b(es|somos)\b.*$/i, '')
        .trim();
      if (cleaned.length >= 2) return cleaned;
    }

    return undefined;
  }

  private extractBusinessNeeds(text: string): string[] {
    const lower = text.toLowerCase();
    const tags = [
      { keywords: ['inventario', 'stock', 'bodega'], label: 'inventario' },
      { keywords: ['pos', 'punto de venta', 'caja'], label: 'pos' },
      { keywords: ['facturación', 'factura electrónica', 'dian', 'facturacion'], label: 'facturacion' },
      { keywords: ['cartera', 'cobranza', 'cuentas por cobrar'], label: 'cartera' },
      { keywords: ['cotización', 'cotizaciones', 'cotizacion', 'propuesta'], label: 'cotizaciones' },
      { keywords: ['compras', 'proveedores', 'orden de compra'], label: 'compras' },
      { keywords: ['nómina', 'nomina', 'empleados', 'prestaciones'], label: 'nomina' },
      { keywords: ['contabilidad', 'contador', 'balance'], label: 'contabilidad' },
      { keywords: ['reportes', 'indicadores', 'dashboard'], label: 'reportes' },
    ];

    return tags
      .filter((tag) => tag.keywords.some((keyword) => lower.includes(keyword)))
      .map((tag) => tag.label);
  }

  private inferIndustryFromText(lower: string): string | undefined {
    const tags = [
      { keywords: ['restaurante', 'comida', 'cafetería', 'cafeteria', 'bar', 'domicilios'], label: 'restaurante' },
      { keywords: ['tienda', 'retail', 'almacén', 'almacen', 'negocio físico', 'negocio fisico', 'boutique'], label: 'retail' },
      { keywords: ['servicios', 'agencia', 'consultoría', 'consultoria', 'abogados', 'salud'], label: 'servicios' },
      { keywords: ['ferretería', 'ferreteria'], label: 'ferreteria' },
      { keywords: ['droguería', 'drogueria', 'farmacia'], label: 'drogueria' },
      { keywords: ['distribuidora', 'mayorista', 'distribución', 'distribucion'], label: 'distribuidora' },
      { keywords: ['manufactura', 'fábrica', 'fabrica', 'producción', 'produccion'], label: 'manufactura' },
    ];

    return tags.find((tag) => tag.keywords.some((keyword) => lower.includes(keyword)))?.label;
  }

  private normalizeIndustry(industry: string | undefined, needs: string[]): IndustryKey | undefined {
    const raw = (industry ?? '').toLowerCase().trim();
    if (raw === 'restaurante') return 'restaurante';
    if (raw === 'retail') return 'retail';
    if (raw === 'servicios') return 'servicios';
    if (raw === 'ferreteria') return 'ferreteria';
    if (raw === 'drogueria') return 'drogueria';
    if (raw === 'distribuidora') return 'distribuidora';
    if (raw === 'manufactura') return 'manufactura';
    if (needs.includes('pos') && needs.includes('inventario')) return 'retail';
    return undefined;
  }

  private detectIntentStage(lower: string, lastIntent?: string, lastNextAction?: string): IntentStage {
    if (this.matches(lower, ['cómo pago', 'como pago', 'pagar', 'pse', 'tarjeta', 'transferencia', 'activar'])) {
      return 'payment_ready';
    }
    if (this.matches(lower, ['cotización', 'cotizacion', 'propuesta', 'envíame', 'enviame'])) {
      return 'quote_ready';
    }
    if (this.matches(lower, ['demo', 'prueba', 'probar', 'demostración', 'demostracion', 'ver el sistema'])) {
      return 'demo_ready';
    }
    if (this.matches(lower, ['comparar', 'diferencia', 'vs', 'qué incluye', 'que incluye'])) {
      return 'comparing';
    }
    if (lastNextAction === 'create_quote') return 'quote_ready';
    if (lastIntent === 'COMPARE_PLANS') return 'comparing';
    return 'curious';
  }

  private asString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (Array.isArray(value)) return value.join(', ');
    return undefined;
  }

  private asNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
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

  private buildPlanComparison(plans: { name: string; price: unknown; maxUsers: number | null }[]): string {
    const sortedPlans = [...plans].sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
    if (sortedPlans.length === 0) {
      return 'Tenemos varias opciones según el tamaño de tu operación y los módulos que necesites.';
    }
    if (sortedPlans.length === 1) {
      return `${sortedPlans[0].name} es la opción activa que hoy tenemos disponible para esta línea comercial.`;
    }

    const first = sortedPlans[0];
    const middle = sortedPlans[Math.min(1, sortedPlans.length - 1)];
    const last = sortedPlans[sortedPlans.length - 1];

    return `${first.name} te sirve para empezar, ${middle.name} te da más control comercial y operativo, y ${last.name} es para equipos que necesitan más cobertura, escala o módulos avanzados.`;
  }

  private buildPlanPitch(plan: PlanLike): string {
    const topFeatures = this.extractPlanFeatureTexts(plan).slice(0, 2).join(' y ');
    return `${plan.name} por COP ${this.formatPrice(plan.price)} al mes, porque te cubre ${topFeatures}`;
  }

  private recommendPlan(
    numUsers: number,
    plans: PlanLike[],
    needs: string[] = [],
    industry?: IndustryKey,
  ): PlanLike {
    const sortedPlans = [...plans].sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
    const needsEnterprise = needs.includes('nomina') || needs.includes('contabilidad') || needs.includes('compras');
    const requiredNeeds = Array.from(new Set(needs));

    const plansMatchingNeeds = requiredNeeds.length
      ? sortedPlans.filter((plan) => requiredNeeds.every((need) => this.planSupportsNeed(plan, need)))
      : sortedPlans;

    const candidatePlans = plansMatchingNeeds.length > 0 ? plansMatchingNeeds : sortedPlans;

    if (needsEnterprise) {
      return candidatePlans[candidatePlans.length - 1] ?? sortedPlans[sortedPlans.length - 1];
    }

    if ((industry === 'distribuidora' || industry === 'manufactura') && numUsers > 3) {
      return this.pickPlanByUsers(candidatePlans, Math.max(numUsers, 4));
    }

    return this.pickPlanByUsers(candidatePlans, numUsers);
  }

  private pickPlanByUsers(plans: PlanLike[], numUsers: number): PlanLike {
    const sortedPlans = [...plans].sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
    const matched = sortedPlans.find((plan) => {
      const maxUsers = this.getMaxUsers(plan);
      return maxUsers === null || maxUsers >= numUsers;
    });
    return matched ?? sortedPlans[sortedPlans.length - 1] ?? plans[0];
  }

  private getMaxUsers(plan: PlanLike): number | null {
    if (typeof (plan as { maxUsers?: unknown }).maxUsers === 'number') {
      return (plan as { maxUsers?: number | null }).maxUsers ?? null;
    }
    return null;
  }

  private selectHighlightedPlan(plans: PlanLike[]): PlanLike | undefined {
    if (plans.length === 0) return undefined;
    const sortedPlans = [...plans].sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
    return sortedPlans[Math.min(1, sortedPlans.length - 1)] ?? sortedPlans[0];
  }

  private findRelevantPlan(lower: string, plans: PlanLike[], storedPlan?: PlanLike): PlanLike | undefined {
    const normalizedMessage = this.normalizePlanName(lower);
    const explicitMatch = plans.find((plan) => {
      const normalizedPlanName = this.normalizePlanName(String(plan.name ?? ''));
      return normalizedPlanName.length > 0 && normalizedMessage.includes(normalizedPlanName);
    });

    if (explicitMatch) {
      return explicitMatch;
    }

    return storedPlan ?? this.selectHighlightedPlan(plans);
  }

  private findSandboxPlan(plans: PlanLike[]): PlanLike | undefined {
    return plans.find((plan) => this.normalizePlanName(String(plan.name ?? '')) === 'sandbox');
  }

  private planSupportsNeed(plan: PlanLike, need: string): boolean {
    const haystack = this.extractPlanFeatureTexts(plan).join(' ').toLowerCase();
    const keywords: Record<string, string[]> = {
      inventario: ['inventario', 'stock', 'bodega'],
      pos: ['pos', 'punto de venta', 'caja'],
      facturacion: ['facturación', 'facturacion', 'dian', 'factura'],
      cartera: ['cartera', 'cobranza', 'cuentas por cobrar'],
      cotizaciones: ['cotización', 'cotizacion', 'propuesta', 'pedido'],
      compras: ['compra', 'compras', 'proveedor', 'proveedores'],
      nomina: ['nómina', 'nomina', 'empleados', 'prestaciones'],
      contabilidad: ['contabilidad', 'contable', 'balance', 'puc'],
      reportes: ['reporte', 'reportes', 'indicadores', 'dashboard'],
    };

    return (keywords[need] ?? [need]).some((keyword) => haystack.includes(keyword));
  }

  private describePlanCapabilities(plan: PlanLike): string {
    const features = this.extractPlanFeatureTexts(plan).slice(0, 3);
    if (features.length === 0) {
      return '';
    }
    if (features.length === 1) {
      return `incluye ${features[0]}`;
    }
    return `incluye ${features.slice(0, -1).join(', ')} y ${features[features.length - 1]}`;
  }

  private extractPlanFeatureTexts(plan: PlanLike): string[] {
    if (!Array.isArray(plan.features)) {
      return ['las funciones clave que hoy necesitas'];
    }

    const values = plan.features
      .map((feature) => this.stringifyFeature(feature))
      .filter((value): value is string => Boolean(value));

    return values.length > 0 ? values : ['las funciones clave que hoy necesitas'];
  }

  private buildPlanFeaturesMessage(plan: PlanLike | undefined, plans: PlanLike[]): string {
    const fallbackPlan = plan ?? this.selectHighlightedPlan(plans);
    if (!fallbackPlan) {
      return 'Tenemos varias opciones con facturación, inventario, POS, cartera y soporte, según el tamaño de tu operación. Si me dices cuántos usuarios tendrían y qué proceso quieres cubrir primero, te digo cuál te conviene.';
    }

    const features = this.extractPlanFeatureTexts(fallbackPlan)
      .filter((feature) => !/^soporte/i.test(feature))
      .slice(0, 4);
    const maxUsers = this.describePlanUserCapacity(fallbackPlan);
    const supportLevel = this.describePlanSupport(fallbackPlan);
    const featureText =
      features.length > 0
        ? this.joinNaturalList(features)
        : 'las funciones clave para operar mejor';

    return `${fallbackPlan.name} te ofrece ${featureText}${maxUsers ? `, pensado para ${maxUsers}` : ''}. ${supportLevel} Si quieres, te digo también con cuál otro plan lo compararía para tu negocio.`;
  }

  private buildSandboxMessage(plan: PlanLike | undefined, hasContactInfo: boolean): string {
    const features = plan ? this.extractPlanFeatureTexts(plan).slice(0, 4) : [];
    const featuresText =
      features.length > 0
        ? `Te permite validar ${this.joinNaturalList(features)}, sin efectos reales ante la DIAN.`
        : 'Sí, manejamos ambiente de pruebas para validar el flujo antes de salir a producción.';

    if (hasContactInfo) {
      return `${featuresText} Como ya tengo cómo ubicarte, te coordinamos el acceso o una demo guiada para que lo revises con tu operación real.`;
    }

    return `${featuresText} Si quieres, te coordinamos una demo o el acceso de prueba y te muestro qué alcance tiene según tu caso.`;
  }

  private stringifyFeature(feature: unknown): string | null {
    if (typeof feature === 'string') {
      return feature.trim() || null;
    }

    if (feature && typeof feature === 'object') {
      const record = feature as Record<string, unknown>;
      const label = typeof record.label === 'string' ? record.label.trim() : '';
      const value = typeof record.value === 'string' ? record.value.trim() : '';

      if (value.toLowerCase() === 'false' || value === '0') {
        return null;
      }

      if (label) {
        return label;
      }

      if (value && value.toLowerCase() !== 'true') {
        return value;
      }
    }

    return null;
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
    const needs = (value as Record<string, unknown>).needs;
    return Array.isArray(needs) ? needs.filter((item): item is string => typeof item === 'string') : [];
  }

  private buildAdvisorReply(hasContactInfo: boolean): string {
    const directContact = this.salesAdminWhatsapp ?? this.salesAdminPhone;
    if (directContact) {
      return `Claro. Puedes hablar con un asesor al ${directContact}. Si quieres, también puedo dejar tus datos registrados para que te contacten sin que tengas que esperar.`;
    }
    if (hasContactInfo) {
      return 'Perfecto, ya tengo cómo ubicarte. Le paso tu caso a un asesor para que te contacte lo antes posible.';
    }
    return `Con gusto te ayudo con eso. Si me compartes tu correo o teléfono, le paso tu caso a un asesor para que te contacte lo antes posible. También puedes escribirnos a ${this.salesAdminEmail}.`;
  }

  private buildHumanHandoffConfirmation(email?: string, phone?: string): string {
    const contactBits = [email, phone].filter(Boolean);
    const contactText =
      contactBits.length > 0
        ? ` Ya dejé registrados tus datos${contactBits.length === 2 ? ` (${email} y ${phone})` : ` (${contactBits[0]})`}.`
        : '';
    const directContact = this.salesAdminWhatsapp ?? this.salesAdminPhone;
    if (directContact) {
      return `Perfecto.${contactText} Si prefieres hablar de una vez, también puedes comunicarte al ${directContact}.`;
    }
    return `Perfecto.${contactText} Un asesor de BeccaSoft te contactará lo antes posible.`;
  }

  private buildStageQuestion(
    intentStage: IntentStage,
    playbook?: (typeof KB.industryPlaybooks)[IndustryKey],
  ): string {
    if (intentStage === 'comparing') {
      return '¿Qué pesa más para ti hoy: precio, inventario, punto de venta o soporte?';
    }
    if (playbook?.qualifyingQuestions[0]) {
      return playbook.qualifyingQuestions[0];
    }
    return '¿Cuántas personas usarían el sistema contigo?';
  }

  private buildComparatorQuestion(playbook?: (typeof KB.industryPlaybooks)[IndustryKey]): string {
    if (playbook?.qualifyingQuestions[1]) {
      return playbook.qualifyingQuestions[1];
    }
    return 'Si me dices si manejas inventario, punto de venta o varios usuarios, te digo cuál te conviene sin hacerte perder tiempo.';
  }

  private buildObjectionFollowUp(playbook?: (typeof KB.industryPlaybooks)[IndustryKey]): string {
    if (playbook?.recommendedCta === 'demo') {
      return 'Si quieres, te muestro rápido cómo se aterriza eso a tu operación y así ves si realmente te compensa.';
    }
    return 'Si quieres, te ubico la opción más rentable según tu tamaño y lo que realmente necesitas.';
  }

  private buildRecommendationClose(
    planName: string,
    intentStage: IntentStage,
    playbook?: (typeof KB.industryPlaybooks)[IndustryKey],
  ): string {
    if (intentStage === 'demo_ready' || playbook?.recommendedCta === 'demo') {
      return `Si te hace sentido, el siguiente paso ideal es mostrarte una demo enfocada en lo que más te importa antes de cotizar ${planName}.`;
    }
    return `Si te hace sentido, te dejo lista la cotización para que veas el valor completo de ${planName}.`;
  }

  private buildDiscoveryQuestion(
    playbook?: (typeof KB.industryPlaybooks)[IndustryKey],
    needs: string[] = [],
  ): string {
    if (playbook?.qualifyingQuestions[0]) {
      return playbook.qualifyingQuestions[0];
    }
    if (needs.includes('pos') || needs.includes('inventario')) {
      return 'cuéntame cuántas personas lo usarían y si necesitas POS, inventario o ambas';
    }
    return 'cuéntame cuántas personas lo usarían y qué proceso quieres ordenar primero';
  }

  private describeFocus(
    playbook?: (typeof KB.industryPlaybooks)[IndustryKey],
    needs: string[] = [],
  ): string {
    if (needs.length > 0) {
      return needs.slice(0, 2).join(' y ');
    }
    if (playbook?.suggestedNeeds.length) {
      return playbook.suggestedNeeds.slice(0, 2).join(' y ');
    }
    return 'tu proceso comercial principal';
  }

  private describePlanUserCapacity(plan: PlanLike): string | null {
    const directMaxUsers = this.getMaxUsers(plan);
    if (typeof directMaxUsers === 'number' && directMaxUsers > 0) {
      return `${directMaxUsers} usuario${directMaxUsers === 1 ? '' : 's'}`;
    }

    const feature = this.extractPlanFeatureTexts(plan).find((item) => /usuario/i.test(item));
    return feature ? feature.toLowerCase() : null;
  }

  private describePlanSupport(plan: PlanLike): string {
    const features = this.extractPlanFeatureTexts(plan);
    const supportFeature = features.find((item) => /soporte/i.test(item));
    if (supportFeature) {
      return `${supportFeature}.`;
    }

    const normalizedName = this.normalizePlanName(String(plan.name ?? ''));
    if (normalizedName.includes('emprendedor')) {
      return `${KB.support.basic}.`;
    }
    if (normalizedName.includes('pyme') || normalizedName.includes('profesional')) {
      return `${KB.support.professional}.`;
    }
    if (normalizedName.includes('empresarial') || normalizedName.includes('enterprise')) {
      return `${KB.support.enterprise}.`;
    }

    return 'Incluye acompanamiento inicial y soporte para arrancar bien.';
  }

  private normalizePlanName(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private joinNaturalList(values: string[]): string {
    if (values.length === 0) return '';
    if (values.length === 1) return values[0];
    if (values.length === 2) return `${values[0]} y ${values[1]}`;
    return `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;
  }

  private buildNeedsAcknowledgement(needs: string[], industry?: IndustryKey | string): string {
    const needLabels: Record<string, string> = {
      facturacion: 'facturación electrónica DIAN',
      inventario: 'control de inventario',
      pos: 'punto de venta',
      cartera: 'gestión de cartera',
      cotizaciones: 'cotizaciones comerciales',
      compras: 'compras y proveedores',
      nomina: 'nómina electrónica',
      contabilidad: 'contabilidad',
      reportes: 'reportes e indicadores',
    };

    const industryContext: Partial<Record<IndustryKey, string>> = {
      restaurante: 'En el sector de alimentos',
      retail: 'En comercio al por menor',
      servicios: 'En empresas de servicios',
      ferreteria: 'En ferreterías',
      drogueria: 'En droguerías y farmacias',
      distribuidora: 'En distribuidoras',
      manufactura: 'En manufactura',
    };

    const needsText = needs.length > 0
      ? `${needLabels[needs[0]] ?? needs[0]} es justo lo que más usan nuestros clientes`
      : 'eso es exactamente lo que resuelve BeccaFact';

    const industryPhrase = industry && industryContext[industry as IndustryKey]
      ? `${industryContext[industry as IndustryKey]}, la ${needsText}.`
      : `La ${needsText}.`;

    return industryPhrase;
  }

  private buildVolumeQuestion(needs: string[]): string {
    if (needs.includes('facturacion')) return 'facturas generan';
    if (needs.includes('pos')) return 'ventas procesan';
    if (needs.includes('nomina')) return 'empleados liquidan';
    if (needs.includes('inventario')) return 'movimientos de stock tienen';
    return 'operaciones procesan';
  }
}
