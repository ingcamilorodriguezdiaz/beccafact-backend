import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import * as XLSX from 'xlsx-js-style';

// ── Excel style helpers ───────────────────────────────────────────────────────

type XAlign = 'left' | 'right' | 'center';

const XBG = { DARK: '0C1C35', NAVY: '1A407E', LIGHT: 'DBE8FA', STRIPE: 'F4F7FB', WHITE: 'FFFFFF' };
const XFG = { WHITE: 'FFFFFF', DARK: '0C1C35', MED: '374151', MUTED: '6B7280' };
const XBRD = {
  muted: { style: 'thin', color: { rgb: 'DCE6F0' } },
  navy:  { style: 'medium', color: { rgb: '1A407E' } },
};

function xc(v: any, bg: string, fg: string, bold: boolean, sz: number,
            align: XAlign, numFmt?: string, bTop?: any, bBot?: any): any {
  const s: any = {
    fill: { patternType: 'solid', fgColor: { rgb: bg } },
    font: { bold, sz, color: { rgb: fg } },
    alignment: { horizontal: align, vertical: 'center' },
    border: { top: bTop ?? XBRD.muted, bottom: bBot ?? XBRD.muted, left: XBRD.muted, right: XBRD.muted },
  };
  if (numFmt) s.numFmt = numFmt;
  return { v, t: typeof v === 'number' ? 'n' : 's', s };
}

function buildStyledSheet(
  title: string,
  subtitle: string,
  headers: Array<{ label: string; width: number; align?: XAlign }>,
  dataRows: any[][],
  moneyCols: number[],
  totalRow: any[],
  totalMoneyCols: number[],
): any {
  const N = headers.length;
  const rows: any[][] = [];

  // Title row
  const titleRow = [xc(title, XBG.DARK, XFG.WHITE, true, 13, 'left', undefined, {}, {})];
  for (let c = 1; c < N; c++) titleRow.push({ v: '', t: 's', s: { fill: { patternType: 'solid', fgColor: { rgb: XBG.DARK } }, border: {} } });
  rows.push(titleRow);

  // Subtitle row
  const subRow = [xc(subtitle, XBG.STRIPE, XFG.MUTED, false, 10, 'left', undefined, {}, {})];
  for (let c = 1; c < N; c++) subRow.push({ v: '', t: 's', s: { fill: { patternType: 'solid', fgColor: { rgb: XBG.STRIPE } }, border: {} } });
  rows.push(subRow);

  // Spacer
  rows.push(Array(N).fill({ v: '', t: 's', s: {} }));

  // Header row
  rows.push(headers.map(h => xc(h.label, XBG.NAVY, XFG.WHITE, true, 10, h.align ?? 'left', undefined, XBRD.navy, XBRD.navy)));

  // Data rows
  dataRows.forEach((row, ri) => {
    const bg = ri % 2 === 0 ? XBG.STRIPE : XBG.WHITE;
    rows.push(row.map((v, ci) =>
      moneyCols.includes(ci)
        ? xc(typeof v === 'number' ? v : 0, bg, XFG.MED, false, 10, 'right', '#,##0')
        : xc(v ?? '', bg, XFG.MED, false, 10, headers[ci]?.align ?? 'left')
    ));
  });

  // Totals row
  rows.push(totalRow.map((v, ci) =>
    totalMoneyCols.includes(ci)
      ? xc(typeof v === 'number' ? v : 0, XBG.LIGHT, XFG.DARK, true, 10, 'right', '#,##0', XBRD.navy, XBRD.navy)
      : xc(v ?? '', XBG.LIGHT, XFG.DARK, true, 10, headers[ci]?.align ?? 'left', undefined, XBRD.navy, XBRD.navy)
  ));

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = headers.map(h => ({ wch: h.width }));
  ws['!rows'] = [
    { hpt: 28 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 },
    ...dataRows.map(() => ({ hpt: 18 })),
    { hpt: 22 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: N - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: N - 1 } },
  ];
  return ws;
}

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
    const wb = XLSX.utils.book_new();
    const fmt = (d: any) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

    if (type === 'invoices') {
      const headers = [
        { label: '#',          width: 5,  align: 'center' as XAlign },
        { label: 'Número',     width: 16 },
        { label: 'Fecha',      width: 13 },
        { label: 'Cliente',    width: 38 },
        { label: 'Subtotal',   width: 18, align: 'right' as XAlign },
        { label: 'IVA',        width: 15, align: 'right' as XAlign },
        { label: 'Total',      width: 18, align: 'right' as XAlign },
        { label: 'Estado',     width: 20 },
        { label: 'DIAN',       width: 20 },
      ];
      const dataRows = data.items.map((r: any, i: number) => [
        i + 1, r.number || '', fmt(r.date), r.customer?.name ?? '',
        r.subtotal, r.taxes, r.total, r.status, r.dianStatus,
      ]);
      const last = data.items.length;
      const subtitle = last
        ? `${last} facturas | Período: ${fmt(data.items[last - 1]?.date)} – ${fmt(data.items[0]?.date)}`
        : 'Sin datos para el período seleccionado';
      XLSX.utils.book_append_sheet(wb,
        buildStyledSheet(
          'BeccaFact — Reporte de Facturación',
          subtitle, headers, dataRows, [4, 5, 6],
          ['', '', '', `Total: ${last} facturas`, data.summary.subtotal, data.summary.taxes, data.summary.total, '', ''],
          [4, 5, 6],
        ), 'Facturación');

    } else if (type === 'payroll') {
      const headers = [
        { label: '#',            width: 5,  align: 'center' as XAlign },
        { label: 'Período',      width: 12 },
        { label: 'Empleado',     width: 30 },
        { label: 'Documento',    width: 15 },
        { label: 'Tipo',         width: 22 },
        { label: 'Salario Base', width: 18, align: 'right' as XAlign },
        { label: 'Devengado',    width: 18, align: 'right' as XAlign },
        { label: 'Deducciones',  width: 18, align: 'right' as XAlign },
        { label: 'Neto a Pagar', width: 18, align: 'right' as XAlign },
        { label: 'Estado',       width: 15 },
      ];
      const dataRows = data.items.map((r: any, i: number) => [
        i + 1, r.period, r.employeeName, r.document, r.type,
        r.baseSalary, r.totalEarnings, r.totalDeductions, r.totalNet, r.status,
      ]);
      XLSX.utils.book_append_sheet(wb,
        buildStyledSheet(
          'BeccaFact — Reporte de Nómina Electrónica',
          `${data.summary.count} liquidaciones | Devengado: $${Number(data.summary.totalEarnings).toLocaleString('es-CO')} | Deducciones: $${Number(data.summary.totalDeductions).toLocaleString('es-CO')}`,
          headers, dataRows, [5, 6, 7, 8],
          ['', '', '', '', 'TOTALES', '', data.summary.totalEarnings, data.summary.totalDeductions, data.summary.totalNet, ''],
          [6, 7, 8],
        ), 'Nómina');

    } else if (type === 'pos') {
      const headers = [
        { label: '#',             width: 5,  align: 'center' as XAlign },
        { label: 'Fecha',         width: 13 },
        { label: 'Cajero',        width: 22 },
        { label: 'Estado',        width: 14 },
        { label: 'Ef. Inicial',   width: 16, align: 'right' as XAlign },
        { label: 'Ef. Final',     width: 16, align: 'right' as XAlign },
        { label: 'Total Ventas',  width: 18, align: 'right' as XAlign },
        { label: '# Ventas',      width: 12, align: 'right' as XAlign },
      ];
      const dataRows = data.items.map((r: any, i: number) => [
        i + 1, fmt(r.date), r.cashierName, r.status,
        r.openingCash, r.closingCash, r.totalSales, r.transactionCount,
      ]);
      XLSX.utils.book_append_sheet(wb,
        buildStyledSheet(
          'BeccaFact — Reporte de Punto de Venta (POS)',
          `${data.summary.sessions} sesiones | ${data.summary.transactions} transacciones | Total: $${Number(data.summary.totalSales).toLocaleString('es-CO')}`,
          headers, dataRows, [4, 5, 6],
          ['', '', '', 'TOTALES', '', '', data.summary.totalSales, data.summary.transactions],
          [6],
        ), 'POS');

    } else if (type === 'collections') {
      const headers = [
        { label: '#',             width: 5,  align: 'center' as XAlign },
        { label: 'Número',        width: 16 },
        { label: 'Cliente',       width: 38 },
        { label: 'Documento',     width: 15 },
        { label: 'F. Emisión',    width: 13 },
        { label: 'F. Vencimiento',width: 15 },
        { label: 'Días Vencido',  width: 14, align: 'right' as XAlign },
        { label: 'Total',         width: 18, align: 'right' as XAlign },
        { label: 'Antigüedad',    width: 14 },
      ];
      const dataRows = data.items.map((r: any, i: number) => [
        i + 1, r.number, r.customerName, r.customerDocument,
        fmt(r.issueDate), fmt(r.dueDate),
        r.daysOverdue > 0 ? r.daysOverdue : 0, r.total, r.aging,
      ]);
      XLSX.utils.book_append_sheet(wb,
        buildStyledSheet(
          'BeccaFact — Reporte de Cartera por Vencimiento',
          `${data.items.length} documentos | Total cartera: $${Number(data.summary.totalBalance).toLocaleString('es-CO')}`,
          headers, dataRows, [7],
          ['', '', '', '', '', 'TOTAL CARTERA', '', data.summary.totalBalance, ''],
          [7],
        ), 'Cartera');
    }

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async getDashboardXlsx(companyId: string, year: number, month: number): Promise<Buffer> {
    const [kpis, monthly] = await Promise.all([
      this.getDashboardKpis(companyId, year, month),
      this.getMonthlyRevenue(companyId, year),
    ]);

    const wb = XLSX.utils.book_new();
    const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    // ─── Hoja 1: KPIs ───────────────────────────────────────────────────
    const kpiHeaders = [
      { label: 'Indicador', width: 40 },
      { label: 'Valor del Mes', width: 22, align: 'right' as XAlign },
      { label: 'Período', width: 18 },
      { label: 'Variación', width: 16, align: 'right' as XAlign },
    ];
    const kpiRows = [
      ['Ingresos Totales (sin canceladas)', Number(kpis.revenue?.current ?? 0), `${MONTHS_ES[(month ?? 1) - 1]} ${year}`, `${Number(kpis.revenue?.change ?? 0).toFixed(1)}%`],
      ['Facturas Emitidas', Number(kpis.invoices?.current ?? 0), `${MONTHS_ES[(month ?? 1) - 1]} ${year}`, `vs ${kpis.invoices?.previous ?? 0} mes ant.`],
      ['IVA Generado', Number(kpis.taxes?.current ?? 0), `${MONTHS_ES[(month ?? 1) - 1]} ${year}`, ''],
      ['Clientes Activos', Number((kpis as any).activeCustomers ?? 0), 'Total acumulado', ''],
      ['Catálogo Activo', Number((kpis as any).activeCatalog ?? 0), 'Productos activos', ''],
      ['Bajo Stock', Number((kpis as any).productCount ?? 0), 'Productos en alerta', ''],
    ];
    XLSX.utils.book_append_sheet(wb,
      buildStyledSheet(
        `BeccaFact — Dashboard ${MONTHS_ES[(month ?? 1) - 1]} ${year}`,
        'Indicadores clave de rendimiento del período seleccionado',
        kpiHeaders, kpiRows, [1],
        ['', '', '', ''],
        [],
      ), 'KPIs');

    // ─── Hoja 2: Ingresos mensuales ──────────────────────────────────────
    const monthlyHeaders = [
      { label: 'Mes',         width: 16 },
      { label: 'Año',         width: 8,  align: 'center' as XAlign },
      { label: 'Ingresos',    width: 22, align: 'right' as XAlign },
      { label: 'IVA',         width: 18, align: 'right' as XAlign },
      { label: '# Facturas',  width: 14, align: 'right' as XAlign },
    ];
    const monthlyRows = monthly.map((m: any) => [
      MONTHS_ES[m.month - 1], m.year, Number(m.revenue), Number(m.taxes), m.invoiceCount,
    ]);
    const totRevenue = monthly.reduce((s: number, m: any) => s + Number(m.revenue), 0);
    const totTax = monthly.reduce((s: number, m: any) => s + Number(m.taxes), 0);
    const totInv = monthly.reduce((s: number, m: any) => s + m.invoiceCount, 0);
    XLSX.utils.book_append_sheet(wb,
      buildStyledSheet(
        `BeccaFact — Ingresos Mensuales ${year}`,
        `Resumen de ventas e impuestos para el año ${year}`,
        monthlyHeaders, monthlyRows, [2, 3],
        ['TOTAL ANUAL', year, totRevenue, totTax, totInv],
        [2, 3],
      ), 'Ingresos Mensuales');

    // ─── Hoja 3: Top Clientes ────────────────────────────────────────────
    if ((kpis as any).topCustomers?.length) {
      const custHeaders = [
        { label: '#',          width: 5,  align: 'center' as XAlign },
        { label: 'Cliente',    width: 40 },
        { label: 'Ingresos',   width: 22, align: 'right' as XAlign },
        { label: '# Facturas', width: 14, align: 'right' as XAlign },
      ];
      const custRows = (kpis as any).topCustomers.map((c: any, i: number) => [
        i + 1, c.name ?? '', Number(c.revenue ?? 0), c.invoiceCount ?? 0,
      ]);
      XLSX.utils.book_append_sheet(wb,
        buildStyledSheet(
          `BeccaFact — Top Clientes ${MONTHS_ES[(month ?? 1) - 1]} ${year}`,
          'Clientes con mayor facturación en el período',
          custHeaders, custRows, [2],
          ['', '', '', ''],
          [],
        ), 'Top Clientes');
    }

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
