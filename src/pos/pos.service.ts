import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CreatePosSessionDto } from './dto/create-pos-session.dto';
import { ClosePosSessionDto } from './dto/close-pos-session.dto';
import { CreatePosSaleDto } from './dto/create-pos-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { DeliverSaleDto } from './dto/deliver-sale.dto';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private prisma: PrismaService,
    private invoicesService: InvoicesService,
  ) {}

  // ── Sessions ──────────────────────────────────────────────────────────────

  async openSession(companyId: string, userId: string, dto: CreatePosSessionDto) {
    const existing = await this.prisma.posSession.findFirst({
      where: { companyId, userId, status: 'OPEN' },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya tienes una sesión de caja abierta. Ciérrala antes de abrir una nueva.',
      );
    }

    return this.prisma.posSession.create({
      data: {
        companyId,
        userId,
        initialCash: dto.initialCash,
        notes: dto.notes,
        status: 'OPEN',
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async closeSession(companyId: string, sessionId: string, dto: ClosePosSessionDto) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId, status: 'OPEN' },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada o ya cerrada');

    const salesAgg = await this.prisma.posSale.aggregate({
      where: { sessionId, status: 'COMPLETED' },
      _sum: { total: true },
      _count: { id: true },
    });

    const totalSales = Number(salesAgg._sum.total ?? 0);
    const totalTransactions = salesAgg._count.id;
    const expectedCash = Number(session.initialCash) + totalSales;
    const cashDifference = dto.finalCash - expectedCash;

    return this.prisma.posSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        finalCash: dto.finalCash,
        expectedCash,
        cashDifference,
        totalSales,
        totalTransactions,
        notes: dto.notes ?? session.notes,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { sales: true } },
      },
    });
  }

  async findSessions(
    companyId: string,
    filters: {
      status?: string;
      userId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { status, userId, from, to, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId };

    if (status) where.status = status;
    if (userId) where.userId = userId;
    if (from || to) {
      where.openedAt = {};
      if (from) where.openedAt.gte = new Date(from);
      if (to) where.openedAt.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.posSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { openedAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { sales: true } },
        },
      }),
      this.prisma.posSession.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOneSession(companyId: string, sessionId: string) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        sales: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, name: true, documentNumber: true } },
            items: {
              include: { product: { select: { id: true, name: true, sku: true } } },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    return session;
  }

  async getActiveSession(companyId: string, userId: string) {
    return this.prisma.posSession.findFirst({
      where: { companyId, userId, status: 'OPEN' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { sales: true } },
      },
    });
  }

  // ── Sales ─────────────────────────────────────────────────────────────────

  async createSale(companyId: string,branchId: string, dto: CreatePosSaleDto) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: dto.sessionId, companyId, status: 'OPEN' },
    });
    if (!session) {
      throw new BadRequestException('La sesión de caja no está abierta o no existe');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('La venta debe tener al menos un artículo');
    }

    // Calcular totales
    let subtotal = 0;
    let taxAmount = 0;

    const itemsData = dto.items.map((item) => {
      const disc = item.discount ?? 0;
      const itemSubtotal = item.quantity * item.unitPrice * (1 - disc / 100);
      const itemTax = itemSubtotal * (item.taxRate / 100);
      const itemTotal = itemSubtotal + itemTax;
      subtotal += itemSubtotal;
      taxAmount += itemTax;
      return {
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        taxAmount: Math.round(itemTax * 100) / 100,
        discount: disc,
        subtotal: Math.round(itemSubtotal * 100) / 100,
        total: Math.round(itemTotal * 100) / 100,
      };
    });

    const cartDiscountAmount =
      dto.cartDiscountPct && dto.cartDiscountPct > 0
        ? Math.round(subtotal * (dto.cartDiscountPct / 100) * 100) / 100
        : 0;
    const total = subtotal + taxAmount - cartDiscountAmount;
    const change = Math.max(0, dto.amountPaid - total);

    const isAdvance = dto.isAdvancePayment === true && dto.amountPaid < total;

    if (!isAdvance && dto.paymentMethod === 'CASH' && dto.amountPaid < total) {
      throw new BadRequestException('El monto pagado es insuficiente');
    }

    if (isAdvance && dto.amountPaid <= 0) {
      throw new BadRequestException('El anticipo debe ser mayor a cero');
    }

    // Número secuencial: POS-YYYY-XXXXXX
    const year = new Date().getFullYear();
    const count = await this.prisma.posSale.count({
      where: { companyId, saleNumber: { startsWith: `POS-${year}-` } },
    });
    const saleNumber = `POS-${year}-${String(count + 1).padStart(6, '0')}`;

    // Crear venta y descontar stock en transacción atómica
// 1. Obtener todos los IDs
    const productIds = itemsData
  .map(i => i.productId)
  .filter((id): id is string => !!id);

// 2. Obtener productos en UNA sola consulta
const products = await this.prisma.product.findMany({
  where: { id: { in: productIds }, companyId },
});

// 3. Crear un mapa rápido de búsqueda
const productMap = new Map(products.map(p => [p.id, p]));

// 4. Validar productos y stock ANTES de la transacción
for (const item of itemsData) {
  if (!item.productId) continue;

  const product = productMap.get(item.productId);

  if (!product) {
    throw new NotFoundException(`Producto no encontrado: ${item.productId}`);
  }

  if (product.stock < Number(item.quantity)) {
    throw new BadRequestException(`Stock insuficiente para: ${product.name}`);
  }
}

// 5. Iniciar transacción SOLO para actualizar stock + crear venta
const sale = await this.prisma.$transaction(async (tx) => {
  // Actualizar stock (rápido porque ya validamos antes)
  for (const item of itemsData) {
    if (!item.productId) continue;

    await tx.product.update({
      where: { id: item.productId },
      data: {
        stock: {
          decrement: Number(item.quantity),
        },
      },
    });
  }

  // Crear la venta
  const newSale = await tx.posSale.create({
    data: {
      companyId,
      sessionId: dto.sessionId,
      customerId: dto.customerId,
      saleNumber,
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      discountAmount: cartDiscountAmount,
      total: Math.round(total * 100) / 100,
      paymentMethod: dto.paymentMethod as any,
      amountPaid: dto.amountPaid,
      change: isAdvance ? 0 : Math.round(change * 100) / 100,
      advanceAmount: isAdvance ? dto.amountPaid : 0,
      remainingAmount: isAdvance ? Math.round((total - dto.amountPaid) * 100) / 100 : 0,
      deliveryStatus: isAdvance ? 'PENDING' : 'DELIVERED',
      status: isAdvance ? 'ADVANCE' : 'COMPLETED',
      notes: dto.notes,

      // Crear items
      items: { create: itemsData },
    },
    include: {
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
      session: { select: { id: true } },
    },
  });

  // Solo actualizar totales de sesión cuando la venta está completada
  if (!isAdvance) {
    await tx.posSession.update({
      where: { id: dto.sessionId },
      data: {
        totalSales: { increment: Math.round(total * 100) / 100 },
        totalTransactions: { increment: 1 },
      },
    });
  }

  return newSale;
});

    // Generar factura electrónica solo si: pago completo, entregado y hay cliente
    let invoice: any = null;
    if (dto.generateInvoice && dto.customerId && !isAdvance) {
      try {
        invoice = await this.invoicesService.create(companyId,branchId, {
          customerId: dto.customerId,
          type: 'VENTA' as any,
          prefix: 'POS',
          issueDate: new Date().toISOString(),
          items: dto.items.map((item) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 19,
            discount: item.discount ?? 0,
          })),
          notes: `Generada desde POS - ${saleNumber}`,
          currency: 'COP',
        } as any);

        await this.prisma.posSale.update({
          where: { id: sale.id },
          data: { invoiceId: invoice.id },
        });
      } catch (err: any) {
        this.logger.warn(
          `Venta ${saleNumber}: no se pudo generar factura automática — ${err?.message}`,
        );
      }
    }

    return { ...sale, invoice };
  }

  // ── Generar factura desde venta existente ─────────────────────────────────

  async generateInvoiceFromSale(companyId: string,branchId: string, saleId: string) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Solo se puede facturar una venta completada. Si es un anticipo, primero completa el pago y marca como entregado.',
      );
    }
    if ((sale as any).deliveryStatus !== 'DELIVERED') {
      throw new BadRequestException(
        'La venta aún no ha sido entregada. Marca el pedido como entregado antes de generar la factura.',
      );
    }
    if (!sale.customerId) {
      throw new BadRequestException(
        'La venta no tiene un cliente asignado. Asigne un cliente para generar la factura.',
      );
    }
    if (sale.invoiceId) {
      throw new BadRequestException('Ya existe una factura vinculada a esta venta.');
    }

    const invoice = await this.invoicesService.create(companyId,branchId, {
      customerId: sale.customerId,
      type: 'VENTA' as any,
      prefix: 'POS',
      issueDate: sale.createdAt.toISOString(),
      items: sale.items.map((item) => ({
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
        discount: Number(item.discount),
      })),
      notes: `Generada desde POS - ${sale.saleNumber}`,
      currency: 'COP',
    } as any);

    await this.prisma.posSale.update({
      where: { id: saleId },
      data: { invoiceId: invoice.id },
    });

    return invoice;
  }

  // ── Tirilla POS ───────────────────────────────────────────────────────────

  async getReceipt(companyId: string, saleId: string): Promise<{ html: string }> {
    const [sale, company] = await Promise.all([
      this.prisma.posSale.findFirst({
        where: { id: saleId, companyId },
        include: {
          items: {
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
          customer: {
            select: { id: true, name: true, documentNumber: true, documentType: true, email: true },
          },
          session: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          name: true, nit: true, razonSocial: true,
          address: true, city: true, phone: true, email: true,
          dianResolucion: true, dianPrefijo: true,
          dianRangoDesde: true, dianRangoHasta: true,
          dianFechaDesde: true, dianFechaHasta: true,
          dianTestMode: true,
        },
      }),
    ]);

    if (!sale) throw new NotFoundException('Venta no encontrada');

    // Fetch linked invoice if exists
    let invoice: any = null;
    if (sale.invoiceId) {
      // @ts-ignore
      invoice = await this.prisma.invoice.findUnique({
        where: { id: sale.invoiceId },
        select: {
          id: true, invoiceNumber: true, prefix: true,
          dianCufe: true, dianQrCode: true, dianStatus: true,
          dianStatusCode: true, dianSentAt: true, issueDate: true, status: true,
        },
      });
    }

    // Fetch super admin company as software provider
    // @ts-ignore
    const provider = await this.prisma.user.findFirst({
      where: { isSuperAdmin: true },
      select: {
        company: { select: { razonSocial: true, nit: true, phone: true, email: true } },
      },
    });

    return { html: this.buildReceiptHtml(sale, company, invoice, provider?.company) };
  }

  private buildReceiptHtml(sale: any, company: any, invoice: any, provider: any): string {
    const fmt = (n: number | string) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n));

    const fmtNum = (n: number | string) => Number(n).toLocaleString('es-CO');

    const date = new Date(sale.createdAt);
    const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const cashierName = sale.session?.user
      ? `${sale.session.user.firstName} ${sale.session.user.lastName}`.toUpperCase()
      : 'N/A';

    const customerName = sale.customer?.name?.toUpperCase() ?? 'CONSUMIDOR FINAL';
    const customerDocType = sale.customer?.documentType ?? '';
    const customerDoc = sale.customer
      ? `${customerDocType}: ${sale.customer.documentNumber}`
      : '';
    const customerEmail = sale.customer?.email ?? '';

    const paymentLabels: Record<string, string> = {
      CASH: 'CONTADO / EFECTIVO',
      CARD: 'TARJETA DÉBITO/CRÉDITO',
      TRANSFER: 'TRANSFERENCIA BANCARIA',
      MIXED: 'PAGO MIXTO',
    };

    // ── Items ──────────────────────────────────────────────────────────────────
    let itemNo = 0;
    const totalQty = (sale.items as any[]).reduce((s: number, i: any) => s + Number(i.quantity), 0);
    const totalLines = sale.items.length;

    const itemRows = (sale.items as any[]).map((item: any) => {
      itemNo++;
      const disc = Number(item.discount) > 0
        ? `<br/><span style="font-size:9px;color:#555">Desc ${Number(item.discount)}%: -${fmt(Number(item.unitPrice) * Number(item.quantity) * Number(item.discount) / 100)}</span>`
        : '';
      return `
        <tr>
          <td style="vertical-align:top;font-size:9.5px;padding:1px 0">${itemNo}</td>
          <td style="vertical-align:top;font-size:9.5px;padding:1px 0">${item.description}${disc}</td>
          <td style="text-align:right;vertical-align:top;font-size:9.5px;padding:1px 0">${fmt(item.unitPrice)}</td>
          <td style="text-align:right;vertical-align:top;font-size:9.5px;padding:1px 0">${fmtNum(item.quantity)}</td>
          <td style="text-align:right;vertical-align:top;font-size:9.5px;padding:1px 0">${fmt(item.total)}</td>
        </tr>`;
    }).join('');

    // ── IVA breakdown by rate ──────────────────────────────────────────────────
    const taxByRate: Record<string, { base: number; tax: number; total: number }> = {};
    for (const item of sale.items as any[]) {
      const rate = Number(item.taxRate);
      const key = `${rate}%`;
      if (!taxByRate[key]) taxByRate[key] = { base: 0, tax: 0, total: 0 };
      taxByRate[key].base  += Number(item.subtotal);
      taxByRate[key].tax   += Number(item.taxAmount);
      taxByRate[key].total += Number(item.total);
    }

    const ivaRows = Object.entries(taxByRate).map(([rate, vals]) => `
      <tr>
        <td style="font-size:9px;padding:1px 0">${rate}</td>
        <td style="font-size:9px;padding:1px 0">Gravado</td>
        <td style="text-align:right;font-size:9px;padding:1px 0">${fmt(vals.base)}</td>
        <td style="text-align:right;font-size:9px;padding:1px 0">${fmt(vals.tax)}</td>
        <td style="text-align:right;font-size:9px;padding:1px 0">${fmt(vals.total)}</td>
      </tr>`).join('');

    // ── Resolution info ────────────────────────────────────────────────────────
    const resolucionBlock = company?.dianResolucion ? `
      <div style="font-size:9px;text-align:center;margin:3px 0;line-height:1.4">
        Resolución DIAN No. <b>${company.dianResolucion}</b>${company.dianPrefijo ? ` Prefijo <b>${company.dianPrefijo}</b>` : ''}<br/>
        ${company.dianRangoDesde && company.dianRangoHasta ? `Rango: <b>${company.dianRangoDesde}</b> al <b>${company.dianRangoHasta}</b>` : ''}
        ${company.dianFechaDesde && company.dianFechaHasta ? `<br/>Vigencia: ${company.dianFechaDesde} al ${company.dianFechaHasta}` : ''}
      </div>` : '';

    // ── Advance payment block ──────────────────────────────────────────────────
    const advanceBlock = sale.status === 'ADVANCE' ? `
      <div style="border:1px dashed #000;padding:4px 6px;margin:4px 0;font-size:9.5px">
        <b>** ANTICIPO / PAGO PARCIAL **</b><br/>
        Anticipo recibido: ${fmt(sale.amountPaid)}<br/>
        Saldo pendiente: <b>${fmt(sale.remainingAmount)}</b><br/>
        Estado entrega: ${(sale.deliveryStatus === 'DELIVERED') ? 'ENTREGADO' : 'PENDIENTE ENTREGA'}
      </div>` : '';

    // ── QR Code block ──────────────────────────────────────────────────────────
    const qrContent = invoice?.dianCufe
      ? `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${invoice.dianCufe}`
      : invoice?.dianQrCode
        ? invoice.dianQrCode
        : `BeccaFact:${sale.saleNumber}`;

    const qrBlock = `
      <div style="text-align:center;margin:6px 0">
        <div id="qr-container" style="display:inline-block;padding:4px;border:1px solid #ccc"></div>
      </div>`;

    // ── Electronic invoice block ───────────────────────────────────────────────
    const cufeStr = invoice?.dianCufe ?? '';
    const cufeDisplay = cufeStr
      ? cufeStr.match(/.{1,30}/g)?.join('<br/>') ?? cufeStr
      : '';

    const invBlock = invoice ? `
      <div style="margin:4px 0">
        <div style="font-size:9.5px;font-weight:bold;text-align:center">** FACTURA ELECTRÓNICA DE VENTA **</div>
        <div style="font-size:9px;text-align:center">${invoice.prefix ?? ''}${invoice.invoiceNumber ?? ''}</div>
        ${invoice.dianStatusCode === '00'
          ? `<div style="font-size:9px;text-align:center;font-weight:bold">✓ ACEPTADA POR LA DIAN</div>`
          : company?.dianTestMode
            ? `<div style="font-size:9px;text-align:center">AMBIENTE DE PRUEBAS</div>`
            : `<div style="font-size:9px;text-align:center">Estado: ${invoice.dianStatus ?? 'PROCESANDO'}</div>`}
        ${cufeDisplay ? `
        <div style="font-size:8.5px;margin-top:4px;word-break:break-all">
          <b>CUFE:</b><br/>${cufeDisplay}
        </div>` : ''}
        ${invoice.dianSentAt ? `<div style="font-size:8.5px">Enviada DIAN: ${new Date(invoice.dianSentAt).toLocaleString('es-CO')}</div>` : ''}
      </div>` : '';

    // ── Software / Provider block ──────────────────────────────────────────────
    const providerBlock = `
      <div style="font-size:8.5px;text-align:center;margin:4px 0;line-height:1.5">
        <b>SOFTWARE FACTURACIÓN ELECTRÓNICA</b><br/>
        BeccaFact — Sistema ERP SaaS<br/>
        ${provider?.razonSocial ? `Proveedor Tecnológico: ${provider.razonSocial}` : 'Proveedor Tecnológico: BeccaSoft'}<br/>
        ${provider?.nit ? `NIT Proveedor: ${provider.nit}` : ''}
      </div>`;

    // ── Barcode (Code128-like via text) ────────────────────────────────────────
    const barcode128 = `
      <div id="barcode-container" style="text-align:center;margin:4px 0;overflow:hidden"></div>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tirilla POS — ${sale.saleNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10.5px; width: 302px; padding: 5px 7px;
    color: #000; background: #fff;
  }
  .sep-dbl { border-top: 2px solid #000; margin: 4px 0; }
  .sep-sng { border-top: 1px solid #000; margin: 4px 0; }
  .sep-dsh { border-top: 1px dashed #000; margin: 4px 0; }
  .sep-star { text-align:center; font-size:9px; letter-spacing:2px; margin:3px 0; color:#333; }
  .c { text-align:center; }
  .b { font-weight:bold; }
  .r { text-align:right; }
  .row { display:flex; justify-content:space-between; font-size:10px; padding:1.5px 0; }
  .row-grand { display:flex; justify-content:space-between; font-size:14px; font-weight:bold; padding:3px 0; border-top:1px solid #000; margin-top:3px; }
  @media print {
    body { width: 302px; margin:0; padding:4px 6px; }
    @page { margin:0; size: 80mm auto; }
    button { display:none !important; }
  }
</style>
</head>
<body>

<!-- ═══ ENCABEZADO COMERCIO ═══ -->
<div style="text-align:center;margin-bottom:4px">
  <div style="font-size:13px;font-weight:bold;line-height:1.3">${company?.razonSocial ?? company?.name ?? 'EMPRESA'}</div>
  <div style="font-size:10px">NIT: ${company?.nit ?? ''}</div>
  ${company?.address ? `<div style="font-size:9.5px">${company.address}${company.city ? ` — ${company.city}` : ''}</div>` : ''}
  ${company?.phone ? `<div style="font-size:9.5px">Tel: ${company.phone}</div>` : ''}
  ${company?.email ? `<div style="font-size:9.5px">${company.email}</div>` : ''}
</div>
${resolucionBlock}
<div class="sep-dbl"></div>

<!-- ═══ TIPO DE DOCUMENTO ═══ -->
<div style="text-align:center;font-size:10.5px;font-weight:bold;margin:2px 0">
  ${invoice ? `FACTURA ELECTRÓNICA DE VENTA` : `DOCUMENTO EQUIVALENTE POS`}
</div>
<div style="text-align:center;font-size:9.5px">${invoice ? `${invoice.prefix ?? ''}${invoice.invoiceNumber ?? ''}` : sale.saleNumber}</div>
<div class="sep-sng"></div>

<!-- ═══ FECHA Y CAJERO ═══ -->
<div class="row"><span>Fecha:</span><span>${dateStr}</span></div>
<div class="row"><span>Hora:</span><span>${timeStr}</span></div>
<div class="row"><span>No. Venta POS:</span><span>${sale.saleNumber}</span></div>
<div class="row"><span>Cajero:</span><span>${cashierName}</span></div>
<div class="sep-dsh"></div>

<!-- ═══ CLIENTE ═══ -->
<div class="row"><span class="b">Cliente:</span><span>${customerName}</span></div>
${customerDoc ? `<div class="row"><span>Identificación:</span><span>${customerDoc}</span></div>` : ''}
${customerEmail ? `<div class="row"><span>Email:</span><span style="font-size:8.5px">${customerEmail}</span></div>` : ''}
<div class="sep-dsh"></div>

<!-- ═══ PRODUCTOS ═══ -->
<table style="width:100%;border-collapse:collapse">
  <thead>
    <tr style="border-bottom:1px solid #000">
      <th style="text-align:left;font-size:9px;font-weight:bold;padding:1px 0;width:5%">#</th>
      <th style="text-align:left;font-size:9px;font-weight:bold;padding:1px 0">Descripción</th>
      <th style="text-align:right;font-size:9px;font-weight:bold;padding:1px 0;width:22%">Vr.Unit</th>
      <th style="text-align:right;font-size:9px;font-weight:bold;padding:1px 0;width:9%">Cant</th>
      <th style="text-align:right;font-size:9px;font-weight:bold;padding:1px 0;width:22%">Vr.Total</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>
<div style="border-top:1px dashed #000;margin:3px 0"></div>

<!-- ═══ RESUMEN ═══ -->
<div style="font-size:9px;margin:2px 0">Total artículos vendidos: <b>${fmtNum(totalQty)}</b></div>
<div style="font-size:9px;margin:2px 0">Total líneas POS: <b>${totalLines}</b></div>
<div class="sep-dsh"></div>

<!-- ═══ SUBTOTAL / TOTAL ═══ -->
<div class="row"><span>** SUBTOTAL / TOTAL --&gt;</span><span class="b">$ ${fmtNum(sale.total)}</span></div>
<div style="margin:4px 0">
  <div class="row"><span>Subtotal (sin IVA):</span><span>${fmt(sale.subtotal)}</span></div>
  <div class="row"><span>Total IVA:</span><span>${fmt(sale.taxAmount)}</span></div>
  ${Number(sale.discountAmount) > 0
    ? `<div class="row"><span>Descuento:</span><span>-${fmt(sale.discountAmount)}</span></div>`
    : ''}
  <div class="row-grand"><span>TOTAL A PAGAR:</span><span>${fmt(sale.total)}</span></div>
</div>
<div class="sep-sng"></div>

<!-- ═══ FORMA DE PAGO ═══ -->
<div style="font-size:10px;font-weight:bold;margin:2px 0">FORMA DE PAGO: ${paymentLabels[sale.paymentMethod] ?? sale.paymentMethod}</div>
${advanceBlock}
<div class="row"><span>Recibido:</span><span>${fmt(sale.amountPaid)}</span></div>
${Number(sale.change) > 0
  ? `<div class="row"><span>Cambio entregado:</span><span>${fmt(sale.change)}</span></div>`
  : ''}
<div class="sep-sng"></div>

<!-- ═══ DETALLE DE IMPUESTOS IVA ═══ -->
<div style="font-size:9.5px;font-weight:bold;margin:2px 0">** DETALLE DE IMPUESTOS IVA **</div>
<table style="width:100%;border-collapse:collapse">
  <thead>
    <tr style="border-bottom:1px solid #000">
      <th style="text-align:left;font-size:8.5px;font-weight:bold;padding:1px 0;width:12%">Tipo</th>
      <th style="text-align:left;font-size:8.5px;font-weight:bold;padding:1px 0;width:18%">Correc</th>
      <th style="text-align:right;font-size:8.5px;font-weight:bold;padding:1px 0">Base/Imp</th>
      <th style="text-align:right;font-size:8.5px;font-weight:bold;padding:1px 0">IVA</th>
      <th style="text-align:right;font-size:8.5px;font-weight:bold;padding:1px 0">Total</th>
    </tr>
  </thead>
  <tbody>${ivaRows}</tbody>
  <tr style="border-top:1px solid #000">
    <td colspan="2" style="font-size:8.5px;font-weight:bold;padding:1px 0">TOTAL</td>
    <td style="text-align:right;font-size:8.5px;font-weight:bold;padding:1px 0">${fmt(sale.subtotal)}</td>
    <td style="text-align:right;font-size:8.5px;font-weight:bold;padding:1px 0">${fmt(sale.taxAmount)}</td>
    <td style="text-align:right;font-size:8.5px;font-weight:bold;padding:1px 0">${fmt(sale.total)}</td>
  </tr>
</table>
<div class="sep-dsh"></div>

<!-- ═══ CAJERO ═══ -->
<div style="font-size:9.5px;text-align:center;margin:3px 0">Lo Atendió: <b>${cashierName}</b></div>
<div class="sep-star">* * * * * * * * * * * * *</div>
<div style="text-align:center;font-size:9.5px;margin:2px 0">RÉGIMEN COMÚN</div>
<div class="sep-dsh"></div>

<!-- ═══ QR CODE ═══ -->
${qrBlock}

<!-- ═══ FACTURA ELECTRÓNICA ═══ -->
${invBlock}
<div class="sep-dsh"></div>

<!-- ═══ SOFTWARE / PROVEEDOR ═══ -->
${providerBlock}
<div class="sep-dbl"></div>

<!-- ═══ MENSAJE LEGAL ═══ -->
<div style="text-align:center;font-size:9px;font-weight:bold;margin:4px 0;line-height:1.5">
  *** GRACIAS POR SU COMPRA ***<br/>
  Conserve este documento para reclamaciones.<br/>
  Esta venta es definitiva y no tiene cambio<br/>
  salvo defecto de fábrica.<br/>
  PROHIBIDA LA VENTA DE LICOR<br/>
  A MENORES DE EDAD
</div>
<div class="sep-dbl"></div>

<!-- ═══ CÓDIGO DE BARRAS ═══ -->
${barcode128}
<div style="text-align:center;font-size:8px;margin-bottom:4px">${sale.saleNumber}</div>

<!-- Print button (hidden on print) -->
<div style="text-align:center;margin-top:12px" class="no-print">
  <button onclick="window.print()" style="padding:8px 22px;font-size:13px;cursor:pointer;border:1px solid #333;border-radius:4px;background:#f5f5f5">
    🖨️ Imprimir
  </button>
</div>

<script>
(function() {
  // QR Code using qrcodejs
  var qrScript = document.createElement('script');
  qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  qrScript.onload = function() {
    try {
      new QRCode(document.getElementById('qr-container'), {
        text: ${JSON.stringify(qrContent)},
        width: 130,
        height: 130,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch(e) {
      document.getElementById('qr-container').innerHTML = '<div style="font-size:9px;padding:10px">QR no disponible</div>';
    }
  };
  qrScript.onerror = function() {
    document.getElementById('qr-container').innerHTML = '<div style="font-size:9px;padding:6px;border:1px dashed #999">[QR: ${sale.saleNumber}]</div>';
  };
  document.head.appendChild(qrScript);

  // Simple barcode using SVG bars (Code 128 visual approximation)
  var saleNum = ${JSON.stringify(sale.saleNumber)};
  var bc = document.getElementById('barcode-container');
  if (bc) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="38" viewBox="0 0 280 38">';
    var chars = saleNum.split('');
    var x = 2;
    var barW = [2,1,1,2,1,2,1,2,1,1];
    var idx = 0;
    while (x < 278) {
      var w = barW[idx % barW.length] + (chars[idx % chars.length] ? (chars[idx % chars.length].charCodeAt(0) % 2) : 0);
      svg += '<rect x="' + x + '" y="0" width="' + w + '" height="32" fill="' + (idx % 2 === 0 ? '#000' : '#fff') + '"/>';
      x += w + 1;
      idx++;
    }
    svg += '</svg>';
    bc.innerHTML = svg;
  }
})();
</script>
</body>
</html>`;
  }

  // ── Cancel sale ───────────────────────────────────────────────────────────

  async cancelSale(companyId: string, saleId: string, notes?: string) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: { in: ['COMPLETED', 'ADVANCE'] as any } },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada o ya cancelada');

    await this.prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: Number(item.quantity) } },
          });
        }
      }

      await tx.posSale.update({
        where: { id: saleId },
        data: { status: 'CANCELLED', notes: notes ?? sale.notes },
      });

      // Solo descontar sesión si la venta ya había sido contabilizada (COMPLETED)
      if (sale.status === 'COMPLETED') {
        await tx.posSession.update({
          where: { id: sale.sessionId },
          data: {
            totalSales: { decrement: Number(sale.total) },
            totalTransactions: { decrement: 1 },
          },
        });
      }
    });

    return { message: 'Venta cancelada exitosamente' };
  }

  // ── List sales ────────────────────────────────────────────────────────────

  async findSales(
    companyId: string,
    filters: {
      sessionId?: string;
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
      search?: string;
    },
  ) {
    const { sessionId, status, from, to, page = 1, limit = 20, search } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId };

    if (sessionId) where.sessionId = sessionId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.posSale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          session: { select: { id: true, openedAt: true } },
        },
      }),
      this.prisma.posSale.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ── Refund sale ───────────────────────────────────────────────────────────

  async refundSale(companyId: string, saleId: string, dto: RefundSaleDto) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId },
      include: { items: true, session: true },
    });

    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.status !== 'COMPLETED') {
      throw new BadRequestException('Solo se pueden reembolsar ventas completadas');
    }
    if (sale.session.status !== 'OPEN') {
      throw new BadRequestException('La sesión de caja debe estar abierta para reembolsar');
    }

    return this.prisma.$transaction(async (tx) => {
      // Restituir stock de cada item
      for (const item of sale.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: Number(item.quantity) } },
          });
        }
      }

      // Marcar venta como REFUNDED
      const refunded = await tx.posSale.update({
        where: { id: saleId },
        data: {
          status: 'REFUNDED',
          notes: dto.reason
            ? `[REEMBOLSO] ${dto.reason}` + (sale.notes ? `\n${sale.notes}` : '')
            : sale.notes,
        },
      });

      // Descontar totales de la sesión
      await tx.posSession.update({
        where: { id: sale.sessionId },
        data: {
          totalSales: { decrement: Number(sale.total) },
          totalTransactions: { decrement: 1 },
        },
      });

      return refunded;
    });
  }

  // ── Agregar pago a anticipo ───────────────────────────────────────────────

  async addPayment(companyId: string, branchId: string, saleId: string, dto: AddPaymentDto) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: 'ADVANCE' as any },
    });
    if (!sale) throw new NotFoundException('Venta con anticipo no encontrada');

    const remaining = Number((sale as any).remainingAmount);
    if (dto.amountPaid > remaining + 0.01) {
      throw new BadRequestException(
        `El monto excede el saldo pendiente de ${remaining.toFixed(2)}`,
      );
    }

    const newAmountPaid = Number(sale.amountPaid) + dto.amountPaid;
    const newRemaining = Math.max(0, remaining - dto.amountPaid);
    const isFullyPaid = newRemaining <= 0;
    const deliveryStatus = (sale as any).deliveryStatus;
    const isDelivered = deliveryStatus === 'DELIVERED';

    const updated = await this.prisma.posSale.update({
      where: { id: saleId },
      data: {
        amountPaid: Math.round(newAmountPaid * 100) / 100,
        remainingAmount: Math.round(newRemaining * 100) / 100,
        paymentMethod: dto.paymentMethod as any,
        status: isFullyPaid && isDelivered ? 'COMPLETED' : 'ADVANCE',
        notes: dto.notes
          ? `${sale.notes ?? ''}\n[PAGO] ${dto.notes}`.trim()
          : sale.notes,
      } as any,
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
      },
    });

    // Si queda completada, actualizar sesión
    if (isFullyPaid && isDelivered) {
      await this.prisma.posSession.update({
        where: { id: sale.sessionId },
        data: {
          totalSales: { increment: Number(sale.total) },
          totalTransactions: { increment: 1 },
        },
      });
    }

    return updated;
  }

  // ── Marcar como entregado ─────────────────────────────────────────────────

  async markDelivered(companyId: string, branchId: string, saleId: string, dto: DeliverSaleDto) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: { in: ['ADVANCE', 'COMPLETED'] as any } },
      include: { items: true, customer: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if ((sale as any).deliveryStatus === 'DELIVERED') {
      throw new BadRequestException('El pedido ya está marcado como entregado');
    }

    const remaining = Number((sale as any).remainingAmount);
    const isFullyPaid = remaining <= 0;
    const newStatus = isFullyPaid ? 'COMPLETED' : 'ADVANCE';

    const updated = await this.prisma.posSale.update({
      where: { id: saleId },
      data: {
        deliveryStatus: 'DELIVERED',
        status: newStatus,
        notes: dto.notes
          ? `${sale.notes ?? ''}\n[ENTREGA] ${dto.notes}`.trim()
          : sale.notes,
      } as any,
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
      },
    });

    // Si queda completada, actualizar sesión
    if (isFullyPaid && sale.status !== 'COMPLETED') {
      await this.prisma.posSession.update({
        where: { id: sale.sessionId },
        data: {
          totalSales: { increment: Number(sale.total) },
          totalTransactions: { increment: 1 },
        },
      });
    }

    // Generar factura si se solicitó y hay cliente
    let invoice: any = null;
    if (dto.generateInvoice && sale.customerId && isFullyPaid) {
      try {
        invoice = await this.invoicesService.create(companyId, branchId, {
          customerId: sale.customerId,
          type: 'VENTA' as any,
          prefix: 'POS',
          issueDate: new Date().toISOString(),
          items: (sale as any).items.map((item: any) => ({
            productId: item.productId ?? undefined,
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate),
            discount: Number(item.discount),
          })),
          notes: `Generada desde POS (anticipo) - ${sale.saleNumber}`,
          currency: 'COP',
        } as any);

        await this.prisma.posSale.update({
          where: { id: saleId },
          data: { invoiceId: invoice.id },
        });
      } catch (err: any) {
        this.logger.warn(
          `Venta ${sale.saleNumber}: no se pudo generar factura al entregar — ${err?.message}`,
        );
      }
    }

    return { ...updated, invoice };
  }

  // ── Cash movements ────────────────────────────────────────────────────────

  async createCashMovement(
    companyId: string,
    sessionId: string,
    userId: string,
    dto: CreateCashMovementDto,
  ) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId },
    });

    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status !== 'OPEN') {
      throw new BadRequestException('La sesión debe estar abierta para registrar movimientos');
    }

    return this.prisma.posCashMovement.create({
      data: {
        companyId,
        sessionId,
        userId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
      },
    });
  }

  async getCashMovements(companyId: string, sessionId: string) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    return this.prisma.posCashMovement.findMany({
      where: { sessionId, companyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSalesSummary(companyId: string, from?: string, to?: string, sessionId?: string) {
    const where: any = { companyId, status: 'COMPLETED' };
    if (sessionId) where.sessionId = sessionId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [agg, byPayment] = await Promise.all([
      this.prisma.posSale.aggregate({
        where,
        _sum: { total: true, taxAmount: true, subtotal: true },
        _count: { id: true },
        _avg: { total: true },
      }),
      this.prisma.posSale.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const byPaymentMethod: Record<string, { total: number; count: number }> = {};
    for (const p of byPayment) {
      byPaymentMethod[p.paymentMethod] = {
        total: Number(p._sum.total ?? 0),
        count: p._count.id,
      };
    }

    return {
      totalSales: Number(agg._sum.total ?? 0),
      totalTransactions: agg._count.id,
      totalTax: Number(agg._sum.taxAmount ?? 0),
      totalSubtotal: Number(agg._sum.subtotal ?? 0),
      avgTicket: Number(agg._avg.total ?? 0),
      byPaymentMethod,
    };
  }
}
