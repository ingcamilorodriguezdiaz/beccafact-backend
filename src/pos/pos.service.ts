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

  async createSale(companyId: string, dto: CreatePosSaleDto) {
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

    if (dto.paymentMethod === 'CASH' && dto.amountPaid < total) {
      throw new BadRequestException('El monto pagado es insuficiente');
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
      change: Math.round(change * 100) / 100,
      status: 'COMPLETED',
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

  // Actualizar la sesión POS
  await tx.posSession.update({
    where: { id: dto.sessionId },
    data: {
      totalSales: { increment: Math.round(total * 100) / 100 },
      totalTransactions: { increment: 1 },
    },
  });

  return newSale;
});

    // Generar factura electrónica si se solicitó y hay cliente
    let invoice: any = null;
    if (dto.generateInvoice && dto.customerId) {
      try {
        invoice = await this.invoicesService.create(companyId, {
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

  async generateInvoiceFromSale(companyId: string, saleId: string) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: 'COMPLETED' },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!sale) throw new NotFoundException('Venta no encontrada o no completada');
    if (!sale.customerId) {
      throw new BadRequestException(
        'La venta no tiene un cliente asignado. Asigne un cliente para generar la factura.',
      );
    }
    if (sale.invoiceId) {
      throw new BadRequestException('Ya existe una factura vinculada a esta venta.');
    }

    const invoice = await this.invoicesService.create(companyId, {
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
            select: { id: true, name: true, documentNumber: true, documentType: true },
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
        },
      }),
    ]);

    if (!sale) throw new NotFoundException('Venta no encontrada');

    return { html: this.buildReceiptHtml(sale, company) };
  }

  private buildReceiptHtml(sale: any, company: any): string {
    const fmtCOP = (n: number) =>
      new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(n);

    const date = new Date(sale.createdAt);
    const dateStr = date.toLocaleDateString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const timeStr = date.toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const cashierName = sale.session?.user
      ? `${sale.session.user.firstName} ${sale.session.user.lastName}`
      : 'N/A';

    const customerName = sale.customer?.name ?? 'CLIENTE OCASIONAL';
    const customerDoc = sale.customer
      ? `${sale.customer.documentType ?? 'Doc'}: ${sale.customer.documentNumber}`
      : '';

    const itemRows = (sale.items as any[])
      .map(
        (item: any) => `
      <tr>
        <td class="desc">${item.description}</td>
        <td class="qty">${Number(item.quantity)}</td>
        <td class="price">${fmtCOP(Number(item.unitPrice))}</td>
        <td class="total">${fmtCOP(Number(item.total))}</td>
      </tr>
      <tr class="tax-row">
        <td colspan="4" class="tax-info">
          IVA ${Number(item.taxRate)}%: ${fmtCOP(Number(item.taxAmount))}
          ${item.discount > 0 ? ` &bull; Desc. ${Number(item.discount)}%` : ''}
        </td>
      </tr>`,
      )
      .join('');

    const paymentLabels: Record<string, string> = {
      CASH: 'EFECTIVO',
      CARD: 'TARJETA',
      TRANSFER: 'TRANSFERENCIA',
      MIXED: 'MIXTO',
    };

    const companyLine2 = [company?.address, company?.city]
      .filter(Boolean)
      .join(', ');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Tirilla POS - ${sale.saleNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px; width: 302px; padding: 6px 8px;
    color: #000; background: #fff;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 5px 0; }
  .double-line { border-top: 2px solid #000; margin: 5px 0; }
  .company-name { font-size: 14px; font-weight: bold; text-align: center; line-height: 1.3; }
  .company-sub { font-size: 10px; text-align: center; margin-top: 1px; }
  .title { font-size: 12px; font-weight: bold; text-align: center; padding: 3px 0; }
  .meta { display: flex; justify-content: space-between; margin: 2px 0; font-size: 10.5px; }
  table { width: 100%; border-collapse: collapse; margin: 3px 0; }
  th {
    font-size: 10px; border-bottom: 1px solid #000;
    padding: 2px 1px; text-align: left; font-weight: bold;
  }
  th.right, td.qty, td.price, td.total { text-align: right; }
  td { font-size: 10.5px; padding: 2px 1px; vertical-align: top; }
  td.desc { width: 44%; }
  td.qty   { width: 10%; }
  td.price { width: 22%; }
  td.total { width: 24%; }
  .tax-row td { color: #555; font-size: 9.5px; padding-left: 6px; padding-bottom: 3px; }
  .totals { margin: 4px 0; }
  .tot-row { display: flex; justify-content: space-between; padding: 1.5px 0; font-size: 11px; }
  .tot-grand {
    font-size: 15px; font-weight: bold;
    border-top: 2px solid #000; padding-top: 4px; margin-top: 4px;
  }
  .payment { margin: 4px 0; }
  .footer { text-align: center; margin-top: 10px; font-size: 10px; line-height: 1.5; }
  @media print {
    body { width: 302px; }
    @page { margin: 0; size: 80mm auto; }
  }
</style>
</head>
<body>
  <div class="company-name">${company?.razonSocial ?? company?.name ?? 'EMPRESA'}</div>
  <div class="company-sub">NIT: ${company?.nit ?? ''}</div>
  ${companyLine2 ? `<div class="company-sub">${companyLine2}</div>` : ''}
  ${company?.phone ? `<div class="company-sub">Tel: ${company.phone}</div>` : ''}

  <div class="double-line"></div>
  <div class="title">TIRILLA POS</div>
  <div class="line"></div>

  <div class="meta"><span class="bold">No. Venta:</span> <span>${sale.saleNumber}</span></div>
  <div class="meta"><span class="bold">Fecha:</span> <span>${dateStr}</span></div>
  <div class="meta"><span class="bold">Hora:</span> <span>${timeStr}</span></div>
  <div class="meta"><span class="bold">Cajero:</span> <span>${cashierName}</span></div>
  <div class="line"></div>
  <div class="meta"><span class="bold">Cliente:</span> <span>${customerName}</span></div>
  ${customerDoc ? `<div class="meta"><span></span> <span>${customerDoc}</span></div>` : ''}

  <div class="line"></div>
  <table>
    <thead>
      <tr>
        <th class="desc">Producto</th>
        <th class="right">Cant</th>
        <th class="right">P.Unit</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="line"></div>

  <div class="totals">
    <div class="tot-row"><span>Subtotal:</span><span>${fmtCOP(Number(sale.subtotal))}</span></div>
    <div class="tot-row"><span>IVA:</span><span>${fmtCOP(Number(sale.taxAmount))}</span></div>
    ${Number(sale.discountAmount) > 0
      ? `<div class="tot-row"><span>Descuento:</span><span>-${fmtCOP(Number(sale.discountAmount))}</span></div>`
      : ''}
    <div class="tot-row tot-grand"><span>TOTAL:</span><span>${fmtCOP(Number(sale.total))}</span></div>
  </div>

  <div class="line"></div>
  <div class="payment">
    <div class="meta">
      <span class="bold">Método pago:</span>
      <span>${paymentLabels[sale.paymentMethod] ?? sale.paymentMethod}</span>
    </div>
    <div class="meta">
      <span class="bold">Recibido:</span>
      <span>${fmtCOP(Number(sale.amountPaid))}</span>
    </div>
    <div class="meta">
      <span class="bold">Cambio:</span>
      <span>${fmtCOP(Number(sale.change))}</span>
    </div>
  </div>

  ${sale.invoiceId
    ? `<div class="line"></div>
       <div class="center bold" style="font-size:10px">FACTURA ELECTRONICA VINCULADA</div>`
    : ''}

  <div class="double-line"></div>
  <div class="footer">
    <div class="bold">&#9733; GRACIAS POR SU COMPRA &#9733;</div>
    <div>Solicite su factura electronica</div>
    <div>al cajero si la requiere</div>
  </div>
</body>
</html>`;
  }

  // ── Cancel sale ───────────────────────────────────────────────────────────

  async cancelSale(companyId: string, saleId: string, notes?: string) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: 'COMPLETED' },
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

      await tx.posSession.update({
        where: { id: sale.sessionId },
        data: {
          totalSales: { decrement: Number(sale.total) },
          totalTransactions: { decrement: 1 },
        },
      });
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
