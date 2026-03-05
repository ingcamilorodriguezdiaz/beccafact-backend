import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

// ── Tipos del catálogo ────────────────────────────────────────────────────────
export type FeatureGroup = 'limits' | 'modules' | 'support';
export type FeatureType  = 'bool' | 'number' | 'months';

export interface FeatureDef {
  key:          string;
  label:        string;
  description:  string;
  type:         FeatureType;
  defaultValue: string;
  group:        FeatureGroup;
  icon:         string;        // SVG path (viewBox 0 0 24 24, stroke)
  numberHint?:  string;
}

// ── Catálogo canónico — única fuente de verdad ────────────────────────────────
export const FEATURE_CATALOG: FeatureDef[] = [
  // ── Límites numéricos
  {
    key: 'max_documents_per_month', label: 'Documentos / mes',
    description: 'Cantidad máxima de documentos electrónicos emitibles por mes',
    type: 'number', defaultValue: '100', group: 'limits', numberHint: '-1 = ilimitado',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    key: 'max_products', label: 'Productos',
    description: 'Número máximo de productos que se pueden registrar',
    type: 'number', defaultValue: '500', group: 'limits', numberHint: '-1 = ilimitado',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
  {
    key: 'max_users', label: 'Usuarios',
    description: 'Número máximo de usuarios que pueden acceder al sistema',
    type: 'number', defaultValue: '5', group: 'limits', numberHint: '-1 = ilimitado',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    key: 'max_integrations', label: 'Integraciones',
    description: 'Número máximo de integraciones externas permitidas',
    type: 'number', defaultValue: '2', group: 'limits', numberHint: '-1 = ilimitado',
    icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  },
  {
    key: 'storage_months', label: 'Historial',
    description: 'Meses que se conserva el historial y almacenamiento de datos',
    type: 'months', defaultValue: '12', group: 'limits', numberHint: '-1 = ilimitado',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  // ── Módulos
  {
    key: 'has_invoices', label: 'Facturación electrónica',
    description: 'Incluye facturación electrónica (DIAN)',
    type: 'bool', defaultValue: 'true', group: 'modules',
    icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  },
  {
    key: 'dian_enabled', label: 'Integración DIAN',
    description: 'Integración directa con la DIAN habilitada para este plan',
    type: 'bool', defaultValue: 'false', group: 'modules',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  {
    key: 'has_inventory', label: 'Gestión de inventario',
    description: 'Módulo completo de gestión de inventario y stock',
    type: 'bool', defaultValue: 'true', group: 'modules',
    icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
  },
  {
    key: 'has_reports', label: 'Reportes y analítica',
    description: 'Módulo de reportes, estadísticas y analítica avanzada',
    type: 'bool', defaultValue: 'true', group: 'modules',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    key: 'has_cartera', label: 'Módulo de cartera',
    description: 'Gestión de cartera y cobranza incluida en el plan',
    type: 'bool', defaultValue: 'false', group: 'modules',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  },
  {
    key: 'has_integrations', label: 'Integraciones externas',
    description: 'Permite activar integraciones con APIs y servicios de terceros',
    type: 'bool', defaultValue: 'false', group: 'modules',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    key: 'bulk_import', label: 'Importación masiva',
    description: 'Permite importar productos, clientes y datos en bloque',
    type: 'bool', defaultValue: 'false', group: 'modules',
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  },
  {
    key: 'has_payroll', label: 'Nómina electrónica',
    description: 'Funcionalidad de nómina electrónica habilitada en el plan',
    type: 'bool', defaultValue: 'false', group: 'modules',
    icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    key: 'has_multicompany', label: 'Multiempresa',
    description: 'Gestión de múltiples empresas dentro de una misma cuenta',
    type: 'bool', defaultValue: 'false', group: 'modules',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  },
  // ── Soporte
  {
    key: 'priority_support', label: 'Soporte prioritario',
    description: 'Soporte con prioridad alta y tiempos de respuesta garantizados (24/7)',
    type: 'bool', defaultValue: 'false', group: 'support',
    icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    key: 'has_sla', label: 'SLA contractual',
    description: 'Acuerdo de nivel de servicio (SLA) contractual incluido en el plan',
    type: 'bool', defaultValue: 'false', group: 'support',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
];

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo canónico de features — única fuente de verdad para front y back */
  getFeatureCatalog(): FeatureDef[] {
    return FEATURE_CATALOG;
  }

  /** Lista pública de planes activos para mostrar en pricing */
  async findPublic() {
    return this.prisma.plan.findMany({
      where: { isActive: true, isCustom: false },
      include: { features: true },
      orderBy: { price: 'asc' },
    });
  }

  /** Obtener plan de una empresa por companyId */
  async getCompanyPlan(companyId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      include: {
        plan: { include: { features: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    if (!subscription) return null;

    // Merge custom limits into features for the response
    const customLimits = (subscription.customLimits as Record<string, string>) ?? {};
    const mergedFeatures = subscription.plan.features.map((f) => ({
      ...f,
      value: customLimits[f.key] ?? f.value,
      isCustom: !!customLimits[f.key],
    }));

    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        trialEndsAt: subscription.trialEndsAt,
      },
      plan: {
        ...subscription.plan,
        features: mergedFeatures,
      },
    };
  }

  async findOne(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { features: true },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }
}