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

    const [activeCustomers,current, previous, topCustomers, topProducts , activeCatalog , lowStockResult] = await Promise.all([
       // Total customer active
        this.prisma.customer.count({
          where: {
            companyId,
            deletedAt: null,
            isActive: true,
          },
        }),
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
        // Solo catálogo activo
      this.prisma.product.count({
        where: {
          companyId,
          deletedAt: null,
          status: 'ACTIVE',
        },
      }),
      // Low stock products
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint as count
        FROM "products"
        WHERE "companyId" = ${companyId}
          AND "deletedAt" IS NULL
          AND "status" = 'ACTIVE'
          AND "stock" <= "minStock"
      `,
    ]);

    const lowStock = Number(lowStockResult[0]?.count ?? 0);
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
      activeCustomers,
      activeCatalog,
      productCount: lowStock,
    };
  }

  async getCollections(companyId: string, asOf?: string) {
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

  /** Resumen de uso del mes actual — alimenta la barra de progreso del sidebar */
  async getUsageSummary(companyId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [documentsUsedThisMonth, totalProducts, totalCustomers] = await Promise.all([
      // Documentos (facturas + notas) emitidos este mes
      this.prisma.invoice.count({
        where: {
          companyId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          issueDate: { gte: monthStart, lte: monthEnd },
        },
      }),
      // Productos activos de la empresa
      this.prisma.product.count({
        where: { companyId, deletedAt: null },
      }),
      // Clientes activos de la empresa
      this.prisma.customer.count({
        where: { companyId, deletedAt: null },
      }),
    ]);

    return {
      documentsUsedThisMonth,
      totalProducts,
      totalCustomers,
      month: now.getMonth() + 1,
      year:  now.getFullYear(),
    };
  }

  // ── Facturación ─────────────────────────────────────────────────────────────

  async getInvoicesReport(companyId: string, from?: string, to?: string, status?: string) {
    const where: any = { companyId, deletedAt: null };
    if (from || to) {
      where.issueDate = {};
      if (from) where.issueDate.gte = new Date(from);
      if (to) where.issueDate.lte = new Date(to);
    }
    if (status) where.status = status;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { customer: { select: { name: true, documentNumber: true } } },
      orderBy: { issueDate: 'desc' },
      take: 1000,
    });

    const total = invoices.reduce((s, i) => s + Number(i.total), 0);
    const totalTax = invoices.reduce((s, i) => s + Number(i.taxAmount), 0);
    const totalSubtotal = invoices.reduce((s, i) => s + Number(i.subtotal), 0);

    return {
      summary: { count: invoices.length, total, taxes: totalTax, subtotal: totalSubtotal },
      items: invoices.map(i => ({
        id: i.id,
        number: (i as any).invoiceNumber ?? (i as any).numero ?? '',
        date: i.issueDate,
        customer: { name: (i as any).customer?.name ?? '', documentNumber: (i as any).customer?.documentNumber ?? '' },
        subtotal: Number(i.subtotal),
        taxes: Number(i.taxAmount),
        total: Number(i.total),
        status: i.status,
        dianStatus: (i as any).dianStatus ?? i.status ?? '',
      })),
    };
  }

  // ── Nómina ──────────────────────────────────────────────────────────────────

  async getPayrollReport(companyId: string, from?: string, to?: string) {
    const where: any = { companyId };
    if (from || to) {
      where.period = {};
      if (from) where.period.gte = from.slice(0, 7); // YYYY-MM
      if (to) where.period.lte = to.slice(0, 7);
    }

    const records = await this.prisma.payroll_records.findMany({
      where,
      include: { employees: { select: { firstName: true, lastName: true, documentNumber: true } } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });

    const totalNet = records.reduce((s: number, r: any) => s + Number(r.netPay ?? 0), 0);
    const totalEarnings = records.reduce((s: number, r: any) => s + Number(r.totalEarnings ?? 0), 0);
    const totalDeductions = records.reduce((s: number, r: any) => s + Number(r.totalDeductions ?? 0), 0);

    return {
      summary: { count: records.length, totalNet, totalEarnings, totalDeductions },
      items: records.map((r: any) => ({
        id: r.id,
        period: r.period,
        employeeName: `${r.employees?.firstName ?? ''} ${r.employees?.lastName ?? ''}`.trim(),
        document: r.employees?.documentNumber ?? '',
        type: r.payrollType ?? 'NOMINA_ELECTRONICA',
        baseSalary: Number(r.baseSalary ?? 0),
        totalEarnings: Number(r.totalEarnings ?? 0),
        totalDeductions: Number(r.totalDeductions ?? 0),
        totalNet: Number(r.netPay ?? 0),
        status: r.status,
      })),
    };
  }

  // ── POS ─────────────────────────────────────────────────────────────────────

  async getPosReport(companyId: string, from?: string, to?: string) {
    const where: any = { companyId };
    if (from || to) {
      where.openedAt = {};
      if (from) where.openedAt.gte = new Date(from);
      if (to) where.openedAt.lte = new Date(to + 'T23:59:59');
    }

    const sessions = await this.prisma.posSession.findMany({
      where,
      include: {
        sales: {
          include: {
            items: { include: { product: { select: { name: true } } } },
          },
        },
        user: { select: { firstName: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });

    let totalSales = 0;
    let totalTransactions = 0;
    const paymentTotals: Record<string, number> = {};

    const sessionItems = sessions.map((s: any) => {
      const sessionTotal = s.sales.reduce((acc: number, sale: any) => acc + Number(sale.total ?? 0), 0);
      totalSales += sessionTotal;
      totalTransactions += s.sales.length;

      for (const sale of s.sales) {
        const method = sale.paymentMethod ?? 'CASH';
        paymentTotals[method] = (paymentTotals[method] ?? 0) + Number(sale.total ?? 0);
      }

      return {
        id: s.id,
        date: s.openedAt,
        cashierName: s.user?.firstName ?? '',
        status: s.status,
        openingCash: Number(s.initialCash ?? 0),
        closingCash: Number(s.finalCash ?? 0),
        totalSales: sessionTotal,
        transactionCount: s.sales.length,
      };
    });

    return {
      summary: { totalSales, transactions: totalTransactions, sessions: sessions.length, paymentTotals },
      items: sessionItems,
    };
  }

  // ── Cartera detallada ────────────────────────────────────────────────────────

  async getCollectionsReport(companyId: string, asOf?: string) {
    const cutoff = asOf ? new Date(asOf) : new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
      },
      include: { customer: { select: { name: true, documentNumber: true, phone: true, email: true } } },
      orderBy: { dueDate: 'asc' },
      take: 1000,
    });

    const items = invoices.map(inv => {
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
      const diffDays = dueDate ? Math.floor((cutoff.getTime() - dueDate.getTime()) / 86400000) : 0;
      let aging = 'CURRENT';
      if (diffDays > 90) aging = 'OVER_90';
      else if (diffDays > 60) aging = 'DAYS_61_90';
      else if (diffDays > 30) aging = 'DAYS_31_60';
      else if (diffDays > 0) aging = 'DAYS_1_30';

      return {
        id: inv.id,
        number: (inv as any).invoiceNumber ?? '',
        customerName: (inv as any).customer?.name ?? '',
        customerDocument: (inv as any).customer?.documentNumber ?? '',
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        daysOverdue: Math.max(0, diffDays),
        total: Number(inv.total),
        aging,
      };
    });

    const totalBalance = items.reduce((s, i) => s + i.total, 0);

    return {
      summary: {
        totalBalance,
        current: items.filter(i => i.aging === 'CURRENT').reduce((s, i) => s + i.total, 0),
        overdue1_30: items.filter(i => i.aging === 'DAYS_1_30').reduce((s, i) => s + i.total, 0),
        overdue31_60: items.filter(i => i.aging === 'DAYS_31_60').reduce((s, i) => s + i.total, 0),
        overdue61_90: items.filter(i => i.aging === 'DAYS_61_90').reduce((s, i) => s + i.total, 0),
        overdueOver90: items.filter(i => i.aging === 'OVER_90').reduce((s, i) => s + i.total, 0),
      },
      items,
    };
  }

  // ── Excel genérico ───────────────────────────────────────────────────────────

  downloadExcel(type: string, data: any): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    let wsData: any[][] = [];

    if (type === 'invoices') {
      wsData = [
        ['#', 'Número', 'Fecha', 'Cliente', 'Subtotal', 'IVA', 'Total', 'Estado', 'Estado DIAN'],
        ...data.items.map((r: any, i: number) => [
          i + 1, r.number, r.date ? new Date(r.date).toLocaleDateString('es-CO') : '',
          r.customer?.name ?? '', r.subtotal, r.taxes, r.total, r.status, r.dianStatus,
        ]),
        [],
        ['TOTALES', '', '', '', data.summary.subtotal, data.summary.taxes, data.summary.total],
      ];
    } else if (type === 'payroll') {
      wsData = [
        ['#', 'Período', 'Empleado', 'Documento', 'Tipo', 'Salario Base', 'Devengado', 'Deducciones', 'Neto a Pagar', 'Estado'],
        ...data.items.map((r: any, i: number) => [
          i + 1, r.period, r.employeeName, r.document, r.type,
          r.baseSalary, r.totalEarnings, r.totalDeductions, r.totalNet, r.status,
        ]),
        [],
        ['TOTALES', '', '', '', '', '', data.summary.totalEarnings, data.summary.totalDeductions, data.summary.totalNet],
      ];
    } else if (type === 'pos') {
      wsData = [
        ['#', 'Fecha', 'Cajero', 'Estado', 'Efectivo Inicial', 'Efectivo Final', 'Total Ventas', 'Cant. Ventas'],
        ...data.items.map((r: any, i: number) => [
          i + 1, r.date ? new Date(r.date).toLocaleDateString('es-CO') : '', r.cashierName,
          r.status, r.openingCash, r.closingCash, r.totalSales, r.transactionCount,
        ]),
        [],
        ['TOTALES', '', '', '', '', '', data.summary.totalSales, data.summary.transactions],
      ];
    } else if (type === 'collections') {
      wsData = [
        ['#', 'Número', 'Cliente', 'Documento', 'Fecha Emisión', 'Fecha Vencimiento', 'Días Vencido', 'Total', 'Antigüedad'],
        ...data.items.map((r: any, i: number) => [
          i + 1, r.number, r.customerName, r.customerDocument,
          r.issueDate ? new Date(r.issueDate).toLocaleDateString('es-CO') : '',
          r.dueDate ? new Date(r.dueDate).toLocaleDateString('es-CO') : '',
          r.daysOverdue, r.total, r.aging,
        ]),
        [],
        ['TOTAL CARTERA', '', '', '', '', '', '', data.summary.totalBalance],
      ];
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
