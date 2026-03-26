import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import * as XLSX from 'xlsx';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) { }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  private buildMonthRange(year: number, month: number): { from: Date; to: Date } {
    return {
      from: new Date(year, month - 1, 1),
      to: new Date(year, month, 0, 23, 59, 59, 999),
    };
  }

  private classifyAging(daysOverdue: number): string {
    if (daysOverdue <= 0) return 'CURRENT';
    if (daysOverdue <= 30) return 'DAYS_1_30';
    if (daysOverdue <= 60) return 'DAYS_31_60';
    if (daysOverdue <= 90) return 'DAYS_61_90';
    return 'OVER_90';
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────

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

    const { from, to } = this.buildMonthRange(y, m);
    const { from: prevFrom, to: prevTo } = this.buildMonthRange(y, m - 1 === 0 ? 12 : m - 1);

    // Ajuste de año para enero: el mes anterior es diciembre del año anterior
    const prevFromAdjusted = m === 1 ? new Date(y - 1, 11, 1) : prevFrom;
    const prevToAdjusted = m === 1 ? new Date(y - 1, 11, 31, 23, 59, 59, 999) : prevTo;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new Error('Invalid date calculation');
    }

    const [activeCustomers, current, previous, topCustomers, topProducts, activeCatalog, lowStockResult] = await Promise.all([
      // Total de clientes activos
      this.prisma.customer.count({
        where: {
          companyId,
          deletedAt: null,
          isActive: true,
        },
      }),
      // Mes actual
      this.prisma.invoice.aggregate({
        where: { companyId, deletedAt: null, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { total: true, taxAmount: true },
        _count: { id: true },
      }),
      // Mes anterior
      this.prisma.invoice.aggregate({
        where: { companyId, deletedAt: null, issueDate: { gte: prevFromAdjusted, lte: prevToAdjusted }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { id: true },
      }),
      // Top 5 clientes por ingresos
      this.prisma.invoice.groupBy({
        by: ['customerId'],
        where: { companyId, deletedAt: null, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { id: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      // Top 5 productos por ventas (via invoice_items)
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
      // Productos con bajo stock
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

    // Enriquecer top clientes con nombres
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

    // Agrupar por antigüedad: current, 1-30, 31-60, 61-90, >90
    const aging = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 };
    const byCustomer: Record<string, any> = {};

    for (const inv of invoices) {
      const daysOverdue = inv.dueDate
        ? Math.max(0, Math.floor((date.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const total = Number(inv.total);
      const bucket = this.classifyAging(daysOverdue);
      if (bucket === 'CURRENT') aging.current += total;
      else if (bucket === 'DAYS_1_30') aging.days1_30 += total;
      else if (bucket === 'DAYS_31_60') aging.days31_60 += total;
      else if (bucket === 'DAYS_61_90') aging.days61_90 += total;
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
    const results = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const { from, to } = this.buildMonthRange(year, i + 1);
        const agg = await this.prisma.invoice.aggregate({
          where: { companyId, deletedAt: null, issueDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
          _sum: { total: true, taxAmount: true },
          _count: { id: true },
        });
        return {
          month: i + 1,
          year,
          revenue: Number(agg._sum.total ?? 0),
          taxes: Number(agg._sum.taxAmount ?? 0),
          invoiceCount: agg._count.id,
        };
      })
    );
    return results;
  }

  /** Resumen de uso del mes actual — alimenta la barra de progreso del sidebar */
  async getUsageSummary(companyId: string) {
    const now = new Date();
    const { from: monthStart, to: monthEnd } = this.buildMonthRange(now.getFullYear(), now.getMonth() + 1);

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
      year: now.getFullYear(),
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

  async getInvoicesByStatus(companyId: string, from?: string, to?: string) {
    const where: any = { companyId, deletedAt: null };
    if (from) where.issueDate = { ...where.issueDate, gte: new Date(from) };
    if (to) where.issueDate = { ...where.issueDate, lte: new Date(to) };

    const grouped = await this.prisma.invoice.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      _sum: { total: true },
    });

    return grouped.map(g => ({
      status: g.status,
      count: g._count.id,
      total: Number(g._sum.total ?? 0),
    }));
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

    const { totalNet, totalEarnings, totalDeductions } = records.reduce(
      (acc, r) => ({
        totalNet: acc.totalNet + Number((r as any).netPay ?? 0),
        totalEarnings: acc.totalEarnings + Number((r as any).totalEarnings ?? 0),
        totalDeductions: acc.totalDeductions + Number((r as any).totalDeductions ?? 0),
      }),
      { totalNet: 0, totalEarnings: 0, totalDeductions: 0 }
    );

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

  async getPayrollMonthlyTrend(companyId: string, fromPeriod?: string, toPeriod?: string) {
    const where: any = { companyId };
    if (fromPeriod) where.period = { ...where.period, gte: fromPeriod };
    if (toPeriod) where.period = { ...where.period, lte: toPeriod };

    const grouped = await this.prisma.payroll_records.groupBy({
      by: ['period'],
      where,
      _sum: { totalEarnings: true, totalDeductions: true, netPay: true },
      _count: { id: true },
      orderBy: { period: 'asc' },
    });

    return grouped.map((g: any) => ({
      period: g.period,
      count: g._count.id,
      totalEarnings: Number(g._sum.totalEarnings ?? 0),
      totalDeductions: Number(g._sum.totalDeductions ?? 0),
      totalNet: Number(g._sum.netPay ?? 0),
    }));
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

  async getPosPaymentBreakdown(companyId: string, from?: string, to?: string) {
    const where: any = { companyId };
    if (from) where.createdAt = { ...where.createdAt, gte: new Date(from) };
    if (to) where.createdAt = { ...where.createdAt, lte: new Date(to) };

    // PosSale tiene paymentMethod (enum: CASH | CARD | TRANSFER | MIXED) y companyId
    const grouped = await this.prisma.posSale.groupBy({
      by: ['paymentMethod'],
      where,
      _count: { id: true },
      _sum: { total: true },
    });

    return grouped.map((g: any) => ({
      paymentMethod: g.paymentMethod,
      count: g._count.id,
      total: Number(g._sum.total ?? 0),
    }));
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
      const aging = this.classifyAging(diffDays);

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

  async getDashboardXlsx(companyId: string, year: number, month: number): Promise<Buffer> {
    const [kpis, monthly] = await Promise.all([
      this.getDashboardKpis(companyId, year, month),
      this.getMonthlyRevenue(companyId, year),
    ]);

    const wb = XLSX.utils.book_new();

    // Hoja 1: KPIs
    const kpiRows = [
      ['Métrica', 'Valor', 'Período'],
      ['Ingresos del mes', kpis.revenue?.current ?? 0, `${month}/${year}`],
      ['Facturas emitidas', kpis.invoices?.current ?? 0, `${month}/${year}`],
      ['IVA generado', kpis.taxes?.current ?? 0, `${month}/${year}`],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiRows), 'KPIs');

    // Hoja 2: Ingresos mensuales
    const monthlyRows = [
      ['Mes', 'Año', 'Ingresos', 'IVA', 'Facturas'],
      ...monthly.map((m: any) => [m.month, m.year, m.revenue, m.taxes, m.invoiceCount]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthlyRows), 'Ingresos mensuales');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
