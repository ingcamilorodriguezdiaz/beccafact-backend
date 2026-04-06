import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { QuoteStatus } from '@prisma/client';
import { PrismaService } from '../config/prisma.service';
import { MailerService } from '../common/mailer/mailer.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';

// Estados que permiten modificaciones (editar, eliminar)
const MUTABLE_STATUSES: QuoteStatus[] = ['DRAFT', 'SENT'];

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

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
  // CAMBIAR ESTADO — no permite asignar CONVERTED manualmente.
  // Cuando pasa a SENT, genera PDF y envía email al cliente si tiene email.
  // ─────────────────────────────────────────────────────────────────────────────
  async updateStatus(companyId: string, id: string, status: QuoteStatus) {
    const quote = await this.findOne(companyId, id);

    // CONVERTED solo se puede asignar mediante el endpoint de conversión
    if (status === 'CONVERTED') {
      throw new BadRequestException(
        'El estado CONVERTED no puede asignarse manualmente. Use el endpoint /convert.',
      );
    }

    const updated = await this.prisma.quote.update({
      where: { id },
      data: { status },
    });

    // Enviar email con PDF cuando el estado pasa a SENT
    if (status === 'SENT') {
      const customerEmail = (quote.customer as any)?.email;
      if (customerEmail) {
        try {
          const pdfBuffer = await this.generatePdf(companyId, id);
          await this.mailer.sendQuoteEmail(
            customerEmail,
            quote.number,
            (quote.customer as any)?.name ?? 'Cliente',
            pdfBuffer,
          );
          this.logger.log(`Email enviado para cotización ${quote.number} a ${customerEmail}`);
        } catch (err) {
          this.logger.error(
            `Error al enviar email para cotización ${quote.number}: ${(err as Error).message}`,
          );
          // No fallar el flujo principal por error de email
        }
      }
    }

    return updated;
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

  // ─────────────────────────────────────────────────────────────────────────────
  // GENERAR PDF — Genera un PDF real de la cotización usando coordenadas raw PDF
  // Mismo formato visual que las facturas (buildInvoicePdfBuffer en invoices.service)
  // ─────────────────────────────────────────────────────────────────────────────
  async generatePdf(companyId: string, quoteId: string): Promise<Buffer> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, companyId, deletedAt: null },
      include: {
        customer: true,
        items: { orderBy: { position: 'asc' } },
      },
    });
    if (!quote) throw new NotFoundException('Cotización no encontrada');

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 34;
    const topMargin = 36;
    const bottomMargin = 36;
    const contentWidth = pageWidth - marginX * 2;

    const colors = {
      navy:    [19, 52, 99]    as [number, number, number],
      blue:    [36, 99, 235]   as [number, number, number],
      slate:   [71, 85, 105]   as [number, number, number],
      text:    [15, 23, 42]    as [number, number, number],
      muted:   [100, 116, 139] as [number, number, number],
      line:    [203, 213, 225] as [number, number, number],
      soft:    [241, 245, 249] as [number, number, number],
      greenBg: [220, 252, 231] as [number, number, number],
      greenText: [22, 101, 52] as [number, number, number],
      amberBg: [254, 243, 199] as [number, number, number],
      amberText: [146, 64, 14] as [number, number, number],
      redBg:   [254, 226, 226] as [number, number, number],
      redText: [153, 27, 27]   as [number, number, number],
      white:   [255, 255, 255] as [number, number, number],
      black:   [0, 0, 0]       as [number, number, number],
    };

    const fmtCOP = (v: any) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(v ?? 0));
    const fmtDate = (d: any) =>
      d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

    const statusLabel = (s: string) =>
      ({ DRAFT: 'BORRADOR', SENT: 'ENVIADA', ACCEPTED: 'ACEPTADA', REJECTED: 'RECHAZADA', EXPIRED: 'VENCIDA', CONVERTED: 'CONVERTIDA' }[s] ?? s ?? '-');

    const statusStyle = (status: string) => {
      if (status === 'ACCEPTED' || status === 'CONVERTED') return { bg: colors.greenBg, text: colors.greenText };
      if (status === 'DRAFT' || status === 'SENT') return { bg: colors.amberBg, text: colors.amberText };
      if (status === 'REJECTED' || status === 'EXPIRED') return { bg: colors.redBg, text: colors.redText };
      return { bg: colors.soft, text: colors.text };
    };

    const normalizeText = (value: any) =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const pdfSafe = (value: any) =>
      normalizeText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

    const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56;

    const wrapText = (text: any, maxWidth: number, fontSize: number) => {
      const normalized = normalizeText(text);
      if (!normalized) return ['-'];
      const words = normalized.split(' ');
      const lines: string[] = [];
      let current = '';
      const splitLongToken = (token: string) => {
        const parts: string[] = [];
        let chunk = '';
        for (const char of token) {
          const candidate = `${chunk}${char}`;
          if (chunk && estimateTextWidth(candidate, fontSize) > maxWidth) {
            parts.push(chunk);
            chunk = char;
          } else {
            chunk = candidate;
          }
        }
        if (chunk) parts.push(chunk);
        return parts;
      };
      for (const word of words) {
        if (estimateTextWidth(word, fontSize) > maxWidth) {
          if (current) { lines.push(current); current = ''; }
          lines.push(...splitLongToken(word));
          continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : ['-'];
    };

    const pages: Array<{ content: string; annots: string[] }> = [];
    let commands: string[] = [];
    let annotations: string[] = [];
    let y = topMargin;

    const toPdfY = (topY: number) => pageHeight - topY;
    const pushPage = () => {
      if (commands.length || annotations.length) pages.push({ content: commands.join('\n'), annots: [...annotations] });
      commands = [];
      annotations = [];
      y = topMargin;
    };
    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - bottomMargin) return;
      pushPage();
    };
    const setFill   = (rgb: [number, number, number]) => commands.push(`${(rgb[0]/255).toFixed(3)} ${(rgb[1]/255).toFixed(3)} ${(rgb[2]/255).toFixed(3)} rg`);
    const setStroke = (rgb: [number, number, number]) => commands.push(`${(rgb[0]/255).toFixed(3)} ${(rgb[1]/255).toFixed(3)} ${(rgb[2]/255).toFixed(3)} RG`);
    const setLineWidth = (width: number) => commands.push(`${width.toFixed(2)} w`);
    const addRect = (x: number, topY: number, width: number, height: number, mode: 'S'|'f'|'B' = 'S') => {
      commands.push(`${x.toFixed(2)} ${toPdfY(topY+height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${mode}`);
    };
    const addLine = (x1: number, topY1: number, x2: number, topY2: number) => {
      commands.push(`${x1.toFixed(2)} ${toPdfY(topY1).toFixed(2)} m ${x2.toFixed(2)} ${toPdfY(topY2).toFixed(2)} l S`);
    };
    const addText = (text: any, x: number, topY: number, options?: { size?: number; font?: 'F1'|'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const font = options?.font ?? 'F1';
      if (options?.color) setFill(options.color);
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${toPdfY(topY).toFixed(2)} Tm (${pdfSafe(text) || '-'}) Tj ET`);
    };
    const addRightText = (text: any, rightX: number, topY: number, options?: { size?: number; font?: 'F1'|'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const normalized = normalizeText(text) || '-';
      const width = estimateTextWidth(normalized, size);
      addText(normalized, Math.max(marginX, rightX - width), topY, options);
    };
    const drawTextBlock = (lines: string[], x: number, topY: number, lineHeight: number, options?: { size?: number; font?: 'F1'|'F2'; color?: [number, number, number] }) => {
      lines.forEach((line, idx) => addText(line, x, topY + idx * lineHeight, options));
    };
    const drawLabelValueRows = (rows: Array<{ label: string; value: string[] }>, x: number, topY: number, width: number) => {
      let cursorY = topY;
      for (const row of rows) {
        addText(row.label, x, cursorY, { size: 9, font: 'F2', color: colors.muted });
        row.value.forEach((line, idx) => {
          addRightText(line, x + width, cursorY + idx * 11, { size: 10, color: colors.text });
        });
        cursorY += Math.max(16, row.value.length * 11 + 4);
      }
      return cursorY - topY;
    };
    const sectionTitle = (title: string, accent: [number, number, number] = colors.navy) => {
      ensureSpace(28);
      setFill(accent);
      addRect(marginX, y, 4, 14, 'f');
      addText(title, marginX + 12, y + 11, { size: 12, font: 'F2', color: colors.text });
      y += 24;
    };

    // ── Header ────────────────────────────────────────────────────────────────
    setFill(colors.soft);
    addRect(0, 0, pageWidth, 18, 'f');
    setFill(colors.navy);
    addRect(0, 18, pageWidth, 96, 'f');
    addText(company?.name ?? 'BeccaFact', marginX, 52, { size: 22, font: 'F2', color: colors.white });
    const companyMeta = [
      company?.razonSocial || '',
      `NIT ${company?.nit ?? '-'}`,
      [company?.email, company?.phone].filter(Boolean).join(' · '),
      [company?.address, company?.city].filter(Boolean).join(', '),
    ].filter(Boolean);
    drawTextBlock(companyMeta.map(normalizeText), marginX, 72, 13, { size: 10, color: [226, 232, 240] });

    // Meta box (numero, fecha, estado)
    const metaX = pageWidth - marginX - 188;
    const metaY = 34;
    setFill(colors.white);
    addRect(metaX, metaY, 188, 74, 'f');
    setStroke([214, 223, 233]);
    setLineWidth(0.8);
    addRect(metaX, metaY, 188, 74, 'S');
    addText('COTIZACION', metaX + 14, metaY + 18, { size: 12, font: 'F2', color: colors.navy });
    addText(quote.number ?? '-', metaX + 14, metaY + 40, { size: 22, font: 'F2', color: colors.text });
    addText(`Emision ${fmtDate(quote.issueDate)}`, metaX + 14, metaY + 56, { size: 9, color: colors.muted });
    if (quote.expiresAt) addText(`Vigencia ${fmtDate(quote.expiresAt)}`, metaX + 104, metaY + 56, { size: 9, color: colors.muted });

    const badge = statusStyle(quote.status as string);
    const badgeWidth = Math.max(70, estimateTextWidth(statusLabel(quote.status as string), 9) + 20);
    setFill(badge.bg);
    addRect(metaX + 188 - badgeWidth - 14, metaY + 12, badgeWidth, 18, 'f');
    addText(statusLabel(quote.status as string), metaX + 188 - badgeWidth - 4, metaY + 24, { size: 9, font: 'F2', color: badge.text });

    y = 132;

    // ── Cards cliente + resumen ────────────────────────────────────────────────
    const cardGap = 14;
    const cardWidth = (contentWidth - cardGap) / 2;
    const customerRows = [
      { label: 'Cliente',    value: wrapText((quote.customer as any)?.name ?? '-', 160, 10) },
      { label: 'Documento',  value: wrapText((quote.customer as any)?.documentNumber ?? '-', 160, 10) },
      ...((quote.customer as any)?.email    ? [{ label: 'Email',     value: wrapText((quote.customer as any).email,    160, 10) }] : []),
      ...((quote.customer as any)?.phone    ? [{ label: 'Telefono',  value: wrapText((quote.customer as any).phone,    160, 10) }] : []),
      ...((quote.customer as any)?.address  ? [{ label: 'Direccion', value: wrapText((quote.customer as any).address,  160, 10) }] : []),
    ];
    const summaryRows = [
      { label: 'Moneda',    value: [normalizeText(quote.currency ?? 'COP')] },
      { label: 'Subtotal',  value: [normalizeText(fmtCOP(quote.subtotal))] },
      { label: 'IVA',       value: [normalizeText(fmtCOP(quote.taxAmount))] },
      { label: 'Descuento', value: [normalizeText(fmtCOP(quote.discountAmount ?? 0))] },
      { label: 'Total',     value: [normalizeText(fmtCOP(quote.total))] },
    ];
    const estimateRowsHeight = (rows: Array<{ label: string; value: string[] }>) =>
      rows.reduce((acc, row) => acc + Math.max(16, row.value.length * 11 + 4), 0);
    const infoCardHeight = Math.max(110, 20 + Math.max(estimateRowsHeight(customerRows), estimateRowsHeight(summaryRows)) + 18);
    ensureSpace(infoCardHeight + 8);

    setFill(colors.white);
    setStroke(colors.line);
    setLineWidth(0.8);
    addRect(marginX, y, cardWidth, infoCardHeight, 'B');
    addRect(marginX + cardWidth + cardGap, y, cardWidth, infoCardHeight, 'B');
    setFill(colors.soft);
    addRect(marginX, y, cardWidth, 28, 'f');
    addRect(marginX + cardWidth + cardGap, y, cardWidth, 28, 'f');
    addText('Cliente / Receptor', marginX + 14, y + 18, { size: 11, font: 'F2', color: colors.navy });
    addText('Resumen financiero', marginX + cardWidth + cardGap + 14, y + 18, { size: 11, font: 'F2', color: colors.navy });
    drawLabelValueRows(customerRows, marginX + 14, y + 44, cardWidth - 28);
    drawLabelValueRows(summaryRows, marginX + cardWidth + cardGap + 14, y + 44, cardWidth - 28);
    y += infoCardHeight + 18;

    // ── Tabla de items ─────────────────────────────────────────────────────────
    sectionTitle(`Detalle de productos / servicios (${Array.isArray(quote.items) ? quote.items.length : 0})`, colors.blue);

    const columns = {
      idx:       marginX + 10,
      desc:      marginX + 42,
      qtyRight:  marginX + 312,
      unitRight: marginX + 396,
      taxRight:  marginX + 446,
      totalRight: pageWidth - marginX - 12,
    };

    const drawTableHeader = () => {
      ensureSpace(30);
      setFill(colors.navy);
      addRect(marginX, y, contentWidth, 24, 'f');
      addText('#',           columns.idx,       y + 15, { size: 9, font: 'F2', color: colors.white });
      addText('Descripcion', columns.desc,      y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Cant.',  columns.qtyRight,  y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Precio', columns.unitRight, y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('IVA',    columns.taxRight,  y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Total',  columns.totalRight,y + 15, { size: 9, font: 'F2', color: colors.white });
      y += 24;
    };
    drawTableHeader();

    const items = Array.isArray(quote.items) ? quote.items : [];
    items.forEach((item: any, index: number) => {
      const descriptionLines = wrapText(item.description ?? '-', 230, 9);
      const metaBits = [
        item.product?.sku ? `SKU ${normalizeText(item.product.sku)}` : '',
        Number(item.discount ?? 0) > 0 ? `Desc ${Number(item.discount)}%` : '',
      ].filter(Boolean);
      const metaLine = metaBits.join(' · ');
      const rowTextLines = [...descriptionLines, ...(metaLine ? [metaLine] : [])];
      const rowHeight = Math.max(28, rowTextLines.length * 11 + 14);
      const previousY = y;
      ensureSpace(rowHeight + 4);
      if (y === topMargin && previousY !== topMargin) drawTableHeader();

      setFill(index % 2 === 0 ? colors.white : colors.soft);
      addRect(marginX, y, contentWidth, rowHeight, 'f');
      setStroke(colors.line);
      setLineWidth(0.5);
      addRect(marginX, y, contentWidth, rowHeight, 'S');
      addText(String(index + 1), columns.idx, y + 17, { size: 9, font: 'F2', color: colors.text });
      descriptionLines.forEach((line, lineIndex) => addText(line, columns.desc, y + 16 + lineIndex * 11, { size: 9, color: colors.text }));
      if (metaLine) addText(metaLine, columns.desc, y + 16 + descriptionLines.length * 11, { size: 8, color: colors.muted });
      addRightText(String(Number(item.quantity ?? 0)), columns.qtyRight, y + 17, { size: 9, color: colors.text });
      addRightText(fmtCOP(item.unitPrice), columns.unitRight, y + 17, { size: 9, color: colors.text });
      addRightText(`${Number(item.taxRate ?? 0)}%`, columns.taxRight, y + 17, { size: 9, color: colors.text });
      addRightText(fmtCOP(item.total), columns.totalRight, y + 17, { size: 9, font: 'F2', color: colors.text });
      y += rowHeight + 4;
    });

    // ── Totales ────────────────────────────────────────────────────────────────
    y += 8;
    const totalBoxWidth = 210;
    const totalBoxX = pageWidth - marginX - totalBoxWidth;
    const totalsRows = [
      ['Subtotal', fmtCOP(quote.subtotal)],
      ['IVA',      fmtCOP(quote.taxAmount)],
      ...(Number(quote.discountAmount ?? 0) > 0 ? [['Descuento', `-${fmtCOP(quote.discountAmount)}`]] : []),
      ['TOTAL',    fmtCOP(quote.total)],
    ];
    const totalBoxHeight = 28 + totalsRows.length * 18 + 12;
    ensureSpace(totalBoxHeight + 16);
    setFill(colors.white);
    setStroke(colors.line);
    setLineWidth(0.8);
    addRect(totalBoxX, y, totalBoxWidth, totalBoxHeight, 'B');
    setFill(colors.soft);
    addRect(totalBoxX, y, totalBoxWidth, 28, 'f');
    addText('Totales', totalBoxX + 14, y + 18, { size: 11, font: 'F2', color: colors.navy });
    let totalY = y + 44;
    totalsRows.forEach(([label, value], idx) => {
      const isGrand = idx === totalsRows.length - 1;
      addText(label, totalBoxX + 14, totalY, { size: isGrand ? 11 : 10, font: isGrand ? 'F2' : 'F1', color: isGrand ? colors.navy : colors.muted });
      addRightText(value, totalBoxX + totalBoxWidth - 14, totalY, { size: isGrand ? 12 : 10, font: 'F2', color: isGrand ? colors.navy : colors.text });
      totalY += 18;
    });
    y += totalBoxHeight + 22;

    // ── Notas ─────────────────────────────────────────────────────────────────
    if (quote.notes) {
      const noteLines = wrapText(quote.notes, contentWidth - 28, 10);
      const notesHeight = 30 + noteLines.length * 12 + 14;
      ensureSpace(notesHeight + 12);
      sectionTitle('Notas / Observaciones', colors.amberText);
      setFill([255, 251, 235]);
      setStroke([253, 230, 138]);
      addRect(marginX, y, contentWidth, notesHeight, 'B');
      drawTextBlock(noteLines, marginX + 14, y + 20, 12, { size: 10, color: [120, 53, 15] });
      y += notesHeight + 18;
    }

    // ── Términos y condiciones ─────────────────────────────────────────────────
    if ((quote as any).terms) {
      const termLines = wrapText((quote as any).terms, contentWidth - 28, 10);
      const termsHeight = 30 + termLines.length * 12 + 14;
      ensureSpace(termsHeight + 12);
      sectionTitle('Terminos y condiciones', colors.slate);
      setFill(colors.soft);
      setStroke(colors.line);
      addRect(marginX, y, contentWidth, termsHeight, 'B');
      drawTextBlock(termLines, marginX + 14, y + 20, 12, { size: 10, color: colors.text });
      y += termsHeight + 18;
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    ensureSpace(36);
    setStroke(colors.line);
    setLineWidth(0.8);
    addLine(marginX, y, pageWidth - marginX, y);
    y += 18;
    addText(`Generado el ${new Date().toLocaleString('es-CO')}`, marginX, y, { size: 9, color: colors.muted });
    addRightText('Generado por BeccaFact', pageWidth - marginX, y, { size: 9, color: colors.muted });
    if (quote.status === 'DRAFT') {
      y += 14;
      addText('Documento en borrador - no valido como cotizacion oficial', marginX, y, { size: 9, font: 'F2', color: colors.redText });
    }

    pushPage();

    // ── Ensamblar PDF raw ──────────────────────────────────────────────────────
    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const pageObjectIds: number[] = [];
    const contentObjectIds: number[] = [];
    const pageAnnotsObjectIds: number[][] = [];
    let nextObjectId = 5;
    pages.forEach(() => {
      pageObjectIds.push(nextObjectId++);
      contentObjectIds.push(nextObjectId++);
      pageAnnotsObjectIds.push([]);
    });
    const kids = pageObjectIds.map((id) => `${id} 0 R`).join(' ');
    objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

    pages.forEach((page, index) => {
      const pageObj = pageObjectIds[index];
      const contentObj = contentObjectIds[index];
      const contentBuffer = Buffer.from(page.content, 'utf8');
      const annotRefs = '';
      objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R${annotRefs} >>`;
      objects[contentObj] = `<< /Length ${contentBuffer.length} >>\nstream\n${page.content}\nendstream`;
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = Buffer.byteLength(pdf, 'utf8');
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }
}
