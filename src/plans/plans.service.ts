import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

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
