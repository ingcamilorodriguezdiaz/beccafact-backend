import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private companiesService: CompaniesService,
  ) {}

  async findAll(
    companyId: string,
    filters: {
      search?: string;
      status?: string;
      type?: string;
      from?: string;
      to?: string;
      customerId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, type, from, to, customerId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (status) where.status = status;
    if (type) where.type = type;
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.issueDate = {};
      if (from) where.issueDate.gte = new Date(from);
      if (to) where.issueDate.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          _count: { select: { items: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    return invoice;
  }

  async create(companyId: string, dto: CreateInvoiceDto) {
    // Check monthly document limit
    const canCreate = await this.companiesService.checkLimit(companyId, 'max_documents_per_month');
    if (!canCreate) {
      throw new ForbiddenException(
        'Has alcanzado el límite mensual de documentos. Actualiza tu plan.',
      );
    }

    // Verify customer belongs to company
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    // Calculate totals
    let subtotal = 0;
    let taxAmount = 0;
    const itemsWithTotals = dto.items.map((item, index) => {
      const lineSubtotal = Number(item.quantity) * Number(item.unitPrice);
      const discount = lineSubtotal * (Number(item.discount ?? 0) / 100);
      const lineAfterDiscount = lineSubtotal - discount;
      const lineTax = lineAfterDiscount * (Number(item.taxRate ?? 19) / 100);
      const lineTotal = lineAfterDiscount + lineTax;
      subtotal += lineAfterDiscount;
      taxAmount += lineTax;
      return {
        productId: item.productId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 19,
        taxAmount: lineTax,
        discount: item.discount ?? 0,
        total: lineTotal,
        position: index + 1,
      };
    });

    const total = subtotal + taxAmount;

    // Get next invoice number
    const invoiceNumber = await this.getNextInvoiceNumber(companyId, dto.prefix ?? 'FV');

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId,
        customerId: dto.customerId,
        invoiceNumber,
        prefix: dto.prefix ?? 'FV',
        type: dto.type ?? 'VENTA',
        status: dto.isDraft ? 'DRAFT' : 'DRAFT',
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        subtotal,
        taxAmount,
        discountAmount: dto.discountAmount ?? 0,
        total,
        notes: dto.notes,
        currency: dto.currency ?? 'COP',
        items: { create: itemsWithTotals },
      },
      include: {
        customer: true,
        items: true,
      },
    });

    // Increment usage counter
    await this.companiesService.incrementUsage(companyId, 'max_documents_per_month');

    return invoice;
  }

  async sendToDian(companyId: string, invoiceId: string) {
    const invoice = await this.findOne(companyId, invoiceId);

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden enviar facturas en estado DRAFT');
    }

    // Here you would integrate with your authorized DIAN provider
    // (Gosocket, Siigo, Factus, etc.)
    // This is a placeholder for the DIAN API call
    const dianResponse = await this.callDianApi(invoice);

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: dianResponse.accepted ? 'ACCEPTED_DIAN' : 'REJECTED_DIAN',
        dianCufe: dianResponse.cufe,
        dianQrCode: dianResponse.qrCode,
        dianStatus: dianResponse.status,
        dianSentAt: new Date(),
        dianResponseAt: new Date(),
      },
    });
  }

  async cancel(companyId: string, invoiceId: string, reason: string) {
    const invoice = await this.findOne(companyId, invoiceId);
    if (['CANCELLED', 'PAID'].includes(invoice.status)) {
      throw new BadRequestException('Esta factura no puede cancelarse');
    }
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED', notes: `${invoice.notes ?? ''}\n[CANCELADA]: ${reason}` },
    });
  }

  async markAsPaid(companyId: string, invoiceId: string) {
    const invoice = await this.findOne(companyId, invoiceId);
    if (invoice.status === 'PAID') throw new BadRequestException('La factura ya está pagada');
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID' },
    });
  }

  async getSummary(companyId: string, from: string, to: string) {
    const where: any = {
      companyId,
      deletedAt: null,
      issueDate: { gte: new Date(from), lte: new Date(to) },
    };

    const [invoices, byStatus, byType] = await Promise.all([
      this.prisma.invoice.aggregate({
        where,
        _sum: { total: true, taxAmount: true, subtotal: true },
        _count: { id: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['type'],
        where,
        _count: { id: true },
        _sum: { total: true },
      }),
    ]);

    return {
      totals: {
        count: invoices._count.id,
        total: invoices._sum.total ?? 0,
        subtotal: invoices._sum.subtotal ?? 0,
        taxAmount: invoices._sum.taxAmount ?? 0,
      },
      byStatus,
      byType,
    };
  }

  private async getNextInvoiceNumber(companyId: string, prefix: string): Promise<string> {
    const last = await this.prisma.invoice.findFirst({
      where: { companyId, prefix, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    if (!last) return `${prefix}-0001`;

    const parts = last.invoiceNumber.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0') + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
  }

  private async callDianApi(invoice: any): Promise<any> {
    // In production: integrate with Gosocket, Factus, or any DIAN-authorized provider
    // Return mock for development
    return {
      accepted: true,
      cufe: `CUFE-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      qrCode: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=MOCK`,
      status: 'ACEPTADO',
    };
  }
}
