import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) { }

  async getDashboardKpis(companyId: string, year: number, month: number) {
    const now = new Date();

    let y = Number(year);
    let m = Number(month);

    // Normalización segura
    if (!y || isNaN(y) || y < 2000) {
      y = now.getFullYear();
    }

    if (!m || isNaN(m) || m < 1 || m > 12) {
      m = now.getMonth() + 1;
    }

    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0, 23, 59, 59);
    const prevFrom = new Date(y, m - 2, 1);
    const prevTo = new Date(y, m - 1, 0, 23, 59, 59);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new Error('Invalid date calculation');
    }

    const [current, previous, topCustomers, topProducts, lowStock] = await Promise.all([
      // Current month
      this.prisma.invoice.aggregate({
        where: { companyId, deletedAt: null, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { total: true, taxAmount: true },
        _count: { id: true },
      }),
      // Previous month
      this.prisma.invoice.aggregate({
        where: { companyId, deletedAt: null, issueDate: { gte: prevFrom, lte: prevTo }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { id: true },
      }),
      // Top 5 customers by revenue
      this.prisma.invoice.groupBy({
        by: ['customerId'],
        where: { companyId, deletedAt: null, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { id: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      // Top 5 products by sales (via invoice_items)
      this.prisma.invoiceItem.groupBy({
        by: ['productId'],
        where: {
          productId: { not: null },
          invoice: { companyId, deletedAt: null, issueDate: { gte: from, lte: to } },
        },
        _sum: { total: true, quantity: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      // Low stock products
      this.prisma.product.count({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
      }),
    ]);

    const currentTotal = Number(current._sum.total ?? 0);
    const previousTotal = Number(previous._sum.total ?? 0);

    const revenueChange = previousTotal
      ? ((currentTotal - previousTotal) / previousTotal) * 100
      : 0;

    // Enrich top customers with names
    const customerIds = topCustomers.map((c) => c.customerId);
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, documentNumber: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return {
      revenue: {
        current: current._sum.total ?? 0,
        previous: previous._sum.total ?? 0,
        change: Math.round(revenueChange * 100) / 100,
      },
      invoices: {
        current: current._count.id,
        previous: previous._count.id,
      },
      taxes: { current: current._sum.taxAmount ?? 0 },
      topCustomers: topCustomers.map((c) => ({
        ...customerMap.get(c.customerId),
        revenue: c._sum.total ?? 0,
        invoiceCount: c._count.id,
      })),
      topProducts,
      productCount: lowStock,
    };
  }

  async getCartera(companyId: string, asOf?: string) {
    const date = asOf ? new Date(asOf) : new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, creditDays: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Group by aging: current, 1-30, 31-60, 61-90, >90
    const aging = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 };
    const byCustomer: Record<string, any> = {};

    for (const inv of invoices) {
      const daysOverdue = inv.dueDate
        ? Math.max(0, Math.floor((date.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const total = Number(inv.total);
      if (daysOverdue === 0) aging.current += total;
      else if (daysOverdue <= 30) aging.days1_30 += total;
      else if (daysOverdue <= 60) aging.days31_60 += total;
      else if (daysOverdue <= 90) aging.days61_90 += total;
      else aging.over90 += total;

      const custId = inv.customerId;
      if (!byCustomer[custId]) {
        byCustomer[custId] = { customer: inv.customer, total: 0, invoices: [] };
      }
      byCustomer[custId].total += total;
      byCustomer[custId].invoices.push({ ...inv, daysOverdue });
    }

    return {
      totalOutstanding: Object.values(byCustomer).reduce((s: any, c: any) => s + c.total, 0),
      aging,
      byCustomer: Object.values(byCustomer).sort((a: any, b: any) => b.total - a.total),
    };
  }

  async getMonthlyRevenue(companyId: string, year: number) {
    const results = [];
    for (let month = 1; month <= 12; month++) {
      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 0, 23, 59, 59);
      const agg = await this.prisma.invoice.aggregate({
        where: { companyId, deletedAt: null, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { total: true, taxAmount: true },
        _count: { id: true },
      });
      results.push({
        month,
        year,
        revenue: agg._sum.total ?? 0,
        taxes: agg._sum.taxAmount ?? 0,
        invoiceCount: agg._count.id,
      });
    }
    return results;
  }
}
