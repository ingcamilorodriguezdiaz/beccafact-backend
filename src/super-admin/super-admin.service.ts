import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService) {}

  // ─── COMPANIES ───────────────────────────────────────────────────────────────

  async getCompanies(filters: { search?: string; status?: string; page?: number; limit?: number }) {
    const { search, status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * +limit;
    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        include: {
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'TRIAL'] } },
            include: { plan: { select: { id: true, name: true, displayName: true, price: true } } },
            take: 1,
            orderBy: { startDate: 'desc' },
          },
          _count: { select: { users: true, invoices: true, products: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: +limit,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }

  async getCompanyDetail(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        subscriptions: {
          include: { plan: { include: { features: true } } },
          orderBy: { startDate: 'desc' },
          take: 5,
        },
        _count: { select: { users: true, invoices: true, products: true, customers: true } },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  async suspendCompany(id: string, reason?: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    await Promise.all([
      this.prisma.company.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      this.prisma.subscription.updateMany({
        where: { companyId: id, status: 'ACTIVE' },
        data: { status: 'SUSPENDED' },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        companyId: id,
        action: 'SUSPEND',
        resource: 'company',
        resourceId: id,
        before: { status: company.status },
        after: { status: 'SUSPENDED', reason: reason ?? 'Suspended by super admin' },
      },
    });

    return { message: 'Empresa suspendida correctamente', status: 'SUSPENDED' };
  }

  async activateCompany(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    await Promise.all([
      this.prisma.company.update({ where: { id }, data: { status: 'ACTIVE' } }),
      this.prisma.subscription.updateMany({
        where: { companyId: id, status: 'SUSPENDED' },
        data: { status: 'ACTIVE' },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        companyId: id,
        action: 'ACTIVATE',
        resource: 'company',
        resourceId: id,
        before: { status: company.status },
        after: { status: 'ACTIVE' },
      },
    });

    return { message: 'Empresa reactivada correctamente', status: 'ACTIVE' };
  }

  async changePlan(companyId: string, planId: string, customLimits?: Record<string, string>) {
    const [company, plan] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId } }),
      this.prisma.plan.findUnique({ where: { id: planId }, include: { features: true } }),
    ]);

    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (!plan) throw new NotFoundException('Plan no encontrado');

    await this.prisma.subscription.updateMany({
      where: { companyId, status: { in: ['ACTIVE', 'TRIAL'] } },
      data: { status: 'CANCELLED', endDate: new Date() },
    });

    const subscription = await this.prisma.subscription.create({
      data: {
        companyId,
        planId,
        status: 'ACTIVE',
        startDate: new Date(),
        customLimits: customLimits ?? undefined,
      },
      include: { plan: { include: { features: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        action: 'CHANGE_PLAN',
        resource: 'subscription',
        resourceId: subscription.id,
        after: { planId, planName: plan.name },
      },
    });

    return subscription;
  }

  // ─── PLANS ───────────────────────────────────────────────────────────────────

  async getPlans() {
    return this.prisma.plan.findMany({
      include: {
        features: true,
        _count: { select: { subscriptions: true } },
      },
      orderBy: { price: 'asc' },
    });
  }

  async getPlan(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        features: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL'] } },
          include: { company: { select: { id: true, name: true, email: true } } },
          take: 20,
        },
        _count: { select: { subscriptions: true } },
      },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  async createPlan(data: any) {
    const { features, ...planData } = data;

    const existing = await this.prisma.plan.findUnique({ where: { name: planData.name } });
    if (existing) throw new BadRequestException(`Ya existe un plan con el nombre "${planData.name}"`);

    return this.prisma.plan.create({
      data: {
        ...planData,
        price: parseFloat(planData.price),
        features: { create: (features ?? []).map((f: any) => ({ key: f.key, value: f.value, label: f.label })) },
      },
      include: { features: true },
    });
  }

  async updatePlan(id: string, data: any) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const { features, ...planData } = data;
    if (planData.price) planData.price = parseFloat(planData.price);

    return this.prisma.$transaction(async (tx) => {
      if (features && features.length > 0) {
        await tx.planFeature.deleteMany({ where: { planId: id } });
        await tx.planFeature.createMany({
          data: features.map((f: any) => ({
            planId: id,
            key: f.key,
            value: f.value,
            label: f.label,
          })),
        });
      }
      return tx.plan.update({
        where: { id },
        data: { ...planData, updatedAt: new Date() },
        include: { features: true, _count: { select: { subscriptions: true } } },
      });
    });
  }

  async togglePlan(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const updated = await this.prisma.plan.update({
      where: { id },
      data: { isActive: !plan.isActive },
    });

    return { message: updated.isActive ? 'Plan activado' : 'Plan desactivado', isActive: updated.isActive };
  }

  // ─── USERS ───────────────────────────────────────────────────────────────────

  async getAllUsers(filters: { search?: string; companyId?: string; page?: number; limit?: number }) {
    const { search, companyId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * +limit;
    const where: any = { deletedAt: null, isSuperAdmin: false };

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (companyId) where.companyId = companyId;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          isActive: true, lastLoginAt: true, createdAt: true,
          company: { select: { id: true, name: true } },
          roles: { include: { role: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: +limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: data.map((u) => ({ ...u, roles: u.roles.map((ur) => ur.role.name) })),
      total,
      page: +page,
      limit: +limit,
      totalPages: Math.ceil(total / +limit),
    };
  }

  // ─── METRICS ─────────────────────────────────────────────────────────────────

  async getGlobalMetrics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCompanies, activeCompanies, suspendedCompanies, trialCompanies,
      totalUsers, totalInvoices, monthlyInvoices, totalProducts,
      revenueThisMonth, recentInvoices, companiesByPlan,
    ] = await Promise.all([
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.company.count({ where: { status: 'ACTIVE' } }),
      this.prisma.company.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.company.count({ where: { status: 'TRIAL' } }),
      this.prisma.user.count({ where: { deletedAt: null, isSuperAdmin: false } }),
      this.prisma.invoice.count({ where: { deletedAt: null } }),
      this.prisma.invoice.count({ where: { deletedAt: null, createdAt: { gte: monthStart } } }),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.invoice.aggregate({
        where: { deletedAt: null, status: { not: 'CANCELLED' }, issueDate: { gte: monthStart } },
        _sum: { total: true },
      }),
      this.prisma.invoice.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          company: { select: { name: true } },
          customer: { select: { name: true } },
        },
      }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
        _count: { planId: true },
      }),
    ]);

    const planIds = companiesByPlan.map((c) => c.planId);
    const plans = await this.prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true, displayName: true },
    });
    const planMap = new Map(plans.map((p) => [p.id, p]));

    return {
      companies: {
        total: totalCompanies,
        active: activeCompanies,
        suspended: suspendedCompanies,
        trial: trialCompanies,
        byPlan: companiesByPlan.map((c) => ({
          plan: planMap.get(c.planId),
          count: c._count.planId,
        })),
      },
      users: { total: totalUsers },
      invoices: {
        total: totalInvoices,
        thisMonth: monthlyInvoices,
        revenueThisMonth: revenueThisMonth._sum.total ?? 0,
      },
      products: { total: totalProducts },
      recentInvoices,
    };
  }

  // ─── AUDIT LOGS ──────────────────────────────────────────────────────────────

  async getAuditLogs(filters: {
    companyId?: string;
    resource?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const { companyId, resource, action, from, to, page = 1, limit = 50 } = filters;
    const skip = (page - 1) * +limit;
    const where: any = {};

    if (companyId) where.companyId = companyId;
    if (resource) where.resource = resource;
    if (action) where.action = action;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          company: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: +limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }
}
