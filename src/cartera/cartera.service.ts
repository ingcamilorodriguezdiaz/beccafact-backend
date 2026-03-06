import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

export type CarteraStatus = 'AL_DIA' | 'POR_VENCER' | 'VENCIDA' | 'EN_MORA';

@Injectable()
export class CarteraService {
  constructor(private prisma: PrismaService) {}

  // ── Dashboard de cartera ────────────────────────────────────────────────────

  async getDashboard(companyId: string) {
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true } },
      },
    });

    let totalCartera = 0;
    let totalVencido = 0;
    let totalPorVencer = 0;
    let totalAlDia = 0;

    for (const inv of invoices) {
      const saldo = Number(inv.total);
      totalCartera += saldo;

      if (!inv.dueDate) {
        totalAlDia += saldo;
      } else if (new Date(inv.dueDate) < today) {
        totalVencido += saldo;
      } else if (new Date(inv.dueDate) <= in30Days) {
        totalPorVencer += saldo;
      } else {
        totalAlDia += saldo;
      }
    }

    const clientesEnMora = new Set(
      invoices
        .filter((i) => i.dueDate && new Date(i.dueDate) < today)
        .map((i) => i.customerId),
    ).size;

    return {
      resumen: {
        totalCartera,
        totalVencido,
        totalPorVencer,
        totalAlDia,
        totalFacturas: invoices.length,
        clientesEnMora,
      },
    };
  }

  // ── Listado de cartera (facturas pendientes de cobro) ──────────────────────

  async findAll(
    companyId: string,
    filters: {
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
    } else if (status === 'POR_VENCER') {
      const in30 = new Date(today);
      in30.setDate(in30.getDate() + 30);
      where.dueDate = { gte: today, lte: in30 };
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
        },
        orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const enriched = data.map((inv) => ({
      ...inv,
      carteraStatus: this.calcStatus(inv.dueDate, inv.status),
      diasVencimiento: inv.dueDate
        ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
        : null,
      saldo: Number(inv.total),
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Cartera por cliente ─────────────────────────────────────────────────────

  async getClienteCartera(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const today = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        customerId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE', 'PAID'] },
      },
      orderBy: { dueDate: 'asc' },
    });

    const pendientes = invoices.filter((i) => i.status !== 'PAID');
    const pagadas = invoices.filter((i) => i.status === 'PAID');

    const saldoPendiente = pendientes.reduce((s, i) => s + Number(i.total), 0);
    const saldoVencido = pendientes
      .filter((i) => i.dueDate && new Date(i.dueDate) < today)
      .reduce((s, i) => s + Number(i.total), 0);

    return {
      customer,
      resumen: {
        saldoPendiente,
        saldoVencido,
        totalFacturas: invoices.length,
        facturasPendientes: pendientes.length,
        facturasPagadas: pagadas.length,
      },
      facturas: invoices.map((inv) => ({
        ...inv,
        carteraStatus: this.calcStatus(inv.dueDate, inv.status),
        diasVencimiento: inv.dueDate
          ? Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
          : null,
      })),
    };
  }

  // ── Registrar pago ──────────────────────────────────────────────────────────

  async registrarPago(
    companyId: string,
    invoiceId: string,
    dto: { monto: number; fecha: string; medioPago: string; referencia?: string; notas?: string },
    userId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === 'PAID') throw new BadRequestException('La factura ya está pagada');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('La factura está cancelada');

    // Marcar como pagada
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', updatedAt: new Date() },
      include: {
        customer: { select: { id: true, name: true } },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYMENT_REGISTERED',
        resource: 'cartera',
        resourceId: invoiceId,
        after: {
          monto: dto.monto,
          fecha: dto.fecha,
          medioPago: dto.medioPago,
          referencia: dto.referencia,
          notas: dto.notas,
          invoiceNumber: invoice.invoiceNumber,
        },
      },
    });

    return updated;
  }

  // ── Gestión de cobros (enviar recordatorio) — solo ADMIN/MANAGER ───────────

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
        action: 'REMINDER_SENT',
        resource: 'cartera',
        resourceId: invoiceId,
        after: { customerEmail: invoice.customer.email, invoiceNumber: invoice.invoiceNumber },
      },
    });

    return { message: `Recordatorio enviado a ${invoice.customer.email ?? invoice.customer.name}` };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private calcStatus(dueDate: Date | null, invoiceStatus: string): CarteraStatus {
    if (invoiceStatus === 'PAID') return 'AL_DIA';
    if (!dueDate) return 'AL_DIA';
    const today = new Date();
    const due = new Date(dueDate);
    const in30 = new Date(today);
    in30.setDate(in30.getDate() + 30);

    const diasVencido = Math.floor((today.getTime() - due.getTime()) / 86400000);

    if (due < today && diasVencido > 60) return 'EN_MORA';
    if (due < today) return 'VENCIDA';
    if (due <= in30) return 'POR_VENCER';
    return 'AL_DIA';
  }
}
