import {
  SALES_CONVERSATION_TEST_CASES,
  SALES_ESCALATION_RULES,
  SALES_INDUSTRY_PLAYBOOKS,
  SALES_INTENT_PLAYBOOKS,
} from './sales-playbook';

export const SALES_KNOWLEDGE_BASE = {
  businessName: 'BeccaSoft',
  product: 'BeccaFact',
  description:
    'BeccaFact es un software ERP en la nube para empresas colombianas. Automatiza facturación electrónica DIAN, inventario, nómina, contabilidad, punto de venta y más. 100% colombiano, fácil de usar y con soporte real.',

  modules: {
    facturacion: 'Genera facturas electrónicas válidas ante la DIAN, con CUFE, QR y envío automático al correo del cliente.',
    inventario: 'Control de stock en tiempo real, alertas de mínimos, entradas y salidas, múltiples bodegas.',
    pos: 'Punto de venta táctil para tiendas físicas. Funciona con o sin internet, imprime tirillas y cierra caja.',
    cartera: 'Seguimiento de cuentas por cobrar, estados de cuenta de clientes, gestión de pagos y vencimientos.',
    nomina: 'Nómina electrónica reportada a la DIAN según Decreto 2291. Calcula salarios, prestaciones, deducciones y genera el XML.',
    contabilidad: 'Libro diario, mayor, balances, estado de resultados y reportes contables integrados con facturación.',
    compras: 'Gestión de proveedores, órdenes de compra, recepción de mercancía y cuentas por pagar.',
    cotizaciones: 'Crea cotizaciones profesionales, las convierte en pedidos o facturas con un clic.',
  },

  faqs: [
    {
      question: '¿Necesito instalar algo?',
      answer: 'No, BeccaFact es 100% en la nube. Solo necesitas un navegador y conexión a internet.',
    },
    {
      question: '¿Funciona con la DIAN?',
      answer: 'Sí, estamos habilitados como operador tecnológico ante la DIAN. Generamos facturas electrónicas, notas crédito, notas débito y nómina electrónica según la normativa colombiana.',
    },
    {
      question: '¿Puedo migrar mis datos de otro software?',
      answer: 'Sí, te ayudamos con la migración de clientes, productos e inventario desde Excel o desde otros sistemas.',
    },
    {
      question: '¿Cuánto tiempo toma la implementación?',
      answer: 'Normalmente 1 a 3 días hábiles. Incluye configuración inicial, carga de datos y capacitación básica.',
    },
    {
      question: '¿Hay contrato de permanencia?',
      answer: 'No, puedes cancelar en cualquier momento. El cobro es mensual sin contratos de largo plazo.',
    },
    {
      question: '¿Qué pasa si necesito más usuarios en el futuro?',
      answer: 'Puedes cambiar de plan en cualquier momento. El cambio aplica desde el siguiente mes.',
    },
    {
      question: '¿Tiene soporte técnico?',
      answer: 'Sí. El soporte incluido depende del plan activo configurado para tu empresa, y si necesitas más cobertura te orientamos sobre la opción que mejor encaja.',
    },
    {
      question: '¿Puedo ver una demo?',
      answer: 'Claro, generamos una cotización y puedes probar el sistema antes de pagar. También ofrecemos una demostración guiada con un asesor.',
    },
    {
      question: '¿Cómo se paga?',
      answer: 'Puedes pagar con tarjeta de crédito/débito, PSE o transferencia bancaria. El cobro es mensual automático o manual según prefieras.',
    },
    {
      question: '¿Funciona para múltiples empresas o sucursales?',
      answer: 'Sí, puedes gestionar múltiples sucursales desde una sola cuenta. Para múltiples empresas (NIT diferentes), cada una tiene su propia cuenta.',
    },
  ],

  objections: [
    {
      trigger: ['caro', 'costoso', 'precio alto', 'no tengo presupuesto', 'mucho dinero'],
      response:
        'Entiendo que el presupuesto importa. La idea es que pagues por un plan que realmente te ayude a ordenar la operación, evitar reprocesos y cumplir bien con la DIAN. Además, no hay permanencias largas: puedes crecer o ajustar el plan según lo que necesites.',
    },
    {
      trigger: ['lo pienso', 'déjame pensarlo', 'necesito tiempo', 'voy a consultar'],
      response:
        'Claro, no hay afán. ¿Qué es lo que más te genera duda? A veces con una pregunta resuelta ya queda todo más claro.',
    },
    {
      trigger: ['ya tengo un software', 'ya uso otro sistema', 'estoy con otro proveedor'],
      response:
        'Qué bueno que ya llevas un control. ¿Qué es lo que más te está faltando en el sistema que usas hoy? Así te cuento si BeccaFact puede resolver eso específicamente.',
    },
    {
      trigger: ['no sé si sirva para mi negocio', 'no sé si aplica', 'mi negocio es diferente'],
      response:
        'Cuéntame un poco de tu negocio y te digo con certeza. BeccaFact se usa en sectores muy diferentes: comercio, servicios, manufactura, restaurantes, distribuidoras... Lo más probable es que haya un módulo que encaje exactamente.',
    },
    {
      trigger: ['es complicado', 'no soy muy técnico', 'difícil de usar'],
      response:
        'Al contrario, ese es uno de los puntos fuertes de BeccaFact: es muy intuitivo. No necesitas saber contabilidad ni sistemas. La mayoría de clientes empiezan a facturar el mismo día de la implementación. Y si tienes dudas, el soporte te acompaña.',
    },
  ],

  closingRules: [
    'Si el cliente dice "sí", "me interesa", "quiero", "lo tomo", "dale", "procede", "envíame la cotización", ofrecer cotización.',
    'Si el cliente da su correo o teléfono sin que se lo pidas, está listo para continuar.',
    'Si el cliente pregunta por formas de pago, tiene alta intención de compra.',
    'No presionar si el cliente dice que necesita tiempo. Dejar la puerta abierta.',
    'Si hay intención de compra pero falta email, pedirlo de forma natural antes de generar cotización.',
  ],

  toneRules: [
    'Habla como un asesor comercial colombiano: cercano, claro y sin tecnicismos innecesarios.',
    'Usa "tú" o "usted" según el tono del cliente.',
    'Sé breve: máximo 3–4 oraciones por respuesta.',
    'Nunca hagas más de 2 preguntas en un mismo mensaje.',
    'No repitas preguntas que ya respondió el cliente.',
    'Conecta las necesidades del cliente con beneficios reales del plan.',
    'Si el cliente da información (nombre, correo, empresa), acúsala y continúa naturalmente.',
    'Evita frases como "claro que sí", "por supuesto", "desde luego" de forma repetitiva.',
    'No uses bullet points ni listas en la respuesta al usuario — escribe en párrafo natural.',
    'Si necesitas mencionar precio, menciona también el valor que entrega.',
  ],

  activationProcess: [
    'Pago completado → Activación automática en menos de 5 minutos.',
    'Se crea usuario administrador con el correo del cliente.',
    'Se envía correo de bienvenida con credenciales y guía de inicio.',
    'El asesor comercial hace seguimiento en las primeras 24 horas.',
    'Capacitación inicial incluida en todos los planes (30–60 minutos vía videollamada).',
  ],

  paymentMethods: [
    'Tarjeta de crédito / débito Visa, Mastercard, Amex',
    'PSE (débito bancario online)',
    'Transferencia bancaria',
    'Efectivo en corresponsal bancario (Efecty, Baloto)',
  ],

  support: {
    basic: 'Soporte por correo y chat en horario laboral (lunes a viernes 8am–6pm)',
    professional: 'Soporte por correo, chat y WhatsApp en horario laboral extendido',
    enterprise: 'Soporte 24/7 con asesor dedicado, teléfono y WhatsApp',
    trainingIncluded: true,
    onboardingIncluded: true,
  },

  industryPlaybooks: SALES_INDUSTRY_PLAYBOOKS,
  intentPlaybooks: SALES_INTENT_PLAYBOOKS,
  escalationRules: SALES_ESCALATION_RULES,
  conversationTests: SALES_CONVERSATION_TEST_CASES,
};

export type SalesKnowledgeBase = typeof SALES_KNOWLEDGE_BASE;
