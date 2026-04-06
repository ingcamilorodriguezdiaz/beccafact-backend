import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { PrismaService } from '../config/prisma.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';

// Estados que permiten modificaciones (editar, eliminar)
const MUTABLE_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT'];

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Genera el siguiente número de cotización para la empresa
  // Formato: COT-{NNNN} (ej: COT-0001, COT-0042)
  // ─────────────────────────────────────────────────────────────────────────────
  private async getNextQuoteNumber(companyId: string): Promise<string> {
    const last = await this.prisma.quote.findFirst({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    if (!last) return 'COT-0001';

    // Extrae el número del formato COT-NNNN y suma 1
    const parts = last.number.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0', 10) + 1;
    return `COT-${String(num).padStart(4, '0')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Genera el siguiente número de factura para conversión
  // Formato: FV-{NNNN} — busca el último número con prefix='FV' de la empresa
  // ─────────────────────────────────────────────────────────────────────────────
  private async getNextInvoiceNumber(companyId: string, prefix: string): Promise<string> {
    const last = await this.prisma.invoice.findFirst({
      where: { companyId, prefix, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });

    if (!last) return `${prefix}-0001`;

    // Extrae el número del formato PREFIX-NNNN y suma 1
    const parts = last.invoiceNumber.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0', 10) + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Calcula los totales de los ítems de la cotización
  // lineTotal  = quantity * unitPrice * (1 - discount/100)
  // lineTax    = lineTotal * taxRate / 100
  // subtotal   = sum(lineTotal)
  // taxAmount  = sum(lineTax)
  // total      = subtotal + taxAmount - discountAmount
  // ─────────────────────────────────────────────────────────────────────────────
  private calculateTotals(
    items: CreateQuoteDto['items'],
    discountAmount = 0,
  ): {
    itemsWithTotals: any[];
    subtotal: number;
    taxAmount: number;
    total: number;
  } {
    let subtotal = 0;
    let taxAmount = 0;

    const itemsWithTotals = items.map((item, index) => {
      const qty = Number(item.quantity);
      const price = Number(item.unitPrice);
      const discount = Number(item.discount ?? 0);
      const taxRate = Number(item.taxRate ?? 19);

      // Total neto de la línea después de descuento
      const lineTotal = qty * price * (1 - discount / 100);
      // Impuesto de la línea
      const lineTax = lineTotal * (taxRate / 100);

      subtotal += lineTotal;
      taxAmount += lineTax;

      return {
        description: item.description,
        quantity: qty,
        unitPrice: price,
        taxRate: taxRate,
        taxAmount: lineTax,
        discount: discount,
        total: lineTotal + lineTax,
        position: item.position ?? index + 1,
        ...(item.productId && { product: { connect: { id: item.productId } } }),
      };
    });

    const total = subtotal + taxAmount - Number(discountAmount);

    return { itemsWithTotals, subtotal, taxAmount, total };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LISTAR cotizaciones con filtros y paginación
  // ─────────────────────────────────────────────────────────────────────────────
  async findAll(
    companyId: string,
    filters: {
      search?: string;
      status?: string;
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, customerId, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = { companyId, deletedAt: null };

    // Filtro por búsqueda en número de cotización o nombre de cliente
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    // Filtro por rango de fechas de emisión
    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.quote.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          _count: { select: { items: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take: +limit,
      }),
      this.prisma.quote.count({ where }),
    ]);

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DETALLE de cotización con ítems, cliente e invoice asociada (si fue convertida)
  // ─────────────────────────────────────────────────────────────────────────────
  async findOne(companyId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: true,
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
          orderBy: { position: 'asc' },
        },
        // Incluye la factura si la cotización fue convertida
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            issueDate: true,
          },
        },
      },
    });

    if (!quote) throw new NotFoundException('Cotización no encontrada');
    return quote;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CREAR cotización — genera número automático y calcula totales
  // ─────────────────────────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateQuoteDto) {
    // Validar que el cliente existe y pertenece a la empresa
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const number = await this.getNextQuoteNumber(companyId);
    const { itemsWithTotals, subtotal, taxAmount, total } = this.calculateTotals(
      dto.items,
      dto.discountAmount ?? 0,
    );

    return this.prisma.quote.create({
      data: {
        companyId,
        customerId: dto.customerId,
        number,
        status: 'DRAFT',
        issueDate: new Date(dto.issueDate),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        subtotal,
        taxAmount,
        discountAmount: dto.discountAmount ?? 0,
        total,
        notes: dto.notes,
        terms: dto.terms,
        currency: dto.currency ?? 'COP',
        items: { create: itemsWithTotals },
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        items: { orderBy: { position: 'asc' } },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ACTUALIZAR cotización — solo permite modificar estados DRAFT o SENT
  // ─────────────────────────────────────────────────────────────────────────────
  async update(companyId: string, id: string, dto: UpdateQuoteDto) {
    const quote = await this.findOne(companyId, id);

    if (!MUTABLE_STATUSES.includes(quote.status as QuoteStatus)) {
      throw new BadRequestException(
        `Solo se pueden modificar cotizaciones en estado DRAFT o SENT. Estado actual: ${quote.status}`,
      );
    }

    // Si se actualizan ítems, recalcular totales y reemplazar los ítems existentes
    let totalsData: Partial<{
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      total: number;
    }> = {};
    let itemsOperation: any = {};

    if (dto.items && dto.items.length > 0) {
      const { itemsWithTotals, subtotal, taxAmount, total } = this.calculateTotals(
        dto.items,
        dto.discountAmount ?? Number(quote.discountAmount) ?? 0,
      );
      totalsData = { subtotal, taxAmount, total };

      // Eliminar ítems existentes y crear los nuevos
      itemsOperation = {
        items: {
          deleteMany: { quoteId: id },
          create: itemsWithTotals,
        },
      };
    } else if (dto.discountAmount !== undefined) {
      // Recalcular solo el total si cambió el descuento global sin nuevos ítems
      const currentSubtotal = Number(quote.subtotal);
      const currentTax = Number(quote.taxAmount);
      totalsData = {
        discountAmount: dto.discountAmount,
        total: currentSubtotal + currentTax - dto.discountAmount,
      };
    }

    // Excluir 'items' del spread del dto para no pasarlo directamente a Prisma
    const { items, ...dtoWithoutItems } = dto;

    return this.prisma.quote.update({
      where: { id },
      data: {
        ...dtoWithoutItems,
        ...(dto.issueDate && { issueDate: new Date(dto.issueDate) }),
        ...(dto.expiresAt && { expiresAt: new Date(dto.expiresAt) }),
        ...totalsData,
        ...itemsOperation,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        items: { orderBy: { position: 'asc' } },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CAMBIAR ESTADO — no permite asignar CONVERTED manualmente
  // ─────────────────────────────────────────────────────────────────────────────
  async updateStatus(companyId: string, id: string, status: QuoteStatus) {
    await this.findOne(companyId, id);

    // CONVERTED solo se puede asignar mediante el endpoint de conversión
    if (status === 'CONVERTED') {
      throw new BadRequestException(
        'El estado CONVERTED no puede asignarse manualmente. Use el endpoint /convert.',
      );
    }

    return this.prisma.quote.update({
      where: { id },
      data: { status },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERTIR cotización a factura
  // - Crea una Invoice tipo VENTA con los mismos ítems
  // - Asigna Quote.invoiceId = invoice.id y Quote.status = CONVERTED
  // - Lanza ConflictException si la cotización ya fue convertida
  // ─────────────────────────────────────────────────────────────────────────────
  async convertToInvoice(companyId: string, id: string) {
    const quote = await this.findOne(companyId, id);

    // Verificar que no haya sido convertida previamente
    if (quote.invoiceId) {
      throw new ConflictException(
        `La cotización ya fue convertida a la factura ${quote.invoice?.invoiceNumber ?? quote.invoiceId}`,
      );
    }

    if (quote.status === 'CONVERTED') {
      throw new ConflictException('Esta cotización ya fue convertida a factura.');
    }

    // Construir ítems para la factura copiando desde los ítems de la cotización
    const invoiceItems = (quote.items as any[]).map((item: any) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxRate: Number(item.taxRate),
      taxAmount: Number(item.taxAmount),
      discount: Number(item.discount),
      total: Number(item.total),
      position: item.position,
      ...(item.productId && { product: { connect: { id: item.productId } } }),
    }));

    const invoiceNumber = await this.getNextInvoiceNumber(companyId, 'FV');
    const prefix = 'FV';

    // Crear la factura y actualizar la cotización en una transacción atómica
    const [invoice] = await this.prisma.$transaction([
      // 1. Crear la factura con los ítems copiados
      this.prisma.invoice.create({
        data: {
          companyId,
          customerId: quote.customerId,
          invoiceNumber,
          prefix,
          type: 'VENTA',
          status: 'DRAFT',
          issueDate: new Date(),
          subtotal: Number(quote.subtotal),
          taxAmount: Number(quote.taxAmount),
          discountAmount: Number(quote.discountAmount),
          total: Number(quote.total),
          currency: quote.currency,
          notes: quote.notes,
          items: { create: invoiceItems },
        },
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          items: { orderBy: { position: 'asc' } },
        },
      }),
      // 2. Marcar la cotización como CONVERTED (invoiceId se asigna después de crear la invoice)
      // Se actualiza en el paso posterior por necesitar el ID generado
    ]);

    // 3. Asignar el invoiceId y estado CONVERTED a la cotización
    await this.prisma.quote.update({
      where: { id },
      data: {
        invoiceId: invoice.id,
        status: 'CONVERTED',
      },
    });

    return invoice;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ELIMINAR cotización — soft-delete, solo permite DRAFT
  // ─────────────────────────────────────────────────────────────────────────────
  async remove(companyId: string, id: string) {
    const quote = await this.findOne(companyId, id);

    if (quote.status !== 'DRAFT') {
      throw new ForbiddenException(
        `Solo se pueden eliminar cotizaciones en estado DRAFT. Estado actual: ${quote.status}`,
      );
    }

    return this.prisma.quote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
