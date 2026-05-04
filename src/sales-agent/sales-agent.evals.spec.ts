import { SalesBillingPeriod, SalesConversationSource, SalesConversationStatus, SalesMessageSender } from '@prisma/client';
import { SalesAgentService } from './sales-agent.service';
import { AgentResponse, SalesAgentContext } from './agent.interfaces';

declare const describe: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toContain: (expected: string) => void;
};

function buildService(): SalesAgentService {
  const config = {
    get: (key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        CLAUDE_API_KEY: '',
        OLLAMA_ENABLED: 'false',
      };
      return key in values ? values[key] : defaultValue;
    },
  };

  return new SalesAgentService(config as never);
}

function buildContext(userMessage: string, overrides?: Partial<SalesAgentContext>): SalesAgentContext {
  const now = new Date();

  return {
    conversation: {
      id: 'conv-1',
      companyId: null,
      customerId: null,
      quoteId: null,
      visitorName: null,
      companyName: null,
      phone: null,
      email: null,
      source: SalesConversationSource.WEB_CHAT,
      status: SalesConversationStatus.NEW,
      interestedPlanName: null,
      recommendedPlanName: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          sender: SalesMessageSender.AGENT,
          content: 'Hola, cuéntame sobre tu empresa.',
          metadata: {},
          createdAt: now,
        },
      ],
    },
    userMessage,
    availablePlans: [
      {
        id: 'plan-1',
        name: 'EMPRENDEDOR',
        description: 'Plan inicial',
        price: 65000 as never,
        billingPeriod: SalesBillingPeriod.MONTHLY,
        maxUsers: 1,
        features: [
          { label: 'Facturación electrónica DIAN', value: 'true' },
          { label: '15 productos', value: '15' },
          { label: '1 usuario', value: '1' },
        ] as never,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'plan-2',
        name: 'PYME',
        description: 'Plan pyme',
        price: 160000 as never,
        billingPeriod: SalesBillingPeriod.MONTHLY,
        maxUsers: 5,
        features: [
          { label: 'Facturación electrónica DIAN', value: 'true' },
          { label: 'Nómina electrónica DIAN ilimitada', value: 'true' },
          { label: 'Importación masiva CSV/Excel', value: 'true' },
          { label: '5 usuarios', value: '5' },
        ] as never,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'plan-3',
        name: 'EMPRESARIAL',
        description: 'Plan completo',
        price: 300000 as never,
        billingPeriod: SalesBillingPeriod.MONTHLY,
        maxUsers: null,
        features: [
          { label: 'Inventario avanzado', value: 'true' },
          { label: 'Punto de Venta (POS)', value: 'true' },
          { label: 'Cartera y cobranza', value: 'true' },
          { label: 'Usuarios ilimitados', value: '-1' },
        ] as never,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'plan-4',
        name: 'SANDBOX',
        description: 'Ambiente de pruebas',
        price: 0 as never,
        billingPeriod: SalesBillingPeriod.MONTHLY,
        maxUsers: 10,
        features: [
          { label: 'Facturación electrónica (modo prueba)', value: 'true' },
          { label: 'Nómina electrónica (modo prueba)', value: 'true' },
          { label: 'Inventario avanzado', value: 'true' },
          { label: 'Ambiente sandbox - sin efectos reales', value: 'true' },
        ] as never,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}

describe('SalesAgent evals', () => {
  let service: SalesAgentService;

  beforeEach(() => {
    service = buildService();
  });

  it('responde precios y sigue calificando en una consulta general', async () => {
    const response = await service.generateResponse(
      buildContext('Mi empresa se llama Mercado Zapatoca, que planes tienen o ofrecen?'),
    );

    expectResponse(response, {
      stage: 'QUALIFICATION',
      action: 'ask_follow_up',
      includes: ['COP', 'usuario'],
    });
  });

  it('responde caracteristicas reales del plan consultado', async () => {
    const response = await service.generateResponse(
      buildContext('Que caracteristicas tiene el plan pyme?'),
    );

    expectResponse(response, {
      stage: 'RECOMMENDATION',
      action: 'answer_question',
      includes: ['PYME', 'Facturación electrónica DIAN', '5 usuarios'],
    });
  });

  it('maneja sandbox como flujo factual de demo o prueba', async () => {
    const response = await service.generateResponse(
      buildContext('Tienen sandbox o ambiente de pruebas para validar antes de comprar?'),
    );

    expectResponse(response, {
      stage: 'DEMO',
      action: 'ask_follow_up',
      includes: ['sin efectos reales ante la DIAN', 'demo'],
    });
  });

  it('escala a humano cuando el prospecto deja contacto para demo', async () => {
    const response = await service.generateResponse(
      buildContext('Quiero una demo para mi restaurante, mi celular es 3001234567.'),
    );

    expectResponse(response, {
      stage: 'HANDOFF_HUMAN',
      action: 'escalate_to_human',
      includes: ['asesor'],
    });
  });

  it('pide correo antes de cotizar cuando hay intencion de compra', async () => {
    const response = await service.generateResponse(
      buildContext('Dale, me gusta ese plan, procedamos.'),
    );

    expectResponse(response, {
      stage: 'QUOTATION',
      action: 'ask_follow_up',
      includes: ['correo'],
    });
  });

  it('genera cotizacion cuando hay compra con email y usuarios', async () => {
    const response = await service.generateResponse(
      buildContext('Somos Mercado Zapatoca, 4 usuarios, enviame la cotizacion a compras@mercadozapatoca.co', {
        conversation: {
          ...buildContext('base').conversation,
          recommendedPlanName: 'PYME',
          messages: [
            ...buildContext('base').conversation.messages,
            {
              id: 'msg-2',
              conversationId: 'conv-1',
              sender: SalesMessageSender.VISITOR,
              content: 'Mi empresa se llama Mercado Zapatoca y somos 4 usuarios.',
              metadata: {},
              createdAt: new Date(),
            },
            {
              id: 'msg-3',
              conversationId: 'conv-1',
              sender: SalesMessageSender.AGENT,
              content: 'Por lo que me cuentas, el plan PYME te puede encajar muy bien.',
              metadata: {},
              createdAt: new Date(),
            },
            {
              id: 'msg-4',
              conversationId: 'conv-1',
              sender: SalesMessageSender.AGENT,
              content: 'Si te hace sentido, te dejo lista la cotizacion cuando me confirmes el correo.',
              metadata: {},
              createdAt: new Date(),
            },
          ],
        },
      }),
    );

    expectResponse(response, {
      stage: 'PAYMENT',
      action: 'create_quote',
      includes: ['enlace de pago'],
    });
  });
});

function expectResponse(
  response: AgentResponse,
  expected: { stage: string; action: string; includes: string[] },
) {
  expect(response.salesStage).toBe(expected.stage);
  expect(response.metadata?.['nextAction']).toBe(expected.action);
  for (const fragment of expected.includes) {
    expect(response.content).toContain(fragment);
  }
}
