import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AccountingService } from '../accounting/accounting.service';
import { PurchasingService } from '../purchasing/purchasing.service';
import { CarteraService } from '../cartera/cartera.service';
import { CreatePosSessionDto } from './dto/create-pos-session.dto';
import { ClosePosSessionDto } from './dto/close-pos-session.dto';
import { ApproveClosePosSessionDto } from './dto/approve-close-pos-session.dto';
import { ReopenPosSessionDto } from './dto/reopen-pos-session.dto';
import { CreatePosSaleDto, PosOrderTypeDto, PosSalePaymentLineDto } from './dto/create-pos-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { DeliverSaleDto } from './dto/deliver-sale.dto';
import { DispatchSaleDto } from './dto/dispatch-sale.dto';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { CancelPosSaleDto } from './dto/cancel-pos-sale.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import {
  CreatePosPostSaleRequestDto,
  ResolvePosPostSaleRequestDto,
} from './dto/create-pos-post-sale-request.dto';
import { CreatePosTerminalDto } from './dto/create-pos-terminal.dto';
import { UpdatePosTerminalDto } from './dto/update-pos-terminal.dto';
import { CreatePosShiftTemplateDto } from './dto/create-pos-shift-template.dto';
import { UpdatePosShiftTemplateDto } from './dto/update-pos-shift-template.dto';
import {
  CreatePosComboDto,
  CreatePosPriceListDto,
  CreatePosPromotionDto,
  PreviewPosPricingDto,
  UpdatePosComboDto,
  UpdatePosPriceListDto,
  UpdatePosPromotionDto,
} from './dto/pos-pricing.dto';
import {
  CreatePosLoyaltyCampaignDto,
  UpdatePosLoyaltyCampaignDto,
} from './dto/pos-loyalty.dto';
import {
  CreatePosCouponDto,
  CreatePosExternalOrderDto,
  CreatePosReplenishmentRequestDto,
  ReconcilePosElectronicPaymentsDto,
  UpdatePosCouponDto,
  UpdatePosExternalOrderStatusDto,
} from './dto/pos-enterprise-integrations.dto';
import {
  CreatePosInventoryLocationDto,
  CreatePosInventoryTransferDto,
  UpdatePosInventoryLocationDto,
  UpsertPosInventoryStockDto,
} from './dto/pos-inventory.dto';
import {
  CreatePosSupervisorOverrideDto,
  ResolvePosSupervisorOverrideDto,
  SavePosGovernanceRuleDto,
} from './dto/pos-governance.dto';
import { HeartbeatPosTerminalDto } from './dto/heartbeat-pos-terminal.dto';
import {
  CreatePosConfigDeploymentDto,
  ResolvePosOperationalIncidentDto,
} from './dto/pos-resilience.dto';

type PosGovernanceActionValue =
  | 'MANUAL_DISCOUNT'
  | 'CASH_WITHDRAWAL'
  | 'CANCEL_SALE'
  | 'REFUND_SALE'
  | 'REOPEN_SESSION'
  | 'APPROVE_POST_SALE';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private prisma: PrismaService,
    private invoicesService: InvoicesService,
    private accountingService: AccountingService,
    private purchasingService: PurchasingService,
    private carteraService: CarteraService,
  ) {}

  private sumDenominations(denominations?: Record<string, number> | null) {
    if (!denominations) return 0;
    return Object.entries(denominations).reduce((total, [value, qty]) => {
      const amount = Number(value);
      const units = Number(qty ?? 0);
      if (!Number.isFinite(amount) || !Number.isFinite(units)) return total;
      return total + amount * units;
    }, 0);
  }

  private roundCurrency(value: number) {
    return Math.round(value * 100) / 100;
  }

  private async createIntegrationTrace(params: {
    companyId: string;
    branchId?: string | null;
    createdById?: string | null;
    module: string;
    sourceType: string;
    sourceId: string;
    targetType?: string | null;
    targetId?: string | null;
    status: string;
    message?: string | null;
    payload?: any;
  }) {
    return this.prisma.posIntegrationTrace.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId ?? null,
        createdById: params.createdById ?? null,
        module: params.module,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        status: params.status,
        message: params.message ?? null,
        payload: params.payload ?? undefined,
      },
    });
  }

  private normalizeChannel(value?: string | null) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized || 'POS';
  }

  private buildPosStatementSummary(pendingSales: any[]) {
    const pendingAmount = this.roundCurrency(
      pendingSales.reduce((sum, sale) => sum + Number(sale.remainingAmount ?? 0), 0),
    );
    return {
      pendingCount: pendingSales.length,
      pendingAmount,
      recentPending: pendingSales.map((sale) => ({
        id: sale.id,
        saleNumber: sale.saleNumber,
        total: Number(sale.total),
        remainingAmount: Number(sale.remainingAmount),
        createdAt: sale.createdAt,
        orderType: sale.orderType,
        paymentMethod: sale.paymentMethod,
      })),
    };
  }

  private async validateCouponForSale(params: {
    companyId: string;
    branchId?: string;
    customerId?: string;
    couponCode?: string;
    subtotal: number;
  }) {
    if (!params.couponCode?.trim()) return null;
    const coupon = await this.prisma.posCoupon.findFirst({
      where: {
        companyId: params.companyId,
        code: params.couponCode.trim(),
        isActive: true,
      },
      include: {
        customer: {
          select: {
            id: true,
            customerSegment: true,
            membershipTier: true,
            loyaltyPointsBalance: true,
          },
        },
      },
    });
    if (!coupon) throw new BadRequestException('Cupón POS no encontrado o inactivo');
    const now = new Date();
    if (coupon.branchId && params.branchId && coupon.branchId !== params.branchId) {
      throw new BadRequestException('El cupón no aplica para esta sucursal');
    }
    if (coupon.customerId && coupon.customerId !== params.customerId) {
      throw new BadRequestException('El cupón está asignado a otro cliente');
    }
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('El cupón todavía no está vigente');
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw new BadRequestException('El cupón ya expiró');
    }
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      throw new BadRequestException('El cupón ya alcanzó su límite de uso');
    }
    if (coupon.minSubtotal && Number(params.subtotal) + 0.001 < Number(coupon.minSubtotal)) {
      throw new BadRequestException('El cupón requiere un subtotal mínimo mayor');
    }
    if ((coupon.targetSegment || coupon.targetTier) && !params.customerId) {
      throw new BadRequestException('El cupón requiere un cliente identificado');
    }

    if ((coupon.targetSegment || coupon.targetTier) && params.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: params.customerId, companyId: params.companyId, deletedAt: null },
        select: {
          id: true,
          customerSegment: true,
          membershipTier: true,
        },
      });
      if (!customer) throw new BadRequestException('Cliente POS no encontrado para validar cupón');
      if (coupon.targetSegment && coupon.targetSegment !== customer.customerSegment) {
        throw new BadRequestException('El cupón no aplica para el segmento del cliente');
      }
      if (coupon.targetTier && coupon.targetTier !== customer.membershipTier) {
        throw new BadRequestException('El cupón no aplica para la membresía del cliente');
      }
    }

    const discount =
      coupon.discountMode === 'PERCENT'
        ? this.roundCurrency(Number(params.subtotal) * (Number(coupon.discountValue) / 100))
        : this.roundCurrency(Math.min(Number(params.subtotal), Number(coupon.discountValue)));

    return {
      coupon,
      discount,
    };
  }

  private async validateLoyaltyRedemption(companyId: string, customerId: string | undefined, pointsToRedeem?: number) {
    const requestedPoints = Math.max(0, Math.floor(Number(pointsToRedeem ?? 0)));
    if (!requestedPoints) return null;
    if (!customerId) {
      throw new BadRequestException('Debes seleccionar un cliente para redimir puntos');
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { id: true, loyaltyPointsBalance: true, loyaltyCode: true },
    });
    if (!customer) throw new NotFoundException('Cliente POS no encontrado');
    if (Number(customer.loyaltyPointsBalance ?? 0) < requestedPoints) {
      throw new BadRequestException('El cliente no tiene suficientes puntos disponibles');
    }
    return {
      customer,
      points: requestedPoints,
      amount: requestedPoints,
    };
  }

  async findCoupons(companyId: string, branchId?: string) {
    return this.prisma.posCoupon.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createCoupon(companyId: string, branchId: string | undefined, dto: CreatePosCouponDto) {
    return this.prisma.posCoupon.create({
      data: {
        companyId,
        branchId: branchId ?? null,
        customerId: dto.customerId ?? null,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        discountMode: dto.discountMode,
        discountValue: dto.discountValue,
        pointsCost: dto.pointsCost ?? 0,
        minSubtotal: dto.minSubtotal ?? null,
        targetSegment: dto.targetSegment?.trim() || null,
        targetTier: dto.targetTier?.trim() || null,
        usageLimit: dto.usageLimit ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        isActive: dto.isActive ?? true,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
  }

  async updateCoupon(companyId: string, id: string, dto: UpdatePosCouponDto) {
    const current = await this.prisma.posCoupon.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!current) throw new NotFoundException('Cupón POS no encontrado');
    return this.prisma.posCoupon.update({
      where: { id },
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        discountMode: dto.discountMode,
        discountValue: dto.discountValue,
        pointsCost: dto.pointsCost ?? 0,
        minSubtotal: dto.minSubtotal ?? null,
        targetSegment: dto.targetSegment?.trim() || null,
        targetTier: dto.targetTier?.trim() || null,
        usageLimit: dto.usageLimit ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        customerId: dto.customerId ?? null,
        isActive: dto.isActive ?? true,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
  }

  async findExternalOrders(companyId: string, branchId?: string) {
    return this.prisma.posExternalOrder.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        sales: { select: { id: true, saleNumber: true, status: true, total: true, orderStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createExternalOrder(companyId: string, branchId: string | undefined, dto: CreatePosExternalOrderDto) {
    const items = dto.items ?? [];
    const subtotal = this.roundCurrency(
      items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0),
    );
    const taxAmount = this.roundCurrency(
      items.reduce(
        (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice) * (Number(item.taxRate ?? 0) / 100),
        0,
      ),
    );
    return this.prisma.posExternalOrder.create({
      data: {
        companyId,
        branchId: branchId ?? null,
        customerId: dto.customerId ?? null,
        channel: this.normalizeChannel(dto.channel),
        externalOrderNumber: dto.externalOrderNumber.trim(),
        status: dto.status?.trim().toUpperCase() || 'PENDING',
        orderType: dto.orderType ?? 'PICKUP',
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        deliveryAddress: dto.deliveryAddress?.trim() || null,
        contactName: dto.contactName?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
        subtotal,
        taxAmount,
        total: this.roundCurrency(subtotal + taxAmount),
        payload: {
          ...(dto.payload ?? {}),
          items,
        } as any,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
  }

  async updateExternalOrderStatus(companyId: string, id: string, dto: UpdatePosExternalOrderStatusDto) {
    const order = await this.prisma.posExternalOrder.findFirst({
      where: { id, companyId },
      select: { id: true, payload: true },
    });
    if (!order) throw new NotFoundException('Pedido externo POS no encontrado');
    return this.prisma.posExternalOrder.update({
      where: { id },
      data: {
        status: dto.status.trim().toUpperCase(),
        payload: {
          ...((order.payload as any) ?? {}),
          ...(dto.payload ?? {}),
        },
        syncedAt: new Date(),
      },
    });
  }

  async getCustomerAccountStatement(companyId: string, customerId: string, branchId?: string) {
    const [carteraStatement, pendingSales, customer] = await Promise.all([
      this.carteraService.getCustomerStatement(companyId, customerId, branchId).catch(() => null),
      this.prisma.posSale.findMany({
        where: {
          companyId,
          customerId,
          ...(branchId ? { branchId } : {}),
          remainingAmount: { gt: 0 } as any,
          status: { in: ['ADVANCE', 'COMPLETED'] as any[] },
        },
        select: {
          id: true,
          saleNumber: true,
          total: true,
          remainingAmount: true,
          createdAt: true,
          orderType: true,
          paymentMethod: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.findFirst({
        where: { id: customerId, companyId, deletedAt: null },
        select: {
          id: true,
          name: true,
          documentNumber: true,
          loyaltyPointsBalance: true,
          membershipTier: true,
          customerSegment: true,
        },
      }),
    ]);

    if (!customer) throw new NotFoundException('Cliente no encontrado');

    return {
      customer,
      cartera: carteraStatement,
      pos: this.buildPosStatementSummary(pendingSales),
      summary: {
        posPendingAmount: this.roundCurrency(
          pendingSales.reduce((sum, sale) => sum + Number(sale.remainingAmount ?? 0), 0),
        ),
        carteraBalance: Number(carteraStatement?.summary?.balance ?? 0),
        combinedExposure: this.roundCurrency(
          Number(carteraStatement?.summary?.balance ?? 0) +
            pendingSales.reduce((sum, sale) => sum + Number(sale.remainingAmount ?? 0), 0),
        ),
      },
    };
  }

  private getTerminalHeartbeatStatus(lastHeartbeatAt?: Date | string | null) {
    if (!lastHeartbeatAt) return 'OFFLINE';
    const diffMs = Date.now() - new Date(lastHeartbeatAt).getTime();
    if (diffMs <= 2 * 60_000) return 'ONLINE';
    if (diffMs <= 10 * 60_000) return 'DEGRADED';
    return 'OFFLINE';
  }

  private buildOperatingConfigSnapshot(config: any) {
    return {
      generatedAt: new Date().toISOString(),
      branch: config.branch ?? null,
      defaults: config.defaults ?? null,
      fiscal: config.fiscal ?? null,
      terminals: (config.terminals ?? []).map((terminal: any) => ({
        id: terminal.id,
        code: terminal.code,
        name: terminal.name,
        branchId: terminal.branchId ?? null,
        invoicePrefix: terminal.invoicePrefix ?? null,
        receiptPrefix: terminal.receiptPrefix ?? null,
        heartbeatSlaSeconds: terminal.heartbeatSlaSeconds ?? null,
      })),
      shifts: (config.shifts ?? []).map((shift: any) => ({
        id: shift.id,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        branchId: shift.branchId ?? null,
      })),
      priceLists: (config.priceLists ?? []).map((priceList: any) => ({
        id: priceList.id,
        name: priceList.name,
        branchId: priceList.branchId ?? null,
        isDefault: !!priceList.isDefault,
        itemCount: Array.isArray(priceList.items) ? priceList.items.length : 0,
      })),
      promotions: (config.promotions ?? []).map((promotion: any) => ({
        id: promotion.id,
        name: promotion.name,
        branchId: promotion.branchId ?? null,
        type: promotion.type,
      })),
      combos: (config.combos ?? []).map((combo: any) => ({
        id: combo.id,
        name: combo.name,
        branchId: combo.branchId ?? null,
        itemCount: Array.isArray(combo.items) ? combo.items.length : 0,
      })),
      coupons: (config.coupons ?? []).map((coupon: any) => ({
        id: coupon.id,
        code: coupon.code,
        branchId: coupon.branchId ?? null,
        isActive: !!coupon.isActive,
      })),
      governance: {
        ruleCount: Array.isArray(config.governance?.rules) ? config.governance.rules.length : 0,
      },
    };
  }

  private async recordOperationalIncident(params: {
    companyId: string;
    branchId?: string | null;
    terminalId?: string | null;
    sessionId?: string | null;
    type: string;
    severity: string;
    title: string;
    description?: string | null;
    meta?: any;
  }) {
    const existing = await this.prisma.posOperationalIncident.findFirst({
      where: {
        companyId: params.companyId,
        terminalId: params.terminalId ?? null,
        sessionId: params.sessionId ?? null,
        type: params.type,
        status: 'OPEN',
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.posOperationalIncident.update({
        where: { id: existing.id },
        data: {
          severity: params.severity,
          title: params.title,
          description: params.description ?? null,
          meta: params.meta ?? undefined,
        },
      });
    }

    return this.prisma.posOperationalIncident.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId ?? null,
        terminalId: params.terminalId ?? null,
        sessionId: params.sessionId ?? null,
        type: params.type,
        severity: params.severity,
        status: 'OPEN',
        title: params.title,
        description: params.description ?? null,
        meta: params.meta ?? undefined,
      },
    });
  }

  private async resolveOperationalIncidents(params: {
    companyId: string;
    terminalId?: string | null;
    sessionId?: string | null;
    type?: string;
    resolvedById?: string | null;
    notes?: string | null;
  }) {
    const incidents = await this.prisma.posOperationalIncident.findMany({
      where: {
        companyId: params.companyId,
        terminalId: params.terminalId ?? undefined,
        sessionId: params.sessionId ?? undefined,
        ...(params.type ? { type: params.type } : {}),
        status: 'OPEN',
      },
      select: { id: true, meta: true },
    });

    for (const incident of incidents) {
      await this.prisma.posOperationalIncident.update({
        where: { id: incident.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedById: params.resolvedById ?? null,
          meta: {
            ...((incident.meta as Record<string, unknown>) ?? {}),
            resolutionNotes: params.notes ?? 'Incidente resuelto automáticamente por recuperación POS',
          } as any,
        },
      });
    }

    return incidents.length;
  }

  private async syncAccountingSaleIfNeeded(companyId: string, saleId: string) {
    try {
      return await this.accountingService.syncPosSaleEntry(companyId, saleId);
    } catch (error: any) {
      this.logger.warn(`POS ${saleId}: no se pudo sincronizar contabilidad de venta — ${error?.message}`);
      return null;
    }
  }

  private async syncAccountingRefundIfNeeded(companyId: string, saleId: string) {
    try {
      return await this.accountingService.syncPosRefundEntry(companyId, saleId);
    } catch (error: any) {
      this.logger.warn(`POS ${saleId}: no se pudo sincronizar contabilidad de reverso — ${error?.message}`);
      return null;
    }
  }

  private async syncAccountingCashMovementIfNeeded(companyId: string, movementId: string) {
    try {
      return await this.accountingService.syncPosCashMovementEntry(companyId, movementId);
    } catch (error: any) {
      this.logger.warn(`Movimiento POS ${movementId}: no se pudo sincronizar contabilidad — ${error?.message}`);
      return null;
    }
  }

  private resolveOrderType(dto: CreatePosSaleDto) {
    if (dto.orderType) return dto.orderType;
    if (dto.isAdvancePayment) return PosOrderTypeDto.LAYAWAY;
    return PosOrderTypeDto.IN_STORE;
  }

  private getLegacyPaymentMethod(payments: Array<{ paymentMethod: string }>) {
    if (payments.length !== 1) return 'MIXED';
    return payments[0].paymentMethod;
  }

  private normalizePaymentPayload(
    payload: {
      paymentMethod?: string;
      amountPaid?: number;
      payments?: PosSalePaymentLineDto[];
      notes?: string;
    },
    options: {
      requiredTotal?: number;
      allowPartial?: boolean;
      allowChange?: boolean;
    } = {},
  ) {
    const rawPayments: Array<{
      paymentMethod: string;
      amount: number;
      transactionReference?: string;
      providerName?: string;
      notes?: string;
    }> =
      payload.payments && payload.payments.length > 0
        ? payload.payments
        : payload.paymentMethod && Number(payload.amountPaid ?? 0) > 0
          ? [
              {
                paymentMethod: payload.paymentMethod as any,
                amount: Number(payload.amountPaid),
                notes: payload.notes,
              },
            ]
          : [];

    if (rawPayments.length === 0) {
      throw new BadRequestException('Debe registrar al menos una línea de pago');
    }

    const normalized = rawPayments.map((item) => {
      const amount = this.roundCurrency(Number(item.amount ?? 0));
      if (!item.paymentMethod || item.paymentMethod === 'MIXED') {
        throw new BadRequestException('Cada línea de pago debe tener un medio válido');
      }
      if (amount <= 0) {
        throw new BadRequestException('El monto de cada línea de pago debe ser mayor a cero');
      }
      return {
        paymentMethod: item.paymentMethod,
        amount,
        transactionReference: item.transactionReference?.trim() || undefined,
        providerName: item.providerName?.trim() || undefined,
        notes: item.notes?.trim() || undefined,
      };
    });

    const totalPaid = this.roundCurrency(
      normalized.reduce((sum, item) => sum + Number(item.amount), 0),
    );
    const cashTotal = this.roundCurrency(
      normalized
        .filter((item) => item.paymentMethod === 'CASH')
        .reduce((sum, item) => sum + Number(item.amount), 0),
    );

    const targetTotal =
      options.requiredTotal != null ? this.roundCurrency(Number(options.requiredTotal)) : undefined;
    const allowPartial = options.allowPartial === true;
    const allowChange = options.allowChange !== false;

    if (targetTotal != null) {
      if (!allowPartial && totalPaid + 0.01 < targetTotal) {
        throw new BadRequestException('El monto pagado es insuficiente');
      }
      if ((!allowChange || cashTotal <= 0) && totalPaid - targetTotal > 0.01) {
        throw new BadRequestException(
          'El valor pagado excede el total y no puede generar cambio en este medio de pago',
        );
      }
    }

    const change =
      targetTotal != null && allowChange && cashTotal > 0
        ? this.roundCurrency(Math.max(0, totalPaid - targetTotal))
        : 0;

    const appliedPayments =
      change > 0
        ? normalized.map((item) => ({ ...item }))
        : normalized;

    if (change > 0) {
      let remainingChange = change;
      for (const item of appliedPayments) {
        if (item.paymentMethod !== 'CASH' || remainingChange <= 0) continue;
        const discount = Math.min(Number(item.amount), remainingChange);
        item.amount = this.roundCurrency(Number(item.amount) - discount);
        remainingChange = this.roundCurrency(remainingChange - discount);
      }
      if (remainingChange > 0.01) {
        throw new BadRequestException('No fue posible distribuir el cambio sobre las líneas de efectivo');
      }
    }

    const appliedTotal = this.roundCurrency(
      appliedPayments.reduce((sum, item) => sum + Number(item.amount), 0),
    );

    return {
      payments: appliedPayments.filter((item) => item.amount > 0),
      rawPayments: normalized,
      totalPaid,
      appliedTotal,
      cashTotal,
      change,
      legacyPaymentMethod: this.getLegacyPaymentMethod(normalized) as any,
    };
  }

  private async getPaymentMethodBreakdown(where: any) {
    const [paymentRows, legacyRows] = await Promise.all([
      this.prisma.posSalePayment.groupBy({
        by: ['paymentMethod'],
        where: { sale: where },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.posSale.groupBy({
        by: ['paymentMethod'],
        where: { ...where, payments: { none: {} } },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const breakdown: Record<string, { total: number; count: number }> = {};
    for (const row of paymentRows) {
      breakdown[row.paymentMethod] = {
        total: Number(row._sum.amount ?? 0),
        count: row._count.id,
      };
    }
    for (const row of legacyRows) {
      const current = breakdown[row.paymentMethod] ?? { total: 0, count: 0 };
      breakdown[row.paymentMethod] = {
        total: this.roundCurrency(current.total + Number(row._sum.total ?? 0)),
        count: current.count + row._count.id,
      };
    }

    return breakdown;
  }

  private async getSessionCashContext(sessionId: string) {
    const [salesAgg, byPaymentMethod, cashMovementsAgg] = await Promise.all([
      this.prisma.posSale.aggregate({
        where: { sessionId, status: 'COMPLETED' },
        _sum: { total: true },
        _count: { id: true },
      }),
      this.getPaymentMethodBreakdown({ sessionId, status: 'COMPLETED' }),
      this.prisma.posCashMovement.findMany({
        where: { sessionId },
        select: { type: true, amount: true },
      }),
    ]);

    const cashIn = cashMovementsAgg
      .filter((item) => item.type === 'IN')
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const cashOut = cashMovementsAgg
      .filter((item) => item.type === 'OUT')
      .reduce((sum, item) => sum + Number(item.amount), 0);

    return {
      totalSales: Number(salesAgg._sum.total ?? 0),
      totalTransactions: salesAgg._count.id,
      byPaymentMethod,
      cashIn,
      cashOut,
      cashSales: byPaymentMethod['CASH']?.total ?? 0,
    };
  }

  private async createAuditLog(params: {
    companyId: string;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    before?: any;
    after?: any;
  }) {
    await this.prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId ?? undefined,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId ?? undefined,
        before: params.before,
        after: params.after,
      },
    });
  }

  private readonly defaultGovernanceRules: Array<{
    action: PosGovernanceActionValue;
    allowedRoles: string[];
    requiresSupervisorOverride: boolean;
    maxDiscountPct?: number | null;
    maxAmountThreshold?: number | null;
    notes: string;
  }> = [
    {
      action: 'MANUAL_DISCOUNT',
      allowedRoles: ['ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO'],
      requiresSupervisorOverride: false,
      maxDiscountPct: 10,
      notes: 'Descuentos manuales en venta POS.',
    },
    {
      action: 'CASH_WITHDRAWAL',
      allowedRoles: ['ADMIN', 'MANAGER'],
      requiresSupervisorOverride: true,
      maxAmountThreshold: 0,
      notes: 'Retiros parciales de caja.',
    },
    {
      action: 'CANCEL_SALE',
      allowedRoles: ['ADMIN', 'MANAGER'],
      requiresSupervisorOverride: true,
      notes: 'Anulación controlada de ventas POS.',
    },
    {
      action: 'REFUND_SALE',
      allowedRoles: ['ADMIN', 'MANAGER'],
      requiresSupervisorOverride: true,
      notes: 'Reembolsos de ventas POS.',
    },
    {
      action: 'REOPEN_SESSION',
      allowedRoles: ['ADMIN', 'MANAGER'],
      requiresSupervisorOverride: true,
      notes: 'Reapertura controlada de caja POS.',
    },
    {
      action: 'APPROVE_POST_SALE',
      allowedRoles: ['ADMIN', 'MANAGER'],
      requiresSupervisorOverride: false,
      notes: 'Aprobación de devoluciones y cambios POS.',
    },
  ];

  private supervisorRoles = ['ADMIN', 'MANAGER'];

  private normalizeRoles(raw?: unknown) {
    return Array.isArray(raw)
      ? raw
          .map((role) => String(role ?? '').trim().toUpperCase())
          .filter((role) => role.length > 0)
      : [];
  }

  private hasAnyRole(userRoles: string[], allowedRoles: string[]) {
    const normalizedUserRoles = this.normalizeRoles(userRoles);
    const normalizedAllowedRoles = this.normalizeRoles(allowedRoles);
    if (normalizedAllowedRoles.length === 0) return true;
    return normalizedAllowedRoles.some((role) => normalizedUserRoles.includes(role));
  }

  private isSupervisor(userRoles: string[]) {
    return this.hasAnyRole(userRoles, this.supervisorRoles);
  }

  private async getGovernanceRules(companyId: string, branchId?: string) {
    const persistedRules = await this.prisma.posGovernanceRule.findMany({
      where: {
        companyId,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }],
      },
      orderBy: [{ branchId: 'desc' }, { createdAt: 'asc' }],
    });

    return this.defaultGovernanceRules.map((defaultRule) => {
      const persisted =
        persistedRules.find((rule) => rule.action === defaultRule.action && rule.branchId === branchId) ??
        persistedRules.find((rule) => rule.action === defaultRule.action && rule.branchId === null);

      return {
        id: persisted?.id ?? null,
        companyId,
        branchId: persisted?.branchId ?? branchId ?? null,
        action: defaultRule.action,
        allowedRoles: this.normalizeRoles(persisted?.allowedRoles ?? defaultRule.allowedRoles),
        requiresSupervisorOverride:
          persisted?.requiresSupervisorOverride ?? defaultRule.requiresSupervisorOverride,
        maxDiscountPct:
          persisted?.maxDiscountPct != null
            ? Number(persisted.maxDiscountPct)
            : defaultRule.maxDiscountPct ?? null,
        maxAmountThreshold:
          persisted?.maxAmountThreshold != null
            ? Number(persisted.maxAmountThreshold)
            : defaultRule.maxAmountThreshold ?? null,
        isActive: persisted?.isActive ?? true,
        notes: persisted?.notes ?? defaultRule.notes,
      };
    });
  }

  private async resolveGovernanceRule(
    companyId: string,
    branchId: string | undefined,
    action: PosGovernanceActionValue,
  ) {
    const rules = await this.getGovernanceRules(companyId, branchId);
    return rules.find((rule) => rule.action === action) ?? null;
  }

  private async consumeApprovedOverride(params: {
    companyId: string;
    userId: string;
    action: PosGovernanceActionValue;
    branchId?: string;
    resourceType: string;
    resourceId?: string | null;
    overrideId?: string | null;
  }) {
    if (!params.overrideId) {
      throw new BadRequestException('La acción requiere un override de supervisor aprobado');
    }

    const override = await this.prisma.posSupervisorOverride.findFirst({
      where: {
        id: params.overrideId,
        companyId: params.companyId,
        action: params.action as any,
        status: 'APPROVED',
      },
      include: {
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!override) {
      throw new BadRequestException('El override indicado no existe o no está aprobado');
    }

    if (override.branchId && params.branchId && override.branchId !== params.branchId) {
      throw new BadRequestException('El override aprobado corresponde a otra sucursal');
    }

    if (override.resourceType !== params.resourceType) {
      throw new BadRequestException('El override aprobado no coincide con el tipo de recurso');
    }

    if (override.resourceId && params.resourceId && override.resourceId !== params.resourceId) {
      throw new BadRequestException('El override aprobado no coincide con el recurso a procesar');
    }

    const consumed = await this.prisma.posSupervisorOverride.update({
      where: { id: override.id },
      data: {
        status: 'CONSUMED',
        consumedAt: new Date(),
      },
      include: {
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.createAuditLog({
      companyId: params.companyId,
      userId: params.userId,
      action: 'POS_SUPERVISOR_OVERRIDE_CONSUMED',
      resource: params.resourceType,
      resourceId: params.resourceId ?? override.id,
      after: {
        overrideId: consumed.id,
        governanceAction: params.action,
        approvedBy: consumed.approvedBy
          ? `${consumed.approvedBy.firstName} ${consumed.approvedBy.lastName}`.trim()
          : null,
      },
    });

    return consumed;
  }

  private async enforceGovernance(params: {
    companyId: string;
    userId: string;
    userRoles: string[];
    action: PosGovernanceActionValue;
    branchId?: string;
    resourceType: string;
    resourceId?: string | null;
    overrideId?: string | null;
    discountPct?: number | null;
    amount?: number | null;
  }) {
    const rule = await this.resolveGovernanceRule(params.companyId, params.branchId, params.action);
    if (!rule || !rule.isActive) return null;

    const supervisor = this.isSupervisor(params.userRoles);
    const allowedByRole = this.hasAnyRole(params.userRoles, rule.allowedRoles);
    const discountExceeded =
      rule.maxDiscountPct != null &&
      Number(params.discountPct ?? 0) > Number(rule.maxDiscountPct) + 0.0001;
    const amountExceeded =
      rule.maxAmountThreshold != null &&
      Number(rule.maxAmountThreshold) > 0 &&
      Number(params.amount ?? 0) > Number(rule.maxAmountThreshold) + 0.0001;
    const requiresOverride =
      rule.requiresSupervisorOverride || !allowedByRole || discountExceeded || amountExceeded;

    if (!requiresOverride || supervisor) {
      return { rule, override: null };
    }

    const override = await this.consumeApprovedOverride({
      companyId: params.companyId,
      userId: params.userId,
      action: params.action,
      branchId: params.branchId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      overrideId: params.overrideId,
    });

    return { rule, override };
  }

  private async ensureBranch(companyId: string, branchId?: string | null) {
    if (!branchId) return null;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    return branch;
  }

  private isWithinPromotionWindow(promotion: any, now: Date) {
    if (!promotion.isActive) return false;
    if (promotion.startsAt && new Date(promotion.startsAt) > now) return false;
    if (promotion.endsAt && new Date(promotion.endsAt) < now) return false;
    if (Array.isArray(promotion.daysOfWeek) && promotion.daysOfWeek.length > 0) {
      const day = now.getDay();
      if (!promotion.daysOfWeek.includes(day)) return false;
    }
    const currentTime = now.toTimeString().slice(0, 5);
    if (promotion.startTime && currentTime < promotion.startTime) return false;
    if (promotion.endTime && currentTime > promotion.endTime) return false;
    return true;
  }

  private applyDiscount(value: number, mode: 'PERCENT' | 'FIXED', discountValue: number) {
    if (mode === 'PERCENT') return this.roundCurrency(value * (discountValue / 100));
    return this.roundCurrency(Math.min(value, discountValue));
  }

  private async buildPricingContext(
    companyId: string,
    branchId: string | undefined,
    customerId: string | undefined,
    items: Array<{ productId?: string; description: string; quantity: number; unitPrice: number; taxRate: number; discount?: number }>,
    priceListId?: string,
  ) {
    const productIds = items.map((item) => item.productId).filter((id): id is string => !!id);
    const [priceLists, promotions, combos, products] = await Promise.all([
      this.findPriceLists(companyId, branchId),
      this.findPromotions(companyId, branchId),
      this.findCombos(companyId, branchId),
      productIds.length
        ? this.prisma.product.findMany({
            where: { companyId, id: { in: productIds } },
            select: { id: true, name: true, price: true, taxRate: true, stock: true },
          })
        : Promise.resolve([]),
    ]);

    const selectedPriceList =
      priceLists.find((list: any) => list.id === priceListId) ??
      priceLists.find((list: any) => list.isDefault) ??
      null;

    return {
      products: new Map(products.map((product: any) => [product.id, product])),
      selectedPriceList,
      promotions,
      combos,
      customerId,
    };
  }

  private calculatePricing(items: PreviewPosPricingDto['items'], context: any, cartDiscountPct = 0) {
    const now = new Date();
    const priceListItems = new Map(
      (context.selectedPriceList?.items ?? []).map((item: any) => [item.productId, item]),
    );

    const pricedItems = items.map((item, index) => {
      const product = item.productId ? context.products.get(item.productId) : null;
      const priceListItem: any = item.productId ? priceListItems.get(item.productId) : null;
      const baseUnitPrice =
        priceListItem && (!priceListItem.minQuantity || Number(item.quantity) >= Number(priceListItem.minQuantity))
          ? Number(priceListItem.price)
          : product
            ? Number(product.price)
            : Number(item.unitPrice);
      const baseDiscountPct = Number(item.discount ?? 0);
      const lineBase = this.roundCurrency(Number(item.quantity) * baseUnitPrice * (1 - baseDiscountPct / 100));
      const applicablePromotions = (context.promotions ?? [])
        .filter((promotion: any) => this.isWithinPromotionWindow(promotion, now))
        .filter((promotion: any) => !promotion.customerId || promotion.customerId === context.customerId)
        .filter((promotion: any) => !promotion.productId || promotion.productId === item.productId)
        .filter((promotion: any) => !promotion.minQuantity || Number(item.quantity) >= Number(promotion.minQuantity))
        .sort((a: any, b: any) => Number(b.priority ?? 0) - Number(a.priority ?? 0));

      let promoDiscount = 0;
      const appliedPromotions: string[] = [];
      for (const promotion of applicablePromotions) {
        if (promotion.type === 'ORDER' || promotion.type === 'CUSTOMER' || promotion.type === 'SCHEDULE') continue;
        const candidate = this.applyDiscount(lineBase, promotion.discountMode, Number(promotion.discountValue));
        if (promotion.stackable) {
          promoDiscount += candidate;
          appliedPromotions.push(promotion.name);
        } else if (candidate > promoDiscount) {
          promoDiscount = candidate;
          appliedPromotions.splice(0, appliedPromotions.length, promotion.name);
        }
      }

      const subtotalBeforeTax = this.roundCurrency(Math.max(0, lineBase - promoDiscount));
      const taxAmount = this.roundCurrency(subtotalBeforeTax * (Number(item.taxRate) / 100));
      return {
        index,
        productId: item.productId,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: baseUnitPrice,
        taxRate: Number(item.taxRate),
        manualDiscount: baseDiscountPct,
        promoDiscount: this.roundCurrency(promoDiscount),
        appliedPromotions,
        subtotal: subtotalBeforeTax,
        taxAmount,
        total: this.roundCurrency(subtotalBeforeTax + taxAmount),
      };
    });

    const subtotal = this.roundCurrency(pricedItems.reduce((sum, item) => sum + item.subtotal, 0));
    const taxAmount = this.roundCurrency(pricedItems.reduce((sum, item) => sum + item.taxAmount, 0));

    let orderPromotionDiscount = 0;
    const orderPromotions = (context.promotions ?? [])
      .filter((promotion: any) => this.isWithinPromotionWindow(promotion, now))
      .filter((promotion: any) => !promotion.customerId || promotion.customerId === context.customerId)
      .filter((promotion: any) => ['ORDER', 'CUSTOMER', 'SCHEDULE'].includes(promotion.type))
      .filter((promotion: any) => !promotion.minSubtotal || subtotal >= Number(promotion.minSubtotal))
      .sort((a: any, b: any) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
    if (orderPromotions.length > 0) {
      const best = orderPromotions[0];
      orderPromotionDiscount = this.applyDiscount(subtotal + taxAmount, best.discountMode, Number(best.discountValue));
    }

    let comboDiscount = 0;
    const appliedCombos: Array<{ comboId: string; comboName: string; discount: number }> = [];
    for (const combo of context.combos ?? []) {
      const active = (!combo.startsAt || new Date(combo.startsAt) <= now) && (!combo.endsAt || new Date(combo.endsAt) >= now);
      if (!combo.isActive || !active || !combo.items?.length) continue;
      const matches = combo.items.map((comboItem: any) => {
        const line = pricedItems.find((item) => item.productId === comboItem.productId);
        return line ? Math.floor(Number(line.quantity) / Number(comboItem.quantity)) : 0;
      });
      const comboTimes = matches.length ? Math.min(...matches) : 0;
      if (comboTimes <= 0) continue;
      const comboBase = combo.items.reduce((sum: number, comboItem: any) => {
        const line = pricedItems.find((item) => item.productId === comboItem.productId);
        return sum + (line ? Number(comboItem.quantity) * line.unitPrice : 0);
      }, 0) * comboTimes;
      const discount = this.roundCurrency(Math.max(0, comboBase - Number(combo.comboPrice) * comboTimes));
      if (discount > 0) {
        comboDiscount += discount;
        appliedCombos.push({ comboId: combo.id, comboName: combo.name, discount });
      }
    }

    const preManualTotal = this.roundCurrency(subtotal + taxAmount - orderPromotionDiscount - comboDiscount);
    const manualDiscountAmount = cartDiscountPct > 0
      ? this.roundCurrency(preManualTotal * (cartDiscountPct / 100))
      : 0;
    const total = this.roundCurrency(Math.max(0, preManualTotal - manualDiscountAmount));

    return {
      items: pricedItems,
      subtotal,
      taxAmount,
      orderPromotionDiscount: this.roundCurrency(orderPromotionDiscount),
      comboDiscount: this.roundCurrency(comboDiscount),
      manualDiscountAmount,
      total,
      priceList: context.selectedPriceList
        ? { id: context.selectedPriceList.id, name: context.selectedPriceList.name }
        : null,
      appliedCombos,
      appliedOrderPromotions: orderPromotions.slice(0, 1).map((promotion: any) => promotion.name),
    };
  }

  // ── Operating config ──────────────────────────────────────────────────────

  async getOperatingConfig(companyId: string, branchId?: string) {
    const [
      company,
      branch,
      terminals,
      shifts,
      priceLists,
      promotions,
      combos,
      loyaltyCampaigns,
      coupons,
      externalOrders,
      inventoryLocations,
      inventoryTransfers,
      governanceRules,
      recentOverrides,
      recentAudit,
      fiscalConfig,
    ] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          name: true,
          dianPosResolucion: true,
          dianPosPrefijo: true,
          dianPosRangoDesde: true,
          dianPosRangoHasta: true,
          dianPosFechaDesde: true,
          dianPosFechaHasta: true,
        },
      }),
      branchId
        ? this.prisma.branch.findFirst({
            where: { id: branchId, companyId, deletedAt: null, isActive: true },
            select: { id: true, name: true, city: true, address: true },
          })
        : null,
      this.findTerminals(companyId, branchId),
      this.findShiftTemplates(companyId, branchId),
      this.findPriceLists(companyId, branchId),
      this.findPromotions(companyId, branchId),
      this.findCombos(companyId, branchId),
      this.findLoyaltyCampaigns(companyId, branchId),
      this.findCoupons(companyId, branchId),
      this.findExternalOrders(companyId, branchId),
      this.findInventoryLocations(companyId, branchId),
      this.findInventoryTransfers(companyId, branchId),
      this.getGovernanceRules(companyId, branchId),
      this.prisma.posSupervisorOverride.findMany({
        where: {
          companyId,
          ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
        include: {
          requestedBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.getGovernanceAudit(companyId, branchId, 20),
      this.prisma.invoiceDocumentConfig.findFirst({
        where: {
          companyId,
          isActive: true,
          type: 'VENTA' as any,
          channel: 'POS',
          OR: [
            ...(branchId ? [{ branchId, posTerminalId: null }] : []),
            { branchId: null, posTerminalId: null },
          ],
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    return {
      company,
      branch,
      terminals,
      shifts,
      priceLists,
      promotions,
      combos,
      loyaltyCampaigns,
      coupons,
      externalOrders,
      inventoryLocations,
      inventoryTransfers,
      defaults: {
        terminalId: terminals.find((item) => item.isDefault)?.id ?? terminals[0]?.id ?? null,
        shiftTemplateId: shifts[0]?.id ?? null,
        priceListId:
          terminals.find((item: any) => item.isDefault)?.defaultPriceList?.id ??
          priceLists.find((item: any) => item.isDefault)?.id ??
          priceLists[0]?.id ??
          null,
        inventoryLocationId:
          terminals.find((item: any) => item.isDefault)?.defaultInventoryLocation?.id ??
          inventoryLocations.find((item: any) => item.isDefault)?.id ??
          inventoryLocations[0]?.id ??
          null,
      },
      fiscal: {
        resolutionNumber: fiscalConfig?.resolutionNumber ?? company?.dianPosResolucion ?? null,
        prefix: fiscalConfig?.prefix ?? company?.dianPosPrefijo ?? null,
        rangeFrom: fiscalConfig?.rangeFrom ?? company?.dianPosRangoDesde ?? null,
        rangeTo: fiscalConfig?.rangeTo ?? company?.dianPosRangoHasta ?? null,
        validFrom: fiscalConfig?.validFrom ?? company?.dianPosFechaDesde ?? null,
        validTo: fiscalConfig?.validTo ?? company?.dianPosFechaHasta ?? null,
        channel: fiscalConfig?.channel ?? 'POS',
        documentConfigId: fiscalConfig?.id ?? null,
      },
      governance: {
        rules: governanceRules,
        pendingOverrides: recentOverrides.filter((item) => item.status === 'PENDING'),
        recentOverrides,
        recentAudit,
      },
    };
  }

  async getGovernanceAudit(companyId: string, branchId?: string, limit = 40) {
    return this.prisma.auditLog.findMany({
      where: {
        companyId,
        action: { startsWith: 'POS_' },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async saveGovernanceRule(companyId: string, branchId: string | undefined, dto: SavePosGovernanceRuleDto) {
    const existing = await this.prisma.posGovernanceRule.findFirst({
      where: {
        companyId,
        branchId: branchId ?? null,
        action: dto.action as any,
      },
    });

    const data = {
      companyId,
      branchId: branchId ?? null,
      action: dto.action as any,
      allowedRoles: this.normalizeRoles(dto.allowedRoles),
      requiresSupervisorOverride: dto.requiresSupervisorOverride ?? false,
      maxDiscountPct: dto.maxDiscountPct ?? null,
      maxAmountThreshold: dto.maxAmountThreshold ?? null,
      isActive: dto.isActive ?? true,
      notes: dto.notes?.trim() || null,
    };

    const saved = existing
      ? await this.prisma.posGovernanceRule.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.posGovernanceRule.create({ data });

    await this.createAuditLog({
      companyId,
      action: existing ? 'POS_GOVERNANCE_RULE_UPDATED' : 'POS_GOVERNANCE_RULE_CREATED',
      resource: 'POS_GOVERNANCE_RULE',
      resourceId: saved.id,
      before: existing
        ? {
            action: existing.action,
            allowedRoles: existing.allowedRoles,
            requiresSupervisorOverride: existing.requiresSupervisorOverride,
            maxDiscountPct: existing.maxDiscountPct,
            maxAmountThreshold: existing.maxAmountThreshold,
            isActive: existing.isActive,
          }
        : null,
      after: {
        action: saved.action,
        allowedRoles: saved.allowedRoles,
        requiresSupervisorOverride: saved.requiresSupervisorOverride,
        maxDiscountPct: saved.maxDiscountPct,
        maxAmountThreshold: saved.maxAmountThreshold,
        isActive: saved.isActive,
      },
    });

    return saved;
  }

  async requestSupervisorOverride(
    companyId: string,
    userId: string,
    branchId: string | undefined,
    dto: CreatePosSupervisorOverrideDto,
  ) {
    const created = await this.prisma.posSupervisorOverride.create({
      data: {
        companyId,
        branchId: dto.branchId ?? branchId ?? null,
        action: dto.action as any,
        resourceType: dto.resourceType.trim(),
        resourceId: dto.resourceId?.trim() || null,
        reason: dto.reason.trim(),
        requestedPayload: dto.requestedPayload as any,
        requestedById: userId,
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_SUPERVISOR_OVERRIDE_REQUESTED',
      resource: created.resourceType,
      resourceId: created.resourceId ?? created.id,
      after: {
        overrideId: created.id,
        governanceAction: created.action,
        reason: created.reason,
        branchId: created.branchId,
      },
    });

    return created;
  }

  async approveSupervisorOverride(
    companyId: string,
    userId: string,
    overrideId: string,
    dto: ResolvePosSupervisorOverrideDto,
  ) {
    const override = await this.prisma.posSupervisorOverride.findFirst({
      where: { id: overrideId, companyId, status: 'PENDING' },
    });
    if (!override) throw new NotFoundException('No se encontró la solicitud de override pendiente');

    const approved = await this.prisma.posSupervisorOverride.update({
      where: { id: override.id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        decisionNotes: dto.notes?.trim() || null,
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_SUPERVISOR_OVERRIDE_APPROVED',
      resource: override.resourceType,
      resourceId: override.resourceId ?? override.id,
      after: {
        overrideId: override.id,
        governanceAction: override.action,
        notes: approved.decisionNotes,
      },
    });

    return approved;
  }

  async rejectSupervisorOverride(
    companyId: string,
    userId: string,
    overrideId: string,
    dto: ResolvePosSupervisorOverrideDto,
  ) {
    const override = await this.prisma.posSupervisorOverride.findFirst({
      where: { id: overrideId, companyId, status: 'PENDING' },
    });
    if (!override) throw new NotFoundException('No se encontró la solicitud de override pendiente');

    const rejected = await this.prisma.posSupervisorOverride.update({
      where: { id: override.id },
      data: {
        status: 'REJECTED',
        approvedById: userId,
        rejectedAt: new Date(),
        decisionNotes: dto.notes?.trim() || null,
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_SUPERVISOR_OVERRIDE_REJECTED',
      resource: override.resourceType,
      resourceId: override.resourceId ?? override.id,
      after: {
        overrideId: override.id,
        governanceAction: override.action,
        notes: rejected.decisionNotes,
      },
    });

    return rejected;
  }

  async findTerminals(companyId: string, branchId?: string) {
    return this.prisma.posTerminal.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, { branch: { companyId } }],
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        branch: { select: { id: true, name: true } },
        defaultPriceList: { select: { id: true, name: true } },
        defaultInventoryLocation: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async createTerminal(companyId: string, branchId: string | undefined, dto: CreatePosTerminalDto) {
    const targetBranchId = dto.branchId ?? branchId ?? null;

    if (targetBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: targetBranchId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Sucursal no encontrada para la terminal POS');
    }

    if (dto.isDefault) {
      await this.prisma.posTerminal.updateMany({
        where: { companyId, branchId: targetBranchId },
        data: { isDefault: false },
      });
    }

    return this.prisma.posTerminal.create({
      data: {
        companyId,
        branchId: targetBranchId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        cashRegisterName: dto.cashRegisterName?.trim() || null,
        deviceName: dto.deviceName?.trim() || null,
        printerName: dto.printerName?.trim() || null,
        printerConnectionType: dto.printerConnectionType?.trim() || null,
        printerPaperWidth: dto.printerPaperWidth ?? 80,
        invoicePrefix: dto.invoicePrefix?.trim() || 'POS',
        receiptPrefix: dto.receiptPrefix?.trim() || 'TIR',
        resolutionNumber: dto.resolutionNumber?.trim() || null,
        resolutionLabel: dto.resolutionLabel?.trim() || null,
        defaultPriceListId: (dto as any).defaultPriceListId ?? null,
        defaultInventoryLocationId: (dto as any).defaultInventoryLocationId ?? null,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        autoPrintReceipt: dto.autoPrintReceipt ?? true,
        autoPrintInvoice: dto.autoPrintInvoice ?? false,
        requireCustomerForInvoice: dto.requireCustomerForInvoice ?? true,
        allowOpenDrawer: dto.allowOpenDrawer ?? true,
        parameters: dto.parameters as any,
      },
      include: {
        branch: { select: { id: true, name: true } },
        defaultPriceList: { select: { id: true, name: true } },
        defaultInventoryLocation: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async registerTerminalHeartbeat(
    companyId: string,
    userId: string,
    terminalId: string,
    dto: HeartbeatPosTerminalDto,
  ) {
    const terminal = await this.prisma.posTerminal.findFirst({
      where: { id: terminalId, companyId, isActive: true },
      select: {
        id: true,
        branchId: true,
        code: true,
        name: true,
        heartbeatSlaSeconds: true,
      },
    });
    if (!terminal) throw new NotFoundException('Terminal POS no encontrada');

    const now = new Date();
    const pendingSyncCount = Number(dto.pendingSyncCount ?? 0);
    const heartbeatMeta = {
      userId,
      cartCount: Number(dto.cartCount ?? 0),
      pendingOrders: Number(dto.pendingOrders ?? 0),
      pendingSyncCount,
      currentView: dto.currentView ?? null,
      userAgent: dto.userAgent ?? null,
      reportedAt: now.toISOString(),
    };

    const updatedTerminal = await this.prisma.posTerminal.update({
      where: { id: terminalId },
      data: {
        lastHeartbeatAt: now,
        heartbeatMeta: heartbeatMeta as any,
      },
      select: {
        id: true,
        code: true,
        name: true,
        branchId: true,
        lastHeartbeatAt: true,
      },
    });

    let updatedSession: any = null;
    if (dto.sessionId) {
      const session = await this.prisma.posSession.findFirst({
        where: {
          id: dto.sessionId,
          companyId,
          terminalId,
          status: 'OPEN',
        },
        select: { id: true },
      });
      if (session) {
        updatedSession = await this.prisma.posSession.update({
          where: { id: dto.sessionId },
          data: {
            lastHeartbeatAt: now,
            offlineSinceAt: null,
            offlineQueueDepth: pendingSyncCount,
            recoverySnapshot: dto.recoverySnapshot ? (dto.recoverySnapshot as any) : undefined,
          },
          select: {
            id: true,
            lastHeartbeatAt: true,
            offlineSinceAt: true,
            offlineQueueDepth: true,
          },
        });
      }
    }

    if (pendingSyncCount > 0) {
      await this.recordOperationalIncident({
        companyId,
        branchId: terminal.branchId,
        terminalId: terminal.id,
        sessionId: dto.sessionId ?? null,
        type: 'OFFLINE_SYNC_PENDING',
        severity: pendingSyncCount >= 10 ? 'HIGH' : 'MEDIUM',
        title: 'Terminal POS con sincronización diferida',
        description: `La terminal ${terminal.code} reporta ${pendingSyncCount} transacciones pendientes por sincronizar.`,
        meta: heartbeatMeta,
      });
    } else {
      await this.resolveOperationalIncidents({
        companyId,
        terminalId: terminal.id,
        sessionId: dto.sessionId ?? null,
        type: 'OFFLINE_SYNC_PENDING',
        resolvedById: userId,
      });
    }

    return {
      terminal: {
        ...updatedTerminal,
        heartbeatStatus: this.getTerminalHeartbeatStatus(updatedTerminal.lastHeartbeatAt),
      },
      session: updatedSession,
    };
  }

  async getMultiBranchOverview(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [branches, openSessions, terminals, todaysSales, reservations, transfers, incidents, deployments] = await Promise.all([
      this.prisma.branch.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { id: true, name: true, city: true, isMain: true },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.posSession.findMany({
        where: { companyId, status: 'OPEN' },
        select: {
          id: true,
          branchId: true,
          userId: true,
          lastHeartbeatAt: true,
          offlineSinceAt: true,
          offlineQueueDepth: true,
          terminal: {
            select: {
              id: true,
              code: true,
              name: true,
              lastHeartbeatAt: true,
            },
          },
        },
      }),
      this.prisma.posTerminal.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          branchId: true,
          isDefault: true,
          lastHeartbeatAt: true,
        },
      }),
      this.prisma.posSale.findMany({
        where: { companyId, createdAt: { gte: today } },
        select: {
          id: true,
          branchId: true,
          total: true,
          status: true,
          orderType: true,
          orderStatus: true,
        },
      }),
      this.prisma.posInventoryReservation.findMany({
        where: { companyId, status: 'OPEN' as any },
        select: { branchId: true, quantity: true },
      }),
      this.prisma.posInventoryTransfer.findMany({
        where: { companyId, status: 'PENDING' as any },
        select: { id: true, fromBranchId: true, toBranchId: true },
      }),
      this.prisma.posOperationalIncident.findMany({
        where: { companyId, status: 'OPEN' },
        select: {
          id: true,
          branchId: true,
          terminalId: true,
          sessionId: true,
          type: true,
          severity: true,
          title: true,
          startedAt: true,
        },
        orderBy: [{ startedAt: 'desc' }],
        take: 100,
      }),
      this.prisma.posConfigDeployment.findMany({
        where: { companyId },
        select: {
          id: true,
          branchId: true,
          terminalId: true,
          scope: true,
          deploymentType: true,
          status: true,
          versionLabel: true,
          conflictCount: true,
          createdAt: true,
          appliedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 30,
      }),
    ]);

    const branchRows = branches.map((branch) => {
      const branchTerminals = terminals.filter((terminal) => terminal.branchId === branch.id);
      const branchOpenSessions = openSessions.filter((session) => session.branchId === branch.id);
      const branchSales = todaysSales.filter((sale) => sale.branchId === branch.id && sale.status === 'COMPLETED');
      const branchPendingOrders = todaysSales.filter(
        (sale) =>
          sale.branchId === branch.id &&
          ['PICKUP', 'DELIVERY', 'LAYAWAY', 'PREORDER'].includes(String(sale.orderType)) &&
          !['CLOSED', 'CANCELLED'].includes(String(sale.orderStatus)),
      );
      const branchReservations = reservations.filter((reservation) => reservation.branchId === branch.id);
      const branchTransfersIn = transfers.filter((transfer) => transfer.toBranchId === branch.id).length;
      const branchTransfersOut = transfers.filter((transfer) => transfer.fromBranchId === branch.id).length;
      const branchIncidents = incidents.filter((incident) => incident.branchId === branch.id);
      const activeCashiers = new Set(branchOpenSessions.map((session) => session.userId)).size;
      const salesTotal = branchSales.reduce((sum, sale) => sum + Number(sale.total), 0);
      const latestHeartbeat = [...branchTerminals, ...branchOpenSessions]
        .map((item: any) => item.lastHeartbeatAt)
        .filter(Boolean)
        .sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

      return {
        branchId: branch.id,
        branchName: branch.name,
        city: branch.city ?? null,
        isMain: branch.isMain,
        terminalsTotal: branchTerminals.length,
        terminalsOnline: branchTerminals.filter((terminal) => this.getTerminalHeartbeatStatus(terminal.lastHeartbeatAt) === 'ONLINE').length,
        openSessions: branchOpenSessions.length,
        activeCashiers,
        salesToday: this.roundCurrency(salesTotal),
        avgTicketToday: branchSales.length > 0 ? this.roundCurrency(salesTotal / branchSales.length) : 0,
        pendingOrders: branchPendingOrders.length,
        reservedUnits: this.roundCurrency(branchReservations.reduce((sum, item) => sum + Number(item.quantity), 0)),
        pendingTransfersIn: branchTransfersIn,
        pendingTransfersOut: branchTransfersOut,
        openIncidents: branchIncidents.length,
        criticalIncidents: branchIncidents.filter((incident) => incident.severity === 'HIGH').length,
        lastHeartbeatAt: latestHeartbeat,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        branches: branchRows.length,
        terminals: terminals.length,
        onlineTerminals: terminals.filter((terminal) => this.getTerminalHeartbeatStatus(terminal.lastHeartbeatAt) === 'ONLINE').length,
        openSessions: openSessions.length,
        pendingOmnichannel: branchRows.reduce((sum, branch) => sum + branch.pendingOrders, 0),
        pendingTransfers: transfers.length,
        openIncidents: incidents.length,
        slaBreaches: terminals.filter((terminal) => this.getTerminalHeartbeatStatus(terminal.lastHeartbeatAt) !== 'ONLINE').length,
      },
      branches: branchRows,
      terminals: terminals.map((terminal) => ({
        terminalId: terminal.id,
        code: terminal.code,
        name: terminal.name,
        branchId: terminal.branchId,
        isDefault: terminal.isDefault,
        lastHeartbeatAt: terminal.lastHeartbeatAt,
        heartbeatStatus: this.getTerminalHeartbeatStatus(terminal.lastHeartbeatAt),
        openIncidents: incidents.filter((incident) => incident.terminalId === terminal.id).length,
      })),
      sessions: openSessions.map((session) => ({
        sessionId: session.id,
        branchId: session.branchId,
        terminalId: session.terminal?.id ?? null,
        terminalCode: session.terminal?.code ?? null,
        cashierId: session.userId,
        lastHeartbeatAt: session.lastHeartbeatAt,
        heartbeatStatus: this.getTerminalHeartbeatStatus(session.lastHeartbeatAt ?? session.terminal?.lastHeartbeatAt ?? null),
        offlineQueueDepth: (session as any).offlineQueueDepth ?? 0,
      })),
      incidents: incidents.map((incident) => ({
        id: incident.id,
        branchId: incident.branchId,
        terminalId: incident.terminalId,
        sessionId: incident.sessionId,
        type: incident.type,
        severity: incident.severity,
        title: incident.title,
        startedAt: incident.startedAt,
      })),
      deployments: deployments.map((deployment) => ({
        id: deployment.id,
        branchId: deployment.branchId,
        terminalId: deployment.terminalId,
        scope: deployment.scope,
        deploymentType: deployment.deploymentType,
        status: deployment.status,
        versionLabel: deployment.versionLabel,
        conflictCount: deployment.conflictCount,
        createdAt: deployment.createdAt,
        appliedAt: deployment.appliedAt,
      })),
    };
  }

  async getOperationalIncidents(companyId: string) {
    return this.prisma.posOperationalIncident.findMany({
      where: { companyId },
      include: {
        branch: { select: { id: true, name: true } },
        terminal: { select: { id: true, code: true, name: true } },
        session: { select: { id: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      take: 100,
    });
  }

  async resolveOperationalIncident(
    companyId: string,
    userId: string,
    incidentId: string,
    dto: ResolvePosOperationalIncidentDto,
  ) {
    const incident = await this.prisma.posOperationalIncident.findFirst({
      where: { id: incidentId, companyId },
    });
    if (!incident) throw new NotFoundException('Incidente operativo POS no encontrado');
    if (incident.status === 'RESOLVED') return incident;

    const updated = await this.prisma.posOperationalIncident.update({
      where: { id: incidentId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: userId,
        meta: {
          ...((incident.meta as Record<string, unknown>) ?? {}),
          resolutionNotes: dto.notes ?? 'Incidente resuelto manualmente',
        } as any,
      },
      include: {
        branch: { select: { id: true, name: true } },
        terminal: { select: { id: true, code: true, name: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_OPERATIONAL_INCIDENT_RESOLVED',
      resource: 'POS_OPERATIONAL_INCIDENT',
      resourceId: incidentId,
      after: {
        type: incident.type,
        severity: incident.severity,
        notes: dto.notes ?? null,
      },
    });

    return updated;
  }

  async getConfigDeployments(companyId: string) {
    return this.prisma.posConfigDeployment.findMany({
      where: { companyId },
      include: {
        branch: { select: { id: true, name: true } },
        terminal: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createConfigDeployment(
    companyId: string,
    userId: string,
    dto: CreatePosConfigDeploymentDto,
  ) {
    const branchIds =
      dto.scope === 'BRANCH'
        ? (dto.branchIds ?? []).filter(Boolean)
        : dto.scope === 'TERMINAL' && dto.terminalId
          ? []
          : [undefined];

    const terminal =
      dto.terminalId && dto.scope === 'TERMINAL'
        ? await this.prisma.posTerminal.findFirst({
            where: { id: dto.terminalId, companyId },
            select: { id: true, branchId: true },
          })
        : null;

    if (dto.scope === 'TERMINAL' && !terminal) {
      throw new NotFoundException('Terminal POS no encontrada para el despliegue');
    }

    const effectiveBranchIds =
      dto.scope === 'COMPANY'
        ? [undefined]
        : dto.scope === 'TERMINAL'
          ? [terminal?.branchId ?? undefined]
          : branchIds.length > 0
            ? branchIds
            : [undefined];

    const createdRows = [];
    for (const targetBranchId of effectiveBranchIds) {
      const config = await this.getOperatingConfig(companyId, targetBranchId);
      const snapshot = this.buildOperatingConfigSnapshot(config);
      createdRows.push(
        await this.prisma.posConfigDeployment.create({
          data: {
            companyId,
            branchId: targetBranchId ?? null,
            terminalId: dto.scope === 'TERMINAL' ? dto.terminalId ?? null : null,
            createdById: userId,
            scope: dto.scope,
            deploymentType: dto.deploymentType,
            status: 'APPLIED',
            versionLabel: dto.versionLabel?.trim() || null,
            snapshot: snapshot as any,
            conflictCount: 0,
            appliedAt: new Date(),
          },
          include: {
            branch: { select: { id: true, name: true } },
            terminal: { select: { id: true, code: true, name: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      );
    }

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_CONFIG_DEPLOYMENT_CREATED',
      resource: 'POS_CONFIG_DEPLOYMENT',
      resourceId: createdRows[0]?.id ?? null,
      after: {
        scope: dto.scope,
        deploymentType: dto.deploymentType,
        deployments: createdRows.length,
        terminalId: dto.terminalId ?? null,
      },
    });

    return createdRows;
  }

  async updateTerminal(companyId: string, id: string, dto: UpdatePosTerminalDto) {
    const current = await this.prisma.posTerminal.findFirst({
      where: { id, companyId },
      select: { id: true, branchId: true },
    });
    if (!current) throw new NotFoundException('Terminal POS no encontrada');

    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    if (targetBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: targetBranchId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Sucursal no encontrada para la terminal POS');
    }

    if (dto.isDefault) {
      await this.prisma.posTerminal.updateMany({
        where: { companyId, branchId: targetBranchId },
        data: { isDefault: false },
      });
    }

    return this.prisma.posTerminal.update({
      where: { id },
      data: {
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        cashRegisterName: dto.cashRegisterName?.trim() || undefined,
        deviceName: dto.deviceName?.trim() || undefined,
        printerName: dto.printerName?.trim() || undefined,
        printerConnectionType: dto.printerConnectionType?.trim() || undefined,
        printerPaperWidth: dto.printerPaperWidth,
        invoicePrefix: dto.invoicePrefix?.trim() || undefined,
        receiptPrefix: dto.receiptPrefix?.trim() || undefined,
        resolutionNumber: dto.resolutionNumber?.trim() || undefined,
        resolutionLabel: dto.resolutionLabel?.trim() || undefined,
        defaultPriceListId: (dto as any).defaultPriceListId,
        defaultInventoryLocationId: (dto as any).defaultInventoryLocationId,
        isActive: dto.isActive,
        isDefault: dto.isDefault,
        autoPrintReceipt: dto.autoPrintReceipt,
        autoPrintInvoice: dto.autoPrintInvoice,
        requireCustomerForInvoice: dto.requireCustomerForInvoice,
        allowOpenDrawer: dto.allowOpenDrawer,
        parameters: dto.parameters as any,
      },
      include: {
        branch: { select: { id: true, name: true } },
        defaultPriceList: { select: { id: true, name: true } },
        defaultInventoryLocation: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async findShiftTemplates(companyId: string, branchId?: string) {
    return this.prisma.posShiftTemplate.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, { branch: { companyId } }],
      },
      orderBy: [{ startTime: 'asc' }, { name: 'asc' }],
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async createShiftTemplate(companyId: string, branchId: string | undefined, dto: CreatePosShiftTemplateDto) {
    const targetBranchId = dto.branchId ?? branchId ?? null;
    if (targetBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: targetBranchId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Sucursal no encontrada para el turno POS');
    }

    return this.prisma.posShiftTemplate.create({
      data: {
        companyId,
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase() || null,
        name: dto.name.trim(),
        startTime: dto.startTime,
        endTime: dto.endTime,
        toleranceMinutes: dto.toleranceMinutes ?? 0,
        requiresBlindClose: dto.requiresBlindClose ?? false,
        isActive: dto.isActive ?? true,
        parameters: dto.parameters as any,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async updateShiftTemplate(companyId: string, id: string, dto: UpdatePosShiftTemplateDto) {
    const current = await this.prisma.posShiftTemplate.findFirst({
      where: { id, companyId },
      select: { id: true, branchId: true },
    });
    if (!current) throw new NotFoundException('Turno POS no encontrado');

    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    if (targetBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: targetBranchId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException('Sucursal no encontrada para el turno POS');
    }

    return this.prisma.posShiftTemplate.update({
      where: { id },
      data: {
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        startTime: dto.startTime,
        endTime: dto.endTime,
        toleranceMinutes: dto.toleranceMinutes,
        requiresBlindClose: dto.requiresBlindClose,
        isActive: dto.isActive,
        parameters: dto.parameters as any,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async findPriceLists(companyId: string, branchId?: string) {
    return this.prisma.posPriceList.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, { branch: { companyId } }],
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async createPriceList(companyId: string, branchId: string | undefined, dto: CreatePosPriceListDto) {
    const targetBranchId = dto.branchId ?? branchId ?? null;
    await this.ensureBranch(companyId, targetBranchId);
    if (dto.isDefault) {
      await this.prisma.posPriceList.updateMany({
        where: { companyId, branchId: targetBranchId },
        data: { isDefault: false },
      });
    }
    return this.prisma.posPriceList.create({
      data: {
        companyId,
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase() || null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            price: item.price,
            minQuantity: item.minQuantity ?? null,
          })),
        },
      },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    });
  }

  async updatePriceList(companyId: string, id: string, dto: UpdatePosPriceListDto) {
    const current = await this.prisma.posPriceList.findFirst({ where: { id, companyId }, select: { id: true, branchId: true } });
    if (!current) throw new NotFoundException('Lista de precios POS no encontrada');
    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    await this.ensureBranch(companyId, targetBranchId);
    if (dto.isDefault) {
      await this.prisma.posPriceList.updateMany({
        where: { companyId, branchId: targetBranchId, id: { not: id } },
        data: { isDefault: false },
      });
    }
    if (dto.items) {
      await this.prisma.posPriceListItem.deleteMany({ where: { priceListId: id } });
    }
    return this.prisma.posPriceList.update({
      where: { id },
      data: {
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        isActive: dto.isActive,
        isDefault: dto.isDefault,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
        items: dto.items
          ? {
              create: dto.items.map((item) => ({
                productId: item.productId,
                price: item.price,
                minQuantity: item.minQuantity ?? null,
              })),
            }
          : undefined,
      },
      include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    });
  }

  async findPromotions(companyId: string, branchId?: string) {
    return this.prisma.posPromotion.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, { branch: { companyId } }],
      },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async createPromotion(companyId: string, branchId: string | undefined, dto: CreatePosPromotionDto) {
    const targetBranchId = dto.branchId ?? branchId ?? null;
    await this.ensureBranch(companyId, targetBranchId);
    return this.prisma.posPromotion.create({
      data: {
        companyId,
        branchId: targetBranchId,
        customerId: dto.customerId,
        productId: dto.productId,
        code: dto.code?.trim().toUpperCase() || null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        type: dto.type as any,
        discountMode: dto.discountMode as any,
        discountValue: dto.discountValue,
        minQuantity: dto.minQuantity ?? null,
        minSubtotal: dto.minSubtotal ?? null,
        daysOfWeek: dto.daysOfWeek as any,
        startTime: dto.startTime || null,
        endTime: dto.endTime || null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        priority: dto.priority ?? 0,
        stackable: dto.stackable ?? false,
        isActive: dto.isActive ?? true,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async updatePromotion(companyId: string, id: string, dto: UpdatePosPromotionDto) {
    const current = await this.prisma.posPromotion.findFirst({ where: { id, companyId }, select: { id: true, branchId: true } });
    if (!current) throw new NotFoundException('Promoción POS no encontrada');
    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    await this.ensureBranch(companyId, targetBranchId);
    return this.prisma.posPromotion.update({
      where: { id },
      data: {
        branchId: targetBranchId,
        customerId: dto.customerId,
        productId: dto.productId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        type: dto.type as any,
        discountMode: dto.discountMode as any,
        discountValue: dto.discountValue,
        minQuantity: dto.minQuantity,
        minSubtotal: dto.minSubtotal,
        daysOfWeek: dto.daysOfWeek as any,
        startTime: dto.startTime,
        endTime: dto.endTime,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        priority: dto.priority,
        stackable: dto.stackable,
        isActive: dto.isActive,
      },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async findCombos(companyId: string, branchId?: string) {
    return this.prisma.posCombo.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, { branch: { companyId } }],
      },
      orderBy: [{ name: 'asc' }],
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  async createCombo(companyId: string, branchId: string | undefined, dto: CreatePosComboDto) {
    const targetBranchId = dto.branchId ?? branchId ?? null;
    await this.ensureBranch(companyId, targetBranchId);
    return this.prisma.posCombo.create({
      data: {
        companyId,
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase() || null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        comboPrice: dto.comboPrice,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        isActive: dto.isActive ?? true,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  async updateCombo(companyId: string, id: string, dto: UpdatePosComboDto) {
    const current = await this.prisma.posCombo.findFirst({ where: { id, companyId }, select: { id: true, branchId: true } });
    if (!current) throw new NotFoundException('Combo POS no encontrado');
    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    await this.ensureBranch(companyId, targetBranchId);
    if (dto.items) {
      await this.prisma.posComboItem.deleteMany({ where: { comboId: id } });
    }
    return this.prisma.posCombo.update({
      where: { id },
      data: {
        branchId: targetBranchId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        comboPrice: dto.comboPrice,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        isActive: dto.isActive,
        items: dto.items
          ? {
              create: dto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            }
          : undefined,
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  async findLoyaltyCampaigns(companyId: string, branchId?: string) {
    return this.prisma.posLoyaltyCampaign.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createLoyaltyCampaign(
    companyId: string,
    branchId: string | undefined,
    dto: CreatePosLoyaltyCampaignDto,
  ) {
    const targetBranchId = dto.branchId ?? branchId ?? undefined;
    await this.ensureBranch(companyId, targetBranchId);
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Cliente objetivo no encontrado');
    }

    return this.prisma.posLoyaltyCampaign.create({
      data: {
        companyId,
        branchId: targetBranchId,
        customerId: dto.customerId,
        code: dto.code?.trim().toUpperCase() || undefined,
        name: dto.name.trim(),
        description: dto.description?.trim() || undefined,
        targetSegment: dto.targetSegment?.trim() || undefined,
        targetTier: dto.targetTier?.trim() || undefined,
        minSubtotal: dto.minSubtotal,
        pointsPerAmount: dto.pointsPerAmount,
        amountStep: dto.amountStep,
        bonusPoints: dto.bonusPoints,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        isActive: dto.isActive ?? true,
      },
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
  }

  async updateLoyaltyCampaign(companyId: string, id: string, dto: UpdatePosLoyaltyCampaignDto) {
    const current = await this.prisma.posLoyaltyCampaign.findFirst({
      where: { id, companyId },
      select: { id: true, branchId: true },
    });
    if (!current) throw new NotFoundException('Campaña de fidelización no encontrada');
    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    await this.ensureBranch(companyId, targetBranchId ?? undefined);
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Cliente objetivo no encontrado');
    }

    return this.prisma.posLoyaltyCampaign.update({
      where: { id },
      data: {
        branchId: targetBranchId,
        customerId: dto.customerId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        description: dto.description?.trim() || (dto.description === null ? null : undefined),
        targetSegment: dto.targetSegment?.trim() || (dto.targetSegment === null ? null : undefined),
        targetTier: dto.targetTier?.trim() || (dto.targetTier === null ? null : undefined),
        minSubtotal: dto.minSubtotal === null ? null : dto.minSubtotal,
        pointsPerAmount: dto.pointsPerAmount,
        amountStep: dto.amountStep,
        bonusPoints: dto.bonusPoints,
        startsAt: dto.startsAt === null ? null : dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt === null ? null : dto.endsAt ? new Date(dto.endsAt) : undefined,
        isActive: dto.isActive,
      },
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
  }

  private isCampaignActive(campaign: {
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
  }) {
    if (!campaign.isActive) return false;
    const now = new Date();
    if (campaign.startsAt && campaign.startsAt > now) return false;
    if (campaign.endsAt && campaign.endsAt < now) return false;
    return true;
  }

  private async resolveLoyaltyCampaign(
    companyId: string,
    branchId: string | null | undefined,
    customer: { id: string; customerSegment?: string | null; membershipTier?: string | null } | null,
    total: number,
  ) {
    if (!customer) return null;
    const campaigns = await this.prisma.posLoyaltyCampaign.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, {}],
      },
      orderBy: [{ customerId: 'desc' }, { bonusPoints: 'desc' }, { createdAt: 'desc' }],
    });

    return (
      campaigns.find((campaign) => {
        if (!this.isCampaignActive(campaign)) return false;
        if (campaign.customerId && campaign.customerId !== customer.id) return false;
        if (campaign.targetSegment && campaign.targetSegment !== (customer.customerSegment ?? null)) return false;
        if (campaign.targetTier && campaign.targetTier !== (customer.membershipTier ?? null)) return false;
        if (campaign.minSubtotal && total < Number(campaign.minSubtotal)) return false;
        return true;
      }) ?? null
    );
  }

  private async awardLoyaltyPoints(
    companyId: string,
    saleId: string,
    customerId: string | null | undefined,
    branchId: string | null | undefined,
    total: number,
  ) {
    if (!customerId || total <= 0) return 0;

    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId },
      select: { id: true, loyaltyPointsEarned: true },
    });
    if (!sale || Number(sale.loyaltyPointsEarned ?? 0) > 0) return Number(sale?.loyaltyPointsEarned ?? 0);

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: {
        id: true,
        customerSegment: true,
        membershipTier: true,
        loyaltyPointsBalance: true,
        loyaltyPointsEarned: true,
      },
    });
    if (!customer) return 0;

    const campaign = await this.resolveLoyaltyCampaign(companyId, branchId, customer, total);
    const amountStep = Number(campaign?.amountStep ?? 10000);
    const ratio = Number(campaign?.pointsPerAmount ?? 0.1);
    const basePoints = Math.floor(total / Math.max(1, amountStep) * ratio);
    const points = Math.max(0, basePoints + Number(campaign?.bonusPoints ?? 0));
    if (points <= 0) return 0;

    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          loyaltyPointsBalance: { increment: points },
          loyaltyPointsEarned: { increment: points },
          lastPurchaseAt: new Date(),
        },
      }),
      this.prisma.posSale.update({
        where: { id: saleId },
        data: {
          loyaltyPointsEarned: points,
          loyaltyCampaignId: campaign?.id ?? null,
        },
      }),
      this.prisma.posLoyaltyTransaction.create({
        data: {
          companyId,
          customerId: customer.id,
          saleId,
          loyaltyCampaignId: campaign?.id,
          type: 'EARN',
          points,
          amountBase: total,
          description: campaign
            ? `Puntos generados por campaña ${campaign.name}`
            : 'Puntos generados por venta POS',
        },
      }),
    ]);

    return points;
  }

  async getCustomerLoyaltyProfile(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        documentNumber: true,
        loyaltyCode: true,
        membershipTier: true,
        customerSegment: true,
        loyaltyPointsBalance: true,
        loyaltyPointsEarned: true,
        loyaltyPointsRedeemed: true,
        lastPurchaseAt: true,
      },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const [sales, transactions] = await Promise.all([
      this.prisma.posSale.findMany({
        where: { companyId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          saleNumber: true,
          total: true,
          status: true,
          createdAt: true,
          loyaltyPointsEarned: true,
          invoice: { select: { id: true, invoiceNumber: true, status: true } },
        },
      }),
      this.prisma.posLoyaltyTransaction.findMany({
        where: { companyId, customerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          loyaltyCampaign: { select: { id: true, name: true } },
          sale: { select: { id: true, saleNumber: true } },
        },
      }),
    ]);

    const completedSales = sales.filter((sale) => sale.status === 'COMPLETED');
    const totalSpent = completedSales.reduce((sum, sale) => sum + Number(sale.total), 0);

    return {
      customer,
      metrics: {
        salesCount: completedSales.length,
        totalSpent,
        averageTicket: completedSales.length ? this.roundCurrency(totalSpent / completedSales.length) : 0,
      },
      recentSales: sales,
      transactions,
    };
  }

  async findInventoryLocations(companyId: string, branchId?: string) {
    return this.prisma.posInventoryLocation.findMany({
      where: {
        companyId,
        isActive: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, {}],
      },
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { stocks: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createInventoryLocation(companyId: string, branchId: string | undefined, dto: CreatePosInventoryLocationDto) {
    const targetBranchId = dto.branchId ?? branchId ?? null;
    if (targetBranchId) {
      await this.ensureBranch(companyId, targetBranchId);
    }

    if (dto.isDefault) {
      await this.prisma.posInventoryLocation.updateMany({
        where: { companyId, branchId: targetBranchId },
        data: { isDefault: false },
      });
    }

    return this.prisma.posInventoryLocation.create({
      data: {
        companyId,
        branchId: targetBranchId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        type: (dto.type as any) ?? 'STORE',
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        allowPosSales: dto.allowPosSales ?? true,
      },
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { stocks: true } },
      },
    });
  }

  async updateInventoryLocation(companyId: string, id: string, dto: UpdatePosInventoryLocationDto) {
    const current = await this.prisma.posInventoryLocation.findFirst({
      where: { id, companyId },
      select: { id: true, branchId: true },
    });
    if (!current) throw new NotFoundException('Ubicación de inventario no encontrada');

    const targetBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    if (targetBranchId) {
      await this.ensureBranch(companyId, targetBranchId);
    }
    if (dto.isDefault) {
      await this.prisma.posInventoryLocation.updateMany({
        where: { companyId, branchId: targetBranchId ?? null },
        data: { isDefault: false },
      });
    }

    return this.prisma.posInventoryLocation.update({
      where: { id },
      data: {
        branchId: dto.branchId === undefined ? undefined : dto.branchId,
        code: dto.code?.trim().toUpperCase(),
        name: dto.name?.trim(),
        type: dto.type as any,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
        allowPosSales: dto.allowPosSales,
      },
      include: {
        branch: { select: { id: true, name: true } },
        _count: { select: { stocks: true } },
      },
    });
  }

  private async syncProductStockTotal(tx: any, companyId: string, productId: string) {
    const rows = await tx.posInventoryStock.findMany({
      where: { companyId, productId },
      select: { quantity: true },
    });
    const total = rows.reduce((sum: number, row: { quantity: number }) => sum + Number(row.quantity ?? 0), 0);
    await tx.product.update({
      where: { id: productId },
      data: { stock: total },
    });
    return total;
  }

  async upsertInventoryStock(companyId: string, branchId: string | undefined, dto: UpsertPosInventoryStockDto) {
    const location = await this.prisma.posInventoryLocation.findFirst({
      where: { id: dto.locationId, companyId, isActive: true },
      select: { id: true, branchId: true },
    });
    if (!location) throw new NotFoundException('Ubicación de inventario no encontrada');

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const record = await this.prisma.posInventoryStock.create({
      data: {
        companyId,
        branchId: location.branchId ?? branchId ?? null,
        locationId: dto.locationId,
        productId: dto.productId,
        lotNumber: dto.lotNumber?.trim() || null,
        serialNumber: dto.serialNumber?.trim() || null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        quantity: dto.quantity,
      },
      include: {
        location: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });

    await this.syncProductStockTotal(this.prisma, companyId, dto.productId);
    return record;
  }

  async getInventoryStocks(companyId: string, branchId?: string, search?: string) {
    return this.prisma.posInventoryStock.findMany({
      where: {
        companyId,
        ...(branchId ? { branchId } : {}),
        product: search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
              ],
            }
          : undefined,
      },
      include: {
        location: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true, stock: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { createdAt: 'desc' }],
    });
  }

  private async resolveInventoryLocationId(
    companyId: string,
    branchId: string | null | undefined,
    preferredLocationId: string | null | undefined,
    terminalId?: string | null,
  ) {
    if (preferredLocationId) {
      const location = await this.prisma.posInventoryLocation.findFirst({
        where: { id: preferredLocationId, companyId, isActive: true },
        select: { id: true, allowPosSales: true },
      });
      if (!location) throw new NotFoundException('Ubicación de inventario no encontrada');
      if (!location.allowPosSales) {
        throw new BadRequestException('La ubicación seleccionada no permite ventas POS');
      }
      return location.id;
    }

    if (terminalId) {
      const terminal = await this.prisma.posTerminal.findFirst({
        where: { id: terminalId, companyId, isActive: true },
        select: { defaultInventoryLocationId: true },
      });
      if (terminal?.defaultInventoryLocationId) return terminal.defaultInventoryLocationId;
    }

    const location = await this.prisma.posInventoryLocation.findFirst({
      where: {
        companyId,
        isActive: true,
        allowPosSales: true,
        OR: branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }, {}],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    return location?.id ?? null;
  }

  private async getInventoryAvailabilityMap(
    companyId: string,
    branchId: string | null | undefined,
    productIds: string[],
    preferredLocationId?: string | null,
  ) {
    if (productIds.length === 0) return new Map<string, { available: number; locationId?: string | null }>();
    const rows = await this.prisma.posInventoryStock.findMany({
      where: {
        companyId,
        productId: { in: productIds },
        ...(preferredLocationId
          ? { locationId: preferredLocationId }
          : branchId
            ? { OR: [{ branchId }, { branchId: null }] }
            : {}),
      },
      include: {
        location: { select: { id: true, name: true, code: true, allowPosSales: true } },
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });

    const map = new Map<string, { available: number; locationId?: string | null }>();
    for (const row of rows) {
      if (!row.location.allowPosSales) continue;
      const available = Number(row.quantity) - Number(row.reservedQuantity ?? 0);
      const current = map.get(row.productId) ?? { available: 0, locationId: row.locationId };
      current.available += Math.max(0, available);
      current.locationId = current.locationId ?? row.locationId;
      map.set(row.productId, current);
    }
    return map;
  }

  async getCatalogProducts(
    companyId: string,
    branchId: string | undefined,
    filters: { search?: string; locationId?: string },
  ) {
    const products = await this.prisma.product.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { sku: { contains: filters.search, mode: 'insensitive' } },
                { barcode: { contains: filters.search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        taxRate: true,
        taxType: true,
        stock: true,
        unit: true,
        minStock: true,
      },
    });

    const stockRows = await this.prisma.posInventoryStock.findMany({
      where: {
        companyId,
        productId: { in: products.map((product) => product.id) },
        ...(filters.locationId
          ? { locationId: filters.locationId }
          : branchId
            ? { OR: [{ branchId }, { branchId: null }] }
            : {}),
      },
      include: {
        location: { select: { id: true, name: true, code: true, allowPosSales: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const grouped = new Map<string, any[]>();
    for (const row of stockRows) {
      if (!row.location.allowPosSales) continue;
      const current = grouped.get(row.productId) ?? [];
      current.push(row);
      grouped.set(row.productId, current);
    }

    return products.map((product) => {
      const rows = grouped.get(product.id) ?? [];
      const reservedStock = rows.reduce((sum, row) => sum + Number(row.reservedQuantity ?? 0), 0);
      const physicalStock = rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
      const availableStock = rows.reduce(
        (sum, row) => sum + Math.max(0, Number(row.quantity ?? 0) - Number(row.reservedQuantity ?? 0)),
        0,
      );
      return {
        ...product,
        stock: rows.length > 0 ? physicalStock : Number(product.stock),
        availableStock: rows.length > 0 ? availableStock : Number(product.stock),
        reservedStock,
        hasInventoryDetail: rows.length > 0,
        inventoryLocations: rows.map((row) => ({
          stockId: row.id,
          locationId: row.locationId,
          locationName: row.location.name,
          locationCode: row.location.code,
          quantity: Number(row.quantity),
          reservedQuantity: Number(row.reservedQuantity ?? 0),
          availableQuantity: Math.max(0, Number(row.quantity) - Number(row.reservedQuantity ?? 0)),
          lotNumber: row.lotNumber,
          serialNumber: row.serialNumber,
          expiresAt: row.expiresAt,
        })),
      };
    });
  }

  private async reserveInventoryForAdvance(
    tx: any,
    companyId: string,
    saleId: string,
    sessionId: string,
    customerId: string | undefined,
    branchId: string,
    locationId: string | null,
    itemsData: Array<{ productId?: string; quantity: number }>,
  ) {
    for (const item of itemsData) {
      if (!item.productId) continue;
      if (!locationId) continue;
      const candidateStocks = await tx.posInventoryStock.findMany({
        where: {
          companyId,
          productId: item.productId,
          locationId,
        },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      });
      let remaining = Number(item.quantity);
      for (const stock of candidateStocks) {
        const available = Number(stock.quantity) - Number(stock.reservedQuantity ?? 0);
        if (available <= 0 || remaining <= 0) continue;
        const reserveQty = Math.min(available, remaining);
        await tx.posInventoryStock.update({
          where: { id: stock.id },
          data: { reservedQuantity: { increment: reserveQty } },
        });
        await tx.posInventoryReservation.create({
          data: {
            companyId,
            branchId,
            locationId,
            productId: item.productId,
            stockId: stock.id,
            saleId,
            sessionId,
            customerId: customerId ?? null,
            quantity: reserveQty,
            status: 'OPEN',
            notes: 'Reserva automática por anticipo POS',
          },
        });
        remaining -= reserveQty;
      }
      if (remaining > 0) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true, stock: true } });
        if (Number(product?.stock ?? 0) < Number(item.quantity)) {
          throw new BadRequestException(`Stock insuficiente para ${product?.name ?? 'producto POS'}`);
        }
      }
    }
  }

  private async allocateInventoryForSale(
    tx: any,
    companyId: string,
    branchId: string,
    locationId: string | null,
    saleItems: Array<{ id: string; productId?: string | null; quantity: any }>,
  ) {
    for (const saleItem of saleItems) {
      if (!saleItem.productId) continue;
      let remaining = Number(saleItem.quantity);
      const reservedRows = await tx.posInventoryReservation.findMany({
        where: { companyId, saleId: (saleItem as any).saleId, productId: saleItem.productId, status: 'OPEN' },
        orderBy: { createdAt: 'asc' },
      });
      for (const reservation of reservedRows) {
        if (remaining <= 0) break;
        const consumeQty = Math.min(remaining, Number(reservation.quantity));
        if (reservation.stockId) {
          await tx.posInventoryStock.update({
            where: { id: reservation.stockId },
            data: {
              quantity: { decrement: consumeQty },
              reservedQuantity: { decrement: consumeQty },
            },
          });
          await tx.posInventoryAllocation.create({
            data: {
              companyId,
              saleItemId: saleItem.id,
              stockId: reservation.stockId,
              quantity: consumeQty,
            },
          });
        }
        if (consumeQty === Number(reservation.quantity)) {
          await tx.posInventoryReservation.update({
            where: { id: reservation.id },
            data: { status: 'CONSUMED' },
          });
        } else {
          await tx.posInventoryReservation.update({
            where: { id: reservation.id },
            data: { quantity: { decrement: consumeQty } },
          });
          await tx.posInventoryReservation.create({
            data: {
              ...reservation,
              id: undefined,
              quantity: consumeQty,
              status: 'CONSUMED',
            },
          });
        }
        remaining -= consumeQty;
      }

      if (remaining > 0 && locationId) {
        const stocks = await tx.posInventoryStock.findMany({
          where: { companyId, productId: saleItem.productId, locationId },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
        });
        for (const stock of stocks) {
          if (remaining <= 0) break;
          const available = Number(stock.quantity) - Number(stock.reservedQuantity ?? 0);
          if (available <= 0) continue;
          const consumeQty = Math.min(remaining, available);
          await tx.posInventoryStock.update({
            where: { id: stock.id },
            data: { quantity: { decrement: consumeQty } },
          });
          await tx.posInventoryAllocation.create({
            data: {
              companyId,
              saleItemId: saleItem.id,
              stockId: stock.id,
              quantity: consumeQty,
            },
          });
          remaining -= consumeQty;
        }
      }

      if (remaining > 0) {
        await tx.product.update({
          where: { id: saleItem.productId },
          data: { stock: { decrement: remaining } },
        });
      } else {
        await this.syncProductStockTotal(tx, companyId, saleItem.productId);
      }
    }
  }

  async findInventoryTransfers(companyId: string, branchId?: string) {
    return this.prisma.posInventoryTransfer.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] } : {}),
      },
      include: {
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
        fromLocation: { select: { id: true, name: true, code: true } },
        toLocation: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createInventoryTransfer(companyId: string, userId: string, dto: CreatePosInventoryTransferDto) {
    const [fromLocation, toLocation] = await Promise.all([
      this.prisma.posInventoryLocation.findFirst({
        where: { id: dto.fromLocationId, companyId, isActive: true },
        select: { id: true, branchId: true, name: true },
      }),
      this.prisma.posInventoryLocation.findFirst({
        where: { id: dto.toLocationId, companyId, isActive: true },
        select: { id: true, branchId: true, name: true },
      }),
    ]);
    if (!fromLocation || !toLocation) {
      throw new NotFoundException('Ubicación origen o destino no encontrada');
    }
    if (fromLocation.id === toLocation.id) {
      throw new BadRequestException('La ubicación destino debe ser diferente a la de origen');
    }

    const reference = dto.reference?.trim() || `TRF-${Date.now()}`;
    return this.prisma.posInventoryTransfer.create({
      data: {
        companyId,
        fromBranchId: fromLocation.branchId ?? null,
        toBranchId: toLocation.branchId ?? null,
        fromLocationId: fromLocation.id,
        toLocationId: toLocation.id,
        reference,
        status: 'PENDING',
        notes: dto.notes?.trim() || null,
        createdById: userId,
        items: {
          create: dto.items.map((item) => ({
            companyId,
            branchId: fromLocation.branchId ?? null,
            productId: item.productId,
            quantity: item.quantity,
            lotNumber: item.lotNumber?.trim() || null,
            serialNumber: item.serialNumber?.trim() || null,
            expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
          })),
        },
      },
      include: {
        fromLocation: { select: { id: true, name: true, code: true } },
        toLocation: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  async postInventoryTransfer(companyId: string, id: string) {
    const transfer = await this.prisma.posInventoryTransfer.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!transfer) throw new NotFoundException('Transferencia no encontrada');
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('La transferencia ya fue procesada');
    }

    const posted = await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        let remaining = Number(item.quantity);
        const sourceStocks = await tx.posInventoryStock.findMany({
          where: {
            companyId,
            locationId: transfer.fromLocationId,
            productId: item.productId,
            ...(item.serialNumber ? { serialNumber: item.serialNumber } : {}),
            ...(item.lotNumber ? { lotNumber: item.lotNumber } : {}),
          },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
        });
        for (const stock of sourceStocks) {
          if (remaining <= 0) break;
          const available = Number(stock.quantity) - Number(stock.reservedQuantity ?? 0);
          if (available <= 0) continue;
          const moveQty = Math.min(remaining, available);
          await tx.posInventoryStock.update({
            where: { id: stock.id },
            data: { quantity: { decrement: moveQty } },
          });
          await tx.posInventoryStock.create({
            data: {
              companyId,
              branchId: transfer.toBranchId ?? null,
              locationId: transfer.toLocationId,
              productId: item.productId,
              lotNumber: item.lotNumber ?? stock.lotNumber,
              serialNumber: item.serialNumber ?? stock.serialNumber,
              expiresAt: item.expiresAt ?? stock.expiresAt,
              quantity: moveQty,
            },
          });
          remaining -= moveQty;
        }
        if (remaining > 0) {
          throw new BadRequestException('Stock insuficiente para completar la transferencia');
        }
        await this.syncProductStockTotal(tx, companyId, item.productId);
      }

      return tx.posInventoryTransfer.update({
        where: { id: transfer.id },
        data: { status: 'POSTED', postedAt: new Date() },
        include: {
          fromLocation: { select: { id: true, name: true, code: true } },
          toLocation: { select: { id: true, name: true, code: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      });
    });

    return posted;
  }

  async previewPricing(companyId: string, branchId: string | undefined, dto: PreviewPosPricingDto) {
    const context = await this.buildPricingContext(
      companyId,
      dto.branchId ?? branchId,
      dto.customerId,
      dto.items,
      dto.priceListId,
    );
    return this.calculatePricing(dto.items, context, dto.cartDiscountPct ?? 0);
  }

  private async getApprovedReturnedQuantities(
    companyId: string,
    saleId: string,
    excludeRequestId?: string,
  ) {
    const approvedLines = await this.prisma.posPostSaleRequestItem.findMany({
      where: {
        lineType: 'RETURN',
        request: {
          companyId,
          saleId,
          status: 'APPROVED',
          ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        },
      },
      select: {
        saleItemId: true,
        quantity: true,
      },
    });

    return approvedLines.reduce<Record<string, number>>((acc, item) => {
      if (!item.saleItemId) return acc;
      acc[item.saleItemId] = (acc[item.saleItemId] ?? 0) + Number(item.quantity);
      return acc;
    }, {});
  }

  async findPostSaleRequests(
    companyId: string,
    branchId?: string,
    filters: { status?: string; saleId?: string } = {},
  ) {
    return this.prisma.posPostSaleRequest.findMany({
      where: {
        companyId,
        ...(branchId ? { branchId } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.saleId ? { saleId: filters.saleId } : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        sale: {
          select: {
            id: true,
            saleNumber: true,
            total: true,
            status: true,
            customer: { select: { id: true, name: true, documentNumber: true } },
            invoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        creditNoteInvoice: { select: { id: true, invoiceNumber: true, status: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            saleItem: {
              select: {
                id: true,
                description: true,
                quantity: true,
                productId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPostSaleRequest(
    companyId: string,
    userId: string,
    branchId: string | undefined,
    saleId: string,
    dto: CreatePosPostSaleRequestDto,
  ) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        invoice: { select: { id: true, invoiceNumber: true, status: true, prefix: true } },
        items: true,
      },
    });

    if (!sale) throw new NotFoundException('Venta POS no encontrada');
    if (!['COMPLETED', 'REFUNDED'].includes(sale.status)) {
      throw new BadRequestException('Solo se puede iniciar postventa sobre ventas completadas');
    }

    const approvedReturned = await this.getApprovedReturnedQuantities(companyId, sale.id);
    const saleItemsById = new Map(sale.items.map((item) => [item.id, item]));

    const returnLines = dto.items.map((line) => {
      const saleItem = saleItemsById.get(line.saleItemId);
      if (!saleItem) {
        throw new NotFoundException('Uno de los ítems seleccionados no pertenece a la venta');
      }

      const quantity = Number(line.quantity);
      const soldQty = Number(saleItem.quantity);
      const alreadyReturned = approvedReturned[saleItem.id] ?? 0;
      const availableQty = Math.max(0, soldQty - alreadyReturned);
      if (quantity > availableQty + 0.0001) {
        throw new BadRequestException(
          `La cantidad a devolver de ${saleItem.description} excede el disponible (${availableQty})`,
        );
      }

      const subtotal = this.roundCurrency(quantity * Number(saleItem.unitPrice));
      const taxAmount = this.roundCurrency(subtotal * (Number(saleItem.taxRate) / 100));
      const total = this.roundCurrency(subtotal + taxAmount);

      return {
        lineType: 'RETURN' as const,
        saleItemId: saleItem.id,
        productId: saleItem.productId ?? undefined,
        description: saleItem.description,
        quantity,
        unitPrice: Number(saleItem.unitPrice),
        taxRate: Number(saleItem.taxRate),
        taxAmount,
        subtotal,
        total,
      };
    });

    if (returnLines.length === 0) {
      throw new BadRequestException('Debe registrar al menos un ítem para devolución o cambio');
    }

    const replacementRequests = dto.replacements ?? [];
    if (dto.type === 'EXCHANGE' && replacementRequests.length === 0) {
      throw new BadRequestException('Debe seleccionar al menos un producto de reemplazo');
    }

    const replacementProductIds = replacementRequests.map((item) => item.productId);
    const replacementProducts = replacementProductIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: replacementProductIds }, companyId, deletedAt: null },
          select: { id: true, name: true, sku: true, price: true, taxRate: true, stock: true },
        })
      : [];
    const replacementProductsById = new Map(replacementProducts.map((item) => [item.id, item]));

    const replacementLines = replacementRequests.map((line) => {
      const product = replacementProductsById.get(line.productId);
      if (!product) {
        throw new NotFoundException('Uno de los productos de reemplazo no existe');
      }
      const quantity = Number(line.quantity);
      const subtotal = this.roundCurrency(quantity * Number(product.price));
      const taxRate = Number(product.taxRate ?? 0);
      const taxAmount = this.roundCurrency(subtotal * (taxRate / 100));
      const total = this.roundCurrency(subtotal + taxAmount);

      return {
        lineType: 'REPLACEMENT' as const,
        productId: product.id,
        description: line.description?.trim() || product.name,
        quantity,
        unitPrice: Number(product.price),
        taxRate,
        taxAmount,
        subtotal,
        total,
      };
    });

    const returnSubtotal = this.roundCurrency(
      returnLines.reduce((sum, item) => sum + Number(item.subtotal), 0),
    );
    const returnTax = this.roundCurrency(
      returnLines.reduce((sum, item) => sum + Number(item.taxAmount), 0),
    );
    const returnTotal = this.roundCurrency(
      returnLines.reduce((sum, item) => sum + Number(item.total), 0),
    );
    const replacementTotal = this.roundCurrency(
      replacementLines.reduce((sum, item) => sum + Number(item.total), 0),
    );

    if (dto.type === 'EXCHANGE' && replacementTotal > returnTotal + 0.01) {
      throw new BadRequestException(
        'El cambio no puede superar el valor de la devolución en esta primera versión POS',
      );
    }

    return this.prisma.posPostSaleRequest.create({
      data: {
        companyId,
        saleId: sale.id,
        branchId: sale.branchId ?? branchId ?? undefined,
        createdById: userId,
        type: dto.type,
        status: 'PENDING_APPROVAL',
        reasonCode: dto.reasonCode,
        reasonDetail: dto.reasonDetail?.trim() || undefined,
        subtotal: returnSubtotal,
        taxAmount: returnTax,
        total: returnTotal,
        exchangeSnapshot:
          dto.type === 'EXCHANGE'
            ? {
                replacementTotal,
                difference: this.roundCurrency(returnTotal - replacementTotal),
              }
            : undefined,
        items: {
          create: [...returnLines, ...replacementLines],
        },
      },
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            customer: { select: { id: true, name: true, documentNumber: true } },
            invoice: { select: { id: true, invoiceNumber: true, status: true } },
          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            saleItem: { select: { id: true, description: true, quantity: true } },
          },
        },
      },
    });
  }

  async approvePostSaleRequest(
    companyId: string,
    userId: string,
    requestId: string,
    dto: ResolvePosPostSaleRequestDto,
  ) {
    const request = await this.prisma.posPostSaleRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        sale: {
          include: {
            customer: { select: { id: true, name: true, documentNumber: true } },
            invoice: { select: { id: true, invoiceNumber: true, status: true, prefix: true } },
            items: true,
          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, stock: true } },
            saleItem: true,
          },
        },
      },
    });

    if (!request) throw new NotFoundException('Solicitud de postventa no encontrada');
    if (request.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('La solicitud ya fue procesada');
    }

    const approvedReturned = await this.getApprovedReturnedQuantities(companyId, request.saleId, request.id);
    const returnLines = request.items.filter((item) => item.lineType === 'RETURN');
    const replacementLines = request.items.filter((item) => item.lineType === 'REPLACEMENT');
    const saleItemsById = new Map(request.sale.items.map((item) => [item.id, item]));

    for (const item of returnLines) {
      const saleItem = item.saleItemId ? saleItemsById.get(item.saleItemId) : null;
      if (!saleItem) {
        throw new BadRequestException('Uno de los ítems de devolución ya no es válido');
      }
      const availableQty = Number(saleItem.quantity) - (approvedReturned[saleItem.id] ?? 0);
      if (Number(item.quantity) > availableQty + 0.0001) {
        throw new BadRequestException(
          `La solicitud supera la cantidad disponible para ${saleItem.description}`,
        );
      }
    }

    for (const item of replacementLines) {
      const product = item.product;
      if (!product) {
        throw new BadRequestException('Uno de los productos de reemplazo no existe');
      }
      if (Number(product.stock) < Number(item.quantity)) {
        throw new BadRequestException(
          `No hay stock suficiente para ${product.name} en el cambio de producto`,
        );
      }
    }

    let creditNoteInvoiceId: string | undefined;
    if (request.sale.invoiceId && request.sale.customerId && returnLines.length > 0) {
      const creditNote = await this.invoicesService.create(
        companyId,
        request.sale.branchId ?? request.branchId ?? null,
        {
          type: 'NOTA_CREDITO',
          originalInvoiceId: request.sale.invoiceId,
          customerId: request.sale.customerId,
          prefix: request.sale.invoice?.prefix ?? 'NC',
          notes: `Nota crédito POS por postventa ${request.sale.saleNumber}`,
          items: returnLines.map((item) => ({
            productId: item.productId ?? undefined,
            description: item.description,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            taxRate: Number(item.taxRate),
            discount: 0,
          })),
        } as any,
      );
      creditNoteInvoiceId = creditNote.id;
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of returnLines) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: Number(item.quantity) } },
          });
        }
      }

      for (const item of replacementLines) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: Number(item.quantity) } },
          });
        }
      }

      return tx.posPostSaleRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
          approvalNotes: dto.approvalNotes?.trim() || undefined,
          creditNoteInvoiceId,
          exchangeSnapshot:
            request.type === 'EXCHANGE'
              ? {
                  ...(request.exchangeSnapshot as Record<string, unknown> | null),
                  appliedAt: new Date().toISOString(),
                  replacementLines: replacementLines.map((item) => ({
                    productId: item.productId,
                    description: item.description,
                    quantity: Number(item.quantity),
                    total: Number(item.total),
                  })),
                }
              : request.exchangeSnapshot ?? undefined,
        },
        include: {
          sale: {
            select: {
              id: true,
              saleNumber: true,
              customer: { select: { id: true, name: true, documentNumber: true } },
              invoice: { select: { id: true, invoiceNumber: true, status: true } },
            },
          },
          creditNoteInvoice: { select: { id: true, invoiceNumber: true, status: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              saleItem: { select: { id: true, description: true, quantity: true } },
            },
          },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
  }

  async rejectPostSaleRequest(
    companyId: string,
    userId: string,
    requestId: string,
    dto: ResolvePosPostSaleRequestDto,
  ) {
    const request = await this.prisma.posPostSaleRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!request) throw new NotFoundException('Solicitud de postventa no encontrada');
    if (request.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('La solicitud ya fue procesada');
    }

    return this.prisma.posPostSaleRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        approvedById: userId,
        approvedAt: new Date(),
        approvalNotes: dto.approvalNotes?.trim() || 'Solicitud rechazada por supervisor',
      },
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            customer: { select: { id: true, name: true, documentNumber: true } },
          },
        },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            saleItem: { select: { id: true, description: true, quantity: true } },
          },
        },
      },
    });
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async openSession(companyId: string, userId: string, branchId: string | undefined, dto: CreatePosSessionDto) {
    const existing = await this.prisma.posSession.findFirst({
      where: { companyId, userId, status: 'OPEN' },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya tienes una sesión de caja abierta. Ciérrala antes de abrir una nueva.',
      );
    }

    const configuredTerminalCount = await this.prisma.posTerminal.count({
      where: branchId
        ? {
            companyId,
            isActive: true,
            OR: [{ branchId }, { branchId: null }],
          }
        : {
            companyId,
            isActive: true,
          },
    });
    if (configuredTerminalCount > 0 && !dto.terminalId) {
      throw new BadRequestException('Debes seleccionar una caja o terminal POS para abrir la sesión');
    }

    const [terminal, shiftTemplate] = await Promise.all([
      dto.terminalId
        ? this.prisma.posTerminal.findFirst({
            where: { id: dto.terminalId, companyId, isActive: true },
            include: { branch: { select: { id: true, name: true } } },
          })
        : null,
      dto.shiftTemplateId
        ? this.prisma.posShiftTemplate.findFirst({
            where: { id: dto.shiftTemplateId, companyId, isActive: true },
            include: { branch: { select: { id: true, name: true } } },
          })
        : null,
    ]);

    if (dto.terminalId && !terminal) {
      throw new NotFoundException('La caja o terminal POS seleccionada no existe');
    }
    if (dto.shiftTemplateId && !shiftTemplate) {
      throw new NotFoundException('El turno POS seleccionado no existe');
    }

    const sessionBranchId = branchId ?? terminal?.branchId ?? shiftTemplate?.branchId ?? null;

    return this.prisma.posSession.create({
      data: {
        companyId,
        userId,
        branchId: sessionBranchId,
        terminalId: terminal?.id,
        shiftTemplateId: shiftTemplate?.id,
        lastHeartbeatAt: new Date(),
        initialCash: dto.initialCash,
        notes: dto.notes,
        status: 'OPEN',
        openingSnapshot: {
          branchId: sessionBranchId,
          terminal: terminal
            ? {
                id: terminal.id,
                code: terminal.code,
                name: terminal.name,
                cashRegisterName: terminal.cashRegisterName,
                printerName: terminal.printerName,
                printerPaperWidth: terminal.printerPaperWidth,
                invoicePrefix: terminal.invoicePrefix,
                receiptPrefix: terminal.receiptPrefix,
                resolutionNumber: terminal.resolutionNumber,
                resolutionLabel: terminal.resolutionLabel,
                parameters: terminal.parameters ?? null,
              }
            : null,
          shiftTemplate: shiftTemplate
            ? {
                id: shiftTemplate.id,
                code: shiftTemplate.code,
                name: shiftTemplate.name,
                startTime: shiftTemplate.startTime,
                endTime: shiftTemplate.endTime,
                toleranceMinutes: shiftTemplate.toleranceMinutes,
                requiresBlindClose: shiftTemplate.requiresBlindClose,
                parameters: shiftTemplate.parameters ?? null,
              }
            : null,
        } as any,
      },
      include: {
        branch: { select: { id: true, name: true } },
        shiftTemplate: true,
        terminal: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async closeSession(
    companyId: string,
    userId: string,
    userRoles: string[],
    sessionId: string,
    dto: ClosePosSessionDto,
  ) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId, status: 'OPEN' },
      include: { shiftTemplate: true },
    });
    if (!session) throw new NotFoundException('Sesión no encontrada o ya cerrada');

    const cashContext = await this.getSessionCashContext(sessionId);
    const countedCash = dto.denominations ? this.sumDenominations(dto.denominations) : dto.finalCash;
    const expectedCash = Number(session.initialCash) + cashContext.cashSales + cashContext.cashIn - cashContext.cashOut;
    const cashDifference = countedCash - expectedCash;
    const needsApproval = Math.abs(cashDifference) > 0.009 || !!session.shiftTemplate?.requiresBlindClose;
    const nextStatus = needsApproval ? 'PENDING_CLOSE_APPROVAL' : 'CLOSED';

    const updated = await this.prisma.posSession.update({
      where: { id: sessionId },
      data: {
        status: nextStatus,
        closedAt: nextStatus === 'CLOSED' ? new Date() : null,
        finalCash: countedCash,
        countedCash,
        expectedCash,
        cashDifference,
        totalSales: cashContext.totalSales,
        totalTransactions: cashContext.totalTransactions,
        closingDenominations: dto.denominations as any,
        closeRequestedAt: new Date(),
        closeRequestedById: userId,
        closeApprovedAt: nextStatus === 'CLOSED' ? new Date() : null,
        closeApprovedById: nextStatus === 'CLOSED' ? userId : null,
        closeRejectedAt: null,
        closeRejectedReason: null,
        notes: dto.notes ?? session.notes,
      },
      include: {
        branch: { select: { id: true, name: true } },
        closeApprovedBy: { select: { id: true, firstName: true, lastName: true } },
        closeRequestedBy: { select: { id: true, firstName: true, lastName: true } },
        shiftTemplate: true,
        terminal: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { sales: true } },
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: needsApproval ? 'POS_CLOSE_REQUESTED' : 'POS_CLOSED',
      resource: 'POS_SESSION',
      resourceId: sessionId,
      before: {
        status: session.status,
        expectedCash: session.expectedCash,
        cashDifference: session.cashDifference,
      },
      after: {
        status: updated.status,
        branchId: updated.branchId,
        expectedCash,
        countedCash,
        cashDifference,
      },
    });

    return {
      ...updated,
      requiresApproval: needsApproval,
      summary: {
        expectedCash,
        countedCash,
        cashDifference,
        cashIn: cashContext.cashIn,
        cashOut: cashContext.cashOut,
        cashSales: cashContext.cashSales,
      },
    };
  }

  async approveCloseSession(companyId: string, userId: string, sessionId: string, dto: ApproveClosePosSessionDto) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId, status: 'PENDING_CLOSE_APPROVAL' },
    });
    if (!session) throw new NotFoundException('No existe un cierre pendiente de aprobación para esta sesión');

    const updated = await this.prisma.posSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closeApprovedAt: new Date(),
        closeApprovedById: userId,
        notes: dto.notes ? `${session.notes ?? ''}\n[APROBACIÓN CIERRE] ${dto.notes}`.trim() : session.notes,
      },
      include: {
        branch: { select: { id: true, name: true } },
        closeApprovedBy: { select: { id: true, firstName: true, lastName: true } },
        closeRequestedBy: { select: { id: true, firstName: true, lastName: true } },
        shiftTemplate: true,
        terminal: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_CLOSE_APPROVED',
      resource: 'POS_SESSION',
      resourceId: sessionId,
      before: { status: session.status, cashDifference: session.cashDifference },
      after: { status: updated.status, approvedAt: updated.closeApprovedAt },
    });

    return updated;
  }

  async reopenSession(
    companyId: string,
    userId: string,
    userRoles: string[],
    branchId: string | undefined,
    sessionId: string,
    dto: ReopenPosSessionDto,
  ) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId, status: 'CLOSED' },
      include: { terminal: true, shiftTemplate: true },
    });
    if (!session) throw new NotFoundException('La sesión cerrada no fue encontrada');

    const existingOpen = await this.prisma.posSession.findFirst({
      where: { companyId, userId, status: 'OPEN' },
      select: { id: true },
    });
    if (existingOpen) {
      throw new BadRequestException('Ya tienes una sesión de caja abierta. Ciérrala antes de reabrir otra.');
    }

    await this.enforceGovernance({
      companyId,
      userId,
      userRoles,
      action: 'REOPEN_SESSION',
      branchId: branchId ?? session.branchId ?? undefined,
      resourceType: 'POS_SESSION',
      resourceId: sessionId,
      overrideId: dto.governanceOverrideId,
    });

    const initialCash = dto.initialCash ?? Number(session.finalCash ?? session.countedCash ?? session.expectedCash ?? 0);
    const reopened = await this.openSession(companyId, userId, branchId ?? session.branchId ?? undefined, {
      initialCash,
      terminalId: dto.terminalId ?? session.terminalId ?? undefined,
      shiftTemplateId: dto.shiftTemplateId ?? session.shiftTemplateId ?? undefined,
      notes: dto.notes
        ? `[REAPERTURA CONTROLADA] ${dto.notes}`
        : `[REAPERTURA CONTROLADA] Derivada de sesión ${session.id}`,
    });

    await this.prisma.posSession.update({
      where: { id: sessionId },
      data: {
        reopenedAt: new Date(),
        reopenedById: userId,
        reopenedFromSessionId: reopened.id,
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_SESSION_REOPENED',
      resource: 'POS_SESSION',
      resourceId: sessionId,
      before: { status: session.status, finalCash: session.finalCash },
      after: { reopenedSessionId: reopened.id, initialCash, branchId: reopened.branchId },
    });

    return reopened;
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
          branch: { select: { id: true, name: true } },
          closeApprovedBy: { select: { id: true, firstName: true, lastName: true } },
          closeRequestedBy: { select: { id: true, firstName: true, lastName: true } },
          reopenedBy: { select: { id: true, firstName: true, lastName: true } },
          shiftTemplate: true,
          terminal: true,
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
        branch: { select: { id: true, name: true } },
        closeApprovedBy: { select: { id: true, firstName: true, lastName: true } },
        closeRequestedBy: { select: { id: true, firstName: true, lastName: true } },
        reopenedBy: { select: { id: true, firstName: true, lastName: true } },
        terminal: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        shiftTemplate: true,
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
        branch: { select: { id: true, name: true } },
        closeApprovedBy: { select: { id: true, firstName: true, lastName: true } },
        closeRequestedBy: { select: { id: true, firstName: true, lastName: true } },
        reopenedBy: { select: { id: true, firstName: true, lastName: true } },
        shiftTemplate: true,
        terminal: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { sales: true } },
      },
    });
  }

  // ── Sales ─────────────────────────────────────────────────────────────────

  async createSale(
    companyId: string,
    userId: string,
    userRoles: string[],
    branchId: string,
    dto: CreatePosSaleDto,
  ) {
    if (dto.clientSyncId?.trim()) {
      const existing = await this.prisma.posSale.findFirst({
        where: {
          companyId,
          clientSyncId: dto.clientSyncId.trim(),
        },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          payments: true,
          customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
          session: { select: { id: true } },
          inventoryLocation: { select: { id: true, name: true, code: true } },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              dianZipKey: true,
              dianStatusCode: true,
              dianStatusMsg: true,
              dianCufe: true,
              dianQrCode: true,
              dianSentAt: true,
            },
          },
        },
      });
      if (existing) return existing;
    }

    const session = await this.prisma.posSession.findFirst({
      where: { id: dto.sessionId, companyId, status: 'OPEN' },
      include: { terminal: true },
    });
    if (!session) {
      throw new BadRequestException('La sesión de caja no está abierta o no existe');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('La venta debe tener al menos un artículo');
    }

    const pricingContext = await this.buildPricingContext(
      companyId,
      branchId ?? session.branchId ?? undefined,
      dto.customerId,
      dto.items,
      dto.priceListId ?? session.terminal?.defaultPriceListId ?? undefined,
    );
    const pricing = this.calculatePricing(dto.items, pricingContext, dto.cartDiscountPct ?? 0);
    const subtotal = pricing.subtotal;
    const taxAmount = pricing.taxAmount;
    const baseDiscountAmount =
      this.roundCurrency(pricing.orderPromotionDiscount + pricing.comboDiscount + pricing.manualDiscountAmount);
    const couponValidation = await this.validateCouponForSale({
      companyId,
      branchId: branchId ?? session.branchId ?? undefined,
      customerId: dto.customerId,
      couponCode: dto.couponCode,
      subtotal: pricing.total,
    });
    const loyaltyRedemption = await this.validateLoyaltyRedemption(
      companyId,
      dto.customerId,
      dto.loyaltyPointsToRedeem,
    );
    const couponDiscountAmount = this.roundCurrency(Number(couponValidation?.discount ?? 0));
    const loyaltyRedemptionAmount = this.roundCurrency(
      Math.min(Number(loyaltyRedemption?.amount ?? 0), Number(pricing.total) - couponDiscountAmount),
    );
    const cartDiscountAmount = this.roundCurrency(
      baseDiscountAmount + couponDiscountAmount + loyaltyRedemptionAmount,
    );
    const total = this.roundCurrency(Math.max(0, pricing.total - couponDiscountAmount - loyaltyRedemptionAmount));
    const maxManualDiscountPct = Math.max(
      Number(dto.cartDiscountPct ?? 0),
      ...dto.items.map((item) => Number(item.discount ?? 0)),
    );
    const itemsData = pricing.items.map((item) => ({
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      discount: this.roundCurrency(item.manualDiscount + item.promoDiscount),
      subtotal: item.subtotal,
      total: item.total,
    }));
    const paymentPayload = this.normalizePaymentPayload(dto, {
      requiredTotal: total,
      allowPartial: dto.isAdvancePayment === true,
      allowChange: true,
    });
    const orderType = this.resolveOrderType(dto);
    const isAdvance = (dto.isAdvancePayment === true || orderType === PosOrderTypeDto.LAYAWAY) && paymentPayload.totalPaid < total;
    const isPreOrder = orderType === PosOrderTypeDto.PREORDER;
    let externalOrder: { id: string; status: string; channel: string } | null = null;

    if (dto.externalOrderId) {
      externalOrder = await this.prisma.posExternalOrder.findFirst({
        where: { id: dto.externalOrderId, companyId },
        select: { id: true, status: true, channel: true },
      });
      if (!externalOrder) {
        throw new NotFoundException('Pedido externo POS no encontrado');
      }
    }

    if (!isAdvance && paymentPayload.totalPaid + 0.01 < total) {
      throw new BadRequestException('El monto pagado es insuficiente');
    }

    if (isAdvance && paymentPayload.totalPaid <= 0) {
      throw new BadRequestException('El anticipo debe ser mayor a cero');
    }

    if (maxManualDiscountPct > 0 || cartDiscountAmount > 0) {
      await this.enforceGovernance({
        companyId,
        userId,
        userRoles,
        action: 'MANUAL_DISCOUNT',
        branchId: branchId ?? session.branchId ?? undefined,
        resourceType: 'POS_SALE',
        resourceId: null,
        overrideId: dto.governanceOverrideId,
        discountPct: maxManualDiscountPct,
        amount: cartDiscountAmount,
      });
    }

    // Número secuencial: POS-YYYY-XXXXXX
    const year = new Date().getFullYear();
    const count = await this.prisma.posSale.count({
      where: { companyId, saleNumber: { startsWith: `POS-${year}-` } },
    });
    const saleNumber = `POS-${year}-${String(count + 1).padStart(6, '0')}`;
    const inventoryLocationId = await this.resolveInventoryLocationId(
      companyId,
      branchId ?? session.branchId ?? undefined,
      dto.inventoryLocationId,
      session.terminal?.id,
    );

    // Crear venta y descontar o reservar inventario en transacción atómica
    const productIds = itemsData
      .map((i) => i.productId)
      .filter((id): id is string => !!id);

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const availabilityMap = await this.getInventoryAvailabilityMap(
      companyId,
      branchId ?? session.branchId ?? undefined,
      productIds,
      inventoryLocationId,
    );

    for (const item of itemsData) {
      if (!item.productId) continue;

      const product = productMap.get(item.productId);
      if (!product) {
        throw new NotFoundException(`Producto no encontrado: ${item.productId}`);
      }

      const inventoryAvailability = availabilityMap.get(item.productId);
      const available = inventoryAvailability
        ? Number(inventoryAvailability.available ?? 0)
        : Number(product.stock ?? 0);

      if (!isPreOrder && available < Number(item.quantity)) {
        throw new BadRequestException(`Stock insuficiente para: ${product.name}`);
      }
    }

    const sale = await this.prisma.$transaction(async (tx) => {

      const newSale = await tx.posSale.create({
        data: {
          companyId,
          sessionId: dto.sessionId,
          customerId: dto.customerId,
          externalOrderId: externalOrder?.id ?? null,
          orderType: orderType as any,
          orderStatus:
            orderType === PosOrderTypeDto.IN_STORE && !isAdvance
              ? 'CLOSED'
              : orderType === PosOrderTypeDto.DELIVERY
                ? 'OPEN'
                : orderType === PosOrderTypeDto.PICKUP
                  ? 'READY'
                  : 'OPEN',
          priceListId: pricing.priceList?.id ?? null,
          inventoryLocationId,
          saleNumber,
          orderReference: dto.orderReference?.trim() || null,
          sourceChannel: this.normalizeChannel(dto.sourceChannel ?? externalOrder?.channel),
          clientSyncId: dto.clientSyncId?.trim() || null,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          deliveryAddress: dto.deliveryAddress?.trim() || null,
          deliveryContactName: dto.deliveryContactName?.trim() || null,
          deliveryContactPhone: dto.deliveryContactPhone?.trim() || null,
          isPreOrder,
          subtotal: Math.round(subtotal * 100) / 100,
          taxAmount: Math.round(taxAmount * 100) / 100,
          discountAmount: cartDiscountAmount,
          couponDiscountAmount,
          loyaltyRedemptionAmount,
          total: Math.round(total * 100) / 100,
          paymentMethod: paymentPayload.legacyPaymentMethod as any,
          amountPaid: paymentPayload.totalPaid,
          change: isAdvance ? 0 : paymentPayload.change,
          advanceAmount: isAdvance ? paymentPayload.totalPaid : 0,
          remainingAmount: isAdvance ? Math.round((total - paymentPayload.totalPaid) * 100) / 100 : 0,
          pricingSnapshot: {
            ...pricing,
            couponCode: couponValidation?.coupon.code ?? null,
            couponDiscountAmount,
            loyaltyPointsRedeemed: loyaltyRedemption?.points ?? 0,
            loyaltyRedemptionAmount,
          } as any,
          deliveryStatus: orderType === PosOrderTypeDto.IN_STORE && !isAdvance ? 'DELIVERED' : 'PENDING',
          status: isAdvance ? 'ADVANCE' : 'COMPLETED',
          notes: dto.notes,
          items: { create: itemsData },
          payments: {
            create: paymentPayload.payments.map((payment) => ({
              paymentMethod: payment.paymentMethod as any,
              amount: payment.amount,
              transactionReference: payment.transactionReference,
              providerName: payment.providerName,
              notes: payment.notes,
            })),
          },
        },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          payments: true,
          customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
          session: { select: { id: true } },
          inventoryLocation: { select: { id: true, name: true, code: true } },
        },
      });

      if (isAdvance && !isPreOrder) {
        await this.reserveInventoryForAdvance(
          tx,
          companyId,
          newSale.id,
          dto.sessionId,
          dto.customerId,
          branchId,
          inventoryLocationId,
          itemsData,
        );
      } else if (!isPreOrder && orderType === PosOrderTypeDto.IN_STORE) {
        await this.allocateInventoryForSale(
          tx,
          companyId,
          branchId,
          inventoryLocationId,
          newSale.items.map((item) => ({ ...item, saleId: newSale.id })),
        );
      } else if (isPreOrder && inventoryLocationId) {
        for (const item of itemsData) {
          if (!item.productId) continue;
          await tx.posInventoryReservation.create({
            data: {
              companyId,
              branchId,
              locationId: inventoryLocationId,
              productId: item.productId,
              saleId: newSale.id,
              sessionId: dto.sessionId,
              customerId: dto.customerId ?? null,
              quantity: Number(item.quantity),
              status: 'OPEN',
              notes: 'Preorden POS pendiente de abastecimiento',
            },
          });
        }
      }

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

    if (!isAdvance && dto.customerId) {
      await this.awardLoyaltyPoints(companyId, sale.id, dto.customerId, branchId, total);
    }

    if (couponValidation || loyaltyRedemption) {
      await this.prisma.$transaction(async (tx) => {
        if (couponValidation) {
          await tx.posCoupon.update({
            where: { id: couponValidation.coupon.id },
            data: { usageCount: { increment: 1 } },
          });
          await tx.posCouponRedemption.create({
            data: {
              companyId,
              couponId: couponValidation.coupon.id,
              saleId: sale.id,
              customerId: dto.customerId ?? null,
              amount: couponDiscountAmount,
              pointsSpent: Number(couponValidation.coupon.pointsCost ?? 0),
            },
          });
        }
        if (loyaltyRedemption && dto.customerId) {
          await tx.customer.update({
            where: { id: dto.customerId },
            data: {
              loyaltyPointsBalance: { decrement: loyaltyRedemption.points },
              loyaltyPointsRedeemed: { increment: loyaltyRedemption.points },
            },
          });
          await tx.posLoyaltyTransaction.create({
            data: {
              companyId,
              customerId: dto.customerId,
              saleId: sale.id,
              loyaltyCampaignId: couponValidation?.coupon.id ? null : null,
              type: 'REDEEM',
              points: loyaltyRedemption.points,
              amountBase: loyaltyRedemptionAmount,
              description: `Redención POS ${sale.saleNumber}`,
            } as any,
          });
        }
        if (externalOrder) {
          await tx.posExternalOrder.update({
            where: { id: externalOrder.id },
            data: {
              status: isAdvance ? 'PARTIALLY_PAID' : 'SYNCED_TO_POS',
              syncedAt: new Date(),
              payload: {
                saleId: sale.id,
                saleNumber: sale.saleNumber,
              },
            },
          });
        }
      });
    } else if (externalOrder) {
      await this.prisma.posExternalOrder.update({
        where: { id: externalOrder.id },
        data: {
          status: isAdvance ? 'PARTIALLY_PAID' : 'SYNCED_TO_POS',
          syncedAt: new Date(),
          payload: {
            saleId: sale.id,
            saleNumber: sale.saleNumber,
          },
        },
      });
    }

    if ((paymentPayload.payments.some((payment) => payment.paymentMethod === 'AGREEMENT') || Number(sale.remainingAmount) > 0) && sale.customer?.id) {
      await this.createIntegrationTrace({
        companyId,
        branchId: sale.branchId ?? branchId,
        createdById: userId,
        module: 'cartera',
        sourceType: 'pos-sale',
        sourceId: sale.id,
        targetType: 'customer',
        targetId: sale.customer.id,
        status: 'PENDING',
        message: `Saldo POS ${sale.saleNumber} pendiente de recaudo/seguimiento`,
        payload: {
          saleNumber: sale.saleNumber,
          remainingAmount: Number(sale.remainingAmount),
          paymentMethod: sale.paymentMethod,
        },
      });
    }

    if (cartDiscountAmount > 0 || maxManualDiscountPct > 0) {
      await this.createAuditLog({
        companyId,
        userId,
        action: 'POS_DISCOUNT_APPLIED',
        resource: 'POS_SALE',
        resourceId: sale.id,
        after: {
          saleNumber,
          branchId: sale.branchId,
          orderType,
          manualDiscountPct: maxManualDiscountPct,
          discountAmount: cartDiscountAmount,
          couponCode: couponValidation?.coupon.code ?? null,
          couponDiscountAmount,
          loyaltyPointsRedeemed: loyaltyRedemption?.points ?? 0,
          loyaltyRedemptionAmount,
          appliedOrderPromotions: pricing.appliedOrderPromotions,
          appliedCombos: pricing.appliedCombos,
        },
      });
    }

    // Generar factura electrónica solo si: pago completo, entregado y hay cliente
    let invoice: any = null;
    if (dto.generateInvoice && dto.customerId && !isAdvance) {
      try {
        invoice = await this.invoicesService.create(companyId,branchId, {
          customerId: dto.customerId,
          type: 'VENTA' as any,
          prefix: session.terminal?.invoicePrefix || undefined,
          sourceChannel: 'POS',
          sourceTerminalId: session.terminalId ?? session.terminal?.id ?? undefined,
          issueDate: new Date().toISOString(),
	          items: itemsData.map((item) => ({
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

    if (!isAdvance && !invoice) {
      await this.syncAccountingSaleIfNeeded(companyId, sale.id);
    }

    return { ...sale, invoice };
  }

  // ── Generar factura desde venta existente ─────────────────────────────────

  async generateInvoiceFromSale(companyId: string,branchId: string, saleId: string) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId },
      include: {
        items: true,
        payments: true,
        customer: true,
        session: { include: { terminal: true } },
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
      prefix: sale.session?.terminal?.invoicePrefix || undefined,
      sourceChannel: 'POS',
      sourceTerminalId: sale.session?.terminal?.id ?? sale.session?.terminalId ?? undefined,
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

  private async releaseOpenReservations(tx: any, companyId: string, saleId: string) {
    const reservations = await tx.posInventoryReservation.findMany({
      where: { companyId, saleId, status: 'OPEN' },
    });
    for (const reservation of reservations) {
      if (reservation.stockId) {
        await tx.posInventoryStock.update({
          where: { id: reservation.stockId },
          data: { reservedQuantity: { decrement: Number(reservation.quantity) } },
        });
      }
    }
    if (reservations.length) {
      await tx.posInventoryReservation.updateMany({
        where: { companyId, saleId, status: 'OPEN' },
        data: { status: 'RELEASED' },
      });
    }
  }

  private async restoreInventoryFromSale(tx: any, companyId: string, saleId: string) {
    const saleItems = await tx.posSaleItem.findMany({
      where: { saleId },
      include: { allocations: true },
    });
    const touchedProducts = new Set<string>();
    for (const item of saleItems) {
      if (item.productId) touchedProducts.add(item.productId);
      if (item.allocations.length > 0) {
        for (const allocation of item.allocations) {
          await tx.posInventoryStock.update({
            where: { id: allocation.stockId },
            data: { quantity: { increment: Number(allocation.quantity) } },
          });
        }
      } else if (item.productId) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: Number(item.quantity) } },
        });
      }
    }
    for (const productId of touchedProducts) {
      await this.syncProductStockTotal(tx, companyId, productId);
    }
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
          payments: { orderBy: { createdAt: 'asc' } },
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
      DATAPHONE: 'DATÁFONO',
      WALLET: 'BILLETERA DIGITAL',
      VOUCHER: 'VALE / BONO',
      GIFT_CARD: 'GIFT CARD',
      AGREEMENT: 'CONVENIO',
    };

    const paymentBreakdown = Array.isArray(sale.payments) ? sale.payments : [];
    const paymentBreakdownHtml = paymentBreakdown.length
      ? paymentBreakdown
          .map((payment: any) => `
            <div class="row">
              <span>${paymentLabels[payment.paymentMethod] ?? payment.paymentMethod}${payment.transactionReference ? ` · Ref ${payment.transactionReference}` : ''}</span>
              <span>${fmt(payment.amount)}</span>
            </div>
            ${payment.providerName ? `<div style="font-size:8.5px;color:#444;margin:-1px 0 2px 0">Canal: ${payment.providerName}</div>` : ''}
          `)
          .join('')
      : `<div class="row"><span>${paymentLabels[sale.paymentMethod] ?? sale.paymentMethod}</span><span>${fmt(sale.total)}</span></div>`;

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
${paymentBreakdownHtml}
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

  async cancelSale(
    companyId: string,
    userId: string,
    userRoles: string[],
    saleId: string,
    dto: CancelPosSaleDto,
  ) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: { in: ['COMPLETED', 'ADVANCE'] as any } },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada o ya cancelada');

    await this.enforceGovernance({
      companyId,
      userId,
      userRoles,
      action: 'CANCEL_SALE',
      branchId: sale.branchId ?? undefined,
      resourceType: 'POS_SALE',
      resourceId: saleId,
      overrideId: dto.governanceOverrideId,
      amount: Number(sale.total),
    });

    await this.prisma.$transaction(async (tx) => {
      if (sale.status === 'ADVANCE') {
        await this.releaseOpenReservations(tx, companyId, saleId);
      } else {
        await this.restoreInventoryFromSale(tx, companyId, saleId);
      }

      await tx.posSale.update({
        where: { id: saleId },
        data: { status: 'CANCELLED', orderStatus: 'CANCELLED', notes: dto.notes ?? sale.notes },
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

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_SALE_CANCELLED',
      resource: 'POS_SALE',
      resourceId: saleId,
      before: {
        status: sale.status,
        total: sale.total,
        branchId: sale.branchId,
      },
      after: {
        status: 'CANCELLED',
        orderStatus: 'CANCELLED',
        notes: dto.notes ?? sale.notes,
      },
    });

    if (!sale.invoiceId && sale.status === 'COMPLETED') {
      await this.syncAccountingRefundIfNeeded(companyId, saleId);
    }

    if (sale.externalOrderId) {
      await this.prisma.posExternalOrder.update({
        where: { id: sale.externalOrderId },
        data: { status: 'CANCELLED', syncedAt: new Date() },
      });
    }

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
          payments: { orderBy: { createdAt: 'asc' } },
          postSaleRequests: {
            select: {
              id: true,
              type: true,
              status: true,
              reasonCode: true,
              total: true,
              createdAt: true,
              creditNoteInvoice: { select: { id: true, invoiceNumber: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          session: { select: { id: true, openedAt: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true, dianZipKey: true, dianStatusCode: true, dianStatusMsg: true, dianCufe: true, dianQrCode: true, dianSentAt: true } },
        },
      }),
      this.prisma.posSale.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ── Refund sale ───────────────────────────────────────────────────────────

  async refundSale(
    companyId: string,
    userId: string,
    userRoles: string[],
    saleId: string,
    dto: RefundSaleDto,
  ) {
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

    await this.enforceGovernance({
      companyId,
      userId,
      userRoles,
      action: 'REFUND_SALE',
      branchId: sale.branchId ?? undefined,
      resourceType: 'POS_SALE',
      resourceId: saleId,
      overrideId: dto.governanceOverrideId,
      amount: Number(sale.total),
    });

    const refunded = await this.prisma.$transaction(async (tx) => {
      await this.restoreInventoryFromSale(tx, companyId, saleId);

      // Marcar venta como REFUNDED
      const refunded = await tx.posSale.update({
        where: { id: saleId },
        data: {
          status: 'REFUNDED',
          orderStatus: 'CANCELLED',
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

    await this.createAuditLog({
      companyId,
      userId,
      action: 'POS_SALE_REFUNDED',
      resource: 'POS_SALE',
      resourceId: saleId,
      before: {
        status: sale.status,
        total: sale.total,
        branchId: sale.branchId,
      },
      after: {
        status: refunded.status,
        refundReason: dto.reason ?? null,
      },
    });

    if (!sale.invoiceId) {
      await this.syncAccountingRefundIfNeeded(companyId, saleId);
    }

    if (sale.externalOrderId) {
      await this.prisma.posExternalOrder.update({
        where: { id: sale.externalOrderId },
        data: { status: 'RETURNED', syncedAt: new Date() },
      });
    }

    return refunded;
  }

  // ── Agregar pago a anticipo ───────────────────────────────────────────────

  async addPayment(companyId: string, branchId: string, saleId: string, dto: AddPaymentDto) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: 'ADVANCE' as any },
      include: { payments: true },
    });
    if (!sale) throw new NotFoundException('Venta con anticipo no encontrada');

    const remaining = Number((sale as any).remainingAmount);
    const paymentPayload = this.normalizePaymentPayload(dto, {
      requiredTotal: remaining,
      allowPartial: true,
      allowChange: false,
    });

    if (paymentPayload.totalPaid > remaining + 0.01) {
      throw new BadRequestException(
        `El monto excede el saldo pendiente de ${remaining.toFixed(2)}`,
      );
    }

    const newAmountPaid = Number(sale.amountPaid) + paymentPayload.totalPaid;
    const newRemaining = Math.max(0, remaining - paymentPayload.totalPaid);
    const isFullyPaid = newRemaining <= 0;
    const deliveryStatus = (sale as any).deliveryStatus;
    const isDelivered = deliveryStatus === 'DELIVERED';
    const mergedPayments = [...sale.payments, ...paymentPayload.payments];

    const updated = await this.prisma.posSale.update({
      where: { id: saleId },
      data: {
        amountPaid: Math.round(newAmountPaid * 100) / 100,
        remainingAmount: Math.round(newRemaining * 100) / 100,
        paymentMethod: this.getLegacyPaymentMethod(mergedPayments) as any,
        status: isFullyPaid && isDelivered ? 'COMPLETED' : 'ADVANCE',
        payments: {
          create: paymentPayload.payments.map((payment) => ({
            paymentMethod: payment.paymentMethod as any,
            amount: payment.amount,
            transactionReference: payment.transactionReference,
            providerName: payment.providerName,
            notes: payment.notes,
          })),
        },
        notes: dto.notes
          ? `${sale.notes ?? ''}\n[PAGO] ${dto.notes}`.trim()
          : sale.notes,
      } as any,
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        payments: { orderBy: { createdAt: 'asc' } },
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
      await this.awardLoyaltyPoints(companyId, sale.id, sale.customerId, branchId, Number(sale.total));
    }

    if (isFullyPaid && isDelivered && !sale.invoiceId) {
      await this.syncAccountingSaleIfNeeded(companyId, saleId);
    }

    if (sale.externalOrderId && isFullyPaid) {
      await this.prisma.posExternalOrder.update({
        where: { id: sale.externalOrderId },
        data: { status: isDelivered ? 'DELIVERED' : 'PAID', syncedAt: new Date() },
      });
    }

    return updated;
  }

  async dispatchSale(companyId: string, saleId: string, dto: DispatchSaleDto) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId },
      select: {
        id: true,
        externalOrderId: true,
        orderType: true,
        orderStatus: true,
        deliveryStatus: true,
        notes: true,
      },
    });
    if (!sale) throw new NotFoundException('Pedido POS no encontrado');
    if (sale.orderType !== 'DELIVERY') {
      throw new BadRequestException('Solo los domicilios se pueden despachar');
    }
    if (sale.deliveryStatus === 'DELIVERED') {
      throw new BadRequestException('El pedido ya fue entregado');
    }

    const updated = await this.prisma.posSale.update({
      where: { id: saleId },
      data: {
        orderStatus: 'IN_TRANSIT',
        dispatchedAt: new Date(),
        dispatchNotes: dto.notes?.trim() || null,
        notes: dto.notes ? `${sale.notes ?? ''}\n[DESPACHO] ${dto.notes}`.trim() : sale.notes,
      } as any,
      include: {
        customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (sale.externalOrderId) {
      await this.prisma.posExternalOrder.update({
        where: { id: sale.externalOrderId },
        data: { status: 'IN_TRANSIT', syncedAt: new Date() },
      });
    }
    return updated;
  }

  // ── Marcar como entregado ─────────────────────────────────────────────────

  async markDelivered(companyId: string, branchId: string, saleId: string, dto: DeliverSaleDto) {
    const sale = await this.prisma.posSale.findFirst({
      where: { id: saleId, companyId, status: { in: ['ADVANCE', 'COMPLETED'] as any } },
      include: { items: true, customer: true, session: { include: { terminal: true } } },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if ((sale as any).deliveryStatus === 'DELIVERED') {
      throw new BadRequestException('El pedido ya está marcado como entregado');
    }

    const remaining = Number((sale as any).remainingAmount);
    const isFullyPaid = remaining <= 0;
    const newStatus = isFullyPaid ? 'COMPLETED' : 'ADVANCE';

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.allocateInventoryForSale(
        tx,
        companyId,
        branchId,
        sale.inventoryLocationId ?? null,
        sale.items.map((item) => ({ ...item, saleId: sale.id })),
      );

      return tx.posSale.update({
        where: { id: saleId },
        data: {
          deliveryStatus: 'DELIVERED',
          orderStatus: 'CLOSED',
          deliveredAt: new Date(),
          status: newStatus,
          notes: dto.notes
            ? `${sale.notes ?? ''}\n[ENTREGA] ${dto.notes}`.trim()
            : sale.notes,
        } as any,
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          customer: { select: { id: true, name: true, documentNumber: true, documentType: true } },
          inventoryLocation: { select: { id: true, name: true, code: true } },
        },
      });
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
      await this.awardLoyaltyPoints(companyId, sale.id, sale.customerId, sale.branchId, Number(sale.total));
    }

    // Generar factura si se solicitó y hay cliente
    let invoice: any = null;
    if (dto.generateInvoice && sale.customerId && isFullyPaid) {
      try {
        invoice = await this.invoicesService.create(companyId, branchId, {
          customerId: sale.customerId,
          type: 'VENTA' as any,
          prefix: sale.session?.terminal?.invoicePrefix || undefined,
          sourceChannel: 'POS',
          sourceTerminalId: sale.session?.terminal?.id ?? sale.session?.terminalId ?? undefined,
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

    if (isFullyPaid && !invoice) {
      await this.syncAccountingSaleIfNeeded(companyId, saleId);
    }

    if (sale.externalOrderId) {
      await this.prisma.posExternalOrder.update({
        where: { id: sale.externalOrderId },
        data: { status: 'DELIVERED', syncedAt: new Date() },
      });
    }

    return { ...updated, invoice };
  }

  // ── Cash movements ────────────────────────────────────────────────────────

  async createCashMovement(
    companyId: string,
    sessionId: string,
    userId: string,
    userRoles: string[],
    dto: CreateCashMovementDto,
  ) {
    const session = await this.prisma.posSession.findFirst({
      where: { id: sessionId, companyId },
    });

    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.status !== 'OPEN') {
      throw new BadRequestException('La sesión debe estar abierta para registrar movimientos');
    }

    if (dto.type === 'OUT') {
      await this.enforceGovernance({
        companyId,
        userId,
        userRoles,
        action: 'CASH_WITHDRAWAL',
        branchId: session.branchId ?? undefined,
        resourceType: 'POS_SESSION',
        resourceId: sessionId,
        overrideId: dto.governanceOverrideId,
        amount: Number(dto.amount),
      });
    }

    const movement = await this.prisma.posCashMovement.create({
      data: {
        companyId,
        sessionId,
        userId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
      },
    });

    await this.createAuditLog({
      companyId,
      userId,
      action: dto.type === 'OUT' ? 'POS_CASH_WITHDRAWAL' : 'POS_CASH_INFLOW',
      resource: 'POS_SESSION',
      resourceId: sessionId,
      after: { movementId: movement.id, type: movement.type, amount: movement.amount, reason: movement.reason },
    });

    await this.syncAccountingCashMovementIfNeeded(companyId, movement.id);

    return movement;
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

  async createReplenishmentRequest(
    companyId: string,
    userId: string,
    branchId: string | undefined,
    dto: CreatePosReplenishmentRequestDto,
  ) {
    const candidates = await this.prisma.product.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(dto.productIds?.length ? { id: { in: dto.productIds } } : {}),
        minStock: { not: null } as any,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        minStock: true,
        price: true,
      },
      take: 60,
    });
    const selected = candidates.filter((item) => Number(item.stock ?? 0) <= Number(item.minStock ?? 0));
    if (!selected.length) {
      throw new BadRequestException('No hay faltantes POS para generar una solicitud de compra');
    }

    const request = await this.purchasingService.createRequest(
      companyId,
      {
        requestDate: new Date().toISOString(),
        neededByDate: dto.neededByDate,
        notes: dto.notes?.trim() || 'Reabastecimiento automático generado desde POS',
        requestingArea: dto.requestingArea?.trim() || 'POS',
        costCenter: dto.costCenter?.trim() || 'POS',
        projectCode: dto.projectCode?.trim() || undefined,
        items: selected.map((item, index) => ({
          productId: item.id,
          description: `${item.name}${item.sku ? ` (${item.sku})` : ''}`,
          quantity: Math.max(1, Number(item.minStock ?? 0) - Number(item.stock ?? 0)),
          estimatedUnitPrice: Number(item.price ?? 0),
          position: index + 1,
        })),
      },
      userId,
    );

    await this.createIntegrationTrace({
      companyId,
      branchId: branchId ?? null,
      createdById: userId,
      module: 'purchasing',
      sourceType: 'pos-replenishment',
      sourceId: request.id,
      targetType: 'purchase-request',
      targetId: request.id,
      status: 'SUCCESS',
      message: `Solicitud ${request.number} creada desde faltantes POS`,
      payload: {
        itemCount: selected.length,
        products: selected.map((item) => ({
          id: item.id,
          name: item.name,
          stock: Number(item.stock ?? 0),
          minStock: Number(item.minStock ?? 0),
        })),
      },
    });

    return request;
  }

  async reconcileElectronicPayments(
    companyId: string,
    userId: string,
    branchId: string | undefined,
    dto: ReconcilePosElectronicPaymentsDto,
  ) {
    const limit = Math.max(1, Math.min(500, Number(dto.limit ?? 200)));
    const payments = await this.prisma.posSalePayment.findMany({
      where: {
        sale: { companyId, ...(branchId ? { branchId } : {}) },
        paymentMethod: { not: 'CASH' as any },
        transactionReference: { not: null },
      },
      include: {
        sale: { select: { id: true, saleNumber: true, branchId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const matches: any[] = [];
    let matchedPayments = 0;
    let reconciledPayments = 0;
    let differenceAmount = 0;

    for (const payment of payments) {
      const reference = payment.transactionReference?.trim();
      if (!reference) continue;
      const bankMovement = await this.prisma.accountingBankMovement.findFirst({
        where: { companyId, reference },
        orderBy: { movementDate: 'desc' },
      });

      if (!bankMovement) {
        differenceAmount = this.roundCurrency(differenceAmount + Number(payment.amount ?? 0));
        matches.push({
          paymentId: payment.id,
          saleId: payment.saleId,
          saleNumber: payment.sale?.saleNumber,
          transactionReference: reference,
          amount: Number(payment.amount ?? 0),
          status: 'UNMATCHED',
        });
        continue;
      }

      matchedPayments += 1;
      let reconciled = bankMovement.status === 'RECONCILED';
      if (!reconciled && bankMovement.reconciledEntryId == null) {
        const entry = await this.prisma.journalEntry.findFirst({
          where: {
            companyId,
            deletedAt: null,
            OR: [{ sourceId: `pos-sale:${payment.saleId}` }, { sourceId: `pos-refund:${payment.saleId}` }],
          },
          select: { id: true },
        });
        if (entry?.id) {
          await this.accountingService.reconcileBankMovement(companyId, bankMovement.id, { entryId: entry.id }, userId);
          reconciled = true;
        }
      }

      if (reconciled) reconciledPayments += 1;
      differenceAmount = this.roundCurrency(
        differenceAmount + Math.abs(Number(bankMovement.amount) - Number(payment.amount ?? 0)),
      );
      matches.push({
        paymentId: payment.id,
        saleId: payment.saleId,
        saleNumber: payment.sale?.saleNumber,
        transactionReference: reference,
        amount: Number(payment.amount ?? 0),
        bankMovementId: bankMovement.id,
        bankAmount: Number(bankMovement.amount),
        status: reconciled ? 'RECONCILED' : 'MATCHED',
      });
    }

    const batch = await this.prisma.posBankReconciliationBatch.create({
      data: {
        companyId,
        branchId: branchId ?? null,
        createdById: userId,
        reference: `POS-BANK-${new Date().toISOString().slice(0, 10)}-${Date.now()}`,
        totalPayments: payments.length,
        matchedPayments,
        reconciledPayments,
        differenceAmount,
        payload: { matches },
      },
    });

    await this.createIntegrationTrace({
      companyId,
      branchId: branchId ?? null,
      createdById: userId,
      module: 'banks',
      sourceType: 'pos-bank-batch',
      sourceId: batch.id,
      targetType: 'accounting-bank-movement',
      status: 'SUCCESS',
      message: `Lote ${batch.reference} conciliado desde POS`,
      payload: {
        totalPayments: payments.length,
        matchedPayments,
        reconciledPayments,
        differenceAmount,
      },
    });

    return { batch, matches };
  }

  async syncAccountingIntegrations(companyId: string, branchId?: string, _userId?: string) {
    const saleWhere: any = { companyId, invoiceId: null, status: 'COMPLETED' as any };
    const refundWhere: any = { companyId, invoiceId: null, status: { in: ['REFUNDED', 'CANCELLED'] as any[] } };
    const movementWhere: any = { companyId };
    if (branchId) {
      saleWhere.branchId = branchId;
      refundWhere.branchId = branchId;
      movementWhere.session = { branchId };
    }

    const [sales, refunds, cashMovements] = await Promise.all([
      this.prisma.posSale.findMany({ where: saleWhere, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.posSale.findMany({ where: refundWhere, select: { id: true }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      this.prisma.posCashMovement.findMany({ where: movementWhere, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    const results = {
      sales: [] as any[],
      refunds: [] as any[],
      cashMovements: [] as any[],
    };

    for (const sale of sales) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `pos-sale:${sale.id}` },
        select: { id: true },
      });
      if (!existing) results.sales.push(await this.accountingService.syncPosSaleEntry(companyId, sale.id));
    }

    for (const sale of refunds) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `pos-refund:${sale.id}` },
        select: { id: true },
      });
      if (!existing) results.refunds.push(await this.accountingService.syncPosRefundEntry(companyId, sale.id));
    }

    for (const movement of cashMovements) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `pos-cash-movement:${movement.id}` },
        select: { id: true },
      });
      if (!existing) results.cashMovements.push(await this.accountingService.syncPosCashMovementEntry(companyId, movement.id));
    }

    return results;
  }

  async getIntegrationsSummary(companyId: string, branchId?: string) {
    const saleFilter: any = { companyId };
    if (branchId) saleFilter.branchId = branchId;
    const movementFilter: any = { companyId };
    if (branchId) movementFilter.session = { branchId };

    const [
      accountingActivity,
      completedSales,
      refundedSales,
      cashMovements,
      pendingLayaways,
      lowStockCandidates,
      reservationAgg,
      pendingTransfers,
      activeCampaigns,
      loyaltyIssued,
      loyaltyRedeemed,
      activeCoupons,
      omnichannelAgg,
      externalOrdersAgg,
      paymentRefs,
      recentTraces,
      recentReplenishments,
      latestBankBatch,
      inventoryDiscrepancies,
    ] = await Promise.all([
      this.prisma.accountingIntegration.findMany({
        where: { companyId, module: 'pos' },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.posSale.findMany({
        where: { ...saleFilter, invoiceId: null, status: 'COMPLETED' as any },
        select: { id: true, total: true },
      }),
      this.prisma.posSale.findMany({
        where: { ...saleFilter, invoiceId: null, status: { in: ['REFUNDED', 'CANCELLED'] as any[] } },
        select: { id: true, total: true },
      }),
      this.prisma.posCashMovement.findMany({
        where: movementFilter,
        select: { id: true, amount: true, type: true },
      }),
      this.prisma.posSale.findMany({
        where: {
          ...saleFilter,
          customerId: { not: null },
          remainingAmount: { gt: 0 } as any,
          status: { in: ['ADVANCE', 'COMPLETED'] as any[] },
        },
        select: { id: true, saleNumber: true, remainingAmount: true, customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.product.findMany({
        where: { companyId, deletedAt: null, minStock: { not: null } as any },
        select: { id: true, name: true, sku: true, stock: true, minStock: true },
        take: 40,
      }).catch(() => [] as any[]),
      this.prisma.posInventoryReservation.aggregate({
        where: {
          companyId,
          ...(branchId ? { branchId } : {}),
          status: 'OPEN' as any,
        },
        _sum: { quantity: true },
        _count: { id: true },
      }),
      this.prisma.posInventoryTransfer.count({
        where: {
          companyId,
          status: 'PENDING' as any,
          ...(branchId ? { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] } : {}),
        },
      }),
      this.prisma.posLoyaltyCampaign.count({
        where: { companyId, isActive: true, ...(branchId ? { branchId } : {}) },
      }),
      this.prisma.posLoyaltyTransaction.aggregate({
        where: { companyId },
        _sum: { points: true },
      }),
      this.prisma.posLoyaltyTransaction.aggregate({
        where: { companyId, type: 'REDEEM' as any },
        _sum: { points: true, amountBase: true },
      }),
      this.prisma.posCoupon.count({
        where: { companyId, isActive: true, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
      }),
      this.prisma.posSale.groupBy({
        by: ['orderType', 'orderStatus'],
        where: {
          ...saleFilter,
          orderType: { in: ['PICKUP', 'DELIVERY', 'LAYAWAY', 'PREORDER'] as any[] },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.posExternalOrder.groupBy({
        by: ['channel', 'status'],
        where: { companyId, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.posSalePayment.findMany({
        where: {
          sale: saleFilter,
          paymentMethod: { not: 'CASH' as any },
          transactionReference: { not: null },
        },
        select: { id: true, transactionReference: true, providerName: true, amount: true },
      }),
      this.prisma.posIntegrationTrace.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.posIntegrationTrace.findMany({
        where: { companyId, module: 'purchasing', targetType: 'purchase-request' },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.posBankReconciliationBatch.findFirst({
        where: { companyId, ...(branchId ? { branchId } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.posInventoryLocation.findMany({
        where: { companyId, ...(branchId ? { branchId } : {}) },
        include: {
          stocks: {
            include: {
              product: { select: { id: true, name: true, stock: true } },
            },
          },
        },
        take: 20,
      }),
    ]);

    const lowStockProducts = (lowStockCandidates as any[]).filter((item) =>
      Number(item.stock ?? 0) <= Number(item.minStock ?? 0),
    ).slice(0, 8);

    const paymentReferences = Array.from(
      new Set(
        paymentRefs
          .map((item) => item.transactionReference?.trim())
          .filter((value): value is string => !!value),
      ),
    );

    const [matchedBanks, reconciledBanks] = paymentReferences.length
      ? await Promise.all([
          this.prisma.accountingBankMovement.count({
            where: { companyId, reference: { in: paymentReferences } },
          }),
          this.prisma.accountingBankMovement.count({
            where: { companyId, status: 'RECONCILED', reference: { in: paymentReferences } },
          }),
        ])
      : [0, 0];

    const integratedSales = accountingActivity.filter((item) => item.resourceType === 'pos-sale' && item.status === 'SUCCESS').length;
    const integratedRefunds = accountingActivity.filter((item) => item.resourceType === 'pos-refund' && item.status === 'SUCCESS').length;
    const integratedCashMovements = accountingActivity.filter((item) => item.resourceType === 'pos-cash-movement' && item.status === 'SUCCESS').length;
    const discrepancyCount = inventoryDiscrepancies.reduce((count, location) => {
      return (
        count +
        location.stocks.filter((stock) => {
          const local = Number(stock.quantity ?? 0) - Number(stock.reservedQuantity ?? 0);
          const global = Number(stock.product?.stock ?? 0);
          return Math.abs(local - global) > 0.001;
        }).length
      );
    }, 0);

    return {
      accounting: {
        completedSales: completedSales.length,
        integratedSales,
        refundedSales: refundedSales.length,
        integratedRefunds,
        cashMovements: cashMovements.length,
        integratedCashMovements,
        failures: accountingActivity.filter((item) => item.status === 'FAILED').length,
        recentActivity: accountingActivity.slice(0, 8),
      },
      cartera: {
        pendingCount: pendingLayaways.length,
        pendingAmount: this.roundCurrency(
          pendingLayaways.reduce((sum, item) => sum + Number(item.remainingAmount), 0),
        ),
        recentPending: pendingLayaways.map((item) => ({
          id: item.id,
          saleNumber: item.saleNumber,
          customerName: item.customer?.name ?? 'Cliente POS',
          remainingAmount: Number(item.remainingAmount),
        })),
      },
      purchasing: {
        replenishmentCount: lowStockProducts.length,
        requestCount: recentReplenishments.length,
        suggestedProducts: lowStockProducts.map((item: any) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          stock: Number(item.stock ?? 0),
          minStock: Number(item.minStock ?? 0),
        })),
        recentRequests: recentReplenishments.map((trace) => ({
          id: trace.targetId ?? trace.id,
          reference: trace.targetId ?? trace.sourceId,
          message: trace.message,
          createdAt: trace.createdAt,
        })),
      },
      inventory: {
        openReservations: reservationAgg._count.id,
        reservedUnits: Number(reservationAgg._sum.quantity ?? 0),
        pendingTransfers,
        discrepancyCount,
      },
      loyalty: {
        activeCampaigns,
        issuedPoints: Number(loyaltyIssued._sum.points ?? 0),
        redeemedPoints: Number(loyaltyRedeemed._sum.points ?? 0),
        redeemedAmount: Number(loyaltyRedeemed._sum.amountBase ?? 0),
        activeCoupons,
      },
      ecommerce: {
        channels: omnichannelAgg.map((item) => ({
          orderType: item.orderType,
          orderStatus: item.orderStatus,
          count: item._count.id,
          total: Number(item._sum.total ?? 0),
        })),
        externalOrders: externalOrdersAgg.map((item) => ({
          channel: item.channel,
          status: item.status,
          count: item._count.id,
          total: Number(item._sum.total ?? 0),
        })),
      },
      banks: {
        electronicPayments: paymentRefs.length,
        referencedPayments: paymentReferences.length,
        matchedBankMovements: matchedBanks,
        reconciledBankMovements: reconciledBanks,
        pendingReconciliation: Math.max(0, paymentReferences.length - reconciledBanks),
        latestBatch: latestBankBatch
          ? {
              id: latestBankBatch.id,
              reference: latestBankBatch.reference,
              createdAt: latestBankBatch.createdAt,
              matchedPayments: latestBankBatch.matchedPayments,
              reconciledPayments: latestBankBatch.reconciledPayments,
            }
          : null,
      },
      traces: recentTraces,
    };
  }

  async getSalesSummary(companyId: string, from?: string, to?: string, sessionId?: string) {
    const where: any = { companyId, status: 'COMPLETED' };
    if (sessionId) where.sessionId = sessionId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [agg, byPaymentMethod, cashMovements] = await Promise.all([
      this.prisma.posSale.aggregate({
        where,
        _sum: { total: true, taxAmount: true, subtotal: true },
        _count: { id: true },
        _avg: { total: true },
      }),
      this.getPaymentMethodBreakdown(where),
      sessionId
        ? this.prisma.posCashMovement.findMany({
            where: { companyId, sessionId },
            select: { type: true, amount: true },
          })
        : Promise.resolve([] as Array<{ type: 'IN' | 'OUT'; amount: number }>),
    ]);

    const cashIn = cashMovements
      .filter((item) => item.type === 'IN')
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const cashOut = cashMovements
      .filter((item) => item.type === 'OUT')
      .reduce((sum, item) => sum + Number(item.amount), 0);

    let expectedCash: number | null = null;
    if (sessionId) {
      const session = await this.prisma.posSession.findUnique({
        where: { id: sessionId },
        select: { initialCash: true },
      });
      if (session) {
        expectedCash = Number(session.initialCash) + (byPaymentMethod['CASH']?.total ?? 0) + cashIn - cashOut;
      }
    }

    return {
      totalSales: Number(agg._sum.total ?? 0),
      totalTransactions: agg._count.id,
      totalTax: Number(agg._sum.taxAmount ?? 0),
      totalSubtotal: Number(agg._sum.subtotal ?? 0),
      avgTicket: Number(agg._avg.total ?? 0),
      byPaymentMethod,
      cashIn,
      cashOut,
      expectedCash,
    };
  }

  async getSalesAnalytics(companyId: string, branchId: string | undefined, from?: string, to?: string) {
    const completedWhere: any = { companyId, status: 'COMPLETED' };
    const allSalesWhere: any = { companyId };
    const postSaleWhere: any = { companyId, status: 'APPROVED' };

    if (branchId) {
      completedWhere.branchId = branchId;
      allSalesWhere.branchId = branchId;
      postSaleWhere.branchId = branchId;
    }

    if (from || to) {
      completedWhere.createdAt = {};
      allSalesWhere.createdAt = {};
      postSaleWhere.createdAt = {};
      if (from) {
        const dateFrom = new Date(from);
        completedWhere.createdAt.gte = dateFrom;
        allSalesWhere.createdAt.gte = dateFrom;
        postSaleWhere.createdAt.gte = dateFrom;
      }
      if (to) {
        const dateTo = new Date(to);
        completedWhere.createdAt.lte = dateTo;
        allSalesWhere.createdAt.lte = dateTo;
        postSaleWhere.createdAt.lte = dateTo;
      }
    }

    const [completedSales, allSales, approvedPostSale] = await Promise.all([
      this.prisma.posSale.findMany({
        where: completedWhere,
        include: {
          branch: { select: { id: true, name: true } },
          session: {
            select: {
              id: true,
              openedAt: true,
              closedAt: true,
              terminal: { select: { id: true, code: true, name: true } },
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          items: {
            include: {
              product: { select: { id: true, cost: true, price: true } },
            },
          },
          payments: true,
        },
      }),
      this.prisma.posSale.findMany({
        where: allSalesWhere,
        select: {
          id: true,
          status: true,
          total: true,
          branchId: true,
          createdAt: true,
        },
      }),
      this.prisma.posPostSaleRequest.findMany({
        where: postSaleWhere,
        select: {
          id: true,
          type: true,
          total: true,
          saleId: true,
          createdAt: true,
          sale: {
            select: {
              branchId: true,
              session: {
                select: {
                  user: { select: { id: true, firstName: true, lastName: true } },
                  terminal: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const refunds = allSales.filter((sale) => sale.status === 'REFUNDED');
    const cancelled = allSales.filter((sale) => sale.status === 'CANCELLED');
    const completedCount = completedSales.length;
    const totalSales = this.roundCurrency(
      completedSales.reduce((sum, sale) => sum + Number(sale.total), 0),
    );
    const totalDiscounts = this.roundCurrency(
      completedSales.reduce((sum, sale) => sum + Number(sale.discountAmount), 0),
    );
    const totalRefunded = this.roundCurrency(
      refunds.reduce((sum, sale) => sum + Number(sale.total), 0),
    );
    const totalCancelled = this.roundCurrency(
      cancelled.reduce((sum, sale) => sum + Number(sale.total), 0),
    );

    const grossMarginAmount = this.roundCurrency(
      completedSales.reduce((sum, sale) => {
        const saleCost = sale.items.reduce((itemSum, item) => {
          const productCost = Number(item.product?.cost ?? 0);
          return itemSum + productCost * Number(item.quantity);
        }, 0);
        return sum + (Number(sale.subtotal) - saleCost);
      }, 0),
    );
    const grossMarginPct =
      totalSales > 0 ? this.roundCurrency((grossMarginAmount / totalSales) * 100) : 0;

    const groupedByTerminal = new Map<string, any>();
    const groupedByCashier = new Map<string, any>();
    const groupedByBranch = new Map<string, any>();
    const groupedByHour = new Map<number, any>();
    const paymentBreakdown = new Map<string, { total: number; count: number }>();

    for (const sale of completedSales) {
      const terminalKey = sale.session?.terminal?.id ?? 'NO_TERMINAL';
      const terminalLabel = sale.session?.terminal
        ? `${sale.session.terminal.code} · ${sale.session.terminal.name}`
        : 'Sin caja';
      const cashierKey = sale.session?.user?.id ?? 'NO_USER';
      const cashierLabel = sale.session?.user
        ? `${sale.session.user.firstName} ${sale.session.user.lastName}`.trim()
        : 'Sin cajero';
      const branchKey = sale.branch?.id ?? sale.branchId ?? 'NO_BRANCH';
      const branchLabel = sale.branch?.name ?? 'Sin tienda';
      const hour = new Date(sale.createdAt).getHours();
      const saleTotal = Number(sale.total);
      const saleSubtotal = Number(sale.subtotal);
      const saleCost = sale.items.reduce(
        (sum, item) => sum + Number(item.product?.cost ?? 0) * Number(item.quantity),
        0,
      );
      const saleMargin = saleSubtotal - saleCost;

      const terminalBucket =
        groupedByTerminal.get(terminalKey) ??
        { terminalId: terminalKey, terminalName: terminalLabel, sales: 0, transactions: 0, avgTicket: 0 };
      terminalBucket.sales += saleTotal;
      terminalBucket.transactions += 1;
      groupedByTerminal.set(terminalKey, terminalBucket);

      const cashierBucket =
        groupedByCashier.get(cashierKey) ??
        {
          cashierId: cashierKey,
          cashierName: cashierLabel,
          sales: 0,
          transactions: 0,
          margin: 0,
          refunds: 0,
          productivityScore: 0,
        };
      cashierBucket.sales += saleTotal;
      cashierBucket.transactions += 1;
      cashierBucket.margin += saleMargin;
      groupedByCashier.set(cashierKey, cashierBucket);

      const branchBucket =
        groupedByBranch.get(branchKey) ??
        { branchId: branchKey, branchName: branchLabel, sales: 0, transactions: 0, avgTicket: 0 };
      branchBucket.sales += saleTotal;
      branchBucket.transactions += 1;
      groupedByBranch.set(branchKey, branchBucket);

      const hourBucket =
        groupedByHour.get(hour) ?? { hour, sales: 0, transactions: 0, avgTicket: 0 };
      hourBucket.sales += saleTotal;
      hourBucket.transactions += 1;
      groupedByHour.set(hour, hourBucket);

      const payments =
        sale.payments && sale.payments.length > 0
          ? sale.payments
          : [{ paymentMethod: sale.paymentMethod as any, amount: sale.total }];
      for (const payment of payments) {
        const key = String(payment.paymentMethod);
        const current = paymentBreakdown.get(key) ?? { total: 0, count: 0 };
        current.total += Number(payment.amount ?? 0);
        current.count += 1;
        paymentBreakdown.set(key, current);
      }
    }

    for (const refund of approvedPostSale) {
      const cashierKey = refund.sale?.session?.user?.id ?? 'NO_USER';
      const terminalKey = refund.sale?.session?.terminal?.id ?? 'NO_TERMINAL';
      const cashierBucket = groupedByCashier.get(cashierKey);
      if (cashierBucket) cashierBucket.refunds += Number(refund.total);
      const terminalBucket = groupedByTerminal.get(terminalKey);
      if (terminalBucket) terminalBucket.refunds = Number(terminalBucket.refunds ?? 0) + Number(refund.total);
    }

    const byTerminal = Array.from(groupedByTerminal.values())
      .map((item) => ({
        ...item,
        sales: this.roundCurrency(item.sales),
        avgTicket: item.transactions > 0 ? this.roundCurrency(item.sales / item.transactions) : 0,
        refunds: this.roundCurrency(Number(item.refunds ?? 0)),
      }))
      .sort((a, b) => b.sales - a.sales);

    const byCashier = Array.from(groupedByCashier.values())
      .map((item) => ({
        ...item,
        sales: this.roundCurrency(item.sales),
        margin: this.roundCurrency(item.margin),
        refunds: this.roundCurrency(item.refunds),
        avgTicket: item.transactions > 0 ? this.roundCurrency(item.sales / item.transactions) : 0,
        productivityScore:
          item.transactions > 0
            ? this.roundCurrency((item.sales / item.transactions) + item.margin / Math.max(item.transactions, 1))
            : 0,
      }))
      .sort((a, b) => b.sales - a.sales);

    const byBranch = Array.from(groupedByBranch.values())
      .map((item) => ({
        ...item,
        sales: this.roundCurrency(item.sales),
        avgTicket: item.transactions > 0 ? this.roundCurrency(item.sales / item.transactions) : 0,
      }))
      .sort((a, b) => b.sales - a.sales);

    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const item = groupedByHour.get(hour) ?? { hour, sales: 0, transactions: 0 };
      return {
        hour,
        sales: this.roundCurrency(item.sales),
        transactions: item.transactions,
        avgTicket: item.transactions > 0 ? this.roundCurrency(item.sales / item.transactions) : 0,
      };
    });

    const byPaymentMethod = Array.from(paymentBreakdown.entries())
      .map(([paymentMethod, item]) => ({
        paymentMethod,
        total: this.roundCurrency(item.total),
        count: item.count,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      kpis: {
        totalSales,
        completedCount,
        avgTicket: completedCount > 0 ? this.roundCurrency(totalSales / completedCount) : 0,
        grossMarginAmount,
        grossMarginPct,
        totalDiscounts,
        totalRefunded,
        totalCancelled,
        refundRate: completedCount > 0 ? this.roundCurrency((refunds.length / completedCount) * 100) : 0,
        approvedReturns: approvedPostSale.length,
      },
      byTerminal,
      byCashier,
      byBranch,
      byHour,
      byPaymentMethod,
      productivity: byCashier.slice(0, 10),
    };
  }
}
