import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { RegisterPaymentDto } from './dto/register-payment.dto';

export type CarteraStatus = 'AL_DIA' | 'POR_VENCER' | 'VENCIDA' | 'EN_MORA';

@Injectable()
export class CarteraService {
  constructor(private prisma: PrismaService) {}

  // ── Dashboard de cartera ──────────────────────────────────────────────────

  async getDashboard(companyId: string, branchId?: string) {
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);

    const where: any = {
      companyId,
      deletedAt: null,
      status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
    };
    if (branchId) where.branchId = branchId;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true } },
      },
    });

    let totalCartera = 0;
    let totalOverdue = 0;
    let totalDueSoon = 0;
    let totalCurrent = 0;

    // Aging buckets: 0-30, 31-60, 61-90, >90
    const aging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };

    for (const inv of invoices) {
      const amount = Number(inv.total);
      totalCartera += amount;

      if (!inv.dueDate) {
        totalCurrent += amount;
        aging.current += amount;
      } else {
        const due = new Date(inv.dueDate);
        const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);

        if (due < today) {
          totalOverdue += amount;
          if (daysOverdue <= 30) aging.days30 += amount;
          else if (daysOverdue <= 60) aging.days60 += amount;
          else if (daysOverdue <= 90) aging.days90 += amount;
          else aging.over90 += amount;
        } else if (due <= in30Days) {
          totalDueSoon += amount;
          aging.current += amount;
        } else {
          totalCurrent += amount;
          aging.current += amount;
        }
      }
    }

    const clientesEnMora = new Set(
      invoices
        .filter((i) => i.dueDate && new Date(i.dueDate) < today)
        .map((i) => i.customerId),
    ).size;

    return {
      summary: {
        totalCartera,
        totalOverdue,
        totalDueSoon,
        totalCurrent,
        totalInvoices: invoices.length,
        clientesEnMora,
      },
      aging,
    };
  }

  // ── Listado de cartera (facturas pendientes de cobro) ────────────────────

  async findAll(
    companyId: string,
    filters: {
      branchId:string;
      search?: string;
      status?: string;
      customerId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, customerId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const today = new Date();

    const where: any = {
      companyId,
      deletedAt: null,
      status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE', 'PAID'] },
    };

     if (filters.branchId) {
      where.branchId = filters.branchId;
    }


    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { documentNumber: { contains: search } } },
      ];
    }

    if (customerId) where.customerId = customerId;

    // Filtro por estado de cartera
    if (status === 'VENCIDA') {
      where.dueDate = { lt: today };
      where.status = { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] };
    } else if (status === 'EN_MORA') {
      const in60DaysAgo = new Date(today);
      in60DaysAgo.setDate(in60DaysAgo.getDate() - 60);
      where.dueDate = { lt: in60DaysAgo };
      where.status = { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] };
    } else if (status === 'POR_VENCER') {
      const in30 = new Date(today);
      in30.setDate(in30.getDate() + 30);
      where.dueDate = { gte: today, lte: in30 };
      where.status = { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] };
    } else if (status === 'AL_DIA') {
      const in30 = new Date(today);
      in30.setDate(in30.getDate() + 30);
      where.dueDate = { gt: in30 };
    } else if (status === 'PAGADA') {
      where.status = 'PAID';
    }

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true, name: true, documentNumber: true, documentType: true,
              email: true, phone: true, city: true, creditLimit: true, creditDays: true,
            },
          },
          payments: {
            select: { amount: true },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const enriched = data.map((inv) => {
      const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      const balance = Math.max(0, Number(inv.total) - paid);
      return {
        ...inv,
        payments: undefined,
        carteraStatus: this.calcStatus(inv.dueDate, inv.status),
        daysOverdue: inv.dueDate
          ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
          : null,
        balance,
        paidAmount: paid,
      };
    });

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Cartera por cliente ──────────────────────────────────────────────────

  async getClienteCartera(companyId: string,branchId:string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const today = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        customerId,
        branchId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE', 'PAID'] },
      },
      include: {
        payments: { select: { amount: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const pending = invoices.filter((i) => i.status !== 'PAID');
    const paid    = invoices.filter((i) => i.status === 'PAID');

    const balancePending = pending.reduce((s, i) => s + Number(i.total), 0);
    const balanceOverdue = pending
      .filter((i) => i.dueDate && new Date(i.dueDate) < today)
      .reduce((s, i) => s + Number(i.total), 0);

    return {
      customer,
      summary: {
        balancePending,
        balanceOverdue,
        totalInvoices: invoices.length,
        invoicesPending: pending.length,
        invoicesPaid: paid.length,
      },
      invoices: invoices.map((inv) => {
        const paidAmt = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
        return {
          ...inv,
          payments: undefined,
          carteraStatus: this.calcStatus(inv.dueDate, inv.status),
          daysOverdue: inv.dueDate
            ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
            : null,
          balance: Math.max(0, Number(inv.total) - paidAmt),
          paidAmount: paidAmt,
        };
      }),
    };
  }

  // ── Registrar pago ────────────────────────────────────────────────────────

  async registrarPago(
    companyId: string,
    invoiceId: string,
    dto: RegisterPaymentDto,
    userId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === 'PAID')      throw new BadRequestException('La factura ya está pagada');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('La factura está cancelada');

    const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
    const balance   = Number(invoice.total) - totalPaid;

    if (dto.amount > balance + 0.01) {
      throw new BadRequestException(
        `El monto ($${dto.amount.toFixed(2)}) supera el saldo pendiente ($${balance.toFixed(2)})`,
      );
    }

    const newBalance = balance - dto.amount;
    const markAsPaid = newBalance <= 0.01;

    const [payment] = await this.prisma.$transaction([
      this.prisma.carteraPayment.create({
        data: {
          companyId,
          invoiceId,
          userId,
          amount:        dto.amount,
          paymentMethod: dto.paymentMethod,
          reference:     dto.reference,
          notes:         dto.notes,
          paymentDate:   new Date(dto.paymentDate),
        },
      }),
      ...(markAsPaid
        ? [this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } })]
        : []),
      this.prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action:     'PAYMENT_REGISTERED',
          resource:   'cartera',
          resourceId: invoiceId,
          after: {
            amount:        dto.amount,
            paymentDate:   dto.paymentDate,
            paymentMethod: dto.paymentMethod,
            reference:     dto.reference,
            invoiceNumber: invoice.invoiceNumber,
            markedPaid:    markAsPaid,
            remainingBalance: newBalance > 0 ? newBalance : 0,
          },
        },
      }),
    ]);

    return {
      payment,
      invoice: {
        id:            invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total:         Number(invoice.total),
        paidAmount:    totalPaid + dto.amount,
        balance:       Math.max(0, newBalance),
        status:        markAsPaid ? 'PAID' : invoice.status,
        customer:      invoice.customer,
      },
    };
  }

  // ── Historial de pagos de una factura ─────────────────────────────────────

  async getPaymentHistory(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    const payments = await this.prisma.carteraPayment.findMany({
      where: { invoiceId, companyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { paymentDate: 'desc' },
    });

    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

    return {
      invoice: {
        id:            invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total:         Number(invoice.total),
        status:        invoice.status,
        dueDate:       invoice.dueDate,
        customer:      invoice.customer,
        paidAmount:    totalPaid,
        balance:       Math.max(0, Number(invoice.total) - totalPaid),
      },
      payments: payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
    };
  }

  // ── Informe de aging (antigüedad de saldos) ──────────────────────────────

  async getAgingReport(companyId: string, branchId?: string) {
    const today = new Date();
    const where: any = {
      companyId,
      deletedAt: null,
      status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
    };
    if (branchId) where.branchId = branchId;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        payments: { select: { amount: true } },
      },
    });

    // Group by customer
    const byCustomer: Record<string, {
      customer: any;
      current: number;
      days30: number;
      days60: number;
      days90: number;
      over90: number;
      total: number;
    }> = {};

    for (const inv of invoices) {
      const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
      const balance = Math.max(0, Number(inv.total) - paid);
      if (balance === 0) continue;

      const cId = inv.customerId;
      if (!byCustomer[cId]) {
        byCustomer[cId] = {
          customer: inv.customer,
          current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0,
        };
      }
      byCustomer[cId].total += balance;

      if (!inv.dueDate || new Date(inv.dueDate) >= today) {
        byCustomer[cId].current += balance;
      } else {
        const daysLate = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
        if (daysLate <= 30)       byCustomer[cId].days30 += balance;
        else if (daysLate <= 60)  byCustomer[cId].days60 += balance;
        else if (daysLate <= 90)  byCustomer[cId].days90 += balance;
        else                      byCustomer[cId].over90 += balance;
      }
    }

    const rows = Object.values(byCustomer).sort((a, b) => b.total - a.total);

    const totals = rows.reduce(
      (acc, r) => {
        acc.current += r.current;
        acc.days30  += r.days30;
        acc.days60  += r.days60;
        acc.days90  += r.days90;
        acc.over90  += r.over90;
        acc.total   += r.total;
        return acc;
      },
      { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 },
    );

    return { rows, totals };
  }

  // ── Enviar recordatorio ──────────────────────────────────────────────────

  async sendReminder(companyId: string, invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: { customer: true },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action:     'REMINDER_SENT',
        resource:   'cartera',
        resourceId: invoiceId,
        after: { customerEmail: invoice.customer.email, invoiceNumber: invoice.invoiceNumber },
      },
    });

    return { message: `Recordatorio enviado a ${invoice.customer.email ?? invoice.customer.name}` };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private calcStatus(dueDate: Date | null, invoiceStatus: string): CarteraStatus {
    if (invoiceStatus === 'PAID') return 'AL_DIA';
    if (!dueDate) return 'AL_DIA';
    const today = new Date();
    const due   = new Date(dueDate);
    const in30  = new Date(today);
    in30.setDate(in30.getDate() + 30);

    const daysLate = Math.floor((today.getTime() - due.getTime()) / 86400000);

    if (due < today && daysLate > 60) return 'EN_MORA';
    if (due < today) return 'VENCIDA';
    if (due <= in30)  return 'POR_VENCER';
    return 'AL_DIA';
  }
}
