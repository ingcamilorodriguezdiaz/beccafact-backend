import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { UpdateCustomerDto } from '../customers/dto/update-customer.dto';
import { CustomersService } from '../customers/customers.service';
import { MailerService } from '../common/mailer/mailer.service';
import { CreatePurchaseOrderDto, CreatePurchaseOrderItemDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderStatus } from '@prisma/client';

@Injectable()
export class PurchasingService {
  constructor(
    private prisma: PrismaService,
    private customersService: CustomersService,
    private mailerService: MailerService,
  ) {}

  private mapCustomerForPurchasing(customer: any) {
    if (!customer) return customer;
    const { creditDays, ...rest } = customer;
    return {
      ...rest,
      creditDays: creditDays ?? null,
      paymentTermDays: creditDays ?? null,
    };
  }

  private mapOrderSupplierToCustomer(order: any) {
    if (!order) return order;
    const {
      customer,
      items,
      number,
      ...rest
    } = order;
    return {
      ...rest,
      orderNumber: number,
      customer: customer
        ? {
            ...customer,
            creditDays: customer.creditDays ?? null,
            paymentTermDays: customer.creditDays ?? null,
          }
        : null,
      lines: Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            taxPercent: Number(item.taxRate ?? 0),
            discountPercent: Number(item.discount ?? 0),
          }))
        : undefined,
    };
  }

  private async ensureCustomerForOrder(companyId: string, customerId: string) {
    return this.customersService.findOne(companyId, customerId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: calcular totales de una orden a partir de sus ítems
  //   itemBase     = quantity * unitPrice * (1 - discount/100)
  //   itemTax      = itemBase * taxRate / 100
  //   itemTotal    = itemBase + itemTax
  //   subtotal     = suma de itemBase
  //   taxAmount    = suma de itemTax
  //   total        = subtotal + taxAmount   (sin descuento global adicional)
  // ─────────────────────────────────────────────────────────────────────────────
  private calcOrderTotals(items: CreatePurchaseOrderItemDto[]) {
    let subtotal = 0;
    let taxAmount = 0;

    const computed = items.map((item) => {
      const taxRate = item.taxRate ?? 19;
      const discount = item.discount ?? 0;
      const base = item.quantity * item.unitPrice * (1 - discount / 100);
      const tax = base * taxRate / 100;
      subtotal += base;
      taxAmount += tax;
      return {
        productId: item.productId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate,
        taxAmount: tax,
        discount,
        total: base + tax,
        position: item.position,
      };
    });

    const total = subtotal + taxAmount;
    return { subtotal, taxAmount, total, computed };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: genera el siguiente número de OC para la empresa en formato OC-NNNN
  // Busca el mayor número correlativo ya emitido (incluyendo soft-deleted)
  // ─────────────────────────────────────────────────────────────────────────────
  private async generateOrderNumber(companyId: string): Promise<string> {
    const last = await this.prisma.purchaseOrder.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    let nextSeq = 1;
    if (last?.number) {
      // Formato esperado: OC-NNNN; extrae la parte numérica
      const parts = last.number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
    }

    return `OC-${String(nextSeq).padStart(4, '0')}`;
  }

  private normalizeText(value: any): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatCurrency(value: any): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(value ?? 0));
  }

  private formatDate(value: any): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private orderStatusLabel(status: string): string {
    return ({
      DRAFT: 'BORRADOR',
      SENT: 'ENVIADA',
      RECEIVED: 'RECIBIDA',
      PARTIAL: 'PARCIAL',
      CANCELLED: 'CANCELADA',
    } as Record<string, string>)[status] ?? status ?? '-';
  }

  private async getOrderRenderContext(companyId: string, id: string) {
    const order = await this.findOneOrder(companyId, id);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });
    return { order, company };
  }

  async generateOrderPreview(companyId: string, id: string): Promise<Buffer> {
    const { order, company } = await this.getOrderRenderContext(companyId, id);
    const rows = (order.lines ?? []).map((line: any, index: number) => {
      const base = this.lineBaseForRender(line);
      const tax = this.lineTaxForRender(line);
      const total = base + tax;
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <strong>${this.escapeHtml(line.description)}</strong>
            <div class="line-meta">Cant. ${this.escapeHtml(line.quantity)} · Dto. ${this.escapeHtml(line.discountPercent ?? 0)}%</div>
          </td>
          <td>${this.escapeHtml(line.quantity)}</td>
          <td>${this.formatCurrency(line.unitPrice)}</td>
          <td>${this.escapeHtml(line.taxPercent ?? 0)}%</td>
          <td>${this.formatCurrency(base)}</td>
          <td>${this.formatCurrency(total)}</td>
        </tr>
      `;
    }).join('');

    const notesBlock = order.notes ? `
      <div class="notes-card">
        <h4>Observaciones</h4>
        <p>${this.escapeHtml(order.notes)}</p>
      </div>
    ` : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Orden de compra ${this.escapeHtml(order.orderNumber)}</title>
  <style>
    * { box-sizing:border-box; }
    body { margin:0; font-family:Arial, sans-serif; background:#eef2ff; color:#172554; }
    .page { max-width:980px; margin:24px auto; background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 22px 44px rgba(15,23,42,.12); }
    .hero { padding:28px 34px; background:linear-gradient(135deg, #1e3a8a 0%, #4338ca 55%, #0f766e 100%); color:#fff; display:flex; justify-content:space-between; gap:24px; }
    .hero h1 { margin:0 0 8px; font-size:30px; }
    .hero p { margin:0; color:rgba(255,255,255,.8); line-height:1.5; }
    .hero-box { min-width:240px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); border-radius:18px; padding:18px; }
    .hero-box small { display:block; text-transform:uppercase; letter-spacing:.12em; font-size:11px; color:#c7d2fe; margin-bottom:8px; }
    .hero-box strong { display:block; font-size:28px; line-height:1.1; }
    .hero-box span { display:inline-block; margin-top:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.18); font-size:12px; font-weight:700; }
    .body { padding:28px 34px 32px; }
    .summary-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; margin-bottom:22px; }
    .card { border:1px solid #dbe4f0; border-radius:16px; overflow:hidden; }
    .card-head { padding:12px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#475569; }
    .card-body { padding:16px; }
    .info-row { display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:14px; }
    .info-row span { color:#64748b; }
    .info-row strong { color:#0f172a; text-align:right; }
    table { width:100%; border-collapse:collapse; }
    thead th { background:#1e3a8a; color:#fff; font-size:11px; text-transform:uppercase; letter-spacing:.08em; padding:12px 10px; text-align:left; }
    tbody td { padding:12px 10px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#334155; vertical-align:top; }
    tbody tr:nth-child(even) td { background:#f8fafc; }
    .line-meta { margin-top:4px; color:#64748b; font-size:12px; }
    .totals { margin-top:18px; margin-left:auto; max-width:320px; border:1px solid #dbe4f0; border-radius:16px; overflow:hidden; }
    .totals .head { padding:12px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#475569; }
    .total-row { display:flex; justify-content:space-between; gap:12px; padding:12px 16px; font-size:14px; }
    .total-row strong { color:#0f172a; }
    .total-row.final { border-top:1px solid #e2e8f0; font-size:16px; font-weight:800; color:#1e3a8a; }
    .notes-card { margin-top:18px; padding:16px 18px; border-radius:16px; border:1px solid #ddd6fe; background:#faf5ff; }
    .notes-card h4 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#6d28d9; }
    .notes-card p { margin:0; color:#374151; line-height:1.6; white-space:pre-wrap; }
    .footer { margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; gap:16px; font-size:12px; color:#64748b; }
    @media print { body { background:#fff; } .page { margin:0; box-shadow:none; border-radius:0; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div>
        <h1>Orden de Compra</h1>
        <p>${this.escapeHtml(company?.name ?? 'BeccaFact')}</p>
        <p>${this.escapeHtml(company?.razonSocial ?? '')}</p>
        <p>NIT ${this.escapeHtml(company?.nit ?? '-')} · ${this.escapeHtml(company?.email ?? '-')}</p>
      </div>
      <div class="hero-box">
        <small>No. orden</small>
        <strong>${this.escapeHtml(order.orderNumber)}</strong>
        <span>${this.escapeHtml(this.orderStatusLabel(order.status))}</span>
      </div>
    </div>
    <div class="body">
      <div class="summary-grid">
        <div class="card">
          <div class="card-head">Cliente</div>
          <div class="card-body">
            <div class="info-row"><span>Nombre</span><strong>${this.escapeHtml(order.customer?.name ?? '-')}</strong></div>
            <div class="info-row"><span>Documento</span><strong>${this.escapeHtml(order.customer?.documentNumber ?? '-')}</strong></div>
            <div class="info-row"><span>Email</span><strong>${this.escapeHtml(order.customer?.email ?? '-')}</strong></div>
            <div class="info-row"><span>Teléfono</span><strong>${this.escapeHtml(order.customer?.phone ?? '-')}</strong></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">Resumen</div>
          <div class="card-body">
            <div class="info-row"><span>Fecha emisión</span><strong>${this.escapeHtml(this.formatDate(order.issueDate))}</strong></div>
            <div class="info-row"><span>Fecha vencimiento</span><strong>${this.escapeHtml(this.formatDate(order.dueDate))}</strong></div>
            <div class="info-row"><span>Moneda</span><strong>COP</strong></div>
            <div class="info-row"><span>Líneas</span><strong>${this.escapeHtml((order.lines ?? []).length)}</strong></div>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Descripción</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>IVA</th>
            <th>Subtotal</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totals">
        <div class="head">Totales</div>
        <div class="total-row"><span>Subtotal</span><strong>${this.formatCurrency(order.subtotal)}</strong></div>
        <div class="total-row"><span>IVA</span><strong>${this.formatCurrency(order.taxAmount)}</strong></div>
        <div class="total-row final"><span>Total</span><strong>${this.formatCurrency(order.total)}</strong></div>
      </div>

      ${notesBlock}

      <div class="footer">
        <span>Generado el ${this.escapeHtml(new Date().toLocaleString('es-CO'))}</span>
        <span>Generado por BeccaFact</span>
      </div>
    </div>
  </div>
</body>
</html>`;

    return Buffer.from(html, 'utf8');
  }

  private lineBaseForRender(line: any): number {
    const quantity = Number(line?.quantity ?? 0);
    const unitPrice = Number(line?.unitPrice ?? 0);
    const discount = Number(line?.discountPercent ?? 0);
    return quantity * unitPrice * (1 - discount / 100);
  }

  private lineTaxForRender(line: any): number {
    const base = this.lineBaseForRender(line);
    const taxPercent = Number(line?.taxPercent ?? 0);
    return base * (taxPercent / 100);
  }

  async generateOrderPdfDocument(companyId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const { order, company } = await this.getOrderRenderContext(companyId, id);
    const buffer = await this.buildPurchaseOrderPdfBuffer(order, company);
    return { buffer, filename: `${order.orderNumber}.pdf` };
  }

  async sendOrderEmail(companyId: string, id: string, to?: string) {
    const { order } = await this.getOrderRenderContext(companyId, id);
    const email = (to ?? order.customer?.email ?? '').trim();
    if (!email) {
      throw new BadRequestException('El cliente no tiene correo electrónico registrado');
    }

    const { buffer } = await this.generateOrderPdfDocument(companyId, id);
    await this.mailerService.sendPurchaseOrderEmail(
      email,
      order.orderNumber,
      order.customer?.name ?? 'Cliente',
      buffer,
    );

    return {
      message: `Orden de compra ${order.orderNumber} enviada correctamente a ${email}`,
      to: email,
    };
  }

  private async buildPurchaseOrderPdfBuffer(order: any, company: any): Promise<Buffer> {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 34;
    const topMargin = 36;
    const bottomMargin = 36;
    const contentWidth = pageWidth - marginX * 2;
    const colors = {
      navy: [30, 58, 138] as [number, number, number],
      teal: [15, 118, 110] as [number, number, number],
      slate: [71, 85, 105] as [number, number, number],
      text: [15, 23, 42] as [number, number, number],
      muted: [100, 116, 139] as [number, number, number],
      line: [203, 213, 225] as [number, number, number],
      soft: [248, 250, 252] as [number, number, number],
      white: [255, 255, 255] as [number, number, number],
      greenBg: [220, 252, 231] as [number, number, number],
      greenText: [22, 101, 52] as [number, number, number],
      amberBg: [254, 243, 199] as [number, number, number],
      amberText: [146, 64, 14] as [number, number, number],
      redBg: [254, 226, 226] as [number, number, number],
      redText: [153, 27, 27] as [number, number, number],
    };
    const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56;
    const pdfSafe = (value: any) =>
      this.normalizeText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
    const wrapText = (text: any, maxWidth: number, fontSize: number) => {
      const normalized = this.normalizeText(text);
      if (!normalized) return ['-'];
      const words = normalized.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
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
    const statusStyle = (status: string) => {
      if (status === 'RECEIVED') return { bg: colors.greenBg, text: colors.greenText };
      if (status === 'DRAFT' || status === 'SENT' || status === 'PARTIAL') return { bg: colors.amberBg, text: colors.amberText };
      if (status === 'CANCELLED') return { bg: colors.redBg, text: colors.redText };
      return { bg: colors.soft, text: colors.text };
    };

    const pages: string[] = [];
    let commands: string[] = [];
    let y = topMargin;
    const toPdfY = (topY: number) => pageHeight - topY;
    const pushPage = () => {
      if (commands.length) pages.push(commands.join('\n'));
      commands = [];
      y = topMargin;
    };
    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - bottomMargin) return;
      pushPage();
      drawHeader();
    };
    const setFill = (rgb: [number, number, number]) => commands.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} rg`);
    const setStroke = (rgb: [number, number, number]) => commands.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} RG`);
    const setLineWidth = (width: number) => commands.push(`${width.toFixed(2)} w`);
    const addRect = (x: number, topY: number, width: number, height: number, mode: 'S' | 'f' | 'B' = 'S') => {
      commands.push(`${x.toFixed(2)} ${toPdfY(topY + height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${mode}`);
    };
    const addText = (text: any, x: number, topY: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const font = options?.font ?? 'F1';
      if (options?.color) setFill(options.color);
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${toPdfY(topY).toFixed(2)} Tm (${pdfSafe(text) || '-'}) Tj ET`);
    };
    const addRightText = (text: any, rightX: number, topY: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const normalized = this.normalizeText(text) || '-';
      const width = estimateTextWidth(normalized, size);
      addText(normalized, Math.max(marginX, rightX - width), topY, options);
    };

    const drawHeader = () => {
      setFill(colors.navy);
      addRect(0, 0, pageWidth, 96, 'f');
      addText(company?.name ?? 'BeccaFact', marginX, 44, { size: 22, font: 'F2', color: colors.white });
      addText(company?.razonSocial ?? '', marginX, 62, { size: 10, color: colors.white });
      addText(`NIT ${company?.nit ?? '-'}`, marginX, 76, { size: 10, color: colors.white });

      const cardX = pageWidth - marginX - 186;
      setFill(colors.white);
      addRect(cardX, 24, 186, 58, 'f');
      setStroke(colors.line);
      setLineWidth(0.8);
      addRect(cardX, 24, 186, 58, 'S');
      addText('ORDEN DE COMPRA', cardX + 12, 42, { size: 11, font: 'F2', color: colors.navy });
      addText(order.orderNumber ?? '-', cardX + 12, 62, { size: 18, font: 'F2', color: colors.text });

      const badge = statusStyle(order.status);
      const badgeText = this.orderStatusLabel(order.status);
      const badgeWidth = Math.max(72, estimateTextWidth(badgeText, 9) + 18);
      setFill(badge.bg);
      addRect(cardX + 186 - badgeWidth - 12, 30, badgeWidth, 16, 'f');
      addText(badgeText, cardX + 186 - badgeWidth + 14, 41, { size: 9, font: 'F2', color: badge.text });

      y = 118;
    };

    const drawInfoCards = () => {
      const gap = 14;
      const cardWidth = (contentWidth - gap) / 2;
      const cardHeight = 116;
      ensureSpace(cardHeight + 16);
      setFill(colors.white);
      setStroke(colors.line);
      setLineWidth(0.8);
      addRect(marginX, y, cardWidth, cardHeight, 'B');
      addRect(marginX + cardWidth + gap, y, cardWidth, cardHeight, 'B');
      setFill(colors.soft);
      addRect(marginX, y, cardWidth, 24, 'f');
      addRect(marginX + cardWidth + gap, y, cardWidth, 24, 'f');
      addText('Cliente', marginX + 12, y + 16, { size: 10, font: 'F2', color: colors.navy });
      addText('Resumen', marginX + cardWidth + gap + 12, y + 16, { size: 10, font: 'F2', color: colors.navy });

      let leftY = y + 40;
      const leftRows = [
        ['Nombre', order.customer?.name ?? '-'],
        ['Documento', order.customer?.documentNumber ?? '-'],
        ['Email', order.customer?.email ?? '-'],
        ['Telefono', order.customer?.phone ?? '-'],
      ];
      for (const [label, value] of leftRows) {
        addText(label, marginX + 12, leftY, { size: 9, font: 'F2', color: colors.muted });
        addRightText(value, marginX + cardWidth - 12, leftY, { size: 9, color: colors.text });
        leftY += 16;
      }

      let rightY = y + 40;
      const rightRows = [
        ['Emision', this.formatDate(order.issueDate)],
        ['Vencimiento', this.formatDate(order.dueDate)],
        ['Subtotal', this.formatCurrency(order.subtotal)],
        ['Total', this.formatCurrency(order.total)],
      ];
      for (const [label, value] of rightRows) {
        addText(label, marginX + cardWidth + gap + 12, rightY, { size: 9, font: 'F2', color: colors.muted });
        addRightText(value, pageWidth - marginX - 12, rightY, { size: 9, color: colors.text });
        rightY += 16;
      }

      y += cardHeight + 18;
    };

    const drawTableHeader = () => {
      ensureSpace(28);
      setFill(colors.teal);
      addRect(marginX, y, contentWidth, 22, 'f');
      addText('#', marginX + 8, y + 14, { size: 9, font: 'F2', color: colors.white });
      addText('Descripcion', marginX + 28, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('Cant.', marginX + 318, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('Precio', marginX + 402, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('IVA', marginX + 452, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('Total', pageWidth - marginX - 10, y + 14, { size: 9, font: 'F2', color: colors.white });
      y += 24;
    };

    drawHeader();
    drawInfoCards();
    drawTableHeader();

    const lines = Array.isArray(order.lines) ? order.lines : [];
    lines.forEach((line: any, index: number) => {
      const descriptionLines = wrapText(line.description ?? '-', 220, 9);
      const meta = `Dto ${Number(line.discountPercent ?? 0)}% · Base ${this.formatCurrency(this.lineBaseForRender(line))}`;
      const rowHeight = Math.max(28, (descriptionLines.length + 1) * 11 + 10);
      const previousY = y;
      ensureSpace(rowHeight + 4);
      if (previousY !== y) {
        drawTableHeader();
      }
      setFill(index % 2 === 0 ? colors.white : colors.soft);
      addRect(marginX, y, contentWidth, rowHeight, 'f');
      setStroke(colors.line);
      setLineWidth(0.5);
      addRect(marginX, y, contentWidth, rowHeight, 'S');
      addText(String(index + 1), marginX + 8, y + 16, { size: 9, font: 'F2', color: colors.text });
      descriptionLines.forEach((descLine, idx) => addText(descLine, marginX + 28, y + 16 + idx * 11, { size: 9, color: colors.text }));
      addText(meta, marginX + 28, y + 16 + descriptionLines.length * 11, { size: 8, color: colors.muted });
      addRightText(line.quantity, marginX + 318, y + 16, { size: 9, color: colors.text });
      addRightText(this.formatCurrency(line.unitPrice), marginX + 402, y + 16, { size: 9, color: colors.text });
      addRightText(`${Number(line.taxPercent ?? 0)}%`, marginX + 452, y + 16, { size: 9, color: colors.text });
      addRightText(this.formatCurrency(this.lineBaseForRender(line) + this.lineTaxForRender(line)), pageWidth - marginX - 10, y + 16, { size: 9, font: 'F2', color: colors.text });
      y += rowHeight + 4;
    });

    const totalBoxWidth = 208;
    const totalBoxX = pageWidth - marginX - totalBoxWidth;
    const totalBoxHeight = 96;
    ensureSpace(totalBoxHeight + 20);
    setFill(colors.white);
    setStroke(colors.line);
    setLineWidth(0.8);
    addRect(totalBoxX, y + 8, totalBoxWidth, totalBoxHeight, 'B');
    setFill(colors.soft);
    addRect(totalBoxX, y + 8, totalBoxWidth, 24, 'f');
    addText('Totales', totalBoxX + 12, y + 24, { size: 10, font: 'F2', color: colors.navy });
    addText('Subtotal', totalBoxX + 12, y + 46, { size: 9, color: colors.muted });
    addRightText(this.formatCurrency(order.subtotal), totalBoxX + totalBoxWidth - 12, y + 46, { size: 9, font: 'F2', color: colors.text });
    addText('IVA', totalBoxX + 12, y + 64, { size: 9, color: colors.muted });
    addRightText(this.formatCurrency(order.taxAmount), totalBoxX + totalBoxWidth - 12, y + 64, { size: 9, font: 'F2', color: colors.text });
    addText('TOTAL', totalBoxX + 12, y + 88, { size: 11, font: 'F2', color: colors.navy });
    addRightText(this.formatCurrency(order.total), totalBoxX + totalBoxWidth - 12, y + 88, { size: 11, font: 'F2', color: colors.navy });
    y += totalBoxHeight + 28;

    if (order.notes) {
      const noteLines = wrapText(order.notes, contentWidth - 24, 10);
      const notesHeight = 28 + noteLines.length * 12 + 12;
      ensureSpace(notesHeight + 12);
      setFill([250, 245, 255]);
      setStroke([221, 214, 254]);
      addRect(marginX, y, contentWidth, notesHeight, 'B');
      addText('Observaciones', marginX + 12, y + 16, { size: 10, font: 'F2', color: [109, 40, 217] });
      noteLines.forEach((line, idx) => addText(line, marginX + 12, y + 34 + idx * 12, { size: 9, color: colors.text }));
      y += notesHeight + 18;
    }

    ensureSpace(24);
    addText(`Generado el ${new Date().toLocaleString('es-CO')}`, marginX, y, { size: 9, color: colors.muted });
    addRightText('Generado por BeccaFact', pageWidth - marginX, y, { size: 9, color: colors.muted });
    pushPage();

    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const kids: string[] = [];
    let nextId = 5;
    pages.forEach((content) => {
      const pageId = nextId++;
      const contentId = nextId++;
      kids.push(`${pageId} 0 R`);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
    });
    objects[2] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

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

  // ─────────────────────────────────────────────────────────────────────────────
  // CUSTOMERS USADOS EN COMPRAS
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllCustomers(
    companyId: string,
    filters: { search?: string; isActive?: boolean; page?: number; limit?: number },
  ) {
    const result = await this.customersService.findAll(companyId, filters);

    return {
      ...result,
      data: result.data.map((customer) => this.mapCustomerForPurchasing(customer)),
    };
  }

  async findOneCustomer(companyId: string, id: string) {
    const customer = await this.customersService.findOne(companyId, id);
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: { companyId, customerId: id, deletedAt: null },
      orderBy: { issueDate: 'desc' },
      take: 5,
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        dueDate: true,
        total: true,
        currency: true,
      },
    });

    return {
      ...this.mapCustomerForPurchasing(customer),
      purchaseOrders: purchaseOrders.map((order) => ({
        ...order,
        orderNumber: order.number,
      })),
    };
  }

  async createCustomer(companyId: string, dto: CreateCustomerDto) {
    const created = await this.customersService.create(companyId, dto);
    return this.mapCustomerForPurchasing(created);
  }

  async updateCustomer(companyId: string, id: string, dto: UpdateCustomerDto) {
    const updated = await this.customersService.update(companyId, id, dto);
    return this.mapCustomerForPurchasing(updated);
  }

  async toggleCustomer(companyId: string, id: string) {
    const updated = await this.customersService.toggle(companyId, id);
    return this.mapCustomerForPurchasing(updated);
  }

  async removeCustomer(companyId: string, id: string) {
    const removed = await this.customersService.remove(companyId, id);
    return this.mapCustomerForPurchasing(removed);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PURCHASE ORDERS
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllOrders(
    companyId: string,
    filters: {
      search?: string;
      status?: PurchaseOrderStatus;
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

    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) where.status = status;
    if (customerId) {
      await this.customersService.findOne(companyId, customerId);
      where.customerId = customerId;
    }

    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { issueDate: 'desc' },
        skip,
        take: +limit,
        include: {
          customer: {
            select: { id: true, name: true, documentNumber: true },
          },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: data.map((order) => this.mapOrderSupplierToCustomer(order)),
      total,
      page: +page,
      limit: +limit,
      totalPages: Math.ceil(total / +limit),
    };
  }

  async findOneOrder(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: true,
        items: {
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    return this.mapOrderSupplierToCustomer(order);
  }

  async createOrder(companyId: string, dto: CreatePurchaseOrderDto) {
    const customerId = dto.customerId ?? dto.supplierId;
    if (!customerId) {
      throw new BadRequestException('El cliente asociado a la orden es obligatorio');
    }

    const customer = await this.ensureCustomerForOrder(companyId, customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const number = await this.generateOrderNumber(companyId);
    const { subtotal, taxAmount, total, computed } = this.calcOrderTotals(dto.items);

    return this.prisma.purchaseOrder.create({
      data: {
        companyId,
        customerId: customer.id,
        number,
        issueDate: new Date(dto.issueDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
        currency: dto.currency ?? 'COP',
        subtotal,
        taxAmount,
        discountAmount: 0,
        total,
        items: {
          create: computed,
        },
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true, address: true, creditDays: true } },
        items: { orderBy: { position: 'asc' } },
      },
    }).then((order) => this.mapOrderSupplierToCustomer(order));
  }

  async updateOrder(companyId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const order = await this.findOneOrder(companyId, id);

    // Solo se permite editar órdenes en estado DRAFT
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ForbiddenException(
        `Solo se pueden modificar órdenes en estado DRAFT. Estado actual: ${order.status}`,
      );
    }

    // Recalcular totales si se envían ítems
    let totalsData: any = {};
    let itemsData: any = {};

    if (dto.items && dto.items.length > 0) {
      const { subtotal, taxAmount, total, computed } = this.calcOrderTotals(dto.items);
      totalsData = { subtotal, taxAmount, total };
      // Reemplazar ítems: eliminar los anteriores y crear los nuevos
      itemsData = {
        items: {
          deleteMany: {},
          create: computed,
        },
      };
    }

    const { items: _items, ...rest } = dto;

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...rest,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        ...totalsData,
        ...itemsData,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true, address: true, creditDays: true } },
        items: { orderBy: { position: 'asc' } },
      },
    }).then((order) => this.mapOrderSupplierToCustomer(order));
  }

  async updateOrderStatus(companyId: string, id: string, dto: UpdatePurchaseOrderStatusDto) {
    // Verificar que la orden existe y pertenece a la empresa
    await this.findOneOrder(companyId, id);

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: dto.status },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true, address: true, creditDays: true } },
      },
    }).then((order) => this.mapOrderSupplierToCustomer(order));
  }

  async removeOrder(companyId: string, id: string) {
    const order = await this.findOneOrder(companyId, id);

    // Solo se puede eliminar órdenes en estado DRAFT o CANCELLED
    if (order.status !== PurchaseOrderStatus.DRAFT && order.status !== PurchaseOrderStatus.CANCELLED) {
      throw new ForbiddenException(
        `Solo se pueden eliminar órdenes en estado DRAFT o CANCELLED. Estado actual: ${order.status}`,
      );
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
