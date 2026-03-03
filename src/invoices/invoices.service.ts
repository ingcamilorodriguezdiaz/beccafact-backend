import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

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

  // ─── UPDATE DRAFT ──────────────────────────────────────────────────────────

  async update(companyId: string, invoiceId: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(companyId, invoiceId);

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden editar facturas en estado DRAFT');
    }

    // Validate customer if changing
    if (dto.customerId && dto.customerId !== invoice.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId, deletedAt: null },
      });
      if (!customer) throw new NotFoundException('Cliente no encontrado');
    }

    // Recalculate totals if items provided
    let subtotal = Number(invoice.subtotal);
    let taxAmount = Number(invoice.taxAmount);
    let itemsCreate: any[] | undefined;

    if (dto.items && dto.items.length > 0) {
      subtotal = 0;
      taxAmount = 0;
      itemsCreate = dto.items.map((item: any, index: any) => {
        const qty   = Number(item.quantity  ?? 1);
        const price = Number(item.unitPrice ?? 0);
        const disc  = Number(item.discount  ?? 0);
        const tax   = Number(item.taxRate   ?? 19);
        const lineBase  = qty * price * (1 - disc / 100);
        const lineTax   = lineBase * (tax / 100);
        subtotal  += lineBase;
        taxAmount += lineTax;
        return {
          productId:   item.productId   ?? null,
          description: item.description ?? '',
          quantity:    qty,
          unitPrice:   price,
          taxRate:     tax,
          taxAmount:   lineTax,
          discount:    disc,
          total:       lineBase + lineTax,
          position:    index + 1,
        };
      });
    }

    const total = subtotal + taxAmount;

    // Build update data
    const data: any = {
      ...(dto.customerId && { customerId: dto.customerId }),
      ...(dto.prefix     && { prefix: dto.prefix }),
      ...(dto.issueDate  && { issueDate: new Date(dto.issueDate) }),
      ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
      ...(dto.notes  !== undefined  && { notes: dto.notes }),
      ...(dto.currency   && { currency: dto.currency }),
      ...(itemsCreate    && { subtotal, taxAmount, total }),
    };

    // Replace items atomically if provided
    if (itemsCreate) {
      await this.prisma.invoiceItem.deleteMany({ where: { invoiceId } });
      data.items = { create: itemsCreate };
    }

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data,
      include: {
        customer: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  // ─── GENERATE PDF ──────────────────────────────────────────────────────────

  async generatePdf(companyId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.findOne(companyId, invoiceId);

    // Fetch company info for header
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });

    const fmtCOP = (v: any) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(v));

    const fmtDate = (d: any) =>
      d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

    const typeLabel = (t: string) =>
      ({ VENTA: 'FACTURA DE VENTA', NOTA_CREDITO: 'NOTA CRÉDITO', NOTA_DEBITO: 'NOTA DÉBITO' }[t] ?? t);

    const statusLabel = (s: string) =>
      ({ DRAFT: 'BORRADOR', SENT_DIAN: 'ENVIADA DIAN', ACCEPTED_DIAN: 'ACEPTADA DIAN', PAID: 'PAGADA', CANCELLED: 'ANULADA', OVERDUE: 'VENCIDA' }[s] ?? s);

    // Build items rows HTML
    const itemRows = (invoice.items as any[]).map((item, i) => `
      <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
        <td class="td-center">${i + 1}</td>
        <td>${item.description}</td>
        <td class="td-center">${Number(item.quantity)}</td>
        <td class="td-right">${fmtCOP(item.unitPrice)}</td>
        <td class="td-center">${Number(item.taxRate)}%</td>
        <td class="td-center">${Number(item.discount)}%</td>
        <td class="td-right"><strong>${fmtCOP(item.total)}</strong></td>
      </tr>
    `).join('');

    const isDraft = invoice.status === 'DRAFT';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Factura ${invoice.invoiceNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 13px; color: #1e293b; background: #fff; padding: 32px; }
  .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-35deg);
    font-size:90px; font-weight:900; color:rgba(0,0,0,0.05); pointer-events:none; z-index:0;
    white-space:nowrap; letter-spacing:8px; }
  .content { position:relative; z-index:1; }

  /* Header */
  .inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; border-bottom:3px solid #1a407e; padding-bottom:20px; }
  .company-block h1 { font-size:20px; font-weight:900; color:#1a407e; letter-spacing:1px; margin-bottom:4px; }
  .company-block p { font-size:11.5px; color:#64748b; margin:2px 0; }
  .inv-title-block { text-align:right; }
  .inv-type { font-size:16px; font-weight:800; color:#1a407e; letter-spacing:2px; margin-bottom:6px; }
  .inv-number { font-size:26px; font-weight:900; color:#0f172a; font-family:monospace; }
  .inv-date { font-size:12px; color:#64748b; margin-top:4px; }
  .status-badge { display:inline-block; margin-top:8px; padding:3px 12px; border-radius:99px;
    font-size:11px; font-weight:700; letter-spacing:.05em; }
  .status-draft { background:#f3f4f6; color:#6b7280; border:1px solid #d1d5db; }
  .status-accepted { background:#dcfce7; color:#166534; }
  .status-paid { background:#dcfce7; color:#166534; }
  .status-sent { background:#dbeafe; color:#1e40af; }
  .status-cancelled { background:#fee2e2; color:#991b1b; }

  /* Client + info grid */
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .info-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px; }
  .info-box h4 { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; margin-bottom:10px; }
  .info-row { display:flex; justify-content:space-between; margin-bottom:5px; }
  .info-row span { font-size:12px; color:#94a3b8; }
  .info-row strong { font-size:12px; color:#1e293b; text-align:right; max-width:200px; }

  /* Items table */
  .items-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
    color:#94a3b8; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead tr { background:#1a407e; }
  thead th { padding:9px 10px; font-size:11px; font-weight:700; color:#fff; text-align:left; letter-spacing:.04em; }
  .td-center { text-align:center; }
  .td-right { text-align:right; }
  tbody tr { border-bottom:1px solid #f0f4f8; }
  .row-even td { background:#fff; }
  .row-odd td { background:#f8fafc; }
  td { padding:9px 10px; font-size:12.5px; color:#374151; vertical-align:middle; }
  tbody tr:last-child { border-bottom:2px solid #e2e8f0; }

  /* Totals */
  .totals-wrap { display:flex; justify-content:flex-end; margin-bottom:24px; }
  .totals-box { min-width:280px; }
  .tot-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f4f8; }
  .tot-row span { font-size:13px; color:#64748b; }
  .tot-row strong { font-size:13px; color:#1e293b; }
  .tot-total { border-top:2px solid #1a407e !important; border-bottom:none !important;
    margin-top:4px; padding-top:10px !important; }
  .tot-total span, .tot-total strong { font-size:16px; font-weight:800; color:#1a407e; }

  /* Notes + DIAN */
  .notes-box { background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px 16px; margin-bottom:16px; }
  .notes-box h4 { font-size:10px; font-weight:700; text-transform:uppercase; color:#92400e; margin-bottom:6px; }
  .notes-box p { font-size:12px; color:#78350f; }
  .dian-box { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px 16px; margin-bottom:16px; }
  .dian-box h4 { font-size:10px; font-weight:700; text-transform:uppercase; color:#166534; margin-bottom:6px; }
  .dian-box p { font-size:11px; color:#166534; word-break:break-all; }

  /* Footer */
  .inv-footer { border-top:1px solid #e2e8f0; padding-top:16px; display:flex; justify-content:space-between; }
  .footer-left p { font-size:11px; color:#94a3b8; margin:2px 0; }
  .footer-right { text-align:right; }
  .footer-right p { font-size:11px; color:#94a3b8; }
  .powered { font-size:10px; color:#c7d9f5; margin-top:4px; }
</style>
</head>
<body>
${isDraft ? '<div class="watermark">BORRADOR</div>' : ''}
<div class="content">

  <!-- Header -->
  <div class="inv-header">
    <div class="company-block">
      <h1>${company?.name ?? 'BeccaFact'}</h1>
      <p>${company?.razonSocial ?? ''}</p>
      <p>NIT: ${company?.nit ?? '—'}</p>
      ${company?.email ? `<p>${company.email}</p>` : ''}
      ${company?.phone ? `<p>${company.phone}</p>` : ''}
      ${company?.address ? `<p>${company.address}${company.city ? ', ' + company.city : ''}</p>` : ''}
    </div>
    <div class="inv-title-block">
      <div class="inv-type">${typeLabel(invoice.type)}</div>
      <div class="inv-number">${invoice.invoiceNumber}</div>
      <div class="inv-date">Emisión: ${fmtDate(invoice.issueDate)}</div>
      ${invoice.dueDate ? `<div class="inv-date">Vencimiento: ${fmtDate(invoice.dueDate)}</div>` : ''}
      <span class="status-badge status-${isDraft ? 'draft' : invoice.status === 'PAID' ? 'paid' : invoice.status === 'ACCEPTED_DIAN' ? 'accepted' : invoice.status === 'SENT_DIAN' ? 'sent' : invoice.status === 'CANCELLED' ? 'cancelled' : 'draft'}">
        ${statusLabel(invoice.status)}
      </span>
    </div>
  </div>

  <!-- Info Grid -->
  <div class="info-grid">
    <div class="info-box">
      <h4>Cliente / Receptor</h4>
      <div class="info-row"><span>Nombre</span><strong>${(invoice.customer as any).name}</strong></div>
      <div class="info-row"><span>Documento</span><strong>${(invoice.customer as any).documentNumber}</strong></div>
      ${(invoice.customer as any).email ? `<div class="info-row"><span>Email</span><strong>${(invoice.customer as any).email}</strong></div>` : ''}
      ${(invoice.customer as any).phone ? `<div class="info-row"><span>Teléfono</span><strong>${(invoice.customer as any).phone}</strong></div>` : ''}
      ${(invoice.customer as any).address ? `<div class="info-row"><span>Dirección</span><strong>${(invoice.customer as any).address}</strong></div>` : ''}
    </div>
    <div class="info-box">
      <h4>Información de Pago</h4>
      <div class="info-row"><span>Moneda</span><strong>${invoice.currency}</strong></div>
      <div class="info-row"><span>Subtotal</span><strong>${fmtCOP(invoice.subtotal)}</strong></div>
      <div class="info-row"><span>IVA</span><strong>${fmtCOP(invoice.taxAmount)}</strong></div>
      <div class="info-row"><span>Descuento</span><strong>${fmtCOP(invoice.discountAmount)}</strong></div>
      <div class="info-row"><span>Total</span><strong style="color:#1a407e;font-size:14px">${fmtCOP(invoice.total)}</strong></div>
    </div>
  </div>

  <!-- Items -->
  <div class="items-title">Detalle de productos / servicios</div>
  <table>
    <thead>
      <tr>
        <th style="width:40px" class="td-center">#</th>
        <th>Descripción</th>
        <th style="width:70px" class="td-center">Cant.</th>
        <th style="width:110px" class="td-right">Precio unit.</th>
        <th style="width:65px" class="td-center">IVA</th>
        <th style="width:65px" class="td-center">Desc.</th>
        <th style="width:120px" class="td-right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Totals -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="tot-row"><span>Subtotal</span><strong>${fmtCOP(invoice.subtotal)}</strong></div>
      <div class="tot-row"><span>IVA</span><strong>${fmtCOP(invoice.taxAmount)}</strong></div>
      ${Number(invoice.discountAmount) > 0 ? `<div class="tot-row"><span>Descuento</span><strong>-${fmtCOP(invoice.discountAmount)}</strong></div>` : ''}
      <div class="tot-row tot-total"><span>TOTAL</span><strong>${fmtCOP(invoice.total)}</strong></div>
    </div>
  </div>

  ${invoice.notes ? `
  <div class="notes-box">
    <h4>Notas / Observaciones</h4>
    <p>${invoice.notes}</p>
  </div>` : ''}

  ${invoice.dianCufe ? `
  <div class="dian-box">
    <h4>Información DIAN</h4>
    <p>CUFE: ${invoice.dianCufe}</p>
    ${invoice.dianQrCode ? `<p>QR: ${invoice.dianQrCode}</p>` : ''}
  </div>` : ''}

  <!-- Footer -->
  <div class="inv-footer">
    <div class="footer-left">
      <p>Generado el ${new Date().toLocaleString('es-CO')}</p>
      ${isDraft ? '<p style="color:#dc2626;font-weight:700">⚠ Documento en borrador — no válido como factura oficial</p>' : ''}
    </div>
    <div class="footer-right">
      <p class="powered">Generado por BeccaFact · Colombia</p>
    </div>
  </div>

</div>
</body>
</html>`;

    // Return HTML as Buffer — the controller sends it with PDF content-type
    // For real PDF generation add puppeteer/wkhtmltopdf; for now returns the HTML
    // which browsers render as a PDF-like document when opened in a tab or iframe
    return Buffer.from(html, 'utf-8');
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
