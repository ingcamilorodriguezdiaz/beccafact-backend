export interface SalesIndustryPlaybook {
  painPoints: string[];
  qualifyingQuestions: string[];
  suggestedNeeds: string[];
  valuePitch: string;
  recommendedCta: 'demo' | 'quote';
}

export interface SalesIntentPlaybook {
  goal: string;
  cta: string;
  guidance: string[];
}

export interface SalesEscalationRule {
  id: string;
  trigger: string;
  customerSignals: string[];
  action: 'ask_contact' | 'handoff_human' | 'create_quote' | 'create_payment_link';
  notes: string;
}

export interface SalesConversationTestCase {
  id: string;
  title: string;
  industry: string;
  userMessage: string;
  expectedStage:
    | 'DISCOVERY'
    | 'QUALIFICATION'
    | 'RECOMMENDATION'
    | 'OBJECTION'
    | 'DEMO'
    | 'QUOTATION'
    | 'PAYMENT'
    | 'HANDOFF_HUMAN';
  expectedAction:
    | 'answer_question'
    | 'ask_follow_up'
    | 'recommend_plan'
    | 'create_quote'
    | 'create_payment_link'
    | 'escalate_to_human';
  expectedSignals: string[];
}

export const SALES_INDUSTRY_PLAYBOOKS: Record<string, SalesIndustryPlaybook> = {
  restaurante: {
    painPoints: ['caja', 'inventario', 'facturación rápida', 'domicilios'],
    qualifyingQuestions: [
      '¿Hoy lo que más te duele es caja, inventario o facturación?',
      '¿Tienen una sola sede o varias?',
      '¿Necesitan punto de venta para atender rápido en caja?',
    ],
    suggestedNeeds: ['pos', 'inventario', 'facturacion', 'reportes'],
    valuePitch:
      'les ayuda a vender más rápido, controlar insumos y reducir descuadres en caja.',
    recommendedCta: 'demo',
  },
  retail: {
    painPoints: ['stock', 'ventas en mostrador', 'referencias', 'precios'],
    qualifyingQuestions: [
      '¿Venden por mostrador, por WhatsApp o ambos?',
      '¿Hoy controlan inventario en Excel o ya usan sistema?',
      '¿Cuántas cajas o usuarios lo manejarían?',
    ],
    suggestedNeeds: ['pos', 'inventario', 'cartera', 'reportes'],
    valuePitch:
      'les da control de inventario en tiempo real y acelera la venta en caja sin perder trazabilidad.',
    recommendedCta: 'demo',
  },
  servicios: {
    painPoints: ['facturación', 'seguimiento a clientes', 'cartera', 'cotizaciones'],
    qualifyingQuestions: [
      '¿Lo más importante para ustedes hoy es facturar mejor o cobrar mejor?',
      '¿Manejan cotizaciones antes de cerrar la venta?',
      '¿Cuántas personas del equipo usarían la herramienta?',
    ],
    suggestedNeeds: ['facturacion', 'cartera', 'cotizaciones', 'reportes'],
    valuePitch:
      'les ordena la parte administrativa, el seguimiento comercial y el cobro sin depender de tantos procesos manuales.',
    recommendedCta: 'quote',
  },
  ferreteria: {
    painPoints: ['muchas referencias', 'inventario', 'compras', 'ventas rápidas'],
    qualifyingQuestions: [
      '¿Manejan muchas referencias y cambios frecuentes de precio?',
      '¿La mayor dificultad hoy está en inventario o en la venta rápida?',
      '¿También necesitan compras y proveedores?',
    ],
    suggestedNeeds: ['inventario', 'pos', 'compras', 'reportes'],
    valuePitch:
      'les ayuda a ordenar referencias, compras y ventas para evitar quiebres de stock y pérdida de control.',
    recommendedCta: 'demo',
  },
  drogueria: {
    painPoints: ['atención rápida', 'inventario sensible', 'control por referencias'],
    qualifyingQuestions: [
      '¿Necesitan vender rápido en caja y controlar inventario al mismo tiempo?',
      '¿Tienen una sola droguería o varias?',
      '¿Hoy el problema es más de facturación, inventario o caja?',
    ],
    suggestedNeeds: ['pos', 'inventario', 'facturacion', 'reportes'],
    valuePitch:
      'les permite atender rápido, controlar inventario y tener más orden en la operación diaria.',
    recommendedCta: 'demo',
  },
  distribuidora: {
    painPoints: ['inventario por volumen', 'cartera', 'pedidos', 'múltiples vendedores'],
    qualifyingQuestions: [
      '¿Venden más a crédito o de contado?',
      '¿Manejan cartera y cobranza frecuente?',
      '¿Cuántas personas entre ventas y administración usarían el sistema?',
    ],
    suggestedNeeds: ['inventario', 'cartera', 'cotizaciones', 'compras', 'reportes'],
    valuePitch:
      'les da control comercial completo entre ventas, cartera, pedidos y administración.',
    recommendedCta: 'quote',
  },
  manufactura: {
    painPoints: ['inventario', 'compras', 'costos', 'control administrativo'],
    qualifyingQuestions: [
      '¿Lo que más quieren ordenar hoy es inventario, compras o facturación?',
      '¿Necesitan varios usuarios entre planta y administración?',
      '¿Ya tienen algún sistema o todavía lo llevan en Excel?',
    ],
    suggestedNeeds: ['inventario', 'compras', 'facturacion', 'reportes', 'contabilidad'],
    valuePitch:
      'les ayuda a reducir dependencia de Excel y a tener más trazabilidad en inventario, compras y facturación.',
    recommendedCta: 'demo',
  },
};

export const SALES_INTENT_PLAYBOOKS: Record<string, SalesIntentPlaybook> = {
  curious: {
    goal: 'abrir conversación y capturar el primer dato útil',
    cta: 'ask_context',
    guidance: ['educa breve', 'haz una sola pregunta de contexto', 'no cierres agresivamente'],
  },
  comparing: {
    goal: 'diferenciar por valor y entender criterio de decisión',
    cta: 'recommend_or_demo',
    guidance: ['compara sin atacar competencia', 'lleva al dolor principal', 'habla de ajuste al negocio'],
  },
  demo_ready: {
    goal: 'convertir interés en demostración enfocada',
    cta: 'schedule_demo',
    guidance: ['pregunta qué quiere ver primero', 'captura datos faltantes', 'aterriza la demo a la operación'],
  },
  quote_ready: {
    goal: 'formalizar propuesta sin perder momentum',
    cta: 'create_quote',
    guidance: ['resume encaje', 'confirma plan sugerido', 'pide correo o WhatsApp si falta'],
  },
  payment_ready: {
    goal: 'remover fricción y mover a activación',
    cta: 'create_payment_link',
    guidance: ['explica el siguiente paso', 'refuerza activación rápida', 'no reabras objeciones'],
  },
};

export const SALES_ESCALATION_RULES: SalesEscalationRule[] = [
  {
    id: 'human_explicit_request',
    trigger: 'El prospecto pide hablar con una persona.',
    customerSignals: ['asesor', 'humano', 'persona real', 'llámenme', 'quiero hablar con alguien'],
    action: 'handoff_human',
    notes: 'Si ya dejó datos, confirmar handoff. Si no, pedir correo o teléfono antes de cerrar el mensaje.',
  },
  {
    id: 'demo_with_contact',
    trigger: 'El prospecto pide demo y ya hay datos de contacto.',
    customerSignals: ['demo', 'ver el sistema', 'demostración', 'agendar demo'],
    action: 'handoff_human',
    notes: 'La demo debe escalar a humano para coordinación y enfoque por industria.',
  },
  {
    id: 'quote_intent_without_email',
    trigger: 'Hay intención de compra pero falta canal de seguimiento.',
    customerSignals: ['cotización', 'envíame propuesta', 'me interesa', 'quiero comprar'],
    action: 'ask_contact',
    notes: 'Pedir correo primero y no prometer envío si aún no se tiene un canal válido.',
  },
  {
    id: 'quote_intent_with_email',
    trigger: 'Hay intención de compra y ya existe email o teléfono.',
    customerSignals: ['procede', 'dale', 'enviámela', 'quiero activarlo'],
    action: 'create_quote',
    notes: 'Generar cotización y, si aplica, el link de pago.',
  },
  {
    id: 'payment_ready',
    trigger: 'El prospecto pregunta cómo pagar o quiere activar de inmediato.',
    customerSignals: ['cómo pago', 'link de pago', 'pse', 'tarjeta', 'activar hoy'],
    action: 'create_payment_link',
    notes: 'No volver a discovery; reducir fricción y mostrar siguiente paso.',
  },
];

export const SALES_PLAYBOOK_GUIDELINES = {
  qualificationOrder: [
    'Identificar empresa o tipo de negocio',
    'Detectar industria objetivo',
    'Confirmar principal dolor o módulo prioritario',
    'Estimar usuarios o sedes',
    'Capturar correo o teléfono antes de escalar o cotizar',
  ],
  webChatGoals: [
    'Calificar el lead sin sonar a formulario',
    'Responder dudas iniciales de planes y módulos',
    'Llevar a demo, cotización o pago según madurez',
    'Escalar a humano cuando la coordinación lo requiera',
  ],
};

export const SALES_CONVERSATION_TEST_CASES: SalesConversationTestCase[] = [
  {
    id: 'retail_price',
    title: 'Retail pregunta por precio general',
    industry: 'retail',
    userMessage: 'Tengo una tienda y quiero saber precios para controlar inventario y caja.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['retail', 'inventario', 'pos'],
  },
  {
    id: 'retail_demo',
    title: 'Retail pide demo',
    industry: 'retail',
    userMessage: 'Manejo una boutique con dos cajas, quiero ver una demo.',
    expectedStage: 'DEMO',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['demo', 'retail', 'pos'],
  },
  {
    id: 'retail_quote',
    title: 'Retail listo para cotizar',
    industry: 'retail',
    userMessage: 'Somos Tienda Nube SAS, 4 usuarios, me interesa cotización al correo compras@tiendanube.co.',
    expectedStage: 'QUOTATION',
    expectedAction: 'create_quote',
    expectedSignals: ['email', 'usersCount', 'recommendedPlanName'],
  },
  {
    id: 'restaurant_discovery',
    title: 'Restaurante exploratorio',
    industry: 'restaurante',
    userMessage: 'Tengo un restaurante pequeño y se me descuadra la caja.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['restaurante', 'caja', 'pos'],
  },
  {
    id: 'restaurant_demo_contact',
    title: 'Restaurante pide demo con contacto',
    industry: 'restaurante',
    userMessage: 'Quiero una demo para mi restaurante, mi celular es 3001234567.',
    expectedStage: 'HANDOFF_HUMAN',
    expectedAction: 'escalate_to_human',
    expectedSignals: ['demo', 'phone', 'handoff'],
  },
  {
    id: 'services_compare',
    title: 'Servicios compara planes',
    industry: 'servicios',
    userMessage: 'Somos una firma contable, ¿qué incluye cada plan y cuál me conviene?',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['servicios', 'comparing'],
  },
  {
    id: 'services_quote',
    title: 'Servicios con necesidad de cartera',
    industry: 'servicios',
    userMessage: 'Necesito cartera y cotizaciones para 6 usuarios, envíame propuesta a gerencia@legalpro.co.',
    expectedStage: 'QUOTATION',
    expectedAction: 'create_quote',
    expectedSignals: ['cartera', 'cotizaciones', 'email'],
  },
  {
    id: 'distributor_credit',
    title: 'Distribuidora con ventas a crédito',
    industry: 'distribuidora',
    userMessage: 'Somos distribuidora, vendemos mucho a crédito y tenemos 8 usuarios.',
    expectedStage: 'RECOMMENDATION',
    expectedAction: 'recommend_plan',
    expectedSignals: ['distribuidora', 'cartera', 'usersCount'],
  },
  {
    id: 'distributor_payment',
    title: 'Distribuidora lista para pagar',
    industry: 'distribuidora',
    userMessage: 'Listo, mándame el link de pago al correo comercial@mayorista.co.',
    expectedStage: 'PAYMENT',
    expectedAction: 'create_quote',
    expectedSignals: ['payment', 'email', 'quote'],
  },
  {
    id: 'manufacturer_control',
    title: 'Manufactura busca trazabilidad',
    industry: 'manufactura',
    userMessage: 'Somos una fábrica y queremos dejar Excel para compras, inventario y facturación.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['manufactura', 'compras', 'inventario'],
  },
  {
    id: 'manufacturer_users',
    title: 'Manufactura con varios usuarios',
    industry: 'manufactura',
    userMessage: 'Necesitamos 12 usuarios entre planta y administración.',
    expectedStage: 'RECOMMENDATION',
    expectedAction: 'recommend_plan',
    expectedSignals: ['usersCount', 'manufactura'],
  },
  {
    id: 'ferreteria_inventory',
    title: 'Ferretería con muchas referencias',
    industry: 'ferreteria',
    userMessage: 'Tengo ferretería con muchas referencias y cambios de precio.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['ferreteria', 'inventario'],
  },
  {
    id: 'ferreteria_buy',
    title: 'Ferretería quiere comprar',
    industry: 'ferreteria',
    userMessage: 'Me interesa activarlo ya, mi correo es admin@ferreplus.co.',
    expectedStage: 'QUOTATION',
    expectedAction: 'create_quote',
    expectedSignals: ['email', 'ready_to_buy'],
  },
  {
    id: 'drogueria_pos',
    title: 'Droguería necesita velocidad en caja',
    industry: 'drogueria',
    userMessage: 'Tengo una droguería y necesito vender rápido en caja sin perder inventario.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['drogueria', 'pos', 'inventario'],
  },
  {
    id: 'drogueria_human',
    title: 'Droguería pide asesor',
    industry: 'drogueria',
    userMessage: 'Prefiero hablar con un asesor ya mismo.',
    expectedStage: 'HANDOFF_HUMAN',
    expectedAction: 'escalate_to_human',
    expectedSignals: ['human_request'],
  },
  {
    id: 'restaurant_objection_price',
    title: 'Objeción de precio',
    industry: 'restaurante',
    userMessage: 'Se me hace costoso para un restaurante pequeño.',
    expectedStage: 'OBJECTION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['objection_price'],
  },
  {
    id: 'services_needs_time',
    title: 'Prospecto necesita tiempo',
    industry: 'servicios',
    userMessage: 'Déjame pensarlo y lo reviso con mi socio.',
    expectedStage: 'OBJECTION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['objection_needs_time'],
  },
  {
    id: 'general_how_pay',
    title: 'Pregunta directa de pago',
    industry: 'general',
    userMessage: '¿Cómo puedo pagar y cuánto se demora la activación?',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['payment', 'activation'],
  },
  {
    id: 'general_multi_branch',
    title: 'Consulta por multisede',
    industry: 'general',
    userMessage: 'Tenemos 3 sedes, ¿el sistema nos sirve?',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['branches', 'usersCount'],
  },
  {
    id: 'general_migration',
    title: 'Consulta por migración',
    industry: 'general',
    userMessage: 'Ya uso otro sistema, pero necesito migrar clientes e inventario.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['migration', 'inventory'],
  },
  {
    id: 'general_support',
    title: 'Pregunta por soporte',
    industry: 'general',
    userMessage: '¿Quién nos ayuda con la implementación y el soporte?',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['support', 'implementation'],
  },
  {
    id: 'general_payroll',
    title: 'Consulta de nómina',
    industry: 'general',
    userMessage: 'Necesitamos nómina electrónica para 20 empleados.',
    expectedStage: 'RECOMMENDATION',
    expectedAction: 'recommend_plan',
    expectedSignals: ['nomina', 'usersCount'],
  },
  {
    id: 'general_accounting',
    title: 'Consulta de contabilidad',
    industry: 'general',
    userMessage: 'Busco facturación y contabilidad completa para mi empresa.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['contabilidad', 'facturacion'],
  },
  {
    id: 'general_whatsapp_followup',
    title: 'Pide seguimiento por WhatsApp',
    industry: 'general',
    userMessage: 'Escríbeme al 3115907753 para coordinar la demo.',
    expectedStage: 'HANDOFF_HUMAN',
    expectedAction: 'escalate_to_human',
    expectedSignals: ['phone', 'demo', 'handoff'],
  },
  {
    id: 'general_email_only',
    title: 'Deja correo sin pedirlo',
    industry: 'general',
    userMessage: 'Mi correo es compras@empresa.co, quiero saber cuál plan me sirve.',
    expectedStage: 'QUALIFICATION',
    expectedAction: 'ask_follow_up',
    expectedSignals: ['email'],
  },
  {
    id: 'general_quote_after_recommendation',
    title: 'Pide cotización después de recomendación',
    industry: 'general',
    userMessage: 'Perfecto, entonces envíame la cotización.',
    expectedStage: 'QUOTATION',
    expectedAction: 'create_quote',
    expectedSignals: ['quote'],
  },
  {
    id: 'general_payment_link',
    title: 'Pide link directo',
    industry: 'general',
    userMessage: 'Dame el link para pagar de una vez.',
    expectedStage: 'PAYMENT',
    expectedAction: 'create_quote',
    expectedSignals: ['payment_link'],
  },
];

export const SALES_PLAYBOOK = {
  industries: SALES_INDUSTRY_PLAYBOOKS,
  intents: SALES_INTENT_PLAYBOOKS,
  escalationRules: SALES_ESCALATION_RULES,
  guidelines: SALES_PLAYBOOK_GUIDELINES,
  conversationTests: SALES_CONVERSATION_TEST_CASES,
};

