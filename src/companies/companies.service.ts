import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async getMyCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId, deletedAt: null },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL'] } },
          include: { plan: { include: { features: true } } },
          orderBy: { startDate: 'desc' },
          take: 1,
        },
        _count: { select: { users: true, products: true, invoices: true } },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  async updateMyCompany(companyId: string, dto: UpdateCompanyDto) {
    await this.getMyCompany(companyId);
    return this.prisma.company.update({
      where: { id: companyId },
      data: dto,
    });
  }

  async getUsage(companyId: string) {
    const period = this.getCurrentPeriod();
    const [usages, subscription] = await Promise.all([
      this.prisma.usageTracking.findMany({ where: { companyId, period } }),
      this.prisma.subscription.findFirst({
        where: { companyId, status: { in: ['ACTIVE', 'TRIAL'] } },
        include: { plan: { include: { features: true } } },
        orderBy: { startDate: 'desc' },
      }),
    ]);

    if (!subscription) return { period, usages: [], limits: {}, percentages: {} };

    const customLimits = (subscription.customLimits as Record<string, string>) ?? {};
    const limits: Record<string, string> = {};
    const percentages: Record<string, number> = {};

    for (const feature of subscription.plan.features) {
      const limitVal = customLimits[feature.key] ?? feature.value;
      limits[feature.key] = limitVal;

      if (limitVal !== 'unlimited' && limitVal !== 'true' && limitVal !== 'false') {
        const limit = parseInt(limitVal);
        const usage = usages.find((u) => u.metric === feature.key);
        percentages[feature.key] = usage
          ? Math.min(100, Math.round((usage.value / limit) * 100))
          : 0;
      }
    }

    return { period, planName: subscription.plan.displayName, usages, limits, percentages };
  }

  /** Información completa de facturación: suscripción + historial */
  async getBilling(companyId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { companyId },
      include: {
        plan: {
          include: { features: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    const active = subscriptions.find((s) => s.status === 'ACTIVE' || s.status === 'TRIAL');

    return {
      currentSubscription: active ?? null,
      history: subscriptions,
    };
  }

  async getUsers(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, isActive: true, lastLoginAt: true, createdAt: true,
        roles: { include: { role: { select: { name: true, displayName: true } } } },
      },
      orderBy: { firstName: 'asc' },
    });
  }

  async incrementUsage(companyId: string, metric: string, amount = 1) {
    const period = this.getCurrentPeriod();
    return this.prisma.usageTracking.upsert({
      where: { companyId_metric_period: { companyId, metric, period } },
      create: { companyId, metric, period, value: amount },
      update: { value: { increment: amount } },
    });
  }

  async checkLimit(companyId: string, metric: string): Promise<boolean> {
    const period = this.getCurrentPeriod();
    const [usage, subscription] = await Promise.all([
      this.prisma.usageTracking.findUnique({
        where: { companyId_metric_period: { companyId, metric, period } },
      }),
      this.prisma.subscription.findFirst({
        where: { companyId, status: { in: ['ACTIVE', 'TRIAL'] } },
        include: { plan: { include: { features: true } } },
        orderBy: { startDate: 'desc' },
      }),
    ]);

    if (!subscription) return false;

    const customLimits = (subscription.customLimits as Record<string, string>) ?? {};
    const limitVal =
      customLimits[metric] ??
      subscription.plan.features.find((f) => f.key === metric)?.value;

    if (!limitVal || limitVal === 'unlimited' || limitVal === '-1' || limitVal === 'true') return true;
    if (limitVal === 'false') return false;

    const limit = parseInt(limitVal);
    return (usage?.value ?? 0) < limit;
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
