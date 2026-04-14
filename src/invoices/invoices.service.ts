import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../config/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  CreateInvoiceDocumentConfigDto,
  UpdateInvoiceDocumentConfigDto,
} from './dto/invoice-document-config.dto';
import {
  CreateDeliveryNoteDto,
  CreateSalesOrderDto,
  CreateSourceInvoiceDto,
} from './dto/invoice-commercial-flow.dto';
import { InvoiceRegisterPaymentDto } from './dto/invoice-register-payment.dto';
import { CreateInvoicePaymentAgreementDto } from './dto/invoice-collections.dto';
import {
  AddInvoiceAttachmentDto,
  RejectInvoiceApprovalDto,
  RequestInvoiceApprovalDto,
} from './dto/invoice-governance.dto';
import {
  BulkInvoiceReprocessDto,
  CreateInvoiceExternalIntakeDto,
  QueueInvoiceReprocessDto,
} from './dto/invoice-operations.dto';
import { AccountingService } from '../accounting/accounting.service';
import { CarteraService } from '../cartera/cartera.service';
import { createHash, createSign, randomBytes, randomUUID } from 'crypto';
import * as archiver from 'archiver';
import * as https from 'https';
import * as http from 'http';
import * as QRCode from 'qrcode';
// ─────────────────────────────────────────────────────────────────────────────
// DIAN Constants — BeccaFact Software propio
// ─────────────────────────────────────────────────────────────────────────────
const DIAN_SOFTWARE_ID = '8c2e43bd-9d57-4144-b0af-8876de5917a8';
const DIAN_SOFTWARE_PIN = '12345';
const DIAN_TEST_SET_ID = 'aa87ad48-5975-46d1-b0d5-f8ed563a528e';
const DIAN_WS_HAB = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc';
const DIAN_WS_PROD = 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc';


// ─────────────────────────────────────────────────────────────────────────────
// Carga certificado DIAN desde archivo en disco (rutas configurables via .env)
// Variables: DIAN_CERT_PATH y DIAN_KEY_PATH  (relativas al CWD o absolutas)
// Si no existen los archivos, usa el certificado auto-firmado de fallback
// (solo válido para pruebas locales — la DIAN rechazará certs no acreditados)
// ─────────────────────────────────────────────────────────────────────────────
/** Elimina los "Bag Attributes" que genera openssl pkcs12 -nodes antes del bloque PEM */
function cleanPemStatic(raw: string, type: string): string {
  const marker = `-----BEGIN ${type}-----`;
  const idx = raw.indexOf(marker);
  return idx >= 0 ? raw.slice(idx).trim() : raw.trim();
}


// Technical key used during habilitación (test) — provided by DIAN in the numbering range
const DIAN_TECH_KEY_HAB = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private companiesService: CompaniesService,
    private accountingService: AccountingService,
    private carteraService: CarteraService,
  ) {
  }

  private async createDianJob(params: {
    companyId: string;
    invoiceId?: string | null;
    branchId?: string | null;
    actionType: string;
    sourceChannel?: string | null;
    triggeredById?: string | null;
    payload?: Record<string, any> | null;
    status?: string;
  }) {
    return this.prisma.invoiceDianProcessingJob.create({
      data: {
        companyId: params.companyId,
        invoiceId: params.invoiceId ?? undefined,
        branchId: params.branchId ?? undefined,
        actionType: params.actionType,
        sourceChannel: params.sourceChannel ?? undefined,
        triggeredById: params.triggeredById ?? undefined,
        payload: params.payload ?? undefined,
        status: params.status ?? 'PENDING',
      },
    });
  }

  private async completeDianJob(jobId: string, data: {
    status: string;
    attempts?: number;
    responseCode?: string | null;
    responseMessage?: string | null;
    result?: Record<string, any> | null;
  }) {
    return this.prisma.invoiceDianProcessingJob.update({
      where: { id: jobId },
      data: {
        status: data.status,
        attempts: data.attempts ?? undefined,
        responseCode: data.responseCode ?? undefined,
        responseMessage: data.responseMessage ?? undefined,
        result: data.result ?? undefined,
        lastAttemptAt: new Date(),
        processedAt: ['SUCCESS', 'FAILED', 'SKIPPED'].includes(data.status) ? new Date() : undefined,
      },
    });
  }

  private async logInvoiceAudit(
    companyId: string,
    userId: string | null,
    action: string,
    invoiceId: string,
    before: Record<string, any> | null,
    after: Record<string, any> | null,
  ) {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId: userId ?? undefined,
        action,
        resource: 'invoice',
        resourceId: invoiceId,
        before: before ?? undefined,
        after: after ?? undefined,
      },
    });
  }

  private async getLatestApprovalRequest(companyId: string, invoiceId: string, actionType: 'ISSUE' | 'CANCEL') {
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT *
        FROM "invoice_approval_requests"
        WHERE "companyId" = $1
          AND "invoiceId" = $2
          AND "actionType" = $3
        ORDER BY "createdAt" DESC
        LIMIT 1
      `,
      companyId,
      invoiceId,
      actionType,
    );
    return rows[0] ?? null;
  }

  private async ensureActionApprovalState(
    companyId: string,
    invoiceId: string,
    actionType: 'ISSUE' | 'CANCEL',
  ) {
    const latest = await this.getLatestApprovalRequest(companyId, invoiceId, actionType);
    if (!latest) return null;
    if (latest.status === 'PENDING') {
      throw new BadRequestException(
        `La factura tiene una aprobación pendiente para ${actionType === 'ISSUE' ? 'emitir' : 'anular'}`,
      );
    }
    if (latest.status === 'REJECTED') {
      throw new BadRequestException(
        `La solicitud de aprobación para ${actionType === 'ISSUE' ? 'emitir' : 'anular'} fue rechazada${latest.rejectedReason ? `: ${latest.rejectedReason}` : ''}`,
      );
    }
    return latest.status === 'APPROVED' ? latest : null;
  }

  private async consumeApprovalRequest(approvalId: string) {
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "invoice_approval_requests"
        SET "status" = 'CONSUMED',
            "consumedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      approvalId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXISTING METHODS (unchanged)
  // ══════════════════════════════════════════════════════════════════════════

  async findAll(companyId: string, filters: {
    search?: string; status?: string; type?: string;
    branchId?: string;
    from?: string; to?: string; customerId?: string;
    page?: number; limit?: number;
  }) {
    const { search, status, type, from, to, customerId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };
    // FILTRO NUEVO — FILTRAR POR SEDE
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }

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

  async findOne(companyId: string, branchId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId, deletedAt: null, branchId },
      include: {
        customer: true,
        documentConfig: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true, unspscCode: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    return invoice;
  }

  async getDocumentConfigs(companyId: string, branchId?: string) {
    return this.prisma.invoiceDocumentConfig.findMany({
      where: {
        companyId,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      include: {
        branch: { select: { id: true, name: true } },
        posTerminal: { select: { id: true, code: true, name: true, branchId: true } },
      },
      orderBy: [
        { isActive: 'desc' },
        { isDefault: 'desc' },
        { channel: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  async createDocumentConfig(companyId: string, dto: CreateInvoiceDocumentConfigDto) {
    if (dto.isDefault) {
      await this.prisma.invoiceDocumentConfig.updateMany({
        where: {
          companyId,
          channel: String(dto.channel ?? 'DIRECT').trim().toUpperCase(),
          type: dto.type ?? 'VENTA',
          ...(dto.branchId ? { branchId: dto.branchId } : { branchId: null }),
          ...(dto.posTerminalId ? { posTerminalId: dto.posTerminalId } : {}),
        },
        data: { isDefault: false },
      });
    }
    return this.prisma.invoiceDocumentConfig.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        posTerminalId: dto.posTerminalId ?? null,
        name: dto.name.trim(),
        channel: String(dto.channel ?? 'DIRECT').trim().toUpperCase(),
        type: dto.type ?? 'VENTA',
        prefix: dto.prefix.trim().toUpperCase(),
        resolutionNumber: dto.resolutionNumber?.trim() || null,
        resolutionLabel: dto.resolutionLabel?.trim() || null,
        rangeFrom: dto.rangeFrom ?? null,
        rangeTo: dto.rangeTo ?? null,
        validFrom: dto.validFrom?.trim() || null,
        validTo: dto.validTo?.trim() || null,
        technicalKey: dto.technicalKey?.trim() || null,
        fiscalRules: dto.fiscalRules ? JSON.parse(dto.fiscalRules) : undefined,
        isActive: dto.isActive !== false,
        isDefault: dto.isDefault === true,
      },
    });
  }

  async updateDocumentConfig(companyId: string, id: string, dto: UpdateInvoiceDocumentConfigDto) {
    const current = await this.prisma.invoiceDocumentConfig.findFirst({ where: { id, companyId } });
    if (!current) throw new NotFoundException('Configuración documental no encontrada');
    const nextChannel = String(dto.channel ?? current.channel).trim().toUpperCase();
    const nextType = dto.type ?? current.type;
    const nextBranchId = dto.branchId === undefined ? current.branchId : dto.branchId;
    const nextPosTerminalId = dto.posTerminalId === undefined ? current.posTerminalId : dto.posTerminalId;
    if (dto.isDefault) {
      await this.prisma.invoiceDocumentConfig.updateMany({
        where: {
          companyId,
          id: { not: id },
          channel: nextChannel,
          type: nextType,
          ...(nextBranchId ? { branchId: nextBranchId } : { branchId: null }),
          ...(nextPosTerminalId ? { posTerminalId: nextPosTerminalId } : {}),
        },
        data: { isDefault: false },
      });
    }
    return this.prisma.invoiceDocumentConfig.update({
      where: { id },
      data: {
        branchId: dto.branchId ?? undefined,
        posTerminalId: dto.posTerminalId ?? undefined,
        name: dto.name?.trim(),
        channel: dto.channel ? String(dto.channel).trim().toUpperCase() : undefined,
        type: dto.type,
        prefix: dto.prefix?.trim().toUpperCase(),
        resolutionNumber: dto.resolutionNumber === undefined ? undefined : dto.resolutionNumber?.trim() || null,
        resolutionLabel: dto.resolutionLabel === undefined ? undefined : dto.resolutionLabel?.trim() || null,
        rangeFrom: dto.rangeFrom === undefined ? undefined : dto.rangeFrom ?? null,
        rangeTo: dto.rangeTo === undefined ? undefined : dto.rangeTo ?? null,
        validFrom: dto.validFrom === undefined ? undefined : dto.validFrom?.trim() || null,
        validTo: dto.validTo === undefined ? undefined : dto.validTo?.trim() || null,
        technicalKey: dto.technicalKey === undefined ? undefined : dto.technicalKey?.trim() || null,
        fiscalRules: dto.fiscalRules === undefined ? undefined : (dto.fiscalRules ? JSON.parse(dto.fiscalRules) : Prisma.JsonNull),
        isActive: dto.isActive,
        isDefault: dto.isDefault,
      },
    });
  }

  private normalizeInvoiceChannel(value?: string | null) {
    return String(value ?? 'DIRECT').trim().toUpperCase() || 'DIRECT';
  }

  private async getSalesFiscalSetup(companyId: string) {
    const taxConfigs = await this.prisma.accountingTaxConfig.findMany({
      where: {
        companyId,
        isActive: true,
        taxCode: { in: ['IVA_VENTAS', 'IVA_GENERADO', 'RETEFUENTE', 'ICA'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const iva = taxConfigs.find((item) => ['IVA_VENTAS', 'IVA_GENERADO'].includes(item.taxCode));
    const retefuente = taxConfigs.find((item) => item.taxCode === 'RETEFUENTE');
    const ica = taxConfigs.find((item) => item.taxCode === 'ICA');
    return {
      ivaRate: Number(iva?.rate ?? 19),
      retefuenteRate: Number(retefuente?.rate ?? 0),
      icaRate: Number(ica?.rate ?? 0),
    };
  }

  private buildFiscalValidationResult(params: {
    customer: any;
    issueDate?: string | Date | null;
    invoiceType?: string | null;
    subtotal: number;
    taxAmount: number;
    withholdingAmount?: number;
    icaAmount?: number;
    sourceChannel?: string | null;
    documentConfig?: any;
  }) {
    const issues: string[] = [];
    const customer = params.customer;
    const documentConfig = params.documentConfig;
    const customerDocument = String(customer.documentNumber ?? '').trim();
    const customerName = String(customer.name ?? '').trim();
    const customerAddress = String(customer.address ?? '').trim();
    const customerCountry = String(customer.country ?? '').trim();
    const issueDate = params.issueDate ? new Date(params.issueDate) : new Date();
    const invoiceType = String(params.invoiceType ?? 'VENTA').trim().toUpperCase();
    const withholdingAmount = Number(params.withholdingAmount ?? 0);
    const icaAmount = Number(params.icaAmount ?? 0);

    if (!customer.documentType) issues.push('El cliente no tiene tipo de documento');
    if (!customerDocument) issues.push('El cliente no tiene número de documento');
    if (!customerName) issues.push('El cliente no tiene nombre o razón social');
    if (!customerAddress) issues.push('El cliente no tiene dirección registrada');
    if (!customerCountry) issues.push('El cliente no tiene país registrado');
    if (params.subtotal <= 0) issues.push('La base gravable debe ser mayor a cero');
    if (params.taxAmount < 0) issues.push('El IVA no puede ser negativo');
    if (withholdingAmount < 0) issues.push('La retefuente no puede ser negativa');
    if (icaAmount < 0) issues.push('El ICA no puede ser negativo');
    if ((invoiceType === 'VENTA' || invoiceType === 'NOTA_DEBITO') && params.taxAmount <= 0) {
      issues.push('La factura debe tener un valor de IVA válido para la operación gravada');
    }

    if (documentConfig?.resolutionNumber) {
      if (documentConfig.validFrom && issueDate < new Date(documentConfig.validFrom)) {
        issues.push('La fecha de emisión es anterior a la vigencia inicial de la resolución');
      }
      if (documentConfig.validTo && issueDate > new Date(documentConfig.validTo)) {
        issues.push('La fecha de emisión supera la vigencia final de la resolución');
      }
    }

    if (params.sourceChannel === 'POS' && !params.documentConfig?.prefix) {
      issues.push('Las facturas POS deben usar una configuración documental con prefijo definido');
    }
    if (params.sourceChannel === 'POS' && !params.documentConfig?.resolutionNumber) {
      issues.push('Las facturas POS deben tener resolución DIAN configurada');
    }
    if (!documentConfig?.resolutionNumber) {
      issues.push('La factura no tiene resolución documental asociada');
    }

    return {
      status: issues.length > 0 ? 'REVIEW_REQUIRED' : 'READY',
      notes: issues.length > 0 ? issues.join('; ') : 'Validación fiscal completa',
      issues,
    };
  }

  private shouldRestockCreditNote(reasonCode?: string | null) {
    return new Set(['1', '2', '4']).has(String(reasonCode ?? '').trim());
  }

  private async validateInventoryAvailability(
    companyId: string,
    items: Array<{ productId?: string | null; quantity: number; description?: string | null }>,
    actionLabel: string,
  ) {
    const requested = new Map<string, number>();
    for (const item of items) {
      if (!item.productId) continue;
      requested.set(item.productId, (requested.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
    }
    if (!requested.size) return;

    const products = await this.prisma.product.findMany({
      where: { companyId, id: { in: Array.from(requested.keys()) }, deletedAt: null },
      select: { id: true, name: true, stock: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));

    for (const [productId, quantity] of requested.entries()) {
      const product = productMap.get(productId);
      if (!product) {
        throw new NotFoundException(`Producto no encontrado para ${actionLabel}`);
      }
      if (Number(product.stock ?? 0) < quantity - 0.0001) {
        throw new BadRequestException(
          `Stock insuficiente para ${product.name}. Disponible: ${Number(product.stock ?? 0)}, solicitado: ${quantity}`,
        );
      }
    }
  }

  private async applyInventoryMovements(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      branchId?: string | null;
      invoiceId?: string | null;
      deliveryNoteId?: string | null;
      movementType: string;
      direction: 'OUT' | 'IN';
      notes?: string | null;
      items: Array<{ productId?: string | null; quantity: number; unitPrice?: number | null }>;
    },
  ) {
    let appliedCount = 0;

    for (const item of params.items) {
      if (!item.productId || Number(item.quantity ?? 0) <= 0) continue;
      const quantity = Number(item.quantity);
      const delta = params.direction === 'OUT' ? -quantity : quantity;
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { id: true, stock: true, status: true },
      });
      if (!product) throw new NotFoundException('Producto no encontrado para movimiento de inventario');

      const currentStock = Number(product.stock ?? 0);
      const nextStock = currentStock + delta;
      if (nextStock < -0.0001) {
        throw new BadRequestException(`Stock insuficiente para el producto ${item.productId}`);
      }

      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: nextStock,
          status:
            nextStock <= 0
              ? 'OUT_OF_STOCK'
              : product.status === 'OUT_OF_STOCK'
                ? 'ACTIVE'
                : product.status,
        },
      });

      await tx.$executeRawUnsafe(
        `INSERT INTO "invoice_inventory_movements"
          ("id","companyId","branchId","invoiceId","deliveryNoteId","productId","movementType","quantity","unitPrice","notes","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        randomUUID(),
        params.companyId,
        params.branchId ?? null,
        params.invoiceId ?? null,
        params.deliveryNoteId ?? null,
        item.productId,
        params.movementType,
        quantity,
        item.unitPrice ?? null,
        params.notes ?? null,
      );

      appliedCount += 1;
    }

    return appliedCount;
  }

  private async resolveInvoiceDocumentConfig(params: {
    companyId: string;
    branchId?: string | null;
    type: string;
    documentConfigId?: string | null;
    sourceChannel?: string | null;
    sourceTerminalId?: string | null;
    preferredPrefix?: string | null;
  }) {
    const channel = this.normalizeInvoiceChannel(params.sourceChannel);
    if (params.documentConfigId) {
      const explicitConfig = await this.prisma.invoiceDocumentConfig.findFirst({
        where: {
          id: params.documentConfigId,
          companyId: params.companyId,
          isActive: true,
        },
      });
      if (explicitConfig) return explicitConfig;
    }
    const configs = await this.prisma.invoiceDocumentConfig.findMany({
      where: {
        companyId: params.companyId,
        isActive: true,
        type: params.type as any,
        channel,
        OR: [
          ...(params.sourceTerminalId ? [{ posTerminalId: params.sourceTerminalId }] : []),
          ...(params.branchId ? [{ branchId: params.branchId, posTerminalId: null }] : []),
          { branchId: null, posTerminalId: null },
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    const matchedByPrefix = params.preferredPrefix
      ? configs.find((item) => item.prefix === params.preferredPrefix)
      : null;
    if (matchedByPrefix) return matchedByPrefix;
    if (configs.length > 0) return configs[0];

    if (channel === 'POS' && params.sourceTerminalId) {
      const terminal = await this.prisma.posTerminal.findFirst({
        where: { id: params.sourceTerminalId, companyId: params.companyId },
        select: {
          id: true,
          invoicePrefix: true,
          resolutionNumber: true,
          resolutionLabel: true,
        },
      });
      if (terminal) {
        return {
          id: null,
          prefix: terminal.invoicePrefix || 'POS',
          resolutionNumber: terminal.resolutionNumber ?? null,
          resolutionLabel: terminal.resolutionLabel ?? null,
          rangeFrom: null,
          rangeTo: null,
          validFrom: null,
          validTo: null,
          technicalKey: null,
          fiscalRules: null,
          channel,
          posTerminalId: terminal.id,
        };
      }
    }

    const company = await this.prisma.company.findUnique({
      where: { id: params.companyId },
      select: {
        dianPrefijo: true,
        dianResolucion: true,
        dianRangoDesde: true,
        dianRangoHasta: true,
        dianFechaDesde: true,
        dianFechaHasta: true,
        dianPosPrefijo: true,
        dianPosResolucion: true,
        dianPosRangoDesde: true,
        dianPosRangoHasta: true,
        dianPosFechaDesde: true,
        dianPosFechaHasta: true,
        dianClaveTecnica: true,
      },
    });
    const isPos = channel === 'POS';
    return {
      id: null,
      prefix: params.preferredPrefix || (isPos ? company?.dianPosPrefijo : company?.dianPrefijo) || (isPos ? 'POS' : 'FV'),
      resolutionNumber: (isPos ? company?.dianPosResolucion : company?.dianResolucion) ?? null,
      resolutionLabel: null,
      rangeFrom: isPos ? company?.dianPosRangoDesde ?? null : company?.dianRangoDesde ?? null,
      rangeTo: isPos ? company?.dianPosRangoHasta ?? null : company?.dianRangoHasta ?? null,
      validFrom: isPos ? company?.dianPosFechaDesde ?? null : company?.dianFechaDesde ?? null,
      validTo: isPos ? company?.dianPosFechaHasta ?? null : company?.dianFechaHasta ?? null,
      technicalKey: company?.dianClaveTecnica ?? null,
      fiscalRules: null,
      channel,
      posTerminalId: params.sourceTerminalId ?? null,
    };
  }

  async create(companyId: string, branchId: string | null, dto: CreateInvoiceDto) {
    const canCreate = await this.companiesService.checkLimit(companyId, 'max_documents_per_month');
    if (!canCreate) throw new ForbiddenException('Has alcanzado el límite mensual de documentos. Actualiza tu plan.');

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    if (dto.type === 'VENTA' || !dto.type) {
      await this.ensureCustomerCommercialEligibility(companyId, customer.id, customer.creditLimit ? Number(customer.creditLimit) : null);
    }

    let originalInvoiceForOperation: any = null;

    // ── Validar referencia para Nota Crédito / Nota Débito ──────────────
    if (dto.type === 'NOTA_CREDITO' || dto.type === 'NOTA_DEBITO') {
      const allowedReasonCodes =
        dto.type === 'NOTA_CREDITO'
          ? new Set(['1', '2', '3', '4', '5', '6'])
          : new Set(['1', '2', '3', '4', '5', '6']);
      if (!dto.discrepancyReasonCode || !allowedReasonCodes.has(dto.discrepancyReasonCode)) {
        throw new BadRequestException('La causal DIAN de la nota es obligatoria o no es válida');
      }
      if (!dto.discrepancyReason?.trim()) {
        throw new BadRequestException('La descripción del motivo de la nota es obligatoria');
      }
      if (!dto.originalInvoiceId) {
        throw new BadRequestException(
          `Las notas de ${dto.type === 'NOTA_CREDITO' ? 'crédito' : 'débito'} deben referenciar una factura original (originalInvoiceId).`
        );
      }
      const where: any = {
        id: dto.originalInvoiceId,
        companyId,
        deletedAt: null,
      };

      // Si el branchId viene definido → filtra por él
      if (branchId) {
        where.branchId = branchId;
      }

      const originalInvoice = await this.prisma.invoice.findFirst({
        where,
        include: {
          items: {
            include: { product: { select: { id: true, name: true, sku: true } } },
            orderBy: { position: 'asc' },
          },
        },
      });
      if (!originalInvoice) {
        throw new NotFoundException('La factura original referenciada no existe.');
      }
      originalInvoiceForOperation = originalInvoice;
      if (originalInvoice.type !== 'VENTA') {
        throw new BadRequestException('Solo se pueden crear notas sobre facturas de venta (tipo VENTA).');
      }
      if (dto.type === 'NOTA_CREDITO') {
        // Calcular saldo disponible
        const usedCredit = await this.prisma.invoice.aggregate({
          where: {
            originalInvoiceId: dto.originalInvoiceId,
            type: 'NOTA_CREDITO',
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] },
          },
          _sum: { total: true },
        });
        const used = Number(usedCredit._sum.total ?? 0);
        const remaining = Number(originalInvoice.total) - used;
        // Calcular total de la nota que se está creando
        let newNoteTotal = 0;
        for (const item of dto.items) {
          const lineSubtotal = Number(item.quantity) * Number(item.unitPrice) * (1 - (Number(item.discount ?? 0) / 100));
          newNoteTotal += lineSubtotal * (1 + (Number(item.taxRate ?? 19) / 100));
        }
        if (newNoteTotal > remaining + 0.01) {
          throw new BadRequestException(
            `El valor de la nota crédito ($${newNoteTotal.toFixed(2)}) supera el saldo disponible de la factura ($${remaining.toFixed(2)}).`
          );
        }

        const relatedNotes = await this.prisma.invoice.findMany({
          where: {
            originalInvoiceId: dto.originalInvoiceId,
            companyId,
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] },
          },
          include: {
            items: {
              include: { product: { select: { id: true } } },
            },
          },
        });

        const originalLines = (originalInvoice.items ?? []).map((item) => ({
          key: item.productId ? `product:${item.productId}` : `desc:${item.description.trim().toLowerCase()}`,
          quantity: Number(item.quantity),
          total: Number(item.total),
        }));

        const consumedMap = new Map<string, { quantity: number; total: number }>();
        for (const note of relatedNotes) {
          if (note.type !== 'NOTA_CREDITO') continue;
          for (const noteItem of note.items) {
            const key = noteItem.productId
              ? `product:${noteItem.productId}`
              : `desc:${noteItem.description.trim().toLowerCase()}`;
            const current = consumedMap.get(key) ?? { quantity: 0, total: 0 };
            current.quantity += Number(noteItem.quantity);
            current.total += Number(noteItem.total);
            consumedMap.set(key, current);
          }
        }

        for (const item of dto.items) {
          const key = item.productId
            ? `product:${item.productId}`
            : `desc:${item.description.trim().toLowerCase()}`;
          const originalLine = originalLines.find((line) => line.key === key);
          if (!originalLine) {
            throw new BadRequestException(`La línea "${item.description}" no corresponde a una línea de la factura original`);
          }
          const consumed = consumedMap.get(key) ?? { quantity: 0, total: 0 };
          const remainingQuantity = this.roundMoney(originalLine.quantity - consumed.quantity);
          if (Number(item.quantity) > remainingQuantity + 0.0001) {
            throw new BadRequestException(
              `La cantidad de la línea "${item.description}" supera lo pendiente por revertir (${remainingQuantity})`,
            );
          }
        }
      }
    }

    // Pre-cargar productos para obtener unit y unspscCode (DIAN XML)
    const productIds = dto.items.map(i => i.productId).filter(Boolean) as string[];
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
        where: { id: { in: productIds }, companyId },
        select: { id: true, unit: true, sku: true },
      })
      : [];
    const productMap = new Map(products.map(p => [p.id, p]));

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
      // unit: usar el del producto si existe, luego el del DTO, default 'EA' (tabla 13.3.6 UNece)
      const prod = item.productId ? productMap.get(item.productId) : undefined;
      const unit = (item as any).unit || prod?.unit || 'EA';
      return {
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate ?? 19),
        taxAmount: lineTax,
        discount: Number(item.discount ?? 0),
        total: lineTotal,
        position: index + 1,

        ...(item.productId && {
          product: {
            connect: { id: item.productId }
          }
        })
      } as any;
    });

    const total = subtotal + taxAmount;
    const fiscalSetup = await this.getSalesFiscalSetup(companyId);
    const invoiceType = dto.type ?? 'VENTA';
    const withholdingAmount =
      invoiceType === 'VENTA' || invoiceType === 'NOTA_DEBITO'
        ? this.roundMoney(subtotal * ((fiscalSetup.retefuenteRate ?? 0) / 100))
        : 0;
    const icaAmount =
      invoiceType === 'VENTA' || invoiceType === 'NOTA_DEBITO'
        ? this.roundMoney(subtotal * ((fiscalSetup.icaRate ?? 0) / 100))
        : 0;
    const resolvedConfig = await this.resolveInvoiceDocumentConfig({
      companyId,
      branchId,
      type: dto.type ?? 'VENTA',
      documentConfigId: dto.documentConfigId,
      sourceChannel: dto.sourceChannel,
      sourceTerminalId: dto.sourceTerminalId,
      preferredPrefix: dto.prefix,
    });
    const fiscalPrefix = resolvedConfig.prefix || dto.prefix || 'FV';
    const invoiceNumber = await this.getNextInvoiceNumber(
      companyId,
      fiscalPrefix,
      resolvedConfig.rangeFrom ?? undefined,
    );
    const fiscalValidation = this.buildFiscalValidationResult({
      customer,
      issueDate: dto.issueDate,
      invoiceType: dto.type ?? 'VENTA',
      subtotal,
      taxAmount,
      withholdingAmount,
      icaAmount,
      sourceChannel: dto.sourceChannel ?? null,
      documentConfig: resolvedConfig,
    });

    const normalizedChannel = this.normalizeInvoiceChannel(dto.sourceChannel);
    const shouldApplyDirectInventory =
      (dto.type ?? 'VENTA') === 'VENTA' &&
      normalizedChannel !== 'POS' &&
      String(dto.inventoryMode ?? '').toUpperCase() !== 'DEFER';

    if (shouldApplyDirectInventory) {
      await this.validateInventoryAvailability(
        companyId,
        dto.items.map((item) => ({
          productId: item.productId ?? null,
          quantity: Number(item.quantity),
          description: item.description,
        })),
        'facturar',
      );
    }

    let invoice: any;
    await this.prisma.$transaction(async (tx) => {
      invoice = await tx.invoice.create({
        data: {
          branchId,
          companyId,
          customerId: dto.customerId,
          invoiceNumber,
          prefix: fiscalPrefix,
          sourceChannel: normalizedChannel,
          sourceTerminalId: dto.sourceTerminalId ?? null,
          type: dto.type ?? 'VENTA',
          status: 'DRAFT',
          issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          subtotal,
          taxAmount,
          withholdingAmount,
          icaAmount,
          discountAmount: dto.discountAmount ?? 0,
          total,
          notes: dto.notes,
          currency: dto.currency ?? 'COP',
          documentConfigId: resolvedConfig.id ?? null,
          resolutionNumber: resolvedConfig.resolutionNumber ?? null,
          resolutionLabel: resolvedConfig.resolutionLabel ?? null,
          numberingRangeFrom: resolvedConfig.rangeFrom ?? null,
          numberingRangeTo: resolvedConfig.rangeTo ?? null,
          resolutionValidFrom: resolvedConfig.validFrom ?? null,
          resolutionValidTo: resolvedConfig.validTo ?? null,
          fiscalRulesSnapshot: resolvedConfig.fiscalRules ?? undefined,
          fiscalValidationStatus: fiscalValidation.status,
          fiscalValidationNotes: fiscalValidation.notes,
          ...(dto.originalInvoiceId && { originalInvoiceId: dto.originalInvoiceId }),
          ...(dto.discrepancyReasonCode && { discrepancyReasonCode: dto.discrepancyReasonCode }),
          ...(dto.discrepancyReason && { discrepancyReason: dto.discrepancyReason }),
          items: { create: itemsWithTotals },
        },
        include: { customer: true, items: true, documentConfig: true },
      });

      const invoiceType = dto.type ?? 'VENTA';
      if (invoiceType === 'VENTA') {
        const applied = shouldApplyDirectInventory
          ? await this.applyInventoryMovements(tx, {
              companyId,
              branchId,
              invoiceId: invoice.id,
              movementType: 'INVOICE_OUT',
              direction: 'OUT',
              notes: `Salida por factura ${invoice.invoiceNumber}`,
              items: dto.items.map((item) => ({
                productId: item.productId ?? null,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice ?? 0),
              })),
            })
          : 0;

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
            inventoryStatus: shouldApplyDirectInventory
              ? applied > 0
                ? 'POSTED'
                : 'NOT_APPLICABLE'
              : 'EXTERNAL',
            inventoryAppliedAt: shouldApplyDirectInventory && applied > 0 ? new Date() : null,
            deliveryStatus: normalizedChannel === 'POS' ? 'EXTERNAL' : 'DELIVERED',
          },
        });
      } else if (
        invoiceType === 'NOTA_CREDITO' &&
        originalInvoiceForOperation &&
        this.shouldRestockCreditNote(dto.discrepancyReasonCode) &&
        !originalInvoiceForOperation.sourcePosSaleId &&
        originalInvoiceForOperation.inventoryStatus === 'POSTED'
      ) {
        const restocked = await this.applyInventoryMovements(tx, {
          companyId,
          branchId,
          invoiceId: invoice.id,
          movementType: 'CREDIT_RETURN',
          direction: 'IN',
          notes: `Reingreso por nota crédito ${invoice.invoiceNumber}`,
          items: dto.items.map((item) => ({
            productId: item.productId ?? null,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice ?? 0),
          })),
        });

        if (restocked > 0) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              inventoryStatus: 'RETURNED',
              inventoryAppliedAt: new Date(),
              inventoryReversedAt: new Date(),
              deliveryStatus: 'RETURNED',
            },
          });
        }
      }
    });

    await this.companiesService.incrementUsage(companyId, 'max_documents_per_month');
    await this.logInvoiceAudit(companyId, null, 'INVOICE_CREATED', invoice.id, null, {
      invoiceNumber: invoice.invoiceNumber,
      type: invoice.type,
      total: invoice.total,
      withholdingAmount,
      icaAmount,
      fiscalValidationStatus: fiscalValidation.status,
      sourceChannel: invoice.sourceChannel,
      inventoryStatus: (invoice as any).inventoryStatus ?? null,
      deliveryStatus: (invoice as any).deliveryStatus ?? null,
    });
    return invoice;
  }

  private async ensureCustomerCommercialEligibility(
    companyId: string,
    customerId: string,
    creditLimit: number | null,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        customerId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE', 'PAID'] },
      },
      include: {
        payments: { select: { amount: true } },
      },
    });

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const adjustments = invoiceIds.length
      ? await this.prisma.$queryRaw<Array<{ invoiceId: string; net: any }>>`
          SELECT
            "invoiceId",
            COALESCE(SUM(
              CASE
                WHEN "type" IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -"amount"
                WHEN "type" IN ('DEBIT_NOTE', 'RECOVERY') THEN "amount"
                ELSE 0
              END
            ), 0) AS net
          FROM "cartera_adjustments"
          WHERE "companyId" = ${companyId}
            AND "status" = 'APPLIED'
            AND "invoiceId" IN (${Prisma.join(invoiceIds)})
          GROUP BY "invoiceId"
        `
      : [];
    const adjustmentMap = new Map(adjustments.map((row) => [row.invoiceId, Number(row.net ?? 0)]));

    const today = new Date();
    let outstanding = 0;
    let overdue = 0;
    for (const invoice of invoices) {
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = Math.max(0, Number(invoice.total) + (adjustmentMap.get(invoice.id) ?? 0) - paid);
      if (balance <= 0.01) continue;
      outstanding += balance;
      if (invoice.dueDate && new Date(invoice.dueDate) < today) overdue += balance;
    }

    if (overdue > 0.01) {
      throw new BadRequestException('El cliente tiene cartera vencida y quedó bloqueado comercialmente');
    }

    if (creditLimit && creditLimit > 0 && outstanding >= creditLimit - 0.01) {
      throw new BadRequestException('El cliente superó su cupo de crédito y no puede facturarse');
    }
  }

  async cancel(companyId: string, branchId: string, invoiceId: string, reason: string) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    const approvedRequest = await this.ensureActionApprovalState(companyId, invoiceId, 'CANCEL');
    if (['CANCELLED', 'PAID'].includes(invoice.status)) {
      throw new BadRequestException('Esta factura no puede cancelarse');
    }
    if (invoice.status === 'ACCEPTED_DIAN') {
      throw new BadRequestException(
        'Una factura validada por la DIAN no puede cancelarse directamente. ' +
        'Debe emitir una Nota Crédito (tipo 2 – anulación) que la referencie.'
      );
    }
    const cancelled = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED', notes: `${invoice.notes ?? ''}\n[CANCELADA]: ${reason}` },
    });
    if (approvedRequest?.id) await this.consumeApprovalRequest(approvedRequest.id);
    await this.logInvoiceAudit(companyId, null, 'INVOICE_CANCELLED', invoiceId, { status: invoice.status }, {
      status: 'CANCELLED',
      reason,
      approvalId: approvedRequest?.id ?? null,
    });
    return cancelled;
  }

  async markAsPaid(companyId: string, branchId: string, invoiceId: string) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    if (invoice.status === 'PAID') throw new BadRequestException('La factura ya está pagada');
    const updated = await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } });
    await this.logInvoiceAudit(companyId, null, 'INVOICE_MARKED_PAID', invoiceId, { status: invoice.status }, { status: 'PAID' });
    return updated;
  }

  async getRemainingBalance(companyId: string, branchId: string, invoiceId: string) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    if (invoice.type !== 'VENTA') {
      throw new BadRequestException('El saldo solo aplica a facturas de venta.');
    }
    const [creditResult, debitResult] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          originalInvoiceId: invoiceId,
          type: 'NOTA_CREDITO',
          deletedAt: null,
          status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] },
        },
        _sum: { total: true },
        _count: { id: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          originalInvoiceId: invoiceId,
          type: 'NOTA_DEBITO',
          deletedAt: null,
          status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] },
        },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);
    const totalCredits = Number(creditResult._sum.total ?? 0);
    const totalDebits = Number(debitResult._sum.total ?? 0);
    const original = Number(invoice.total);
    const remaining = original - totalCredits + totalDebits;
    return {
      invoiceId,
      invoiceNumber: (invoice as any).invoiceNumber,
      originalTotal: original,
      totalCredits,
      totalDebits,
      creditCount: creditResult._count.id,
      debitCount: debitResult._count.id,
      remainingBalance: Math.max(0, remaining),
      fullyOffset: remaining <= 0,
    };
  }

  async getInvoiceStatement(companyId: string, branchId: string, invoiceId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    return this.carteraService.getInvoiceStatement(companyId, invoiceId);
  }

  async getInvoiceReconciliation(companyId: string, branchId: string, invoiceId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    const statement = await this.carteraService.getInvoiceStatement(companyId, invoiceId);
    return {
      invoice: statement.invoice,
      summary: statement.summary,
      reconciliation: statement.reconciliation,
    };
  }

  async getApprovalFlow(companyId: string, branchId: string, invoiceId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          iar."id",
          iar."actionType",
          iar."status",
          iar."reason",
          iar."requestedAt",
          iar."approvedAt",
          iar."rejectedAt",
          iar."rejectedReason",
          iar."consumedAt",
          iar."requestedById",
          iar."approvedById",
          TRIM(COALESCE(req."firstName",'') || ' ' || COALESCE(req."lastName",'')) AS "requestedByName",
          TRIM(COALESCE(app."firstName",'') || ' ' || COALESCE(app."lastName",'')) AS "approvedByName"
        FROM "invoice_approval_requests" iar
        LEFT JOIN "users" req ON req."id" = iar."requestedById"
        LEFT JOIN "users" app ON app."id" = iar."approvedById"
        WHERE iar."companyId" = $1
          AND iar."invoiceId" = $2
        ORDER BY iar."createdAt" DESC
      `,
      companyId,
      invoiceId,
    );
    return rows.map((row) => ({
      ...row,
      requestedByName: row.requestedByName?.trim() || null,
      approvedByName: row.approvedByName?.trim() || null,
    }));
  }

  async requestApproval(companyId: string, branchId: string, invoiceId: string, dto: RequestInvoiceApprovalDto, userId: string) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    const actionType = dto.actionType;
    if (actionType === 'ISSUE' && invoice.status !== 'DRAFT') {
      throw new BadRequestException('Solo se puede solicitar aprobación de emisión sobre facturas en borrador');
    }
    if (actionType === 'CANCEL' && ['CANCELLED', 'PAID'].includes(invoice.status)) {
      throw new BadRequestException('La factura ya no admite solicitud de anulación');
    }
    const latest = await this.getLatestApprovalRequest(companyId, invoiceId, actionType);
    if (latest?.status === 'PENDING') {
      throw new BadRequestException('Ya existe una solicitud pendiente para esta acción');
    }

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "invoice_approval_requests" (
          "id","companyId","invoiceId","actionType","status","reason","requestedById","requestedAt","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,$4,'PENDING',$5,$6,NOW(),NOW(),NOW())
      `,
      randomUUID(),
      companyId,
      invoiceId,
      actionType,
      dto.reason?.trim() || null,
      userId,
    );

    await this.logInvoiceAudit(companyId, userId, 'INVOICE_APPROVAL_REQUESTED', invoiceId, null, {
      actionType,
      reason: dto.reason?.trim() || null,
    });

    return this.getApprovalFlow(companyId, branchId, invoiceId);
  }

  async approveApproval(companyId: string, branchId: string, invoiceId: string, userId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    const approval = (await this.getApprovalFlow(companyId, branchId, invoiceId)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para esta factura');

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "invoice_approval_requests"
        SET "status" = 'APPROVED',
            "approvedById" = $2,
            "approvedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      approval.id,
      userId,
    );

    await this.logInvoiceAudit(companyId, userId, 'INVOICE_APPROVAL_APPROVED', invoiceId, null, {
      approvalId: approval.id,
      actionType: approval.actionType,
    });

    return this.getApprovalFlow(companyId, branchId, invoiceId);
  }

  async rejectApproval(
    companyId: string,
    branchId: string,
    invoiceId: string,
    dto: RejectInvoiceApprovalDto,
    userId: string,
  ) {
    await this.findOne(companyId, branchId, invoiceId);
    const approval = (await this.getApprovalFlow(companyId, branchId, invoiceId)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para esta factura');

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "invoice_approval_requests"
        SET "status" = 'REJECTED',
            "approvedById" = $2,
            "rejectedAt" = NOW(),
            "rejectedReason" = $3,
            "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      approval.id,
      userId,
      dto.reason?.trim() || null,
    );

    await this.logInvoiceAudit(companyId, userId, 'INVOICE_APPROVAL_REJECTED', invoiceId, null, {
      approvalId: approval.id,
      actionType: approval.actionType,
      reason: dto.reason?.trim() || null,
    });

    return this.getApprovalFlow(companyId, branchId, invoiceId);
  }

  async getAttachments(companyId: string, branchId: string, invoiceId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          ia."id",
          ia."invoiceId",
          ia."fileName",
          ia."fileUrl",
          ia."mimeType",
          ia."category",
          ia."notes",
          ia."sizeBytes",
          ia."createdAt",
          ia."uploadedById",
          TRIM(COALESCE(u."firstName",'') || ' ' || COALESCE(u."lastName",'')) AS "uploadedByName"
        FROM "invoice_attachments" ia
        LEFT JOIN "users" u ON u."id" = ia."uploadedById"
        WHERE ia."companyId" = $1
          AND ia."invoiceId" = $2
        ORDER BY ia."createdAt" DESC
      `,
      companyId,
      invoiceId,
    );
    return rows.map((row) => ({
      ...row,
      uploadedByName: row.uploadedByName?.trim() || null,
    }));
  }

  async addAttachment(companyId: string, branchId: string, invoiceId: string, dto: AddInvoiceAttachmentDto, userId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "invoice_attachments" (
          "id","companyId","invoiceId","fileName","fileUrl","mimeType","category","notes","sizeBytes","uploadedById","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      `,
      randomUUID(),
      companyId,
      invoiceId,
      dto.fileName.trim(),
      dto.fileUrl.trim(),
      dto.mimeType?.trim() || null,
      dto.category?.trim() || null,
      dto.notes?.trim() || null,
      dto.sizeBytes ?? null,
      userId,
    );

    await this.logInvoiceAudit(companyId, userId, 'INVOICE_ATTACHMENT_ADDED', invoiceId, null, {
      fileName: dto.fileName.trim(),
      fileUrl: dto.fileUrl.trim(),
      category: dto.category?.trim() || null,
    });

    return this.getAttachments(companyId, branchId, invoiceId);
  }

  async getAuditTrail(companyId: string, branchId: string, invoiceId: string) {
    await this.findOne(companyId, branchId, invoiceId);
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          al."id",
          al."action",
          al."resource",
          al."resourceId",
          al."createdAt",
          al."before",
          al."after",
          al."userId",
          TRIM(COALESCE(u."firstName",'') || ' ' || COALESCE(u."lastName",'')) AS "userName"
        FROM "audit_logs" al
        LEFT JOIN "users" u ON u."id" = al."userId"
        WHERE al."companyId" = $1
          AND al."resource" = 'invoice'
          AND al."resourceId" = $2
        ORDER BY al."createdAt" DESC
      `,
      companyId,
      invoiceId,
    );
    return rows.map((row) => ({
      ...row,
      userName: row.userName?.trim() || null,
    }));
  }

  async registerPartialPayment(
    companyId: string,
    branchId: string,
    invoiceId: string,
    dto: InvoiceRegisterPaymentDto,
    userId: string,
  ) {
    await this.findOne(companyId, branchId, invoiceId);
    return this.carteraService.registrarPago(companyId, invoiceId, dto as any, userId);
  }

  async createPaymentAgreement(
    companyId: string,
    branchId: string,
    invoiceId: string,
    dto: CreateInvoicePaymentAgreementDto,
    userId: string,
  ) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    return this.carteraService.createPaymentPromise(
      companyId,
      {
        customerId: invoice.customerId,
        invoiceId,
        amount: dto.amount,
        promisedDate: dto.promisedDate,
        notes: dto.notes,
      },
      userId,
    );
  }

  async getAssociatedNotes(companyId: string, branchId: string, invoiceId: string) {
    await this.findOne(companyId, branchId, invoiceId); // validates ownership
    return this.prisma.invoice.findMany({
      where: { originalInvoiceId: invoiceId, companyId, deletedAt: null },
      include: { customer: { select: { id: true, name: true } }, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNoteContext(companyId: string, branchId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null, branchId },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.type !== 'VENTA') {
      throw new BadRequestException('El contexto de notas solo aplica a facturas de venta');
    }

    const [balance, statement, notes] = await Promise.all([
      this.getRemainingBalance(companyId, branchId, invoiceId),
      this.carteraService.getInvoiceStatement(companyId, invoiceId),
      this.getAssociatedNotes(companyId, branchId, invoiceId),
    ]);

    const consumedMap = new Map<string, { creditedQty: number; creditedTotal: number; debitedQty: number; debitedTotal: number }>();
    for (const note of notes) {
      for (const item of note.items ?? []) {
        const key = item.productId
          ? `product:${item.productId}`
          : `desc:${item.description.trim().toLowerCase()}`;
        const current = consumedMap.get(key) ?? { creditedQty: 0, creditedTotal: 0, debitedQty: 0, debitedTotal: 0 };
        if (note.type === 'NOTA_CREDITO') {
          current.creditedQty += Number(item.quantity);
          current.creditedTotal += Number(item.total);
        } else if (note.type === 'NOTA_DEBITO') {
          current.debitedQty += Number(item.quantity);
          current.debitedTotal += Number(item.total);
        }
        consumedMap.set(key, current);
      }
    }

    const lineContext = (invoice.items ?? []).map((item) => {
      const key = item.productId
        ? `product:${item.productId}`
        : `desc:${item.description.trim().toLowerCase()}`;
      const consumed = consumedMap.get(key) ?? { creditedQty: 0, creditedTotal: 0, debitedQty: 0, debitedTotal: 0 };
      return {
        id: item.id,
        productId: item.productId,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
        discount: Number(item.discount),
        total: Number(item.total),
        product: item.product,
        creditedQty: consumed.creditedQty,
        debitedQty: consumed.debitedQty,
        remainingCreditQty: this.roundMoney(Number(item.quantity) - consumed.creditedQty),
        remainingCreditAmount: this.roundMoney(Number(item.total) - consumed.creditedTotal),
      };
    });

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: Number(invoice.total),
        customer: invoice.customer,
        sourceChannel: invoice.sourceChannel,
        inventoryStatus: (invoice as any).inventoryStatus ?? null,
        deliveryStatus: (invoice as any).deliveryStatus ?? null,
      },
      documentBalance: balance,
      cartera: statement.summary,
      notes,
      lines: lineContext,
      reasonCatalog: {
        credit: [
          { code: '1', label: 'Devolución parcial de bienes o servicios' },
          { code: '2', label: 'Anulación o reverso total de la factura' },
          { code: '3', label: 'Rebaja o descuento sobre la operación' },
          { code: '4', label: 'Ajuste comercial o de calidad' },
          { code: '5', label: 'Rescisión o nulidad' },
          { code: '6', label: 'Otros ajustes del documento' },
        ],
        debit: [
          { code: '1', label: 'Intereses' },
          { code: '2', label: 'Gastos por cobrar' },
          { code: '3', label: 'Cambio en el valor facturado' },
          { code: '4', label: 'Otros' },
          { code: '5', label: 'Ajuste por servicio adicional' },
          { code: '6', label: 'Regularización comercial' },
        ],
      },
      guidedActions: {
        canFullCreditReverse: balance.remainingBalance > 0.01,
        canPartialByLine: lineContext.some((line) => line.remainingCreditQty > 0.0001),
        inventoryReturnEligible:
          !invoice.sourcePosSaleId &&
          String((invoice as any).inventoryStatus ?? '') === 'POSTED',
      },
    };
  }

  async getSummary(companyId: string, branchId: string, from: string, to: string) {
    const where: any = { companyId, deletedAt: null, branchId, issueDate: { gte: new Date(from), lte: new Date(to) } };
    const [invoices, byStatus, byType] = await Promise.all([
      this.prisma.invoice.aggregate({ where, _sum: { total: true, taxAmount: true, subtotal: true }, _count: { id: true } }),
      this.prisma.invoice.groupBy({ by: ['status'], where, _count: { id: true }, _sum: { total: true } }),
      this.prisma.invoice.groupBy({ by: ['type'], where, _count: { id: true }, _sum: { total: true } }),
    ]);
    return {
      totals: { count: invoices._count.id, total: invoices._sum.total ?? 0, subtotal: invoices._sum.subtotal ?? 0, taxAmount: invoices._sum.taxAmount ?? 0 },
      byStatus,
      byType,
    };
  }

  async getAnalyticsSummary(
    companyId: string,
    branchId: string | null,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const now = new Date();
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : now;
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      deletedAt: null,
      issueDate: { gte: dateFrom, lte: dateTo },
      ...(branchId ? { branchId } : {}),
    };

    const invoices = await this.prisma.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        total: true,
        status: true,
        dianStatus: true,
        dianStatusCode: true,
        dianSentAt: true,
        dianResponseAt: true,
        sourceChannel: true,
        branchId: true,
        sourceQuoteId: true,
        customerId: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
      },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    });

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const quoteIds = Array.from(new Set(invoices.map((invoice) => invoice.sourceQuoteId).filter(Boolean) as string[]));

    const [quotes, pendingApprovals, attachmentsCount] = await Promise.all([
      quoteIds.length
        ? this.prisma.quote.findMany({
            where: { companyId, id: { in: quoteIds }, deletedAt: null },
            select: { id: true, salesOwnerName: true, sourceChannel: true },
          })
        : Promise.resolve([]),
      invoiceIds.length
        ? this.prisma.invoiceApprovalRequest.count({
            where: { companyId, invoiceId: { in: invoiceIds }, status: 'PENDING' as any },
          })
        : Promise.resolve(0),
      invoiceIds.length
        ? this.prisma.invoiceAttachment.count({
            where: { companyId, invoiceId: { in: invoiceIds } },
          })
        : Promise.resolve(0),
    ]);

    const quoteMap = new Map(quotes.map((quote) => [quote.id, quote]));
    const normalized = invoices.map((invoice) => {
      const emitted = !['DRAFT', 'CANCELLED'].includes(String(invoice.status));
      const collected = invoice.payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount ?? 0)), 0);
      const responseMinutes =
        invoice.dianSentAt && invoice.dianResponseAt
          ? Math.max(
              0,
              Math.round((new Date(invoice.dianResponseAt).getTime() - new Date(invoice.dianSentAt).getTime()) / 60000),
            )
          : null;
      const quote = invoice.sourceQuoteId ? quoteMap.get(invoice.sourceQuoteId) : null;
      const seller = String(quote?.salesOwnerName ?? '').trim() || (invoice.sourceChannel === 'POS' ? 'POS / Caja' : 'Sin vendedor');
      const channel = this.normalizeInvoiceChannel(invoice.sourceChannel);
      const branchName = invoice.branch?.name ?? 'Sin sucursal';
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        total: Number(invoice.total ?? 0),
        status: String(invoice.status),
        dianStatus: invoice.dianStatus ?? null,
        dianStatusCode: invoice.dianStatusCode ?? null,
        channel,
        branchId: invoice.branchId ?? null,
        branchName,
        seller,
        customerId: invoice.customerId,
        emitted,
        collected,
        rejected: String(invoice.status) === 'REJECTED_DIAN',
        pendingDian: ['DRAFT', 'SENT_DIAN', 'ISSUED'].includes(String(invoice.status)),
        responseMinutes,
      };
    });

    const emittedDocs = normalized.filter((item) => item.emitted);
    const emittedAmount = emittedDocs.reduce((sum, item) => sum + item.total, 0);
    const collectedAmount = normalized.reduce((sum, item) => sum + item.collected, 0);
    const rejectedDocs = normalized.filter((item) => item.rejected).length;
    const pendingDianDocs = normalized.filter((item) => item.pendingDian).length;
    const acceptedDocs = normalized.filter((item) => ['ACCEPTED_DIAN', 'PAID', 'OVERDUE'].includes(item.status)).length;
    const responseTimes = normalized
      .map((item) => item.responseMinutes)
      .filter((value): value is number => value !== null);
    const avgResponseMinutes = responseTimes.length
      ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
      : 0;
    const rejectionRate = emittedDocs.length ? Number(((rejectedDocs / emittedDocs.length) * 100).toFixed(1)) : 0;
    const collectionRate = emittedAmount > 0 ? Number(((collectedAmount / emittedAmount) * 100).toFixed(1)) : 0;
    const attachmentCoverage = emittedDocs.length ? Number((((attachmentsCount > 0 ? attachmentsCount : 0) / emittedDocs.length) * 100).toFixed(1)) : 0;

    const topCodesMap = new Map<string, number>();
    for (const item of normalized) {
      const key = item.dianStatusCode || item.dianStatus || 'SIN_CODIGO';
      topCodesMap.set(key, (topCodesMap.get(key) ?? 0) + 1);
    }

    const aggregateDimension = <T extends string>(keyResolver: (item: typeof normalized[number]) => T) => {
      const map = new Map<T, { count: number; emittedAmount: number; collectedAmount: number; rejectedCount: number }>();
      for (const item of normalized) {
        const key = keyResolver(item);
        const current = map.get(key) ?? { count: 0, emittedAmount: 0, collectedAmount: 0, rejectedCount: 0 };
        current.count += 1;
        current.emittedAmount += item.total;
        current.collectedAmount += item.collected;
        current.rejectedCount += item.rejected ? 1 : 0;
        map.set(key, current);
      }
      return Array.from(map.entries())
        .map(([key, value]) => ({
          key,
          ...value,
          rejectionRate: value.count ? Number(((value.rejectedCount / value.count) * 100).toFixed(1)) : 0,
          collectionRate: value.emittedAmount > 0 ? Number(((value.collectedAmount / value.emittedAmount) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.emittedAmount - a.emittedAmount);
    };

    return {
      kpis: {
        issuedCount: emittedDocs.length,
        acceptedCount: acceptedDocs,
        rejectedCount: rejectedDocs,
        pendingDianCount: pendingDianDocs,
        emittedAmount,
        collectedAmount,
        rejectionRate,
        collectionRate,
        avgResponseMinutes,
      },
      documentControl: {
        attachmentsCount,
        pendingApprovals,
        attachmentCoverage,
      },
      dian: {
        topStatusCodes: Array.from(topCodesMap.entries())
          .map(([code, count]) => ({ code, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6),
      },
      byBranch: aggregateDimension((item) => item.branchName),
      byChannel: aggregateDimension((item) => item.channel),
      bySeller: aggregateDimension((item) => item.seller),
      latestDocuments: normalized.slice(0, 10).map((item) => ({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        issueDate: item.issueDate,
        total: item.total,
        status: item.status,
        dianStatus: item.dianStatus,
        dianStatusCode: item.dianStatusCode,
        branchName: item.branchName,
        channel: item.channel,
        seller: item.seller,
        collected: item.collected,
        responseMinutes: item.responseMinutes,
      })),
    };
  }

  async getOperationalMonitor(companyId: string, branchId?: string | null) {
    const [jobs, intakes, integrations] = await Promise.all([
      this.prisma.invoiceDianProcessingJob.findMany({
        where: {
          companyId,
          ...(branchId ? { branchId } : {}),
        },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              dianStatus: true,
              dianStatusCode: true,
              sourceChannel: true,
              branchId: true,
            },
          },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 30,
      }),
      this.prisma.invoiceExternalIntake.findMany({
        where: { companyId, ...(branchId ? { branchId } : {}) },
        include: {
          linkedInvoice: { select: { id: true, invoiceNumber: true, status: true, dianStatus: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
      }),
      this.prisma.accountingIntegration.findMany({
        where: {
          companyId,
          module: 'invoices',
          ...(branchId ? { context: { path: ['branchId'], equals: branchId } as any } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
      }),
    ]);

    return {
      queue: {
        pending: jobs.filter((job: any) => job.status === 'PENDING').length,
        failed: jobs.filter((job: any) => job.status === 'FAILED').length,
        success: jobs.filter((job: any) => job.status === 'SUCCESS').length,
        recent: jobs,
      },
      externalIntakes: {
        pending: intakes.filter((item: any) => item.status === 'PENDING').length,
        processed: intakes.filter((item: any) => item.status === 'PROCESSED').length,
        recent: intakes,
      },
      accounting: {
        recent: integrations,
      },
    };
  }

  async getExternalIntakes(companyId: string, branchId?: string | null) {
    return this.prisma.invoiceExternalIntake.findMany({
      where: {
        companyId,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        linkedInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            dianStatus: true,
          },
        },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
  }

  async createExternalIntake(
    companyId: string,
    branchId: string | null,
    dto: CreateInvoiceExternalIntakeDto,
    userId: string,
  ) {
    const created = await this.prisma.invoiceExternalIntake.create({
      data: {
        companyId,
        branchId: branchId ?? undefined,
        channel: String(dto.channel).trim().toUpperCase(),
        externalRef: dto.externalRef.trim(),
        customerPayload: dto.customerPayload ?? undefined,
        invoicePayload: dto.invoicePayload ?? undefined,
        notes: dto.notes?.trim() || undefined,
        triggeredById: userId,
        status: dto.autoProcess ? 'QUEUED' : 'PENDING',
      },
    });
    await this.logInvoiceAudit(companyId, userId, 'INVOICE_EXTERNAL_INTAKE_CREATED', created.id, null, {
      channel: created.channel,
      externalRef: created.externalRef,
      status: created.status,
    });
    if (dto.autoProcess) {
      return this.processExternalIntake(companyId, branchId, created.id, userId);
    }
    return created;
  }

  async processExternalIntake(
    companyId: string,
    branchId: string | null,
    intakeId: string,
    userId: string,
  ) {
    const intake = await this.prisma.invoiceExternalIntake.findFirst({
      where: { id: intakeId, companyId },
    });
    if (!intake) throw new NotFoundException('Intake externo no encontrado');
    if (intake.linkedInvoiceId) {
      return this.prisma.invoiceExternalIntake.findFirst({
        where: { id: intakeId, companyId },
        include: { linkedInvoice: true },
      });
    }

    const payload = (intake.invoicePayload as any) ?? {};
    const customerPayload = (intake.customerPayload as any) ?? {};
    const sourceChannel = String(payload.sourceChannel ?? intake.channel ?? 'ONLINE').trim().toUpperCase();
    const customerId = String(payload.customerId ?? customerPayload.customerId ?? '').trim();
    if (!customerId) throw new BadRequestException('El intake externo requiere customerId para convertirse en factura');
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) throw new BadRequestException('El intake externo requiere líneas para convertirse en factura');

    const invoice = await this.create(companyId, branchId, {
      customerId,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      notes: payload.notes ?? intake.notes ?? `Factura creada desde intake ${intake.externalRef}`,
      currency: payload.currency ?? 'COP',
      type: payload.type ?? 'VENTA',
      sourceChannel,
      prefix: payload.prefix,
      documentConfigId: payload.documentConfigId,
      sendToDian: false,
      items,
    } as any);

    await this.prisma.invoiceExternalIntake.update({
      where: { id: intake.id },
      data: {
        linkedInvoiceId: invoice.id,
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });

    await this.logInvoiceAudit(companyId, userId, 'INVOICE_EXTERNAL_INTAKE_PROCESSED', invoice.id, null, {
      intakeId: intake.id,
      channel: intake.channel,
      externalRef: intake.externalRef,
    });

    return this.prisma.invoiceExternalIntake.findFirst({
      where: { id: intake.id, companyId },
      include: { linkedInvoice: true, branch: true },
    });
  }

  async queueInvoiceReprocess(
    companyId: string,
    branchId: string,
    invoiceId: string,
    dto: QueueInvoiceReprocessDto,
    userId: string,
  ) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    const job = await this.createDianJob({
      companyId,
      invoiceId,
      branchId,
      actionType: dto.actionType,
      sourceChannel: invoice.sourceChannel ?? null,
      triggeredById: userId,
      payload: { notes: dto.notes ?? null },
    });
    await this.logInvoiceAudit(companyId, userId, 'INVOICE_REPROCESS_QUEUED', invoiceId, null, {
      jobId: job.id,
      actionType: dto.actionType,
    });
    return job;
  }

  async bulkReprocess(
    companyId: string,
    branchId: string,
    dto: BulkInvoiceReprocessDto,
    userId: string,
  ) {
    const invoices = dto.invoiceIds?.length
      ? await this.prisma.invoice.findMany({
          where: { id: { in: dto.invoiceIds }, companyId, branchId, deletedAt: null },
          select: { id: true, sourceChannel: true },
        })
      : await this.prisma.invoice.findMany({
          where: {
            companyId,
            branchId,
            deletedAt: null,
            ...(dto.actionType === 'SEND_DIAN'
              ? { status: { in: ['DRAFT', 'REJECTED_DIAN'] as any[] } }
              : { OR: [{ dianZipKey: { not: null } }, { dianCufe: { not: null } }] }),
          },
          select: { id: true, sourceChannel: true },
          take: 50,
        });

    const jobs = [];
    for (const invoice of invoices) {
      jobs.push(
        await this.createDianJob({
          companyId,
          invoiceId: invoice.id,
          branchId,
          actionType: dto.actionType,
          sourceChannel: invoice.sourceChannel ?? null,
          triggeredById: userId,
          payload: { bulk: true },
        }),
      );
    }
    return { queued: jobs.length, jobs };
  }

  async processQueuedOperations(companyId: string, branchId: string, userId: string) {
    const jobs = await this.prisma.invoiceDianProcessingJob.findMany({
      where: {
        companyId,
        branchId,
        status: 'PENDING',
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 20,
    });

    const results: any[] = [];
    for (const job of jobs) {
      try {
        await this.prisma.invoiceDianProcessingJob.update({
          where: { id: job.id },
          data: {
            status: 'PROCESSING',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
        let result: any;
        if (job.actionType === 'SEND_DIAN') {
          result = await this.sendToDian(companyId, job.sourceChannel ?? 'DIRECT', job.invoiceId!, {
            skipJobRegistration: true,
          });
          await this.completeDianJob(job.id, {
            status: 'SUCCESS',
            responseCode: result?.dianStatusCode ?? null,
            responseMessage: result?.dianStatusMsg ?? 'Envío ejecutado',
            result: { invoiceId: job.invoiceId, status: result?.status, dianStatus: result?.dianStatus },
          });
        } else {
          result = await this.queryDianStatus(companyId, job.invoiceId!, { skipJobRegistration: true });
          await this.completeDianJob(job.id, {
            status: 'SUCCESS',
            responseCode: result?.dianStatusCode ?? null,
            responseMessage: result?.dianStatusMsg ?? 'Consulta ejecutada',
            result: { invoiceId: job.invoiceId, status: result?.status, dianStatus: result?.dianStatus },
          });
        }
        results.push({ jobId: job.id, status: 'SUCCESS', invoiceId: job.invoiceId });
      } catch (error: any) {
        await this.completeDianJob(job.id, {
          status: 'FAILED',
          responseMessage: error?.message ?? 'No fue posible procesar el reproceso',
        });
        results.push({ jobId: job.id, status: 'FAILED', message: error?.message ?? 'Error' });
      }
    }

    await this.logInvoiceAudit(companyId, userId, 'INVOICE_QUEUE_PROCESSED', branchId, null, {
      jobs: results.length,
      results,
    });

    return {
      processed: results.length,
      results,
    };
  }

  async getFiscalSummaryReport(
    companyId: string,
    branchId: string | null,
    filters: { dateFrom: string; dateTo: string },
  ) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new BadRequestException('Debes indicar dateFrom y dateTo para el resumen fiscal');
    }
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      deletedAt: null,
      branchId: branchId ?? undefined,
      issueDate: { gte: new Date(filters.dateFrom), lte: new Date(filters.dateTo) },
      status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] as any },
    };
    const [aggregate, byType, byValidation] = await Promise.all([
      this.prisma.invoice.aggregate({
        where,
        _count: { id: true },
        _sum: {
          subtotal: true,
          taxAmount: true,
          withholdingAmount: true,
          icaAmount: true,
          total: true,
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['type'],
        where,
        _count: { id: true },
        _sum: { subtotal: true, taxAmount: true, withholdingAmount: true, icaAmount: true, total: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['fiscalValidationStatus'],
        where,
        _count: { id: true },
      }),
    ]);

    return {
      summary: {
        count: aggregate._count.id,
        taxableBase: Number(aggregate._sum.subtotal ?? 0),
        iva: Number(aggregate._sum.taxAmount ?? 0),
        retefuente: Number(aggregate._sum.withholdingAmount ?? 0),
        ica: Number(aggregate._sum.icaAmount ?? 0),
        total: Number(aggregate._sum.total ?? 0),
      },
      byType: byType.map((row) => ({
        type: row.type,
        count: row._count.id,
        taxableBase: Number(row._sum.subtotal ?? 0),
        iva: Number(row._sum.taxAmount ?? 0),
        retefuente: Number(row._sum.withholdingAmount ?? 0),
        ica: Number(row._sum.icaAmount ?? 0),
        total: Number(row._sum.total ?? 0),
      })),
      byValidation: byValidation.map((row) => ({
        status: row.fiscalValidationStatus,
        count: row._count.id,
      })),
    };
  }

  async getVatSalesBookReport(
    companyId: string,
    branchId: string | null,
    filters: { dateFrom: string; dateTo: string },
  ) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new BadRequestException('Debes indicar dateFrom y dateTo para el libro de IVA');
    }
    const rows = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        issueDate: { gte: new Date(filters.dateFrom), lte: new Date(filters.dateTo) },
        status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] as any },
      },
      select: {
        id: true,
        invoiceNumber: true,
        prefix: true,
        issueDate: true,
        type: true,
        subtotal: true,
        taxAmount: true,
        total: true,
        sourceChannel: true,
        customer: {
          select: {
            id: true,
            name: true,
            documentNumber: true,
            documentType: true,
          },
        },
      },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      prefix: row.prefix,
      issueDate: row.issueDate,
      type: row.type,
      sourceChannel: row.sourceChannel,
      customerName: row.customer.name,
      customerDocument: row.customer.documentNumber,
      customerDocumentType: row.customer.documentType,
      taxableBase: Number(row.subtotal ?? 0),
      iva: Number(row.taxAmount ?? 0),
      total: Number(row.total ?? 0),
    }));
  }

  async getWithholdingsBookReport(
    companyId: string,
    branchId: string | null,
    filters: { dateFrom: string; dateTo: string },
  ) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new BadRequestException('Debes indicar dateFrom y dateTo para el libro de retenciones');
    }
    const rows = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        issueDate: { gte: new Date(filters.dateFrom), lte: new Date(filters.dateTo) },
        status: { notIn: ['CANCELLED', 'REJECTED_DIAN'] as any },
        OR: [
          { withholdingAmount: { gt: 0 } },
          { icaAmount: { gt: 0 } },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        prefix: true,
        issueDate: true,
        type: true,
        subtotal: true,
        withholdingAmount: true,
        icaAmount: true,
        total: true,
        customer: {
          select: {
            name: true,
            documentNumber: true,
          },
        },
      },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      prefix: row.prefix,
      issueDate: row.issueDate,
      type: row.type,
      customerName: row.customer.name,
      customerDocument: row.customer.documentNumber,
      taxableBase: Number(row.subtotal ?? 0),
      retefuente: Number(row.withholdingAmount ?? 0),
      ica: Number(row.icaAmount ?? 0),
      total: Number(row.total ?? 0),
    }));
  }

  async getDianValidationReport(
    companyId: string,
    branchId: string | null,
    filters: { dateFrom: string; dateTo: string },
  ) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new BadRequestException('Debes indicar dateFrom y dateTo para el reporte de validación fiscal');
    }
    const rows = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        issueDate: { gte: new Date(filters.dateFrom), lte: new Date(filters.dateTo) },
      },
      select: {
        id: true,
        invoiceNumber: true,
        prefix: true,
        issueDate: true,
        type: true,
        status: true,
        sourceChannel: true,
        dianStatus: true,
        dianStatusCode: true,
        fiscalValidationStatus: true,
        fiscalValidationNotes: true,
        customer: {
          select: {
            name: true,
            documentNumber: true,
          },
        },
      },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      prefix: row.prefix,
      issueDate: row.issueDate,
      type: row.type,
      status: row.status,
      sourceChannel: row.sourceChannel,
      dianStatus: row.dianStatus,
      dianStatusCode: row.dianStatusCode,
      fiscalValidationStatus: row.fiscalValidationStatus,
      fiscalValidationNotes: row.fiscalValidationNotes,
      customerName: row.customer.name,
      customerDocument: row.customer.documentNumber,
    }));
  }

  async getSalesOrders(companyId: string, branchId?: string | null) {
    return this.prisma.$queryRawUnsafe(
      `
        SELECT
          so."id",
          so."number",
          so."status",
          so."issueDate",
          so."requestedDate",
          so."total",
          so."currency",
          so."quoteId",
          so."posSaleId",
          c."name" AS "customerName",
          COUNT(soi."id")::int AS "itemsCount"
        FROM "sales_orders" so
        INNER JOIN "customers" c ON c."id" = so."customerId"
        LEFT JOIN "sales_order_items" soi ON soi."orderId" = so."id"
        WHERE so."companyId" = $1
          AND so."deletedAt" IS NULL
          ${branchId ? 'AND so."branchId" = $2' : ''}
        GROUP BY so."id", c."name"
        ORDER BY so."createdAt" DESC
        LIMIT 50
      `,
      ...(branchId ? [companyId, branchId] : [companyId]),
    );
  }

  async getDeliveryNotes(companyId: string, branchId?: string | null) {
    return this.prisma.$queryRawUnsafe(
      `
        SELECT
          dn."id",
          dn."number",
          dn."status",
          dn."inventoryStatus",
          dn."issueDate",
          dn."salesOrderId",
          dn."posSaleId",
          c."name" AS "customerName",
          COUNT(dni."id")::int AS "itemsCount",
          COALESCE(SUM(dni."total"), 0) AS "total"
        FROM "delivery_notes" dn
        INNER JOIN "customers" c ON c."id" = dn."customerId"
        LEFT JOIN "delivery_note_items" dni ON dni."deliveryNoteId" = dn."id"
        WHERE dn."companyId" = $1
          AND dn."deletedAt" IS NULL
          ${branchId ? 'AND dn."branchId" = $2' : ''}
        GROUP BY dn."id", c."name"
        ORDER BY dn."createdAt" DESC
        LIMIT 50
      `,
      ...(branchId ? [companyId, branchId] : [companyId]),
    );
  }

  async createSalesOrder(companyId: string, branchId: string | null, dto: CreateSalesOrderDto) {
    const source = await this.resolveCommercialSource(companyId, branchId, {
      customerId: dto.customerId,
      quoteId: dto.quoteId,
      posSaleId: dto.posSaleId,
      items: dto.items,
    });
    const items = source.items;
    if (!items.length) throw new BadRequestException('El pedido debe tener al menos una línea');
    const number = await this.getNextCommercialNumber('sales_orders', companyId, 'PED');
    const totals = this.calculateCommercialTotals(items);
    const normalizedItems = totals.items;
    const orderId = randomUUID();
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const requestedDate = dto.requestedDate ? new Date(dto.requestedDate) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "sales_orders"
          ("id","companyId","branchId","customerId","quoteId","posSaleId","number","status","issueDate","requestedDate","subtotal","taxAmount","discountAmount","total","currency","notes","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
        orderId,
        companyId,
        branchId,
        source.customerId,
        dto.quoteId ?? null,
        dto.posSaleId ?? null,
        number,
        issueDate,
        requestedDate,
        totals.subtotal,
        totals.taxAmount,
        totals.discountAmount,
        totals.total,
        dto.currency ?? source.currency ?? 'COP',
        dto.notes ?? source.notes ?? null,
      );

      for (let index = 0; index < normalizedItems.length; index += 1) {
        const item = normalizedItems[index] as any;
        await tx.$executeRawUnsafe(
          `INSERT INTO "sales_order_items"
            ("id","orderId","productId","sourceQuoteItemId","sourcePosSaleItemId","description","orderedQuantity","unitPrice","taxRate","discount","total","position")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          randomUUID(),
          orderId,
          item.productId ?? null,
          item.quoteItemId ?? null,
          item.posSaleItemId ?? null,
          item.description,
          item.quantity,
          item.unitPrice,
          item.taxRate ?? 19,
          item.discount ?? 0,
          item.total,
          index + 1,
        );
      }
    });

    return {
      id: orderId,
      number,
      status: 'OPEN',
      customerId: source.customerId,
      quoteId: dto.quoteId ?? null,
      posSaleId: dto.posSaleId ?? null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      total: totals.total,
      currency: dto.currency ?? source.currency ?? 'COP',
      itemsCount: normalizedItems.length,
    };
  }

  async createDeliveryNote(companyId: string, branchId: string | null, dto: CreateDeliveryNoteDto) {
    const source = await this.resolveDeliverySource(companyId, dto);
    if (!source.items.length) throw new BadRequestException('La remisión no tiene líneas pendientes');
    if (!source.inventoryManagedExternally) {
      await this.validateInventoryAvailability(
        companyId,
        source.items.map((item: any) => ({
          productId: item.productId ?? null,
          quantity: Number(item.quantity),
          description: item.description,
        })),
        'remisionar',
      );
    }
    const noteId = randomUUID();
    const number = await this.getNextCommercialNumber('delivery_notes', companyId, 'REM');
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "delivery_notes"
          ("id","companyId","branchId","customerId","salesOrderId","posSaleId","number","status","inventoryStatus","inventoryAppliedAt","issueDate","notes","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$10,$11,NOW(),NOW())`,
        noteId,
        companyId,
        branchId,
        source.customerId,
        dto.salesOrderId ?? null,
        dto.posSaleId ?? null,
        number,
        source.inventoryManagedExternally ? 'EXTERNAL' : 'POSTED',
        source.inventoryManagedExternally ? null : new Date(),
        issueDate,
        dto.notes ?? null,
      );

      for (let index = 0; index < source.items.length; index += 1) {
        const item = source.items[index] as any;
        await tx.$executeRawUnsafe(
          `INSERT INTO "delivery_note_items"
            ("id","deliveryNoteId","salesOrderItemId","productId","description","quantity","unitPrice","taxRate","discount","total","position")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          randomUUID(),
          noteId,
          item.salesOrderItemId ?? null,
          item.productId ?? null,
          item.description,
          item.quantity,
          item.unitPrice,
          item.taxRate ?? 19,
          item.discount ?? 0,
          item.total,
          index + 1,
        );

        if (item.salesOrderItemId) {
          await tx.$executeRawUnsafe(
            `UPDATE "sales_order_items"
             SET "deliveredQuantity" = COALESCE("deliveredQuantity", 0) + $2
             WHERE "id" = $1`,
            item.salesOrderItemId,
            item.quantity,
          );
        }
      }

      if (!source.inventoryManagedExternally) {
        await this.applyInventoryMovements(tx, {
          companyId,
          branchId,
          deliveryNoteId: noteId,
          movementType: 'DELIVERY_OUT',
          direction: 'OUT',
          notes: `Salida por remisión ${number}`,
          items: source.items.map((item: any) => ({
            productId: item.productId ?? null,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice ?? 0),
          })),
        });
      }
    });

    return {
      id: noteId,
      number,
      status: 'POSTED',
      customerId: source.customerId,
      salesOrderId: dto.salesOrderId ?? null,
      posSaleId: dto.posSaleId ?? null,
      itemsCount: source.items.length,
    };
  }

  async createInvoiceFromSource(companyId: string, branchId: string | null, dto: CreateSourceInvoiceDto) {
    const source = await this.resolveInvoiceSource(companyId, branchId, dto);
    if (!source.items.length) throw new BadRequestException('No hay líneas disponibles para facturar');
    if (source.inventoryAction === 'ON_INVOICE') {
      await this.validateInventoryAvailability(
        companyId,
        source.items.map((item: any) => ({
          productId: item.productId ?? null,
          quantity: Number(item.quantity),
          description: item.description,
        })),
        'facturar desde origen',
      );
    }

    const invoice = await this.create(companyId, branchId, {
      customerId: source.customerId,
      type: 'VENTA' as any,
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      notes: source.notes,
      currency: dto.currency ?? source.currency ?? 'COP',
      sourceChannel: source.sourceChannel,
      sourceTerminalId: source.sourceTerminalId,
      inventoryMode: 'DEFER',
      items: source.items.map((item: any, index: number) => ({
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 19,
        discount: item.discount ?? 0,
        position: index + 1,
      })),
    } as any);

    const appliedAdvanceAmount = dto.applyAdvance ? Number(source.appliedAdvanceAmount ?? 0) : 0;
    const billingMode = source.billingMode;

    await this.prisma.$transaction(async (tx) => {
      let appliedInventoryAt: Date | null = null;
      let inventoryStatus = source.inventoryAction === 'ON_INVOICE' ? 'PENDING' : source.inventoryManagedExternally ? 'EXTERNAL' : 'DELIVERED';
      let deliveryStatus = source.deliveryStatus ?? (source.inventoryAction === 'NONE' ? 'DELIVERED' : 'PENDING');

      await tx.$executeRawUnsafe(
        `UPDATE "invoices"
         SET "salesOrderId" = $2,
             "deliveryNoteId" = $3,
             "sourceQuoteId" = $4,
             "sourcePosSaleId" = $5,
             "billingMode" = $6,
             "appliedAdvanceAmount" = $7,
             "notes" = $8,
             "inventoryStatus" = $9,
             "inventoryAppliedAt" = $10,
             "deliveryStatus" = $11
         WHERE "id" = $1`,
        invoice.id,
        dto.salesOrderId ?? null,
        dto.deliveryNoteId ?? null,
        dto.quoteId ?? null,
        source.sourcePosSaleId ?? dto.posSaleId ?? null,
        billingMode,
        appliedAdvanceAmount,
        source.notes,
        inventoryStatus,
        appliedInventoryAt,
        deliveryStatus,
      );

      const createdItems = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "invoice_items" WHERE "invoiceId" = $1 ORDER BY "position" ASC`,
        invoice.id,
      );

      for (let index = 0; index < source.items.length; index += 1) {
        const sourceItem = source.items[index] as any;
        const createdItem = createdItems[index];
        if (!createdItem) continue;

        await tx.$executeRawUnsafe(
          `UPDATE "invoice_items"
           SET "salesOrderItemId" = $2,
               "deliveryNoteItemId" = $3,
               "sourceQuoteItemId" = $4,
               "sourcePosSaleItemId" = $5,
               "sourceQuantity" = $6
           WHERE "id" = $1`,
          createdItem.id,
          sourceItem.salesOrderItemId ?? null,
          sourceItem.deliveryNoteItemId ?? null,
          sourceItem.quoteItemId ?? null,
          sourceItem.posSaleItemId ?? null,
          sourceItem.quantity,
        );

        if (sourceItem.salesOrderItemId) {
          await tx.$executeRawUnsafe(
            `UPDATE "sales_order_items"
             SET "invoicedQuantity" = COALESCE("invoicedQuantity", 0) + $2
             WHERE "id" = $1`,
            sourceItem.salesOrderItemId,
            sourceItem.quantity,
          );
        }
        if (sourceItem.deliveryNoteItemId) {
          await tx.$executeRawUnsafe(
            `UPDATE "delivery_note_items"
             SET "invoicedQuantity" = COALESCE("invoicedQuantity", 0) + $2
             WHERE "id" = $1`,
            sourceItem.deliveryNoteItemId,
            sourceItem.quantity,
          );
        }
      }

      if (source.inventoryAction === 'ON_INVOICE') {
        const applied = await this.applyInventoryMovements(tx, {
          companyId,
          branchId,
          invoiceId: invoice.id,
          movementType: 'INVOICE_OUT',
          direction: 'OUT',
          notes: `Salida por factura ${invoice.invoiceNumber}`,
          items: source.items.map((item: any) => ({
            productId: item.productId ?? null,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice ?? 0),
          })),
        });
        if (applied > 0) {
          inventoryStatus = 'POSTED';
          appliedInventoryAt = new Date();
          deliveryStatus = 'DELIVERED';
          await tx.$executeRawUnsafe(
            `UPDATE "invoices"
             SET "inventoryStatus" = $2,
                 "inventoryAppliedAt" = $3,
                 "deliveryStatus" = $4
             WHERE "id" = $1`,
            invoice.id,
            inventoryStatus,
            appliedInventoryAt,
            deliveryStatus,
          );
        }
      }

      if (dto.quoteId && billingMode === 'FULL') {
        await tx.quote.updateMany({
          where: { id: dto.quoteId, companyId, invoiceId: null },
          data: { invoiceId: invoice.id, status: 'CONVERTED' as any },
        });
      }
      if (dto.posSaleId) {
        await tx.posSale.updateMany({
          where: { id: dto.posSaleId, companyId, invoiceId: null },
          data: { invoiceId: invoice.id },
        });
      }
    });

    return {
      ...invoice,
      salesOrderId: dto.salesOrderId ?? null,
      deliveryNoteId: dto.deliveryNoteId ?? null,
      sourceQuoteId: dto.quoteId ?? null,
      sourcePosSaleId: source.sourcePosSaleId ?? dto.posSaleId ?? null,
      billingMode,
      appliedAdvanceAmount,
    };
  }

  private calculateCommercialTotals(items: any[]) {
    let subtotal = 0;
    let taxAmount = 0;
    let discountAmount = 0;
    const normalizedItems = items.map((item) => {
      const lineSubtotal = Number(item.quantity) * Number(item.unitPrice);
      const lineDiscount = lineSubtotal * (Number(item.discount ?? 0) / 100);
      const taxable = lineSubtotal - lineDiscount;
      const lineTax = taxable * (Number(item.taxRate ?? 19) / 100);
      const lineTotal = taxable + lineTax;
      subtotal += taxable;
      taxAmount += lineTax;
      discountAmount += lineDiscount;
      return { ...item, taxRate: Number(item.taxRate ?? 19), discount: Number(item.discount ?? 0), total: lineTotal };
    });
    return {
      items: normalizedItems,
      subtotal,
      taxAmount,
      discountAmount,
      total: subtotal + taxAmount,
    };
  }

  private async getNextCommercialNumber(table: 'sales_orders' | 'delivery_notes', companyId: string, prefix: string) {
    const last = await this.prisma.$queryRawUnsafe<Array<{ number: string }>>(
      `SELECT "number" FROM "${table}" WHERE "companyId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      companyId,
    );
    if (!last[0]?.number) return `${prefix}-0001`;
    const num = parseInt(String(last[0].number).split('-').pop() ?? '0', 10) + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
  }

  private async resolveCommercialSource(companyId: string, branchId: string | null, dto: {
    customerId?: string;
    quoteId?: string;
    posSaleId?: string;
    items?: any[];
  }) {
    if (dto.quoteId) {
      const quote = await this.prisma.quote.findFirst({
        where: { id: dto.quoteId, companyId, deletedAt: null },
        include: { items: true, customer: true },
      });
      if (!quote) throw new NotFoundException('Cotización no encontrada');
      return {
        customerId: quote.customerId,
        currency: quote.currency,
        notes: `Pedido generado desde cotización ${quote.number}`,
        items: (dto.items?.length ? dto.items : quote.items).map((item: any) => ({
          productId: item.productId ?? null,
          quoteItemId: item.id ?? null,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxRate: Number(item.taxRate ?? 19),
          discount: Number(item.discount ?? 0),
        })),
      };
    }

    if (dto.posSaleId) {
      const sale = await this.prisma.posSale.findFirst({
        where: { id: dto.posSaleId, companyId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundException('Venta POS no encontrada');
      return {
        customerId: sale.customerId,
        currency: 'COP',
        notes: `Pedido generado desde POS ${sale.saleNumber}`,
        items: (dto.items?.length ? dto.items : sale.items).map((item: any) => ({
          productId: item.productId ?? null,
          posSaleItemId: item.id ?? null,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          taxRate: Number(item.taxRate ?? 19),
          discount: Number(item.discount ?? 0),
        })),
      };
    }

    if (!dto.customerId) throw new BadRequestException('Debes indicar cliente, cotización o venta POS');
    if (!dto.items?.length) throw new BadRequestException('Debes indicar líneas para crear el pedido');
    return {
      customerId: dto.customerId,
      currency: 'COP',
      notes: null,
      items: dto.items,
    };
  }

  private async resolveDeliverySource(companyId: string, dto: CreateDeliveryNoteDto) {
    if (dto.salesOrderId) {
      const order = await this.prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "customerId","posSaleId" FROM "sales_orders" WHERE "id" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        dto.salesOrderId,
        companyId,
      );
      if (!order[0]) throw new NotFoundException('Pedido comercial no encontrado');
      const rawItems = dto.items?.length
        ? dto.items
        : await this.prisma.$queryRawUnsafe<Array<any>>(
            `SELECT
              soi."id" AS "salesOrderItemId",
              soi."productId",
              soi."description",
              (soi."orderedQuantity" - COALESCE(soi."deliveredQuantity", 0)) AS "quantity",
              soi."unitPrice",
              soi."taxRate",
              soi."discount",
              soi."total"
             FROM "sales_order_items" soi
             WHERE soi."orderId" = $1
               AND (soi."orderedQuantity" - COALESCE(soi."deliveredQuantity", 0)) > 0`,
            dto.salesOrderId,
          );
      const normalized = this.calculateCommercialTotals(rawItems.filter((item: any) => Number(item.quantity) > 0));
      return {
        customerId: order[0].customerId,
        items: normalized.items,
        inventoryManagedExternally: !!order[0].posSaleId,
      };
    }

    if (dto.posSaleId) {
      const sale = await this.prisma.posSale.findFirst({
        where: { id: dto.posSaleId, companyId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundException('Venta POS no encontrada');
      const normalized = this.calculateCommercialTotals((dto.items?.length ? dto.items : sale.items).map((item: any) => ({
        productId: item.productId ?? null,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate ?? 19),
        discount: Number(item.discount ?? 0),
        total: Number(item.total ?? 0),
      })));
      return {
        customerId: sale.customerId,
        items: normalized.items,
        inventoryManagedExternally: true,
      };
    }

    throw new BadRequestException('Debes indicar un pedido comercial o una venta POS para generar la remisión');
  }

  private async resolveInvoiceSource(companyId: string, branchId: string | null, dto: CreateSourceInvoiceDto) {
    if (dto.deliveryNoteId) {
      const note = await this.prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "customerId","posSaleId","number","inventoryStatus" FROM "delivery_notes" WHERE "id" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        dto.deliveryNoteId,
        companyId,
      );
      if (!note[0]) throw new NotFoundException('Remisión no encontrada');
      const items = dto.items?.length
        ? dto.items
        : await this.prisma.$queryRawUnsafe<Array<any>>(
            `SELECT
              dni."id" AS "deliveryNoteItemId",
              dni."salesOrderItemId",
              dni."productId",
              dni."description",
              (dni."quantity" - COALESCE(dni."invoicedQuantity", 0)) AS "quantity",
              dni."unitPrice",
              dni."taxRate",
              dni."discount"
             FROM "delivery_note_items" dni
             WHERE dni."deliveryNoteId" = $1
               AND (dni."quantity" - COALESCE(dni."invoicedQuantity", 0)) > 0`,
            dto.deliveryNoteId,
          );
      return {
        customerId: note[0].customerId,
        currency: dto.currency ?? 'COP',
        sourceChannel: note[0].posSaleId ? 'POS' : 'DIRECT',
        sourceTerminalId: undefined,
        sourcePosSaleId: note[0].posSaleId ?? null,
        appliedAdvanceAmount: 0,
        billingMode: 'PARTIAL',
        inventoryAction: 'NONE',
        inventoryManagedExternally: !!note[0].posSaleId,
        deliveryStatus: 'DELIVERED',
        notes: dto.notes || `Factura generada desde remisión`,
        items: items.filter((item: any) => Number(item.quantity) > 0),
      };
    }

    if (dto.salesOrderId) {
      const order = await this.prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "customerId","quoteId","posSaleId","currency","number" FROM "sales_orders" WHERE "id" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        dto.salesOrderId,
        companyId,
      );
      if (!order[0]) throw new NotFoundException('Pedido comercial no encontrado');
      const items = dto.items?.length
        ? dto.items
        : await this.prisma.$queryRawUnsafe<Array<any>>(
            `SELECT
              soi."id" AS "salesOrderItemId",
              soi."productId",
              soi."description",
              (soi."orderedQuantity" - COALESCE(soi."invoicedQuantity", 0)) AS "quantity",
              soi."unitPrice",
              soi."taxRate",
              soi."discount"
             FROM "sales_order_items" soi
             WHERE soi."orderId" = $1
               AND (soi."orderedQuantity" - COALESCE(soi."invoicedQuantity", 0)) > 0`,
            dto.salesOrderId,
          );
      const totals = this.calculateCommercialTotals(items);
      return {
        customerId: order[0].customerId,
        currency: order[0].currency ?? 'COP',
        sourceChannel: order[0].posSaleId ? 'POS' : 'DIRECT',
        sourceTerminalId: undefined,
        sourcePosSaleId: order[0].posSaleId ?? null,
        appliedAdvanceAmount: 0,
        billingMode: items.some((item: any) => Number(item.quantity) <= 0) ? 'PARTIAL' : 'FULL',
        inventoryAction: order[0].posSaleId ? 'NONE' : 'ON_INVOICE',
        inventoryManagedExternally: !!order[0].posSaleId,
        deliveryStatus: order[0].posSaleId ? 'EXTERNAL' : 'PENDING',
        notes: dto.notes || `Factura generada desde pedido ${order[0].number}`,
        items: totals.items,
      };
    }

    if (dto.quoteId) {
      const quote = await this.prisma.quote.findFirst({
        where: { id: dto.quoteId, companyId, deletedAt: null },
        include: { items: true },
      });
      if (!quote) throw new NotFoundException('Cotización no encontrada');
      const items = (dto.items?.length ? dto.items : quote.items).map((item: any) => ({
        productId: item.productId ?? null,
        quoteItemId: item.id ?? null,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate ?? 19),
        discount: Number(item.discount ?? 0),
      }));
      const totals = this.calculateCommercialTotals(items);
      const fullQuoted = quote.items.reduce((sum, item) => sum + Number(item.quantity), 0);
      const requested = items.reduce((sum, item) => sum + Number(item.quantity), 0);
      return {
        customerId: quote.customerId,
        currency: quote.currency ?? 'COP',
        sourceChannel: 'DIRECT',
        sourceTerminalId: undefined,
        sourcePosSaleId: null,
        appliedAdvanceAmount: 0,
        billingMode: requested < fullQuoted ? 'PARTIAL' : 'FULL',
        inventoryAction: 'ON_INVOICE',
        inventoryManagedExternally: false,
        deliveryStatus: 'PENDING',
        notes: dto.notes || `Factura generada desde cotización ${quote.number}`,
        items: totals.items,
      };
    }

    if (dto.posSaleId) {
      const sale = await this.prisma.posSale.findFirst({
        where: { id: dto.posSaleId, companyId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundException('Venta POS no encontrada');
      const items = (dto.items?.length ? dto.items : sale.items).map((item: any) => ({
        productId: item.productId ?? null,
        posSaleItemId: item.id ?? null,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate ?? 19),
        discount: Number(item.discount ?? 0),
      }));
      const totals = this.calculateCommercialTotals(items);
      const appliedAdvanceAmount = dto.applyAdvance
        ? Math.min(Number(sale.advanceAmount ?? 0), Number(sale.amountPaid ?? 0), totals.total)
        : 0;
      return {
        customerId: sale.customerId,
        currency: 'COP',
        sourceChannel: 'POS',
        sourceTerminalId: sale.sessionId ? undefined : undefined,
        sourcePosSaleId: sale.id,
        appliedAdvanceAmount,
        billingMode: appliedAdvanceAmount > 0 ? 'ADVANCE_SETTLEMENT' : 'FULL',
        inventoryAction: 'NONE',
        inventoryManagedExternally: true,
        deliveryStatus: 'EXTERNAL',
        notes: dto.notes || `Factura generada desde POS ${sale.saleNumber}${appliedAdvanceAmount > 0 ? ` aplicando anticipo por ${appliedAdvanceAmount}` : ''}`,
        items: totals.items,
      };
    }

    throw new BadRequestException('Debes indicar un origen comercial válido para facturar');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIAN INTEGRATION — sendToDian (replaces the mock)
  // ══════════════════════════════════════════════════════════════════════════

  async sendToDian(
    companyId: string,
    source: string,
    invoiceId: string,
    options?: {
      skipJobRegistration?: boolean;
      triggeredById?: string | null;
      branchId?: string | null;
    },
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: true,
        company: true,
        documentConfig: true,
        items: {
          include: { product: { select: { id: true, sku: true, unit: true, unspscCode: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('Solo se pueden enviar facturas en estado DRAFT');
    const approvedRequest = await this.ensureActionApprovalState(companyId, invoiceId, 'ISSUE');
    const branchId = options?.branchId ?? invoice.branchId ?? null;
    const dianJob = options?.skipJobRegistration
      ? null
      : await this.createDianJob({
          companyId,
          invoiceId,
          branchId,
          actionType: 'SEND_DIAN',
          sourceChannel: invoice.sourceChannel ?? source ?? null,
          triggeredById: options?.triggeredById ?? null,
          payload: {
            mode: 'direct',
          },
          status: 'PROCESSING',
        });

    const inv = invoice as any;
    const company = inv.company;
    const customer = inv.customer;
    const items = inv.items;
    const sourceChannel = this.normalizeInvoiceChannel(inv.sourceChannel || source || 'DIRECT');
    let documentConfig = inv.documentConfig as any;

    if (!documentConfig?.resolutionNumber) {
      const resolvedConfig = await this.resolveInvoiceDocumentConfig({
        companyId,
        branchId,
        type: invoice.type,
        documentConfigId: invoice.documentConfigId ?? null,
        sourceChannel,
        sourceTerminalId: invoice.sourceTerminalId ?? null,
        preferredPrefix: invoice.prefix ?? null,
      });

      if (resolvedConfig) {
        documentConfig = resolvedConfig;
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            documentConfigId: resolvedConfig.id ?? invoice.documentConfigId ?? null,
            prefix: invoice.prefix ?? resolvedConfig.prefix ?? null,
            resolutionNumber: invoice.resolutionNumber ?? resolvedConfig.resolutionNumber ?? null,
            resolutionLabel: invoice.resolutionLabel ?? resolvedConfig.resolutionLabel ?? null,
            numberingRangeFrom: invoice.numberingRangeFrom ?? resolvedConfig.rangeFrom ?? null,
            numberingRangeTo: invoice.numberingRangeTo ?? resolvedConfig.rangeTo ?? null,
            resolutionValidFrom: invoice.resolutionValidFrom ?? resolvedConfig.validFrom ?? null,
            resolutionValidTo: invoice.resolutionValidTo ?? resolvedConfig.validTo ?? null,
            fiscalRulesSnapshot:
              invoice.fiscalRulesSnapshot ??
              resolvedConfig.fiscalRules ??
              undefined,
          },
        });

        (invoice as any).documentConfigId = resolvedConfig.id ?? invoice.documentConfigId ?? null;
        (invoice as any).prefix = invoice.prefix ?? resolvedConfig.prefix ?? null;
        (invoice as any).resolutionNumber =
          invoice.resolutionNumber ?? resolvedConfig.resolutionNumber ?? null;
        (invoice as any).resolutionLabel =
          invoice.resolutionLabel ?? resolvedConfig.resolutionLabel ?? null;
        (invoice as any).numberingRangeFrom =
          invoice.numberingRangeFrom ?? resolvedConfig.rangeFrom ?? null;
        (invoice as any).numberingRangeTo =
          invoice.numberingRangeTo ?? resolvedConfig.rangeTo ?? null;
        (invoice as any).resolutionValidFrom =
          invoice.resolutionValidFrom ?? resolvedConfig.validFrom ?? null;
        (invoice as any).resolutionValidTo =
          invoice.resolutionValidTo ?? resolvedConfig.validTo ?? null;
        (invoice as any).fiscalRulesSnapshot =
          invoice.fiscalRulesSnapshot ?? resolvedConfig.fiscalRules ?? null;
      }
    }

    const isPos = sourceChannel === 'POS';
    const fiscalValidation = this.buildFiscalValidationResult({
      customer,
      issueDate: invoice.issueDate,
      invoiceType: invoice.type,
      subtotal: Number(invoice.subtotal ?? 0),
      taxAmount: Number(invoice.taxAmount ?? 0),
      withholdingAmount: Number((invoice as any).withholdingAmount ?? 0),
      icaAmount: Number((invoice as any).icaAmount ?? 0),
      sourceChannel,
      documentConfig,
    });
    if (
      fiscalValidation.status !== invoice.fiscalValidationStatus ||
      fiscalValidation.notes !== invoice.fiscalValidationNotes
    ) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          fiscalValidationStatus: fiscalValidation.status,
          fiscalValidationNotes: fiscalValidation.notes,
        },
      });
      (invoice as any).fiscalValidationStatus = fiscalValidation.status;
      (invoice as any).fiscalValidationNotes = fiscalValidation.notes;
    }
    if (fiscalValidation.status === 'REVIEW_REQUIRED') {
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: 'FAILED',
          responseCode: 'FISCAL_REVIEW_REQUIRED',
          responseMessage: fiscalValidation.notes ?? 'Validación fiscal previa pendiente',
          result: { invoiceId, fiscalValidationStatus: fiscalValidation.status },
        });
      }
      throw new BadRequestException(
        `La factura no supera la validación fiscal previa para DIAN: ${fiscalValidation.notes}`,
      );
    }

    // ── Determine environment ─────────────────────────────────────────────
    const isTestMode = company.dianTestMode !== false;

    if (!isTestMode) {
      const productionConfigIssues: string[] = [];
      if (!documentConfig?.id) {
        productionConfigIssues.push('La factura no tiene una configuración documental activa asociada');
      }
      if (!documentConfig?.resolutionNumber) {
        productionConfigIssues.push('La configuración documental no tiene resolución DIAN');
      }
      if (!documentConfig?.prefix) {
        productionConfigIssues.push('La configuración documental no tiene prefijo');
      }
      if (!documentConfig?.technicalKey) {
        productionConfigIssues.push('La configuración documental no tiene clave técnica');
      }
      if (productionConfigIssues.length > 0) {
        const productionConfigMessage =
          `No se puede emitir en producción: ${productionConfigIssues.join('. ')}. ` +
          `Configura una resolución documental activa para este canal antes de enviar a DIAN.`;
        if (dianJob) {
          await this.completeDianJob(dianJob.id, {
            status: 'FAILED',
            responseCode: 'MISSING_PRODUCTION_DOCUMENT_CONFIG',
            responseMessage: productionConfigMessage,
            result: { invoiceId, sourceChannel, documentConfigId: documentConfig?.id ?? null },
          });
        }
        throw new BadRequestException(productionConfigMessage);
      }
    }

    const softwareId = company.dianSoftwareId || DIAN_SOFTWARE_ID;
    const softwarePin = company.dianSoftwarePin || DIAN_SOFTWARE_PIN;
    const testSetId = company.dianTestSetId || DIAN_TEST_SET_ID;
    // Determinar fuente de claveTecnica (para logging de diagnóstico FAD06)
    const rawClaveTecnica =
      documentConfig?.technicalKey ||
      (inv.fiscalRulesSnapshot as any)?.technicalKey ||
      company.dianClaveTecnica ||
      DIAN_TECH_KEY_HAB;
    const claveTecnicaSource =
      documentConfig?.technicalKey ? 'documentConfig.technicalKey' :
      (inv.fiscalRulesSnapshot as any)?.technicalKey ? 'fiscalRulesSnapshot.technicalKey' :
      company.dianClaveTecnica ? 'company.dianClaveTecnica' : 'DIAN_TECH_KEY_HAB (fallback)';
    // Limpiar TODOS los caracteres de espacio/control: espacios, tabs, newlines, no-break-spaces, etc.
    // Las claves técnicas DIAN son siempre alfanuméricas sin espacios.
    const claveTecnica = rawClaveTecnica.replace(/[\s\u00A0\uFEFF]/g, '');
    this.logger.log(
      `[CUFE] claveTecnica fuente="${claveTecnicaSource}" len=${claveTecnica.length} ` +
      `primeros8="${claveTecnica.slice(0, 8)}" últimos4="${claveTecnica.slice(-4)}"`,
    );

     if (!isTestMode && !/^[A-Fa-f0-9]{62,64}$/.test(claveTecnica)) {
      const invalidTechnicalKeyMessage =
        `La Clave Técnica DIAN de producción es inválida. ` +
        `Valor actual: "${claveTecnica}" (longitud ${claveTecnica.length}). ` +
        `Debe ser hexadecimal y coincidir exactamente con la resolución activa en DIAN.`;
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: 'FAILED',
          responseCode: 'INVALID_PRODUCTION_TECHNICAL_KEY',
          responseMessage: invalidTechnicalKeyMessage,
          result: { invoiceId, sourceChannel, documentConfigId: documentConfig?.id ?? null },
        });
      }
      throw new BadRequestException(invalidTechnicalKeyMessage);
    }

    // Advertencia crítica: en producción, sin claveTecnica propia el CUFE es inválido.
    // La clave de habilitación (DIAN_TECH_KEY_HAB) no es reconocida por DIAN en producción.
    if (!isTestMode && claveTecnica === DIAN_TECH_KEY_HAB.replace(/[\s\u00A0\uFEFF]/g, '')) {
      this.logger.error(
        `[DIAN] PRODUCCIÓN — Empresa ${company.nit} no tiene "Clave Técnica DIAN" configurada. ` +
        `Se usará la clave de habilitación por defecto, pero el CUFE generado no será válido para producción. ` +
        `Configure dianClaveTecnica en el panel de la empresa.`,
      );
    }

    // ── Full invoice number for DIAN ──────────────────────────────────────
    // En HABILITACIÓN la DIAN exige prefijo SETP y numeración 990000001-995000000
    // En PRODUCCIÓN se usa el prefijo y número real de la factura
    const dbPrefix = invoice.prefix || documentConfig?.prefix || 'FV';
    const rawNum = invoice.invoiceNumber || '0001';

    let prefix: string;
    let numericPart: string;

    if (isTestMode) {
      // Ambiente habilitación: prefijo SETP, número en rango 990000001+
      prefix = invoice.prefix || documentConfig?.prefix || company.dianPrefijo || 'SETP';
      // Extraer solo dígitos del invoiceNumber
      const digits = rawNum.replace(/\D/g, '') || '1';
      // Mapear al rango 990000000: 990000000 + número de factura
      const rangeBase = Number(
        invoice.numberingRangeFrom ??
          documentConfig?.rangeFrom ??
          (isPos ? company.dianPosRangoDesde : company.dianRangoDesde) ??
          990000000,
      );
      numericPart = String(rangeBase + parseInt(digits, 10));
    } else {
      // Producción: prefijo y número reales
      prefix = dbPrefix;
      const rawSuffix =
        rawNum.replace(new RegExp(`^${dbPrefix}-?`), '').trim() ||
        rawNum.replace(/\D/g, '') ||
        '1';
      const rawSuffixDigits = rawSuffix.replace(/\D/g, '');
      // DIAN calcula NumFac con el consecutivo documental real, no con padding visual
      // interno tipo "0001". Conservamos el número bonito en BD/PDF, pero para XML/CUFE
      // emitimos el consecutivo sin ceros a la izquierda: FEJC255, BEFA1, etc.
      numericPart = rawSuffixDigits
        ? String(parseInt(rawSuffixDigits, 10) || 1)
        : rawSuffix;
    }

    const fullNumber = `${prefix}${numericPart}`;

    // ── Dates with Bogotá offset ──────────────────────────────────────────
    // FAD09e/ZE02: SigningTime DEBE ser idéntico a IssueDate+IssueTime del XML.
    //
    // Problema raíz: cuando se crea una factura con solo fecha ("2026-03-12"),
    // Prisma guarda 2026-03-12T00:00:00.000Z (medianoche UTC).
    // toColombiaDate(medianoche UTC) = 2026-03-11 (¡un día antes! UTC-5)
    // toColombiaTime(medianoche UTC) = "19:00:00-05:00"
    // Pero la firma ocurre con new Date() real → SigningTime distinto → FAD09e.
    //
    // Solución:
    // 1. issueDate: se lee de la BD como string ISO y se trunca a YYYY-MM-DD
    //    SIN restar offset (la fecha del documento es un dato de negocio, no timestamp).
    // 2. issueTime: se usa new Date() en el momento del envío a DIAN.
    //    La firma usará exactamente este mismo valor → IssueTime == SigningTime.
    const nowForIssue = new Date();  // momento exacto de generación/envío
    // Extraer fecha del documento directamente del string ISO sin ajuste de zona
    // invoice.issueDate puede ser Date o string "2026-03-12" / "2026-03-12T00:00:00.000Z"
    const issueDateRaw = invoice.issueDate instanceof Date
      ? invoice.issueDate.toISOString()
      : String(invoice.issueDate);
    const issueDate = issueDateRaw.substring(0, 10);         // "2026-03-12" siempre correcto
    const issueTime = this.toColombiaTime(nowForIssue);       // hora actual Colombia == SigningTime

    // ── Tax breakdown ─────────────────────────────────────────────────────
    // FAD06 fix: el CUFE ValImp1 DEBE coincidir exactamente con cac:TaxTotal/cbc:TaxAmount del XML.
    // El XML TaxTotal se calcula sumando el taxAmount de cada línea, NO desde invoice.taxAmount.
    // Si hay diferencia de redondeo entre ambas fuentes → DIAN recalcula CUFE diferente → FAD06.
    // Solución: usar la misma fuente para ambos (suma de items).
    const taxIvaFromItems = items.reduce(
      (sum: number, it: any) => sum + Number(it.taxAmount || 0),
      0,
    );
    const taxIva = taxIvaFromItems;            // code 01 IVA — sincronizado con XML TaxTotal
    const taxInc = 0;                          // code 04 INC
    const taxIca = 0;                          // code 03 ICA (no emitido en XML, DIAN usa 0.00)
    const subtotal = Number(invoice.subtotal);
    const total = Number(invoice.total);

    // ── Company DV (antes del CUFE para usar supplierNitClean) ────────────
    // company.nit puede venir como "900987654" o "900987654-1" — solo usar los dígitos base
    const supplierNitClean = company.nit.replace(/[^0-9]/g, '').slice(0, 9); // 9 dígitos NIT Colombia
    const supplierDv = this.calcDv(supplierNitClean);

    const documentTypes = await this.prisma.parameter.findFirst({
      where: { category: "DOCUMENT_TYPES" }
    });
    // ── Customer ID type (DIAN codes) ────────────────────────────────────
    // No depender solo del parámetro en BD. Si falta o viene incompleto,
    // un NIT podría degradarse a CC (13), provocando FAK61 y CUFE inválido.
    const defaultIdTypeMap: Record<string, string> = {
      NIT: '31',
      CC: '13',
      CE: '22',
      TI: '12',
      RC: '11',
      PASSPORT: '41',
      PEP: '47',
      PPT: '48',
      DIE: '31',
    };
    const parameterIdTypeMap: Record<string, string> = documentTypes?.value
      ? JSON.parse(documentTypes.value)
      : {};
    const idTypeMap: Record<string, string> = {
      ...defaultIdTypeMap,
      ...parameterIdTypeMap,
    };
    const rawCustomerDocumentType = String(customer.documentType || '').trim().toUpperCase();
    const custIdRaw = customer.documentNumber || customer.taxId || '222222222222';
    const custIdDigits = custIdRaw.replace(/\D/g, '');
    const inferredAsNit =
      rawCustomerDocumentType === 'NIT' ||
      rawCustomerDocumentType === '31' ||
      (!!customer.taxId && String(customer.taxId).replace(/\D/g, '').length >= 9) ||
      (/^\d{9,}$/.test(custIdDigits) && rawCustomerDocumentType === '');
    const custIdType =
      idTypeMap[rawCustomerDocumentType] ||
      (inferredAsNit ? '31' : '13');
    // custId debe quedar exactamente igual en XML y CUFE.
    // Para evitar FAD06, normalizamos el documento del adquiriente al mismo valor
    // que se envía en CompanyID / numAdq.
    const custIdBase = custIdType === '31'
      ? custIdDigits.slice(0, 9)
      : (custIdDigits || custIdRaw.replace(/-\d$/, '').trim());
    const custId = custIdBase;
    // FAK24: DV obligatorio cuando schemeName=31. Calcular siempre desde el NIT limpio.
    const custDv = custIdType === '31' ? this.calcDv(custIdBase.replace(/[^0-9]/g, '').slice(0, 9)) : '';
    const nitCustomerClean = custId;

    // ── CUFE — SHA-384 per Anexo Técnico DIAN v1.9 §11.2 ─────────────────
    this.logger.log(
      `[CUFE] Calculando con claveTecnica="${claveTecnica}" (len=${claveTecnica.length}) ` +
      `tipoAmbiente="${isTestMode ? '2' : '1'}" issueDate="${issueDate}" issueTime="${issueTime}" ` +
      `subtotal=${subtotal} taxIva=${taxIva} total=${total} nitOFE="${supplierNitClean}" numAdq="${nitCustomerClean}"`,
    );
    const { cufe, cufeInput } = this.calcCufeWithInput({
      invoiceNumber: fullNumber, issueDate, issueTime,
      subtotal, taxIva, taxInc, taxIca, total,
      nitSupplier: supplierNitClean,
      nitCustomer: nitCustomerClean,
      claveTecnica,
      tipoAmbiente: isTestMode ? '2' : '1',
    });
    this.logger.log(`[CUFE] Input: "${cufeInput}"`);
    this.logger.log(`[CUFE] Hash:  "${cufe}"`);

    // ── Software Security Code ────────────────────────────────────────────
    const ssc = this.calcSoftwareSecurityCode(softwareId, softwarePin, fullNumber);

    // ── Numbering range data ──────────────────────────────────────────────

    // En un helper o dentro del servicio
    const defaults = {
      resolucion: '18760000001',
      desde: 1,
      hasta: 5000000,
      fechaDesde: '2019-01-19',
      fechaHasta: '2030-01-19'
    };
    const toDateOnly = (d: Date) => d.toISOString().split('T')[0];
    // Creamos un objeto con la data "normalizada"
    // Fechas de la resolución: vienen de la DB como Date (ej. 2019-01-19T00:00:00Z).
    // toColombiaDate restaría 5h → 2019-01-18. Para fechas de autorización usamos
    // directamente el valor ISO sin corrección de zona (son fechas de calendario, no timestamps).

    const companyDefaults = isPos
      ? {
          resolucion: company.dianPosResolucion || defaults.resolucion,
          dianPrefix: company.dianPosPrefijo || prefix,
          rangoDesde: company.dianPosRangoDesde || defaults.desde,
          rangoHasta: company.dianPosRangoHasta || defaults.hasta,
          fechaDesde: company.dianPosFechaDesde ? toDateOnly(new Date(company.dianPosFechaDesde)) : defaults.fechaDesde,
          fechaHasta: company.dianPosFechaHasta ? toDateOnly(new Date(company.dianPosFechaHasta)) : defaults.fechaHasta,
        }
      : {
          resolucion: company.dianResolucion || defaults.resolucion,
          dianPrefix: company.dianPrefijo || prefix,
          rangoDesde: company.dianRangoDesde || defaults.desde,
          rangoHasta: company.dianRangoHasta || defaults.hasta,
          fechaDesde: company.dianFechaDesde ? toDateOnly(new Date(company.dianFechaDesde)) : defaults.fechaDesde,
          fechaHasta: company.dianFechaHasta ? toDateOnly(new Date(company.dianFechaHasta)) : defaults.fechaHasta,
        };

    const { resolucion, dianPrefix, rangoDesde, rangoHasta, fechaDesde, fechaHasta } =
      documentConfig || invoice.documentConfigId || invoice.resolutionNumber || invoice.numberingRangeFrom
        ? {
            resolucion: invoice.resolutionNumber || documentConfig?.resolutionNumber || companyDefaults.resolucion,
            dianPrefix: invoice.prefix || documentConfig?.prefix || companyDefaults.dianPrefix,
            rangoDesde: invoice.numberingRangeFrom || documentConfig?.rangeFrom || companyDefaults.rangoDesde,
            rangoHasta: invoice.numberingRangeTo || documentConfig?.rangeTo || companyDefaults.rangoHasta,
            fechaDesde: invoice.resolutionValidFrom || documentConfig?.validFrom || companyDefaults.fechaDesde,
            fechaHasta: invoice.resolutionValidTo || documentConfig?.validTo || companyDefaults.fechaHasta,
          }
        : companyDefaults;

    // ── Build UBL 2.1 XML ────────────────────────────────────────────────
    this.logger.log(`[DIAN] Generating XML for ${fullNumber} CUFE=${cufe.slice(0, 16)}…`);
    // ── CustomizationID: 05=bienes, 01=consumidor final ──────────────────
    // Consumidor final: doc != NIT (CC, TI, CE, etc. — no tiene RUT)
    const isConsumidorFinal = custIdType !== '31';
    const customizationId = isConsumidorFinal ? '01' : '05';

    // ── PaymentMeansCode desde invoice.paymentMethod ──────────────────────
    // 10=contado, 41=crédito, 42=transferencia, 48=tarj.crédito, 54=tarj.débito
    const paymentMeansCodeMap: Record<string, string> = {
      cash: '10', credit: '41', transfer: '42',
      credit_card: '48', debit_card: '54', check: '20',
    };
    const invoicePaymentMethod = (invoice as any).paymentMethod as string | undefined;
    const paymentMeansCode = paymentMeansCodeMap[invoicePaymentMethod ?? 'cash'] || '10';

    const xmlUnsigned = this.buildUblXml({
      fullNumber, prefix: dianPrefix, issueDate, issueTime,
      dueDate: invoice.dueDate ? this.toColombiaDate(new Date(invoice.dueDate)) : issueDate,
      profileExecutionId: isTestMode ? '2' : '1',
      currency: invoice.currency || 'COP',
      cufe, cufeInput, ssc, softwareId,
      resolucion, rangoDesde, rangoHasta, fechaDesde, fechaHasta,
      subtotal, taxIva, taxInc, taxIca, total,
      supplierNit: supplierNitClean, supplierDv,
      supplierName: company.razonSocial,
      supplierAddress: company.address || 'Sin dirección',
      supplierCity: company.city || 'Bogotá',
      supplierCityCode: (company as any).cityCode || '11001',
      supplierDepartment: company.department || 'Cundinamarca',
      supplierDeptCode: (company as any).departmentCode || '11',
      supplierCountry: company.country || 'CO',
      supplierPhone: company.phone || '0000000000',
      supplierEmail: company.email,
      custIdType, custDv,
      custId,
      custName: customer.name || 'Sin nombre',
      custAddress: customer.address || 'Sin dirección',
      custCity: customer.city || 'Bogotá',
      custCityCode: (customer as any).cityCode || '11001',
      custDepartment: (customer as any).department || 'Bogotá',
      custDeptCode: ((customer as any).departmentCode || '11').toString().replace(/^0+(?=\d{2})/, '') || '11',
      custCountry: customer.country || 'CO',
      custEmail: customer.email || 'cliente@example.com',
      custTaxLevelCode: (customer as any).taxLevelCode || null,
      customizationId,
      paymentMeansCode,
      items: items.map((it: any, idx: number) => ({
        lineId: idx + 1,
        description: it.description,
        quantity: Number(it.quantity),
        unit: it.unit || it.product?.unit || 'EA',
        unitPrice: Number(it.unitPrice),
        taxRate: Number(it.taxRate),
        taxAmount: Number(it.taxAmount),
        discount: Number(it.discount || 0),
        // lineTotal = precio neto SIN IVA (UBL LineExtensionAmount y TaxableAmount)
        // it.total en la BD incluye IVA → usar total - taxAmount para obtener el neto
        lineTotal: Number(it.total) - Number(it.taxAmount),
        sku: it.product?.sku || it.description?.substring(0, 20) || String(idx + 1),
        unspscCode: it.product?.unspscCode ?? (it as any).unspscCode ?? null,
      })),
    });
    await this.logInvoiceAudit(companyId, null, 'INVOICE_CUFE_TRACE', invoiceId, null, {
      environment: isTestMode ? 'HABILITACION' : 'PRODUCCION',
      sourceChannel,
      invoiceId,
      invoiceNumberDb: invoice.invoiceNumber,
      prefixDb: invoice.prefix,
      fullNumber,
      issueDate,
      issueTime,
      subtotal,
      taxIva,
      taxInc,
      taxIca,
      total,
      supplier: {
        nit: supplierNitClean,
        dv: supplierDv,
        razonSocial: company.razonSocial,
      },
      customer: {
        name: customer.name,
        documentTypeRaw: customer.documentType,
        documentTypeDian: custIdType,
        documentNumberRaw: custIdRaw,
        documentNumberNormalized: custId,
      },
      documentConfig: {
        id: documentConfig?.id ?? null,
        prefix: documentConfig?.prefix ?? null,
        resolutionNumber: documentConfig?.resolutionNumber ?? null,
        rangeFrom: documentConfig?.rangeFrom ?? null,
        rangeTo: documentConfig?.rangeTo ?? null,
        validFrom: documentConfig?.validFrom ?? null,
        validTo: documentConfig?.validTo ?? null,
        technicalKey: claveTecnica,
        technicalKeySource: claveTecnicaSource,
        technicalKeyLength: claveTecnica.length,
      },
      cufe,
      cufeInput,
      xml: {
        invoiceIdTag: fullNumber,
        uuid: cufe,
      },
    });
    const certPem = this.normalizePem(company.dianCertificate);
    const keyPem = this.normalizePem(company.dianCertificateKey);
    // ── Sign XML (XAdES-BES placeholder — real cert needed for production) ─
    // issueDate + issueTime del XML → usados en SigningTime (FAD09e)
    const issueDateTimeForSig = `${issueDate}T${issueTime.replace(/-05:00$/, '')}-05:00`;
    const xmlSigned = this.signXmlPlaceholder(xmlUnsigned, certPem, keyPem, issueDateTimeForSig);

    // ── Compress to ZIP → Base64 ──────────────────────────────────────────
    // Anexo Técnico §15: fileName = {NitOFE}{CUFE}.zip  (CUFE = hash SHA384, NO el número de factura)
    const xmlFileName = `${supplierNitClean}${cufe}.xml`;
    const zipFileName = `${supplierNitClean}${cufe}.zip`;
    this.logger.log(`[DIAN] Compressing ${xmlFileName} → ${zipFileName}`);
    const zipBuffer = await this.createZip(xmlFileName, xmlSigned);
    const zipBase64 = zipBuffer.toString('base64');

    await this.logInvoiceAudit(companyId, null, 'INVOICE_DIAN_DISPATCH_TRACE', invoiceId, null, {
      environment: isTestMode ? 'HABILITACION' : 'PRODUCCION',
      invoiceId,
      invoiceNumberDb: invoice.invoiceNumber,
      fullNumber,
      wsUrl: isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD,
      soapActions: isTestMode ? ['SendTestSetAsync'] : ['SendBillSync', 'SendBillAsync'],
      software: {
        softwareId,
        softwarePinLength: softwarePin.length,
        providerId: supplierNitClean,
        providerDv: supplierDv,
      },
      documentAuthorization: {
        documentConfigId: documentConfig?.id ?? null,
        resolutionNumber: resolucion,
        prefix: dianPrefix,
        rangeFrom: rangoDesde,
        rangeTo: rangoHasta,
        validFrom: fechaDesde,
        validTo: fechaHasta,
        technicalKey: claveTecnica,
        technicalKeyLength: claveTecnica.length,
      },
      customer: {
        documentTypeDian: custIdType,
        documentNumber: custId,
        name: customer.name,
      },
      files: {
        xmlFileName,
        zipFileName,
        xmlBytes: Buffer.byteLength(xmlSigned, 'utf8'),
        zipBytes: zipBuffer.length,
        zipBase64Length: zipBase64.length,
      },
      soapPreview: isTestMode
        ? {
            action: 'SendTestSetAsync',
            body: `<wcf:SendTestSetAsync><wcf:fileName>${zipFileName}</wcf:fileName><wcf:contentFile>[BASE64_ZIP_${zipBase64.length}]</wcf:contentFile><wcf:testSetId>${testSetId}</wcf:testSetId></wcf:SendTestSetAsync>`,
          }
        : {
            sync: `<wcf:SendBillSync><wcf:fileName>${zipFileName}</wcf:fileName><wcf:contentFile>[BASE64_ZIP_${zipBase64.length}]</wcf:contentFile></wcf:SendBillSync>`,
            async: `<wcf:SendBillAsync><wcf:fileName>${zipFileName}</wcf:fileName><wcf:contentFile>[BASE64_ZIP_${zipBase64.length}]</wcf:contentFile></wcf:SendBillAsync>`,
          },
      xmlHeader: {
        profileExecutionId: isTestMode ? '2' : '1',
        customizationId,
        invoiceAuthorization: resolucion,
        supplierCompanyId: supplierNitClean,
        customerCompanyId: custId,
      },
    });

    // ── Save XML before network call ──────────────────────────────────────
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        dianCufe: cufe,
        dianStatus: 'PENDING',
        dianAttempts: { increment: 1 },
        xmlContent: xmlUnsigned,
        xmlSigned,
      } as any,
    });

    // ── Call DIAN WebService ──────────────────────────────────────────────
    // WS-Security X.509 Certificate Token Profile 1.1 (Anexo Técnico §7.5)

    this.logger.log(`[DIAN] Calling ${isTestMode ? 'SendTestSetAsync' : 'SendBillSync (con fallback a SendBillAsync)'} → ${isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD}`);

    // ── Habilitación: SendTestSetAsync (sin cambios) ──────────────────────
    if (isTestMode) {
      let soapResult: DianSoapResult;
      try {
        soapResult = await this.soapSendTestSetAsync({ zipFileName, zipBase64, testSetId, wsUrl: DIAN_WS_HAB, certPem, keyPem });
      } catch (err: any) {
        this.logger.error(`[DIAN] SOAP call failed: ${err.message}`);
        await this.prisma.invoice.update({
          where: { id: invoiceId },
          data: { dianStatus: 'ERROR', dianStatusMsg: err.message, dianErrors: null } as any,
        });
        if (dianJob) {
          await this.completeDianJob(dianJob.id, {
            status: 'FAILED',
            responseMessage: err.message,
            result: { invoiceId, phase: 'SOAP_SEND' },
          });
        }
        throw new BadRequestException(`Error de comunicación con DIAN: ${err.message}`);
      }

      // ── Persist result (habilitación) ───────────────────────────────────
      const newStatus = soapResult.zipKey ? 'SENT_DIAN' : 'DRAFT';
      const sendErrors: string[] = soapResult.errorMessages ?? [];
      const updated = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: newStatus,
          dianStatus: soapResult.zipKey ? 'SENT' : 'ERROR',
          dianZipKey: soapResult.zipKey || null,
          dianQrCode: cufe ? `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cufe}` : null,
          dianSentAt: new Date(),
          dianStatusMsg: sendErrors.length > 0 ? sendErrors.join('; ') : null,
          dianErrors: sendErrors.length > 0 ? JSON.stringify(sendErrors) : null,
        } as any,
      });

      const accountingSync = await this.accountingService.syncInvoiceEntry(companyId, invoiceId);
      if (approvedRequest?.id) await this.consumeApprovalRequest(approvedRequest.id);
      await this.logInvoiceAudit(companyId, null, 'INVOICE_ISSUED_TO_DIAN', invoiceId, { status: invoice.status }, {
        status: updated.status,
        dianStatus: updated.dianStatus,
        dianZipKey: updated.dianZipKey,
        approvalId: approvedRequest?.id ?? null,
      });
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: updated.dianStatus === 'SENT' ? 'SUCCESS' : 'FAILED',
          responseMessage:
            updated.dianStatusMsg ??
            (sendErrors.length > 0 ? sendErrors.join('; ') : null) ??
            (updated.dianStatus === 'SENT' ? 'Factura enviada a DIAN' : 'No fue posible enviar la factura'),
          result: {
            invoiceId,
            status: updated.status,
            dianStatus: updated.dianStatus,
            dianZipKey: updated.dianZipKey,
            sendMode: 'ASYNC',
          },
        });
      }

      return {
        ...updated,
        dianResult: soapResult,
        accountingSync,
      };
    }

    // ── Producción: SendBillSync primero, fallback a SendBillAsync ────────
    // SendBillSync también recibe el ZIP comprimido (igual que SendBillAsync).
    // La única diferencia es que retorna la validación sincrónica en vez de un ZipKey.
    let syncResult: DianStatusResult | null = null;
    let usedSendMode: 'SYNC' | 'ASYNC' = 'SYNC';

    try {
      this.logger.log(`[DIAN] Intentando SendBillSync para ${zipFileName}`);
      syncResult = await this.soapSendBillSync({ zipFileName, zipBase64, wsUrl: DIAN_WS_PROD, certPem, keyPem });
      this.logger.log(`[DIAN] SendBillSync isValid=${syncResult.isValid} statusCode=${syncResult.statusCode}`);
    } catch (syncErr: any) {
      this.logger.warn(`[DIAN] SendBillSync falló (${syncErr.message}), haciendo fallback a SendBillAsync`);
      syncResult = null;
    }

    // Si SendBillSync funcionó → persistir resultado directo
    if (syncResult !== null) {
      const syncErrors: string[] = syncResult.errorMessages ?? [];
      const syncStatus = syncResult.isValid ? 'ACCEPTED_DIAN' : 'REJECTED_DIAN';
      const syncDianStatus = syncResult.isValid ? '00' : (syncResult.statusCode || 'ERROR');

      const updated = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: syncStatus,
          dianStatus: syncDianStatus,
          dianStatusCode: syncResult.statusCode || null,
          dianStatusMsg: syncResult.statusDescription || syncResult.statusMessage || (syncErrors.length > 0 ? syncErrors.join('; ') : null),
          dianZipKey: null,
          dianCufe: cufe,
          dianErrors: syncErrors.length > 0 ? JSON.stringify(syncErrors) : null,
          dianXmlBase64: syncResult.xmlBase64 || null,
          dianQrCode: cufe ? `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}` : null,
          dianSentAt: new Date(),
          dianResponseAt: new Date(),
        } as any,
      });

      const accountingSync = await this.accountingService.syncInvoiceEntry(companyId, invoiceId);
      if (approvedRequest?.id) await this.consumeApprovalRequest(approvedRequest.id);
      await this.logInvoiceAudit(companyId, null, 'INVOICE_ISSUED_TO_DIAN', invoiceId, { status: invoice.status }, {
        status: updated.status,
        dianStatus: updated.dianStatus,
        dianZipKey: null,
        approvalId: approvedRequest?.id ?? null,
        sendMode: 'SYNC',
      });
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: syncResult.isValid ? 'SUCCESS' : 'FAILED',
          responseMessage:
            syncResult.statusDescription ||
            syncResult.statusMessage ||
            (syncErrors.length > 0 ? syncErrors.join('; ') : null) ||
            (syncResult.isValid ? 'Factura aceptada por DIAN (SendBillSync)' : 'Factura rechazada por DIAN (SendBillSync)'),
          result: {
            invoiceId,
            status: updated.status,
            dianStatus: updated.dianStatus,
            dianZipKey: null,
            sendMode: 'SYNC',
          },
        });
      }

      return {
        ...updated,
        dianResult: { success: syncResult.isValid, zipKey: undefined, errorMessages: syncErrors, raw: syncResult.raw } as DianSoapResult,
        accountingSync,
      };
    }

    // Fallback: SendBillAsync (ZIP)
    usedSendMode = 'ASYNC';
    let soapResult: DianSoapResult;
    try {
      this.logger.log(`[DIAN] Fallback SendBillAsync para ${zipFileName}`);
      soapResult = await this.soapSendBillAsync({ zipFileName, zipBase64, wsUrl: DIAN_WS_PROD, certPem, keyPem });
    } catch (err: any) {
      this.logger.error(`[DIAN] SOAP call failed (SendBillAsync fallback): ${err.message}`);
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { dianStatus: 'ERROR', dianStatusMsg: err.message, dianErrors: null } as any,
      });
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: 'FAILED',
          responseMessage: err.message,
          result: { invoiceId, phase: 'SOAP_SEND', sendMode: 'ASYNC' },
        });
      }
      throw new BadRequestException(`Error de comunicación con DIAN: ${err.message}`);
    }

    // ── Persist result (fallback async) ──────────────────────────────────
    const newStatus = soapResult.zipKey ? 'SENT_DIAN' : 'DRAFT';
    const sendErrors: string[] = soapResult.errorMessages ?? [];
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: newStatus,
        dianStatus: soapResult.zipKey ? 'SENT' : 'ERROR',
        dianZipKey: soapResult.zipKey || null,
        dianQrCode: cufe ? `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}` : null,
        dianSentAt: new Date(),
        dianStatusMsg: sendErrors.length > 0 ? sendErrors.join('; ') : null,
        dianErrors: sendErrors.length > 0 ? JSON.stringify(sendErrors) : null,
      } as any,
    });

    const accountingSync = await this.accountingService.syncInvoiceEntry(companyId, invoiceId);
    if (approvedRequest?.id) await this.consumeApprovalRequest(approvedRequest.id);
    await this.logInvoiceAudit(companyId, null, 'INVOICE_ISSUED_TO_DIAN', invoiceId, { status: invoice.status }, {
      status: updated.status,
      dianStatus: updated.dianStatus,
      dianZipKey: updated.dianZipKey,
      approvalId: approvedRequest?.id ?? null,
      sendMode: usedSendMode,
    });
    if (dianJob) {
      await this.completeDianJob(dianJob.id, {
        status: updated.dianStatus === 'SENT' ? 'SUCCESS' : 'FAILED',
        responseMessage:
          updated.dianStatusMsg ??
          (sendErrors.length > 0 ? sendErrors.join('; ') : null) ??
          (updated.dianStatus === 'SENT' ? 'Factura enviada a DIAN' : 'No fue posible enviar la factura'),
        result: {
          invoiceId,
          status: updated.status,
          dianStatus: updated.dianStatus,
          dianZipKey: updated.dianZipKey,
          sendMode: usedSendMode,
        },
      });
    }

    return {
      ...updated,
      dianResult: soapResult,
      accountingSync,
    };
  }

  // ── Query DIAN status by ZipKey ───────────────────────────────────────────
  async queryDianStatus(
    companyId: string,
    invoiceId: string,
    options?: {
      skipJobRegistration?: boolean;
      triggeredById?: string | null;
      branchId?: string | null;
    },
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: { company: true },
    }) as any;
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    const branchId = options?.branchId ?? invoice.branchId ?? null;
    const dianJob = options?.skipJobRegistration
      ? null
      : await this.createDianJob({
          companyId,
          invoiceId,
          branchId,
          actionType: 'QUERY_DIAN_STATUS',
          sourceChannel: invoice.sourceChannel ?? null,
          triggeredById: options?.triggeredById ?? null,
          payload: {
            mode: 'direct',
            hasZipKey: !!invoice.dianZipKey,
            hasCufe: !!invoice.dianCufe,
          },
          status: 'PROCESSING',
        });

    const zipKey = invoice.dianZipKey;
    const cufe = invoice.dianCufe;
    if (!zipKey && !cufe) {
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: 'FAILED',
          responseCode: 'MISSING_TRACKING',
          responseMessage: 'La factura no tiene un ZipKey o CUFE para consultar',
          result: { invoiceId },
        });
      }
      throw new BadRequestException('La factura no tiene un ZipKey o CUFE para consultar');
    }

    const isTestMode = invoice.company?.dianTestMode !== false;
    const wsUrl = isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD;
    const certPem = invoice.company?.dianCertificate;
    const keyPem = invoice.company?.dianCertificateKey;

    let result: DianStatusResult;
    let queriedBy: 'ZIP' | 'CUFE' = zipKey ? 'ZIP' : 'CUFE';
    let fallbackAfterBatchUnauth = false; // true cuando GetStatusZip devolvió código 2 y se hizo fallback a GetStatus
    try {
      if (zipKey) {
        result = await this.soapGetStatusZip({ trackId: zipKey, wsUrl, certPem, keyPem });

        if (result.statusCode === '66') {
          // Código 66 de GetStatusZip = documento en procesamiento asíncrono (DIAN Anexo Técnico §7.11).
          // Es comportamiento ESPERADO con SendBillAsync: DIAN aún no terminó de procesar el ZIP.
          // NO hacer fallback a GetStatus+CUFE — también retornaría 66 porque el doc no está indexado aún.
          // La factura queda como SENT_DIAN (pendiente de confirmación). El usuario debe reintentar en minutos.
          this.logger.log(
            `[DIAN] GetStatusZip código 66 para ${invoiceId} — en procesamiento asíncrono. ZipKey: ${zipKey}`,
          );
        } else if (result.statusCode === '2' && cufe) {
          // Código 2 = empresa no autorizada para envío por lotes (GetStatusZip).
          // Intentar consulta individual por CUFE (GetStatus), que no requiere autorización de lotes.
          // NOTA: Si el CUFE también falla (código 66), puede ser claveTecnica incorrecta en producción.
          this.logger.warn(
            `[DIAN] GetStatusZip código 2 (no autorizada para lotes) para ${invoiceId}. Reintentando con GetStatus por CUFE.`,
          );
          fallbackAfterBatchUnauth = true;
          result = await this.soapGetStatus({ trackId: cufe, wsUrl, certPem, keyPem });
          queriedBy = 'CUFE';
          if (result.statusCode === '66') {
            this.logger.error(
              `[DIAN] GetStatus por CUFE también devolvió 66 para ${invoiceId}. ` +
              `Posible causa: "Clave Técnica DIAN" de producción no configurada (dianClaveTecnica). ` +
              `El CUFE calculado con la clave de habilitación no es reconocido por DIAN en producción.`,
            );
          }
        }
      } else {
        result = await this.soapGetStatus({ trackId: cufe!, wsUrl, certPem, keyPem });
        queriedBy = 'CUFE';
      }
    } catch (error: any) {
      if (dianJob) {
        await this.completeDianJob(dianJob.id, {
          status: 'FAILED',
          responseMessage: error?.message ?? 'No fue posible consultar el estado DIAN',
          result: { invoiceId, phase: 'SOAP_QUERY' },
        });
      }
      throw error;
    }

    // Map DIAN status to invoice status.
    // No sobreescribir campos DIAN cuando el estado es incierto/pendiente:
    //   1. Código 66 de GetStatusZip (ZIP): DIAN aún procesando async — normal, esperar.
    //   2. Código 66 de GetStatus(CUFE) después de fallback por código 2: el CUFE puede ser
    //      inválido si dianClaveTecnica de producción no está configurada. No marcar como error
    //      definitivo hasta que el usuario configure la clave técnica correcta.
    const isPendingAsync = result.statusCode === '66' && queriedBy === 'ZIP';
    const isCufeMismatch = result.statusCode === '66' && queriedBy === 'CUFE' && fallbackAfterBatchUnauth;
    const skipStatusFields = isPendingAsync || isCufeMismatch;

    let newInvoiceStatus: string = invoice.status;
    if (!skipStatusFields) {
      // DIAN returns '0' or '00' for success (PDF §7.11.3 shows '0', §7.12.3 shows '00')
      if (result.isValid && (result.statusCode === '00' || result.statusCode === '0')) {
        newInvoiceStatus = 'ACCEPTED_DIAN';
      } else if (result.statusCode === '99') {
        newInvoiceStatus = 'REJECTED_DIAN';
      }
    }

    const statusErrors: string[] = result.errorMessages ?? [];
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: newInvoiceStatus,
        // skipStatusFields: no sobreescribir cuando el estado es ambiguo/pendiente
        ...(skipStatusFields ? {} : {
          dianStatus: result.statusCode,
          dianStatusCode: result.statusCode,
          dianStatusMsg: result.statusMessage || result.statusDescription || null,
          dianErrors: statusErrors.length > 0 ? JSON.stringify(statusErrors) : null,
          dianXmlBase64: result.xmlBase64 || null,
        }),
        dianResponseAt: new Date(),
      } as any,
    });

    const accountingSync = ['ACCEPTED_DIAN', 'PAID', 'OVERDUE', 'SENT_DIAN'].includes(newInvoiceStatus)
      ? await this.accountingService.syncInvoiceEntry(companyId, invoiceId)
      : null;

    const pendingMsg = isCufeMismatch
      ? 'DIAN no encontró el CUFE — posible "Clave Técnica DIAN" de producción no configurada'
      : 'DIAN procesando documento (async) — reintentar en unos minutos';

    await this.logInvoiceAudit(companyId, null, 'INVOICE_DIAN_STATUS_QUERIED', invoiceId, null, {
      status: updated.status,
      dianStatusCode: updated.dianStatusCode,
      dianStatusMsg: updated.dianStatusMsg,
      queriedBy,
      skipStatusFields,
    });
    if (dianJob) {
      await this.completeDianJob(dianJob.id, {
        status: 'SUCCESS',
        responseCode: skipStatusFields ? result.statusCode : (updated.dianStatusCode ?? null),
        responseMessage: skipStatusFields
          ? pendingMsg
          : (updated.dianStatusMsg ?? result.statusDescription ?? 'Estado DIAN consultado'),
        result: {
          invoiceId,
          status: updated.status,
          dianStatus: updated.dianStatus,
          dianStatusCode: skipStatusFields ? result.statusCode : updated.dianStatusCode,
          queriedBy,
          pendingAsync: skipStatusFields,
          isCufeMismatch,
        },
      });
    }

    return {
      ...updated,
      accountingSync,
      dianQuerySource: queriedBy,
      dianPendingAsync: skipStatusFields,
      dianCufeMismatch: isCufeMismatch,
    };
  }

  private getInvoiceDisplayNumber(invoice: any) {
    const prefix = String(invoice?.prefix ?? '').trim();
    const raw = String(invoice?.invoiceNumber ?? '').trim();
    if (!raw) return prefix || '-';
    if (!prefix) return raw;
    const upperRaw = raw.toUpperCase();
    const upperPrefix = prefix.toUpperCase();
    if (upperRaw === upperPrefix || upperRaw.startsWith(`${upperPrefix}-`)) {
      return raw;
    }
    return `${prefix}-${raw}`;
  }

  private getInvoiceFileBaseName(invoice: any) {
    return this.getInvoiceDisplayNumber(invoice).replace(/[^\w.-]+/g, '_');
  }

  // ── Download signed XML ───────────────────────────────────────────────────
  async getXml(companyId: string, invoiceId: string): Promise<{ xml: string; filename: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
    }) as any;
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (!invoice.xmlSigned) throw new BadRequestException('XML aún no generado para esta factura');
    return {
      xml: invoice.xmlSigned,
      filename: `${this.getInvoiceFileBaseName(invoice)}.xml`,
    };
  }

  async generatePdfDocument(companyId: string, branchId: string, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { invoice, company } = await this.getInvoiceRenderContext(companyId, branchId, invoiceId);
    const buffer = await this.buildInvoicePdfBuffer(invoice, company);
    return {
      buffer,
      filename: `${this.getInvoiceFileBaseName(invoice)}.pdf`,
    };
  }

  async generateInvoiceZip(companyId: string, branchId: string, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { invoice, company } = await this.getInvoiceRenderContext(companyId, branchId, invoiceId);
    if (!invoice.xmlSigned) {
      throw new BadRequestException('El XML de la factura aún no está disponible');
    }

    const baseName = this.getInvoiceFileBaseName(invoice);
    const pdfBuffer = await this.buildInvoicePdfBuffer(invoice, company);
    const zipBuffer = await this.createArchive([
      { name: `${baseName}.pdf`, content: pdfBuffer },
      { name: `${baseName}.xml`, content: Buffer.from(invoice.xmlSigned, 'utf8') },
    ]);

    return {
      buffer: zipBuffer,
      filename: `${baseName}.zip`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIAN SOAPUI HELPER — Genera payload listo para pruebas manuales
  // Endpoint: POST /v1/invoices/dian/soapui-payload
  // No requiere factura en BD. Datos hardcodeados para ambiente habilitación.
  // ══════════════════════════════════════════════════════════════════════════

  async buildSoapUiPayload(overrides?: {
    nitEmpresa?: string;
    nitCliente?: string;
    numFactura?: string;
    subtotal?: number;
    iva?: number;
    certPem?: string;
    keyPem?: string;
  }) {
    const o = overrides ?? {};

    // ── Datos de prueba hardcodeados (ambiente habilitación DIAN) ────────────
    const softwareId = DIAN_SOFTWARE_ID;
    const softwarePin = DIAN_SOFTWARE_PIN;
    const testSetId = DIAN_TEST_SET_ID;
    const claveTecnica = DIAN_TECH_KEY_HAB;

    // Empresa facturadora — usar el NIT registrado en el catálogo DIAN HAB
    const nitEmpresa = (o.nitEmpresa ?? '900987654').replace(/\D/g, '');
    const dvEmpresa = this.calcDv(nitEmpresa);

    // Cliente de prueba
    const nitCliente = (o.nitCliente ?? '900000001').replace(/\D/g, '');

    // Número de factura en rango habilitación (990000001 – 995000000)
    const numFactura = o.numFactura ?? 'SETP990000001';
    const prefix = numFactura.replace(/\d.*$/, '') || 'SETP';

    // Valores monetarios
    const subtotal = o.subtotal ?? 1000000;   // $1.000.000 COP
    const iva = o.iva ?? 190000;         // 19% IVA
    const total = subtotal + iva;

    // Fechas en horario Colombia (UTC-5)
    const now = new Date();
    const issueDate = this.toColombiaDate(now);
    const issueTime = this.toColombiaTime(now);
    const dueDate = issueDate;               // contado

    // ── Calcular CUFE ────────────────────────────────────────────────────────
    const { cufe, cufeInput } = this.calcCufeWithInput({
      invoiceNumber: numFactura,
      issueDate, issueTime,
      subtotal, taxIva: iva, taxInc: 0, taxIca: 0, total,
      nitSupplier: nitEmpresa,
      nitCustomer: nitCliente,
      claveTecnica,
      tipoAmbiente: '2',  // habilitación
    });

    // ── Calcular Software Security Code ─────────────────────────────────────
    const ssc = this.calcSoftwareSecurityCode(softwareId, softwarePin, numFactura);

    // ── Construir XML UBL 2.1 ────────────────────────────────────────────────
    const xmlUnsigned = this.buildUblXml({
      fullNumber: numFactura,
      prefix,
      issueDate, issueTime, dueDate,
      profileExecutionId: '2',          // habilitación
      currency: 'COP',
      cufe, cufeInput, ssc, softwareId,
      // Datos de resolución de prueba DIAN habilitación
      resolucion: '18760000001',
      rangoDesde: '990000000',
      rangoHasta: '995000000',
      fechaDesde: '2019-01-19',
      fechaHasta: '2030-01-19',
      // Empresa
      supplierNit: nitEmpresa,
      supplierDv: dvEmpresa,
      supplierName: 'EMPRESA DEMO BECCAFACT SAS',
      supplierAddress: 'Calle 100 No 10-20',
      supplierCity: 'Bogotá',
      supplierCityCode: '11001',
      supplierDepartment: 'Cundinamarca',
      supplierDeptCode: '11',
      supplierCountry: 'CO',
      supplierPhone: '6011234567',
      supplierEmail: 'facturacion@beccafact.co',
      // Cliente de prueba
      custIdType: '31',
      custDv: this.calcDv(nitCliente),
      custId: nitCliente,
      custName: 'CLIENTE PRUEBA SAS',
      custAddress: 'Carrera 7 No 32-00',
      custCity: 'Bogotá',
      custCityCode: '11001',
      custCountry: 'CO',
      custDepartment: 'Bogotá',
      custDeptCode: '11',
      custEmail: 'compras@clienteprueba.co',
      customizationId: '05',
      paymentMeansCode: '10',
      // Totales
      subtotal, taxIva: iva, taxInc: 0, taxIca: 0, total,
      // Una sola línea de detalle
      items: [{
        lineId: 1,
        description: 'Servicio de software BeccaFact (prueba habilitación)',
        quantity: 1,
        unit: 'EA',
        unitPrice: subtotal,
        taxRate: 19,
        taxAmount: iva,
        discount: 0,
        lineTotal: subtotal,
      }],
    });

    // ── Firmar XML ───────────────────────────────────────────────────────────
    const issueDateTimePreview = `${issueDate}T${issueTime.replace(/-05:00$/, '')}-05:00`;
    const xmlSigned = this.signXmlPlaceholder(
      xmlUnsigned,
      o.certPem ?? '',
      o.keyPem ?? '',
      issueDateTimePreview,
    );

    // ── Comprimir y codificar ────────────────────────────────────────────────
    const xmlFileName = `${nitEmpresa}${numFactura}.xml`;
    const zipFileName = `${nitEmpresa}${numFactura}.zip`;
    const zipBuffer = await this.createZip(xmlFileName, xmlSigned);
    const zipBase64 = zipBuffer.toString('base64');

    // ── Construir SOAP Envelope listo para SoapUI ────────────────────────────
    const actionUri = 'http://wcf.dian.colombia/IWcfDianCustomerServices/SendTestSetAsync';
    const wsUrl = DIAN_WS_HAB;
    const { randomBytes: rb, createHash: cH, createSign: cS } = require('crypto');

    // Timestamps WS-Security
    const tsNow = new Date();
    const created = tsNow.toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const expires = new Date(tsNow.getTime() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const rnd = () => rb(8).toString('hex').toUpperCase();
    const tsId = `TS-${rnd()}`;
    const bstId = `X509-${rnd()}`;
    const sigId = `SIG-${rnd()}`;
    const kiId = `KI-${rnd()}`;
    const strId = `STR-${rnd()}`;
    const toId = `id-${rnd()}`;

    const effectiveCert = o.certPem ?? '';
    const effectiveKey = o.keyPem ?? '';
    const certBase64 = effectiveCert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

    // Namespaces
    const EXC_C14N_UI = 'http://www.w3.org/2001/10/xml-exc-c14n#';
    const WSU_NS_UI = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
    const WSSE_NS_UI = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
    const DS_NS_UI = 'http://www.w3.org/2000/09/xmldsig#';
    const WSA_NS_UI = 'http://www.w3.org/2005/08/addressing';

    // Digest de wsa:To con InclusiveNamespaces PrefixList="soap wcf"
    const toForDigest =
      `<wsa:To` +
      ` xmlns:soap="http://www.w3.org/2003/05/soap-envelope"` +
      ` xmlns:wsa="${WSA_NS_UI}"` +
      ` xmlns:wcf="http://wcf.dian.colombia"` +
      ` xmlns:wsu="${WSU_NS_UI}"` +
      ` wsu:Id="${toId}"` +
      `>${wsUrl}</wsa:To>`;
    const toDigestUI = cH('sha256').update(toForDigest, 'utf8').digest('base64');

    // SignedInfo con InclusiveNamespaces
    const siBody =
      `<ds:SignedInfo xmlns:ds="${DS_NS_UI}">` +
      `<ds:CanonicalizationMethod Algorithm="${EXC_C14N_UI}">` +
      `<ec:InclusiveNamespaces PrefixList="wsa soap wcf" xmlns:ec="${EXC_C14N_UI}"/>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${toId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${EXC_C14N_UI}">` +
      `<ec:InclusiveNamespaces PrefixList="soap wcf" xmlns:ec="${EXC_C14N_UI}"/>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
      `<ds:DigestValue>${toDigestUI}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;
    const signerSoap = cS('RSA-SHA256');
    signerSoap.update(siBody, 'utf8');
    const sigValueSoap = signerSoap.sign(effectiveKey, 'base64');

    const soapEnvelope =
      '<soap:Envelope' +
      ' xmlns:soap="http://www.w3.org/2003/05/soap-envelope"' +
      ' xmlns:wcf="http://wcf.dian.colombia">' +
      `<soap:Header xmlns:wsa="${WSA_NS_UI}">` +
      `<wsse:Security xmlns:wsse="${WSSE_NS_UI}" xmlns:wsu="${WSU_NS_UI}">` +
      `<wsu:Timestamp wsu:Id="${tsId}">` +
      `<wsu:Created>${created}</wsu:Created>` +
      `<wsu:Expires>${expires}</wsu:Expires>` +
      `</wsu:Timestamp>` +
      `<wsse:BinarySecurityToken` +
      ` EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"` +
      ` ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"` +
      ` wsu:Id="${bstId}"` +
      `>${certBase64}</wsse:BinarySecurityToken>` +
      `<ds:Signature Id="${sigId}" xmlns:ds="${DS_NS_UI}">` +
      siBody +
      `<ds:SignatureValue>${sigValueSoap}</ds:SignatureValue>` +
      `<ds:KeyInfo Id="${kiId}">` +
      `<wsse:SecurityTokenReference wsu:Id="${strId}">` +
      `<wsse:Reference URI="#${bstId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>` +
      `</wsse:SecurityTokenReference>` +
      `</ds:KeyInfo>` +
      `</ds:Signature>` +
      `</wsse:Security>` +
      `<wsa:Action>${actionUri}</wsa:Action>` +
      `<wsa:To wsu:Id="${toId}" xmlns:wsu="${WSU_NS_UI}">${wsUrl}</wsa:To>` +
      `</soap:Header>` +
      `<soap:Body>` +
      `<wcf:SendTestSetAsync>` +
      `<wcf:fileName>${zipFileName}</wcf:fileName>` +
      `<wcf:contentFile>${zipBase64}</wcf:contentFile>` +
      `<wcf:testSetId>${testSetId}</wcf:testSetId>` +
      `</wcf:SendTestSetAsync>` +
      `</soap:Body>` +
      `</soap:Envelope>`;

    return {
      // ── Instrucciones SoapUI ─────────────────────────────────────────────
      instrucciones: {
        paso1: 'Abre SoapUI y crea un proyecto SOAP nuevo',
        paso2: `URL del WSDL: ${wsUrl}?wsdl`,
        paso3: 'O crea una Raw Request y pega el soapEnvelope directamente',
        paso4: `Endpoint: ${wsUrl}`,
        paso5: `Content-Type header: application/soap+xml; charset=utf-8; action="${actionUri}"`,
        paso6: 'Envía la petición y espera la respuesta con b:ZipKey',
        nota: 'El certificado actual es auto-firmado (prueba local). Reemplaza con cert real de CA ONAC para que DIAN acepte la firma.',
      },
      // ── Datos del documento ──────────────────────────────────────────────
      documento: {
        numFactura,
        nitEmpresa,
        nitCliente,
        cufe,
        cufeInput,
        issueDate,
        issueTime,
        subtotal,
        iva,
        total,
        testSetId,
      },
      // ── Archivos generados ───────────────────────────────────────────────
      archivos: {
        xmlFileName,
        zipFileName,
        xmlSignedLength: xmlSigned.length,
        zipBase64Length: zipBase64.length,
        zipBase64Muestra: zipBase64.slice(0, 80) + '...',
      },
      // ── SOAP Envelope completo listo para pegar en SoapUI ────────────────
      soapEnvelope,
      // ── XML firmado (para inspección / validación externa) ───────────────
      xmlSigned,
      // ── Configuración SoapUI (headers) ───────────────────────────────────
      soapUiConfig: {
        endpoint: wsUrl,
        contentType: `application/soap+xml; charset=utf-8; action="${actionUri}"`,
        method: 'POST',
        wsdl: `${wsUrl}?wsdl`,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUFE — Código Único Factura Electrónica (Anexo Técnico DIAN v1.9 §11.2)
  // SHA-384(NumFac+FecFac+HorFac+ValFac+CodImp1+ValImp1+CodImp2+ValImp2+CodImp3+ValImp3+ValTot+NitOFE+NumAdq+ClTec+TipoAmbiente)
  // ══════════════════════════════════════════════════════════════════════════

  // Retorna { cufe, cufeInput } — cufeInput va en cbc:Note del XML (Anexo §11.2 / Generica.xml)
  private calcCufeWithInput(p: {
    invoiceNumber: string; issueDate: string; issueTime: string;
    subtotal: number; taxIva: number; taxInc: number; taxIca: number; total: number;
    nitSupplier: string; nitCustomer: string; claveTecnica: string; tipoAmbiente: string;
  }): { cufe: string; cufeInput: string } {
    const f = (n: number) => n.toFixed(2);
    // Anexo §11.2 pág 656: NitOFE y NumAdq SIN puntos, SIN guiones, SIN dígito de verificación
    const nitOFE = p.nitSupplier.replace(/[^0-9]/g, '');
    const numAdq = p.nitCustomer.replace(/[^0-9]/g, '');
    const cufeInput =
      p.invoiceNumber + p.issueDate + p.issueTime +
      f(p.subtotal) +
      '01' + f(p.taxIva) +
      '04' + f(p.taxInc) +
      '03' + f(p.taxIca) +
      f(p.total) +
      nitOFE + numAdq + p.claveTecnica + p.tipoAmbiente;
    this.logger.debug(`[CUFE] input: ${cufeInput}`);
    const cufe = createHash('sha384').update(cufeInput, 'utf8').digest('hex');
    return { cufe, cufeInput };
  }

  // SHA-384(SoftwareID + Pin + NumFac)
  private calcSoftwareSecurityCode(softwareId: string, pin: string, invoiceNumber: string): string {
    return createHash('sha384').update(`${softwareId}${pin}${invoiceNumber}`, 'utf8').digest('hex');
  }

  // Dígito de verificación NIT
  calcDv(nit: string): string {
    const n = nit.replace(/\D/g, '');
    const f = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47];
    let sum = 0;
    [...n].reverse().forEach((d, i) => { if (i < f.length) sum += parseInt(d) * f[i]; });
    const r = sum % 11;
    return (r >= 2 ? 11 - r : r).toString();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XML UBL 2.1 BUILDER — Anexo Técnico DIAN v1.9
  // ══════════════════════════════════════════════════════════════════════════

  private buildUblXml(d: {
    fullNumber: string; prefix: string; issueDate: string; issueTime: string;
    dueDate: string; profileExecutionId: string; currency: string;
    cufe: string; cufeInput: string; ssc: string; softwareId: string;
    resolucion: string; rangoDesde: string; rangoHasta: string; fechaDesde: string; fechaHasta: string;
    subtotal: number; taxIva: number; taxInc: number; taxIca: number; total: number;
    supplierNit: string; supplierDv: string; supplierName: string;
    supplierAddress: string; supplierCity: string; supplierCityCode: string;
    supplierDepartment: string; supplierDeptCode: string;
    supplierCountry: string; supplierPhone: string; supplierEmail: string;
    custIdType: string; custDv: string; custId: string;
    custName: string; custAddress: string; custCity: string; custCityCode: string; custDepartment: string; custDeptCode: string;
    custCountry: string; custEmail: string; custTaxLevelCode?: string | null;
    // Nuevos campos de control
    customizationId?: string;    // '01' consumidor final | '05' bienes | '09' servicios | '10' mandatos  default='05'
    paymentMeansCode?: string;   // '10' contado | '41' crédito | '42' transferencia | '48' tarj.crédito | '54' tarj.débito
    items: Array<{ lineId: number; description: string; quantity: number; unit: string; unitPrice: number; taxRate: number; taxAmount: number; discount: number; lineTotal: number; sku?: string; unspscCode?: string | null }>;
  }): string {
    const x = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isHab = d.profileExecutionId === '2';

    // ── CustomizationID según tipo de operación ───────────────────────────
    // 01=consumidor final (sin NIT), 05=venta bienes, 09=servicios, 10=mandatos
    const customizationId = d.customizationId || '05';

    // ── PaymentMeansCode ──────────────────────────────────────────────────
    const paymentMeansCode = d.paymentMeansCode || '10';

    // ── cac:Person para personas naturales (FAK61 / ZB01) ────────────────
    // Obligatorio cuando AdditionalAccountID="2" (custIdType !== '31').
    // POSICIÓN: entre cac:PartyTaxScheme y cac:PartyLegalEntity (schema DIAN Colombia).
    // Orden campos UBL 2.1: FirstName(1) → FamilyName(2) → MiddleName(4).
    let custPersonXml = '';
    if (d.custIdType !== '31') {
      const _nameParts = (d.custName || '').trim().split(/\s+/).filter(Boolean);
      const _firstName  = x(_nameParts[0] || '');
      const _familyName = x(_nameParts.length > 1 ? _nameParts[_nameParts.length - 1] : _nameParts[0] || '');
      const _middleName = _nameParts.length > 2 ? x(_nameParts.slice(1, -1).join(' ')) : '';
      custPersonXml =
        `<cac:Person>\n` +
        `            <cbc:FirstName>${_firstName}</cbc:FirstName>\n` +
        `            <cbc:FamilyName>${_familyName}</cbc:FamilyName>` +
        (_middleName ? `\n            <cbc:MiddleName>${_middleName}</cbc:MiddleName>` : '') +
        `\n         </cac:Person>`;
    }

    const customerPartyXml = d.custIdType === '31'
      ? `<cac:AccountingCustomerParty>
      <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
      <cac:Party>
         <cac:PartyName>
            <cbc:Name>${x(d.custName)}</cbc:Name>
         </cac:PartyName>
         <cac:PhysicalLocation>
            <cac:Address>
               <cbc:ID>${d.custCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.custCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.custDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.custDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.custAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:Address>
         </cac:PhysicalLocation>
         <cac:PartyTaxScheme>
            <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${d.custDv ? ` schemeID="${d.custDv}"` : ''} schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
            <cbc:TaxLevelCode listName="48">${d.custTaxLevelCode && d.custTaxLevelCode !== 'ZZ' && d.custTaxLevelCode !== 'O-99' ? d.custTaxLevelCode : 'O-13'}</cbc:TaxLevelCode>
            <cac:RegistrationAddress>
               <cbc:ID>${d.custCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.custCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.custDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.custDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.custAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:RegistrationAddress>
            <cac:TaxScheme>
               <cbc:ID>01</cbc:ID>
               <cbc:Name>IVA</cbc:Name>
            </cac:TaxScheme>
         </cac:PartyTaxScheme>
         <cac:PartyLegalEntity>
            <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${d.custDv ? ` schemeID="${d.custDv}"` : ''} schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
         </cac:PartyLegalEntity>
         <cac:Contact>
            <cbc:ElectronicMail>${d.custEmail}</cbc:ElectronicMail>
         </cac:Contact>
      </cac:Party>
   </cac:AccountingCustomerParty>`
      : `<cac:AccountingCustomerParty>
      <cbc:AdditionalAccountID>2</cbc:AdditionalAccountID>
      <cac:Party>
         <cac:PartyIdentification>
            <cbc:ID schemeName="${d.custIdType}">${d.custId}</cbc:ID>
         </cac:PartyIdentification>
         <cac:PartyName>
            <cbc:Name>${x(d.custName)}</cbc:Name>
         </cac:PartyName>
         <cac:PhysicalLocation>
            <cac:Address>
               <cbc:ID>${d.custCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.custCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.custDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.custDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.custAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:Address>
         </cac:PhysicalLocation>
         <cac:PartyTaxScheme>
            <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
            <cbc:TaxLevelCode listName="49">R-99-PN</cbc:TaxLevelCode>
            <cac:RegistrationAddress>
               <cbc:ID>${d.custCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.custCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.custDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.custDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.custAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:RegistrationAddress>
            <cac:TaxScheme>
               <cbc:ID>ZZ</cbc:ID>
               <cbc:Name>No aplica</cbc:Name>
            </cac:TaxScheme>
         </cac:PartyTaxScheme>
         <cac:PartyLegalEntity>
            <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
         </cac:PartyLegalEntity>
         <cac:Contact>
            <cbc:ElectronicMail>${d.custEmail}</cbc:ElectronicMail>
         </cac:Contact>
         ${custPersonXml}
      </cac:Party>
   </cac:AccountingCustomerParty>`;

    // ── Base imponible y TaxTotals agrupados por tasa (FAS01a/FAS01b) ──────
    // La DIAN exige que haya exactamente un TaxTotal de cabecera por cada código
    // de tributo presente en las líneas, con el mismo ID, Name y Percent.
    interface TaxGroup { taxId: string; taxName: string; percent: number; taxableAmt: number; taxAmt: number; }
    const taxGroupsMap = new Map<string, TaxGroup>();
    for (const it of d.items) {
      if (it.taxAmount > 0) {
        const key = `${String(it.taxRate)}`; // agrupar por tasa (% IVA)
        const existing = taxGroupsMap.get(key);
        if (existing) {
          existing.taxableAmt += it.lineTotal;
          existing.taxAmt += it.taxAmount;
        } else {
          taxGroupsMap.set(key, { taxId: '01', taxName: 'IVA', percent: it.taxRate, taxableAmt: it.lineTotal, taxAmt: it.taxAmount });
        }
      }
    }
    // Si no hay ningún grupo con IVA, crear un bloque 0.00 para cumplir estructura
    const taxGroups: TaxGroup[] = taxGroupsMap.size > 0
      ? Array.from(taxGroupsMap.values())
      : [{ taxId: '01', taxName: 'IVA', percent: 0, taxableAmt: 0, taxAmt: 0 }];
    const taxableBase = taxGroups.reduce((s, g) => s + g.taxableAmt, 0);
    const headerTaxBlocks = [
      ...taxGroups.map(g => `   <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${d.currency}">${g.taxAmt.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
         <cbc:TaxableAmount currencyID="${d.currency}">${g.taxableAmt.toFixed(2)}</cbc:TaxableAmount>
         <cbc:TaxAmount currencyID="${d.currency}">${g.taxAmt.toFixed(2)}</cbc:TaxAmount>
         <cac:TaxCategory>
            <cbc:Percent>${g.percent.toFixed(2)}</cbc:Percent>
            <cac:TaxScheme>
               <cbc:ID>${g.taxId}</cbc:ID>
               <cbc:Name>${g.taxName}</cbc:Name>
            </cac:TaxScheme>
         </cac:TaxCategory>
      </cac:TaxSubtotal>
   </cac:TaxTotal>`),
      ...(d.taxIca > 0 ? [`   <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${d.currency}">${d.taxIca.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
         <cbc:TaxableAmount currencyID="${d.currency}">${(taxableBase > 0 ? taxableBase : d.subtotal).toFixed(2)}</cbc:TaxableAmount>
         <cbc:TaxAmount currencyID="${d.currency}">${d.taxIca.toFixed(2)}</cbc:TaxAmount>
         <cac:TaxCategory>
            <cbc:Percent>0.00</cbc:Percent>
            <cac:TaxScheme>
               <cbc:ID>03</cbc:ID>
               <cbc:Name>ICA</cbc:Name>
            </cac:TaxScheme>
         </cac:TaxCategory>
      </cac:TaxSubtotal>
   </cac:TaxTotal>`] : []),
    ].join('\n');

    // ── Items XML — con AllowanceCharge cuando hay descuento ──────────────
    const itemsXml = d.items.map(item => {
      // Precio bruto de la línea (antes de descuento)
      const grossLineTotal = item.discount > 0
        ? item.lineTotal + item.discount
        : item.lineTotal;
      const grossUnitPrice = item.discount > 0
        ? item.unitPrice + (item.discount / item.quantity)
        : item.unitPrice;

      // Bloque AllowanceCharge solo si hay descuento
      const allowanceBlock = item.discount > 0 ? `
      <cac:AllowanceCharge>
         <cbc:ID>1</cbc:ID>
         <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
         <cbc:AllowanceChargeReason>Descuento</cbc:AllowanceChargeReason>
         <cbc:MultiplierFactorNumeric>${((item.discount / grossLineTotal) * 100).toFixed(2)}</cbc:MultiplierFactorNumeric>
         <cbc:Amount currencyID="${d.currency}">${item.discount.toFixed(2)}</cbc:Amount>
         <cbc:BaseAmount currencyID="${d.currency}">${grossLineTotal.toFixed(2)}</cbc:BaseAmount>
      </cac:AllowanceCharge>` : '';

      // Bloque TaxTotal — solo cuando hay IVA
      const taxBlock = item.taxAmount > 0 ? `
      <cac:TaxTotal>
         <cbc:TaxAmount currencyID="${d.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
         <cbc:TaxEvidenceIndicator>false</cbc:TaxEvidenceIndicator>
         <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${d.currency}">${item.lineTotal.toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${d.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
            <cac:TaxCategory>
               <cbc:Percent>${item.taxRate.toFixed(2)}</cbc:Percent>
               <cac:TaxScheme>
                  <cbc:ID>01</cbc:ID>
                  <cbc:Name>IVA</cbc:Name>
               </cac:TaxScheme>
            </cac:TaxCategory>
         </cac:TaxSubtotal>
      </cac:TaxTotal>` : '';

      return `
   <cac:InvoiceLine>
      <cbc:ID>${item.lineId}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${item.unit}">${item.quantity.toFixed(6)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${d.currency}">${item.lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cbc:FreeOfChargeIndicator>false</cbc:FreeOfChargeIndicator>${allowanceBlock}${taxBlock}
      <cac:Item>
         <cbc:Description>${x(item.description)}</cbc:Description>
         <cac:SellersItemIdentification>
            <cbc:ID>${item.sku || String(item.lineId)}</cbc:ID>
         </cac:SellersItemIdentification>
         <cac:StandardItemIdentification>
            <cbc:ID schemeAgencyID="10" schemeID="${item.unspscCode ? '001' : '999'}" schemeName="${item.unspscCode ? 'UNSPSC' : 'Estandar de adopcion del contribuyente facturador'}">${item.unspscCode ?? (item.sku || String(item.lineId))}</cbc:ID>
         </cac:StandardItemIdentification>
      </cac:Item>
      <cac:Price>
         <cbc:PriceAmount currencyID="${d.currency}">${grossUnitPrice.toFixed(2)}</cbc:PriceAmount>
         <cbc:BaseQuantity unitCode="${item.unit}">${item.quantity.toFixed(6)}</cbc:BaseQuantity>
      </cac:Price>
   </cac:InvoiceLine>`;
    }).join('');

    // ── QRCode exactamente como el XML de ejemplo DIAN ────────────────────
    const qrCode = `NroFactura=${d.fullNumber}
NitFacturador=${d.supplierNit}
NitAdquiriente=${d.custId}
FechaFactura=${d.issueDate}
ValorTotalFactura=${d.total.toFixed(2)}
CUFE=${d.cufe}
URL=https://catalogo-vpfe${isHab ? '-hab' : ''}.dian.gov.co/Document/FindDocument?documentKey=${d.cufe}`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2     http://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/maindoc/UBL-Invoice-2.1.xsd">
   <ext:UBLExtensions>
      <ext:UBLExtension>
         <ext:ExtensionContent>
            <sts:DianExtensions>
               <sts:InvoiceControl>
                  <sts:InvoiceAuthorization>${d.resolucion}</sts:InvoiceAuthorization>
                  <sts:AuthorizationPeriod>
                     <cbc:StartDate>${d.fechaDesde}</cbc:StartDate>
                     <cbc:EndDate>${d.fechaHasta}</cbc:EndDate>
                  </sts:AuthorizationPeriod>
                  <sts:AuthorizedInvoices>
                     <sts:Prefix>${d.prefix}</sts:Prefix>
                     <sts:From>${d.rangoDesde}</sts:From>
                     <sts:To>${d.rangoHasta}</sts:To>
                  </sts:AuthorizedInvoices>
               </sts:InvoiceControl>
               <sts:InvoiceSource>
                  <cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode>
               </sts:InvoiceSource>
               <sts:SoftwareProvider>
                  <sts:ProviderID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</sts:ProviderID>
                  <sts:SoftwareID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)">${d.softwareId}</sts:SoftwareID>
               </sts:SoftwareProvider>
               <sts:SoftwareSecurityCode schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)">${d.ssc}</sts:SoftwareSecurityCode>
               <sts:AuthorizationProvider>
                  <sts:AuthorizationProviderID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">800197268</sts:AuthorizationProviderID>
               </sts:AuthorizationProvider>
               <sts:QRCode>${x(qrCode)}</sts:QRCode>
            </sts:DianExtensions>
         </ext:ExtensionContent>
      </ext:UBLExtension>
   
   <ext:UBLExtension><ext:ExtensionContent><!-- SIGNATURE_PLACEHOLDER --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
   <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
   <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
   <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
   <cbc:ProfileExecutionID>${d.profileExecutionId}</cbc:ProfileExecutionID>
   <cbc:ID>${d.fullNumber}</cbc:ID>
   <cbc:UUID schemeID="${d.profileExecutionId}" schemeName="CUFE-SHA384">${d.cufe}</cbc:UUID>
   <cbc:IssueDate>${d.issueDate}</cbc:IssueDate>
   <cbc:IssueTime>${d.issueTime}</cbc:IssueTime>
   <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
   <cbc:Note>${x(d.cufeInput)}</cbc:Note>
   <cbc:DocumentCurrencyCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listID="ISO 4217 Alpha">${d.currency}</cbc:DocumentCurrencyCode>
   <cbc:LineCountNumeric>${d.items.length}</cbc:LineCountNumeric>
   <cac:AccountingSupplierParty>
      <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
      <cac:Party>
         <cac:PartyName>
            <cbc:Name>${x(d.supplierName)}</cbc:Name>
         </cac:PartyName>
         <cac:PhysicalLocation>
            <cac:Address>
               <cbc:ID>${d.supplierCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.supplierCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.supplierDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.supplierDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.supplierAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.supplierCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:Address>
         </cac:PhysicalLocation>
         <cac:PartyTaxScheme>
            <cbc:RegistrationName>${x(d.supplierName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</cbc:CompanyID>
            <cbc:TaxLevelCode listName="05">O-99</cbc:TaxLevelCode>
            <cac:RegistrationAddress>
               <cbc:ID>${d.supplierCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.supplierCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.supplierDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.supplierDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.supplierAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.supplierCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:RegistrationAddress>
            <cac:TaxScheme>
               <cbc:ID>01</cbc:ID>
               <cbc:Name>IVA</cbc:Name>
            </cac:TaxScheme>
         </cac:PartyTaxScheme>
         <cac:PartyLegalEntity>
            <cbc:RegistrationName>${x(d.supplierName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</cbc:CompanyID>
            <cac:CorporateRegistrationScheme>
               <cbc:ID>${d.prefix}</cbc:ID>
            </cac:CorporateRegistrationScheme>
         </cac:PartyLegalEntity>
         <cac:Contact>
            <cbc:Telephone>${d.supplierPhone}</cbc:Telephone>
            <cbc:ElectronicMail>${d.supplierEmail}</cbc:ElectronicMail>
         </cac:Contact>
      </cac:Party>
   </cac:AccountingSupplierParty>
${customerPartyXml}
   <cac:PaymentMeans>
      <cbc:ID>2</cbc:ID>
      <cbc:PaymentMeansCode>${paymentMeansCode}</cbc:PaymentMeansCode>
      <cbc:PaymentDueDate>${d.dueDate}</cbc:PaymentDueDate>
   </cac:PaymentMeans>
${headerTaxBlocks}
   <cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="${d.currency}">${d.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="${d.currency}">${(taxableBase > 0 ? taxableBase : d.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="${d.currency}">${d.total.toFixed(2)}</cbc:TaxInclusiveAmount>
      <cbc:AllowanceTotalAmount currencyID="${d.currency}">${d.items.reduce((s, it) => s + (it.discount || 0), 0).toFixed(2)}</cbc:AllowanceTotalAmount>
      <cbc:ChargeTotalAmount currencyID="${d.currency}">0.00</cbc:ChargeTotalAmount>
      <cbc:PrepaidAmount currencyID="${d.currency}">0.00</cbc:PrepaidAmount>
      <cbc:PayableAmount currencyID="${d.currency}">${d.total.toFixed(2)}</cbc:PayableAmount>
   </cac:LegalMonetaryTotal>
${itemsXml}
</Invoice>`;
  }

  /**
   * Canonicaliza un fragmento XML aplicando C14N Inclusive manualmente:
   * 1. Inserta los 9 namespaces del Invoice root en el tag de apertura
   * 2. Expande los self-closing tags (<foo/> → <foo></foo>)
   * La DIAN verifica los digests y la firma sobre contenido C14N Inclusive,
   * que requiere ambas transformaciones para producir el hash correcto.
   */
  private toC14nString(fragment: string, openTag: string): string {
    const INVOICE_NS =
      ` xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"` +
      ` xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"` +
      ` xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"` +
      ` xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` +
      ` xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"` +
      ` xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"` +
      ` xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` +
      ` xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;
    // Extraer el nombre del tag (e.g. '<ds:KeyInfo ' → 'ds:KeyInfo')
    // para construir un regex que funcione tanto con atributos (<ds:KeyInfo Id="...">)
    // como sin atributos (<ds:SignedInfo>)
    const tagName = openTag.replace(/^</, '').replace(/[\s>].*$/, '');
    // Insertar INVOICE_NS justo antes del primer espacio o '>' después del nombre del tag
    const withNs = fragment.replace(
      new RegExp(`(<${tagName})([ >])`),
      `$1${INVOICE_NS}$2`,
    );
    // C14N Inclusive convierte self-closing <ds:Foo attr="x"/> → <ds:Foo attr="x"></ds:Foo>
    return withNs.replace(/<((?:ds|xades|xades141|sts):[A-Za-z]+)([^>]*)\/>/g, '<$1$2></$1>');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XAdES-BES SIGNATURE — estructura exacta según ejemplos DIAN v1.9
  // 3 References: (1) doc enveloped, (2) KeyInfo, (3) SignedProperties
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Limpia un PEM que puede venir con "Bag Attributes" de un pfx/p12 export
   * (openssl pkcs12 -nodes genera esos headers). Extrae solo el bloque PEM válido.
   * También normaliza saltos de línea y espacios.
   */
  private cleanPem(raw: string, type: 'CERTIFICATE' | 'PRIVATE KEY' | 'RSA PRIVATE KEY'): string {
    if (!raw) return raw;
    const marker = `-----BEGIN ${type}-----`;
    const idx = raw.indexOf(marker);
    return idx >= 0 ? raw.slice(idx).trim() : raw.trim();
  }

  private normalizePem(pem: string): string {
    return pem
      .replace(/\\n/g, '\n')  // Convierte los literales \n a saltos de línea
      .replace(/\r/g, '')      // Quita CR si viene de Windows
      .trim();                 // Quita espacios al inicio y final
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private signXmlPlaceholder(xml: string, certPem: string, keyPem: string, issueDateTime?: string): string {
    // ── Limpiar Bag Attributes que genera openssl pkcs12 ─────────────────────
    // Los certs de GSE/Andes vienen con "Bag Attributes\n  friendlyName:..." antes del PEM
    const rawCert = certPem;
    const rawKey = keyPem;

    // Detectar si la key es PKCS8 (BEGIN PRIVATE KEY) o PKCS1 (BEGIN RSA PRIVATE KEY)
    const keyType = rawKey.includes('BEGIN RSA PRIVATE KEY') ? 'RSA PRIVATE KEY' : 'PRIVATE KEY';
    const effectiveCert = this.cleanPem(rawCert, 'CERTIFICATE');
    const effectiveKey = this.cleanPem(rawKey, keyType);

    try {
      const { createSign, X509Certificate, randomUUID } = require('crypto');

      // Dos UUIDs distintos, igual que en el ejemplo DIAN
      const sigId = randomUUID();
      const keyInfoId = randomUUID();
      // Formato: 2026-03-10T15:30:00-05:00 (hora Colombia)
      // FAD09e: SigningTime DEBE coincidir con IssueDate+IssueTime del XML
      // Si se pasa issueDateTime lo usamos; si no, usamos now() como fallback
      const signingTime = issueDateTime ?? (new Date().toISOString().slice(0, 19) + '-05:00');

      // ── Cert info ────────────────────────────────────────────────────────
      const certBase64 = effectiveCert
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '');
      const certDer = Buffer.from(certBase64, 'base64');
      const certDigest = createHash('sha256').update(certDer).digest('base64');
      const cert = new X509Certificate(effectiveCert);

      // X509IssuerName en formato RFC 2253 sin espacio después de coma — como en los ejemplos DIAN:
      // "C=CO,L=Bogota D.C.,O=Andes SCD.,OU=...,CN=...,emailAddress=..."
      // Node.js X509Certificate.issuer devuelve las partes con \n, en orden reverso al RFC2253,
      // así que simplemente revertimos y unimos con "," (sin espacio)
      const issuerName = cert.issuer
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .reverse()
        .join(',');

      // SerialNumber: X509Certificate.serialNumber es hex, DIAN necesita decimal
      const serialDec = BigInt('0x' + cert.serialNumber).toString();

      // ── SignedProperties — digest exactamente como en los ejemplos DIAN ──
      // SIN xmlns en el elemento — los namespaces (xades, ds) vienen del scope
      // del Invoice root que los declara. El validador DIAN hace C14N sobre el
      // elemento en su contexto de namespaces heredados del documento.
      // Ref verificada contra Combustible.xml y Consumidor Final.xml de DIAN.
      const signedPropsXml =
        `<xades:SignedProperties Id="xmldsig-${sigId}-signedprops"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${issuerName}</ds:X509IssuerName><ds:X509SerialNumber>${serialDec}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>https://facturaelectronica.dian.gov.co/politicadefirma/v1/politicadefirmav2.pdf</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier><xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole></xades:SignedSignatureProperties></xades:SignedProperties>`;

      // ── KeyInfo XML (digest como Ref 2) ───────────────────────────────────
      const keyInfoXml =
        `<ds:KeyInfo Id="xmldsig-${keyInfoId}-keyinfo"><ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`;

      // ── Digests C14N Inclusive ────────────────────────────────────────────────
      // La DIAN verifica cada Reference aplicando C14N Inclusive al elemento en su
      // contexto dentro del documento. C14N Inclusive:
      //   1. Hereda los namespaces del elemento raíz Invoice (9 namespaces)
      //   2. Convierte self-closing tags <foo/> → <foo></foo>
      // toC14nString() aplica ambas transformaciones sin necesitar un parser XML.

      // docDigest: URI="" con transform enveloped-signature + C14N Inclusive
      // La DIAN aplica: (1) quitar <ds:Signature> del árbol (deja ExtensionContent vacío),
      // (2) C14N Inclusive del documento resultante.
      // C14N del documento = quitar declaración XML <?xml...?> + expandir self-closing tags.
      // El xml que recibimos tiene <!-- SIGNATURE_PLACEHOLDER --> → lo vaciamos antes de C14N.
      const xmlForDoc = xml.replace('<!-- SIGNATURE_PLACEHOLDER -->', '');
      const xmlC14n = xmlForDoc
        .replace(/^<\?xml[^?]+\?>\s*/s, '')                          // quitar declaración XML
        .replace(/<([A-Za-z][A-Za-z0-9:_.-]*)([^>]*)\/>/g, '<$1$2></$1>'); // expandir self-closing
      const docDigest = createHash('sha256').update(Buffer.from(xmlC14n, 'utf8')).digest('base64');

      // keyInfoDigest: elemento <ds:KeyInfo> canonicalizado
      // KeyInfo no tiene elementos self-closing → toC14nString solo agrega NS
      const keyInfoC14n = this.toC14nString(keyInfoXml, '<ds:KeyInfo ');
      const keyInfoDigest = createHash('sha256').update(Buffer.from(keyInfoC14n, 'utf8')).digest('base64');

      // propsDigest: elemento <xades:SignedProperties> canonicalizado
      // SignedProperties tiene <ds:DigestMethod .../> → toC14nString expande self-closing
      const signedPropsC14n = this.toC14nString(signedPropsXml, '<xades:SignedProperties ');
      const propsDigest = createHash('sha256').update(Buffer.from(signedPropsC14n, 'utf8')).digest('base64');

      // ── SignedInfo — 3 referencias exactamente como DIAN ─────────────────
      // Contenido del SignedInfo (idéntico en versión a firmar y versión a insertar)
      const signedInfoContent =
        `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
        `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
        `<ds:Reference Id="xmldsig-${sigId}-ref0" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${docDigest}</ds:DigestValue></ds:Reference>` +
        `<ds:Reference URI="#xmldsig-${keyInfoId}-keyinfo"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${keyInfoDigest}</ds:DigestValue></ds:Reference>` +
        `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xmldsig-${sigId}-signedprops"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${propsDigest}</ds:DigestValue></ds:Reference>`;

      // Versión para FIRMAR: con todos los namespaces heredados del Invoice root (C14N Inclusive)
      // Versión para INSERTAR en el XML: sin namespaces (los hereda del documento)
      const signedInfoXml = `<ds:SignedInfo>${signedInfoContent}</ds:SignedInfo>`;

      // Versión para FIRMAR: C14N Inclusive completo (NS heredados + self-closing expandidos)
      const signedInfoC14n = this.toC14nString(signedInfoXml, '<ds:SignedInfo>');

      // ── Firma RSA-SHA256 sobre el SignedInfo canonicalizado ───────────────
      const signer = createSign('RSA-SHA256');
      signer.update(signedInfoC14n, 'utf8');  // ← firmar C14N correcto
      const sigValue = signer.sign(effectiveKey).toString('base64');

      // ── Bloque Signature final ────────────────────────────────────────────
      const sigBlock =
        `<ds:Signature Id="xmldsig-${sigId}">
${signedInfoXml}
<ds:SignatureValue Id="xmldsig-${sigId}-sigvalue">
${sigValue}
</ds:SignatureValue>
${keyInfoXml}
<ds:Object><xades:QualifyingProperties Target="#xmldsig-${sigId}"><xades:SignedProperties Id="xmldsig-${sigId}-signedprops"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${issuerName}</ds:X509IssuerName><ds:X509SerialNumber>${serialDec}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>https://facturaelectronica.dian.gov.co/politicadefirma/v1/politicadefirmav2.pdf</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier><xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole></xades:SignedSignatureProperties></xades:SignedProperties></xades:QualifyingProperties></ds:Object>
</ds:Signature>`;

      return xml.replace('<!-- SIGNATURE_PLACEHOLDER -->', sigBlock);
    } catch (e) {
      this.logger.error(`[DIAN] XML signing failed: ${(e as Error).message}`);
      throw new Error(`No se pudo firmar el XML: ${(e as Error).message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZIP compression
  // ══════════════════════════════════════════════════════════════════════════

  private createZip(filename: string, content: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = (archiver as any)('zip', { zlib: { level: 9 } });
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.append(Buffer.from(content, 'utf8'), { name: filename });
      archive.finalize();
    });
  }

  private createArchive(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = (archiver as any)('zip', { zlib: { level: 9 } });
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      for (const file of files) {
        archive.append(file.content, { name: file.name });
      }
      archive.finalize();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOAP CLIENTS — DIAN WebServices
  // ══════════════════════════════════════════════════════════════════════════

  /** SendTestSetAsync — habilitación environment */
  private async soapSendTestSetAsync(p: { zipFileName: string; zipBase64: string; testSetId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianSoapResult> {
    // CRÍTICO: sin whitespace ni saltos de línea — el bodyContent para el digest usa este mismo string
    const body = `<wcf:SendTestSetAsync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile><wcf:testSetId>${p.testSetId}</wcf:testSetId></wcf:SendTestSetAsync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendTestSetAsync', p.certPem, p.keyPem);
    const zipKey = this.extractTag(raw, 'b:ZipKey') || this.extractTag(raw, 'ZipKey');
    const errors = this.extractAllTags(raw, 'b:processedMessage');
    return { success: !!zipKey, zipKey, errorMessages: errors, raw };
  }

  /** SendBillAsync — production */
  private async soapSendBillAsync(p: { zipFileName: string; zipBase64: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianSoapResult> {
    const body = `<wcf:SendBillAsync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile></wcf:SendBillAsync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendBillAsync', p.certPem, p.keyPem);
    const zipKey = this.extractTag(raw, 'b:ZipKey') || this.extractTag(raw, 'ZipKey');
    const errors = this.extractAllTags(raw, 'b:processedMessage');
    return { success: !!zipKey && errors.length === 0, zipKey, errorMessages: errors, raw };
  }

  /** SendBillSync — producción, envío sincrónico con ZIP (retorna validación inmediata en vez de ZipKey) */
  private async soapSendBillSync(p: { zipFileName: string; zipBase64: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    // Igual que SendBillAsync pero síncrono: DIAN recibe el mismo ZIP y devuelve IsValid+StatusCode directamente.
    const body = `<wcf:SendBillSync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile></wcf:SendBillSync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendBillSync', p.certPem, p.keyPem);
    return this.parseStatusResponse(raw);
  }

  /** GetStatus — query by CUFE */
  private async soapGetStatus(p: { trackId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    const body = `<wcf:GetStatus><wcf:trackId>${p.trackId}</wcf:trackId></wcf:GetStatus>`;
    const raw = await this.soapCall(p.wsUrl, body, 'GetStatus', p.certPem, p.keyPem);
    return this.parseStatusResponse(raw);
  }

  /** GetStatusZip — query batch by ZipKey */
  private async soapGetStatusZip(p: { trackId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    const body = `<wcf:GetStatusZip><wcf:trackId>${p.trackId}</wcf:trackId></wcf:GetStatusZip>`;
    const raw = await this.soapCall(p.wsUrl, body, 'GetStatusZip', p.certPem, p.keyPem);
    return this.parseStatusResponse(raw);
  }

  async getDianNumberingRange(params: {
    accountCode: string;
    accountCodeT?: string;
    softwareCode: string;
    certPem: string;
    keyPem: string;
    wsUrl?: string;
  }) {
    const wsUrl = params.wsUrl || DIAN_WS_PROD;
    const body =
      `<wcf:GetNumberingRange>` +
      `<wcf:accountCode>${params.accountCode}</wcf:accountCode>` +
      `<wcf:accountCodeT>${params.accountCodeT || params.accountCode}</wcf:accountCodeT>` +
      `<wcf:softwareCode>${params.softwareCode}</wcf:softwareCode>` +
      `</wcf:GetNumberingRange>`;

    const raw = await this.soapCall(
      wsUrl,
      body,
      'GetNumberingRange',
      this.normalizePem(params.certPem),
      this.normalizePem(params.keyPem),
    );

    const operationCode = this.extractTagLoose(raw, 'OperationCode') || '';
    const operationDescription = this.extractTagLoose(raw, 'OperationDescription') || '';
    const responseBlocks = this.extractBlocksLoose(raw, 'NumberRangeResponse');

    const ranges = responseBlocks.map((block) => ({
      resolutionNumber: this.extractTagLoose(block, 'ResolutionNumber') || '',
      resolutionDate: this.extractTagLoose(block, 'ResolutionDate') || '',
      prefix: this.extractTagLoose(block, 'Prefix') || '',
      fromNumber: Number(this.extractTagLoose(block, 'FromNumber') || 0) || 0,
      toNumber: Number(this.extractTagLoose(block, 'ToNumber') || 0) || 0,
      validDateFrom: this.extractTagLoose(block, 'ValidDateFrom') || '',
      validDateTo: this.extractTagLoose(block, 'ValidDateTo') || '',
      technicalKey: this.extractTagLoose(block, 'TechnicalKey') || '',
    }));

    return {
      operationCode,
      operationDescription,
      ranges,
      raw,
    };
  }

  private parseStatusResponse(raw: string): DianStatusResult {
    return {
      isValid: this.extractTag(raw, 'b:IsValid') === 'true',
      statusCode: this.extractTag(raw, 'b:StatusCode'),
      statusDescription: this.extractTag(raw, 'b:StatusDescription'),
      statusMessage: this.extractTag(raw, 'b:StatusMessage'),
      xmlBase64: this.extractTag(raw, 'b:XmlBase64Bytes'),
      trackId: this.extractTag(raw, 'b:XmlDocumentKey') || this.extractTag(raw, 'b:xmlDocumentKey'),
      errorMessages: this.extractAllTags(raw, 'c:string'),
      raw,
    };
  }

  /**
   * WS-Security header para DIAN.
   *
   * Ambiente HABILITACIÓN (SendTestSetAsync):
   *   La DIAN HAB NO requiere firma del mensaje SOAP — acepta <soap:Header/>
   *   vacío. El header complejo con X.509 sólo es requerido en PRODUCCIÓN.
   *
   * Ambiente PRODUCCIÓN:
   *   Requiere BinarySecurityToken + Signature RSA-SHA256 con certificado
   *   digital expedido por entidad certificadora avalada por ONAC en Colombia.
   */
  private buildWsSecurityHeader(certPem?: string, keyPem?: string): string {
    // Sin certificado real → header vacío (válido para habilitación)
    if (!certPem || !keyPem || certPem.includes('PLACEHOLDER') || certPem.includes('PENDING')) {
      return `<soap:Header/>`;
    }

    // Con certificado real → BinarySecurityToken + Timestamp + Signature
    try {
      const { createSign } = require('crypto');
      const now = new Date();
      const created = now.toISOString().replace(/\.\d{3}Z$/, '.000Z');
      const expires = new Date(now.getTime() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
      const tsId = `TS-${randomBytes(8).toString('hex')}`;
      const bstId = `BST-${randomBytes(8).toString('hex')}`;
      const sigId = `SIG-${randomBytes(8).toString('hex')}`;

      const certBase64 = certPem
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '');

      const timestampXml = `<wsu:Timestamp xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" wsu:Id="${tsId}"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>`;
      const tsDigest = createHash('sha256').update(timestampXml, 'utf8').digest('base64');

      const signedInfoXml = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI="#${tsId}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${tsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

      const signer = createSign('RSA-SHA256');
      signer.update(signedInfoXml, 'utf8');
      const sigValue = signer.sign(keyPem, 'base64');

      return `<soap:Header>
  <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
                 xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
                 soap:mustUnderstand="1">
    <wsu:Timestamp wsu:Id="${tsId}">
      <wsu:Created>${created}</wsu:Created>
      <wsu:Expires>${expires}</wsu:Expires>
    </wsu:Timestamp>
    <wsse:BinarySecurityToken
        wsu:Id="${bstId}"
        ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"
        EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${certBase64}</wsse:BinarySecurityToken>
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${sigId}">
      ${signedInfoXml}
      <ds:SignatureValue>${sigValue}</ds:SignatureValue>
      <ds:KeyInfo>
        <wsse:SecurityTokenReference>
          <wsse:Reference URI="#${bstId}"
            ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>
        </wsse:SecurityTokenReference>
      </ds:KeyInfo>
    </ds:Signature>
  </wsse:Security>
</soap:Header>`;
    } catch (e) {
      this.logger.warn(`[DIAN] WS-Security header failed: ${(e as Error).message}`);
      return `<soap:Header/>`;
    }
  }

  /**
   * ExcC14N (Exclusive Canonicalization) puro en TypeScript.
   *
   * Orden de namespace declarations según el estándar XML-ExcC14N + comportamiento de WSS4J/lxml:
   *   1. Primero los prefijos del InclusiveNamespaces PrefixList (en el orden dado)
   *   2. Luego los prefijos utilizados por el elemento (element prefix, attribute prefixes)
   *      ordenados por local name del prefijo
   *   Nunca se repite un prefijo.
   *
   * Para wsa:To con InclusiveNamespaces="soap wcf":
   *   soap, wcf  (InclusiveNamespaces, en ese orden)
   *   wsa        (prefijo del elemento)
   *   wsu        (prefijo de atributo wsu:Id)
   *
   * Para ds:SignedInfo con InclusiveNamespaces="wsa soap wcf":
   *   wsa, soap, wcf  (InclusiveNamespaces)
   *   ds              (prefijo del elemento)
   *   ec              (prefijo usado en hijos — ignorado en el elemento raíz)
   */
  private excC14nElement(
    elementXml: string,
    inheritedNs: Record<string, string>,
    inclusiveNsPrefixes: string[],
  ): string {
    // Tag de apertura del elemento raíz
    const ownNsMatch = elementXml.match(/^<[^>]+>/)?.[0] ?? '';

    // Extraer namespace declarations propias del elemento
    const ownNs: Record<string, string> = {};
    for (const m of ownNsMatch.matchAll(/xmlns:(\w+)="([^"]+)"/g)) {
      ownNs[m[1]] = m[2];
    }

    // Todos los namespaces en scope
    const allNs = { ...inheritedNs, ...ownNs };

    // Prefijos visiblemente usados: prefijo del element + prefijos en atributos
    const tagMatch = elementXml.match(/^<(\w+):/);
    const elemPrefix = tagMatch?.[1] ?? '';
    const usedByElem = new Set<string>();
    if (elemPrefix) usedByElem.add(elemPrefix);
    for (const m of ownNsMatch.matchAll(/ (\w+):[\w]+=["'][^"']*["']/g)) {
      if (m[1] !== 'xmlns') usedByElem.add(m[1]);
    }

    // Orden final: todos los prefijos a incluir, ordenados alfabéticamente por prefijo
    // (regla del estándar XML C14N — ExcC14N mantiene el mismo orden para ns declarations)
    const allPrefixes = new Set<string>();
    for (const p of inclusiveNsPrefixes) {
      if (allNs[p]) allPrefixes.add(p);
    }
    for (const p of usedByElem) {
      if (allNs[p]) allPrefixes.add(p);
    }
    const ordered = [...allPrefixes].sort();

    // Construir el tag de apertura con declarations en el orden correcto
    const nsDecls = ordered.map(p => ` xmlns:${p}="${allNs[p]}"`).join('');
    let openTag = ownNsMatch.replace(/ xmlns:\w+="[^"]+"/g, '');
    openTag = openTag.replace(/^(<\S+)/, `$1${nsDecls}`);

    return openTag + elementXml.slice(ownNsMatch.length);
  }

  /**
   * Low-level SOAP HTTP POST — DIAN WCF (SOAP 1.2 + WS-Addressing + WS-Security)
   *
   * FIX DEFINITIVO: ExcC14N implementado en TypeScript puro (sin Python).
   * El error InvalidSecurity ocurría porque el orden de namespace declarations era incorrecto.
   * ExcC14N ordena por namespace URI, no por prefijo. Firmar el string raw produce una firma
   * que el servidor no puede verificar (canonicaliza diferente).
   */
  private soapCall(wsUrl: string, soapBody: string, action: string, certPem: string, keyPem: string): Promise<string> {
    const effectiveCert = this.cleanPem(certPem, 'CERTIFICATE');
    const effectiveKey = this.cleanPem(
      keyPem,
      keyPem.includes('BEGIN RSA PRIVATE KEY') ? 'RSA PRIVATE KEY' : 'PRIVATE KEY',
    );

    const actionUri = `http://wcf.dian.colombia/IWcfDianCustomerServices/${action}`;
    const now = new Date();
    const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const expires = new Date(now.getTime() + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const rand = () => randomBytes(17).toString('hex').toUpperCase();
    const tsId = `TS-${rand()}`;
    const bstId = `X509-${rand()}`;
    const sigId = `SIG-${rand()}`;
    const kiId = `KI-${rand()}`;
    const strId = `STR-${rand()}`;
    const toId = `id-${rand()}`;

    const certBase64 = effectiveCert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

    const SOAP_NS = 'http://www.w3.org/2003/05/soap-envelope';
    const WCF_NS = 'http://wcf.dian.colombia';
    const WSA_NS = 'http://www.w3.org/2005/08/addressing';
    const WSU_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
    const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
    const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
    const EC_NS = 'http://www.w3.org/2001/10/xml-exc-c14n#';

    // Namespaces heredados del contexto del Envelope (los que están en scope cuando
    // el servidor canonicaliza wsa:To y ds:SignedInfo)
    const envelopeNs: Record<string, string> = { soap: SOAP_NS, wcf: WCF_NS };
    const headerNs: Record<string, string> = { ...envelopeNs, wsa: WSA_NS };
    const securityNs: Record<string, string> = { ...headerNs, wsse: WSSE_NS, wsu: WSU_NS };
    const sigNs: Record<string, string> = { ...securityNs, ds: DS_NS };

    // ── 1. Digest de wsa:To con ExcC14N, InclusiveNamespaces="soap wcf" ───────
    // El elemento tiene wsu:Id (usa wsu:) y xmlns:wsu inline.
    // Namespaces en scope: headerNs + wsse + wsu (de Security) + wsu inline propio
    const toRaw = `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${wsUrl}</wsa:To>`;
    const toC14n = this.excC14nElement(toRaw, headerNs, ['soap', 'wcf']);
    const toDigest = createHash('sha256').update(toC14n, 'utf8').digest('base64');

    // ── 2. Construir SignedInfo en forma c14n directamente ────────────────────
    // Reglas C14N aplicadas manualmente (verificadas contra lxml):
    //   1. Namespace declarations en opening tag ordenadas alfabéticamente por prefijo:
    //      ds < soap < wcf < wsa
    //   2. xmlns:ec va ANTES de PrefixList en ec:InclusiveNamespaces (orden alfa de atributos)
    //   3. Elementos vacíos se expanden: <X/> → <X></X>
    //   4. Sin whitespace extra entre elementos
    const signedInfoC14n =
      `<ds:SignedInfo` +
      ` xmlns:ds="${DS_NS}"` +
      ` xmlns:soap="${SOAP_NS}"` +
      ` xmlns:wcf="${WCF_NS}"` +
      ` xmlns:wsa="${WSA_NS}">` +
      `<ds:CanonicalizationMethod Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces xmlns:ec="${EC_NS}" PrefixList="wsa soap wcf">` +
      `</ec:InclusiveNamespaces>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256">` +
      `</ds:SignatureMethod>` +
      `<ds:Reference URI="#${toId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces xmlns:ec="${EC_NS}" PrefixList="soap wcf">` +
      `</ec:InclusiveNamespaces>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">` +
      `</ds:DigestMethod>` +
      `<ds:DigestValue>${toDigest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;

    // SignedInfo raw para el envelope (formato normal, sin expansión c14n)
    const signedInfoRaw =
      `<ds:SignedInfo>` +
      `<ds:CanonicalizationMethod Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces PrefixList="wsa soap wcf" xmlns:ec="${EC_NS}"/>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${toId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces PrefixList="soap wcf" xmlns:ec="${EC_NS}"/>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
      `<ds:DigestValue>${toDigest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;

    // ── 4. Firmar los bytes canonicalizados del SignedInfo ─────────────────────
    const signer = createSign('RSA-SHA256');
    signer.update(signedInfoC14n, 'utf8');
    const sigValue = signer.sign(effectiveKey, 'base64');

    // ── 5. Construir el envelope final ────────────────────────────────────────
    const envelope =
      `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:wcf="${WCF_NS}">` +
      `<soap:Header xmlns:wsa="${WSA_NS}">` +
      `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}">` +
      `<wsu:Timestamp wsu:Id="${tsId}">` +
      `<wsu:Created>${created}</wsu:Created>` +
      `<wsu:Expires>${expires}</wsu:Expires>` +
      `</wsu:Timestamp>` +
      `<wsse:BinarySecurityToken` +
      ` EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"` +
      ` ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"` +
      ` wsu:Id="${bstId}">${certBase64}</wsse:BinarySecurityToken>` +
      `<ds:Signature Id="${sigId}" xmlns:ds="${DS_NS}">` +
      signedInfoRaw +
      `<ds:SignatureValue>${sigValue}</ds:SignatureValue>` +
      `<ds:KeyInfo Id="${kiId}">` +
      `<wsse:SecurityTokenReference wsu:Id="${strId}">` +
      `<wsse:Reference URI="#${bstId}"` +
      ` ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>` +
      `</wsse:SecurityTokenReference>` +
      `</ds:KeyInfo>` +
      `</ds:Signature>` +
      `</wsse:Security>` +
      `<wsa:Action>${actionUri}</wsa:Action>` +
      `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${wsUrl}</wsa:To>` +
      `</soap:Header>` +
      `<soap:Body>${soapBody}</soap:Body>` +
      `</soap:Envelope>`;

    this.logger.debug(`[DIAN] toC14n: ${toC14n}`);
    this.logger.debug(`[DIAN] siC14n: ${signedInfoC14n.slice(0, 200)}...`);
    this.logger.debug(`[DIAN] toDigest: ${toDigest}`);
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const lib = u.protocol === 'https:' ? https : http;

      const agent = u.protocol === 'https:'
        ? new (require('https').Agent)({
          cert: effectiveCert,
          key: effectiveKey,
          rejectUnauthorized: false,
          keepAlive: false,
        })
        : undefined;

      const bodyBuf = Buffer.from(envelope, 'utf8');
      const opt = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${actionUri}"`,
          'Content-Length': bodyBuf.length,
        },
        agent,
        timeout: 60000,
      };

      const req = (lib as any).request(opt, (res: any) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          this.logger.debug(`[DIAN SOAP] ${action} HTTP ${res.statusCode}:\n${data.slice(0, 600)}...`);
          resolve(data);
        });
      });
      req.on('error', (e: any) => {
        this.logger.error(`[DIAN SOAP] ${action} network error: ${e.code} - ${e.message}`);
        reject(e);
      });
      req.on('timeout', () => {
        req.destroy();
        this.logger.error(`[DIAN SOAP] ${action} timeout after 60s`);
        reject(new Error(`DIAN timeout: ${action}`));
      });
      req.write(bodyBuf);
      req.end();
    });
  }

  // ── XML helpers ───────────────────────────────────────────────────────────
  private extractTag(xml: string, tag: string): string | undefined {
    const s = xml.indexOf(`<${tag}>`);
    if (s === -1) return undefined;
    const e = xml.indexOf(`</${tag}>`, s);
    return e === -1 ? undefined : xml.substring(s + tag.length + 2, e).trim();
  }

  private extractTagLoose(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
    return match?.[1]?.trim();
  }

  private extractAllTags(xml: string, tag: string): string[] {
    const r: string[] = [];
    let pos = 0;
    while (true) {
      const s = xml.indexOf(`<${tag}>`, pos);
      if (s === -1) break;
      const e = xml.indexOf(`</${tag}>`, s);
      if (e === -1) break;
      r.push(xml.substring(s + tag.length + 2, e).trim());
      pos = e + tag.length + 3;
    }
    return r;
  }

  private extractBlocksLoose(xml: string, tag: string): string[] {
    return Array.from(
      xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g')),
    ).map((match) => match[1]);
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  private toColombiaDate(d: Date): string {
    // YYYY-MM-DD in UTC-5
    const offset = d.getTime() - 5 * 60 * 60 * 1000;
    return new Date(offset).toISOString().split('T')[0];
  }

  private toColombiaTime(d: Date): string {
    // HH:mm:ss-05:00
    const offset = d.getTime() - 5 * 60 * 60 * 1000;
    const t = new Date(offset).toISOString().split('T')[1].split('.')[0];
    return `${t}-05:00`;
  }

  // ── Invoice number ────────────────────────────────────────────────────────
  private async getNextInvoiceNumber(companyId: string, prefix: string, rangeFrom?: number): Promise<string> {
    const last = await this.prisma.invoice.findFirst({
      where: { companyId, prefix, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });
    const start = Number(rangeFrom ?? 1);
    const startWidth = Math.max(4, String(start).length);
    if (!last) {
      return `${prefix}-${String(start).padStart(startWidth, '0')}`;
    }
    const parts = last.invoiceNumber.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0') + 1;
    const width = Math.max(4, String(num).length, startWidth);
    return `${prefix}-${String(num).padStart(width, '0')}`;
  }



  // ── QR Code generator (TypeScript puro, sin dependencias) ─────────────────
  // Soporta modo byte, versiones 1-10, ECC nivel M
  // Suficiente para URLs DIAN de hasta ~174 caracteres
  private async qrGenSvg(text: string): Promise<string> {
    if (!text?.trim()) return '';
    return QRCode.toString(text, {
      type: 'svg',
      width: 220,
      margin: 2,
    });
  }

  async generatePdf(companyId: string, branchId: string, invoiceId: string): Promise<Buffer> {
    const { invoice, company } = await this.getInvoiceRenderContext(companyId, branchId, invoiceId);

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
    const svgQR = invoice.dianQrCode ? await this.qrGenSvg(invoice.dianQrCode) : '';

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
    <div style="display:flex;align-items:flex-start;gap:20px;">
      <div style="flex:1;min-width:0;">
        <p style="font-size:10px;word-break:break-all;margin-bottom:6px;"><strong>CUFE:</strong> ${invoice.dianCufe}</p>
        ${invoice.dianQrCode ? `<p style="font-size:10px;word-break:break-all;"><strong>URL:</strong> ${invoice.dianQrCode}</p>` : ''}
      </div>
      ${invoice.dianQrCode ? `<div style="flex-shrink:0;">${svgQR}</div>` : ''}
    </div>
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

  private async getInvoiceRenderContext(companyId: string, branchId: string, invoiceId: string) {
    const invoice = await this.findOne(companyId, branchId, invoiceId);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });
    return { invoice, company };
  }

  private async buildInvoicePdfBuffer(invoice: any, company: any): Promise<Buffer> {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 34;
    const topMargin = 36;
    const bottomMargin = 36;
    const contentWidth = pageWidth - marginX * 2;
    const colors = {
      navy: [19, 52, 99] as [number, number, number],
      blue: [36, 99, 235] as [number, number, number],
      slate: [71, 85, 105] as [number, number, number],
      text: [15, 23, 42] as [number, number, number],
      muted: [100, 116, 139] as [number, number, number],
      line: [203, 213, 225] as [number, number, number],
      soft: [241, 245, 249] as [number, number, number],
      greenBg: [220, 252, 231] as [number, number, number],
      greenText: [22, 101, 52] as [number, number, number],
      amberBg: [254, 243, 199] as [number, number, number],
      amberText: [146, 64, 14] as [number, number, number],
      redBg: [254, 226, 226] as [number, number, number],
      redText: [153, 27, 27] as [number, number, number],
      white: [255, 255, 255] as [number, number, number],
      black: [0, 0, 0] as [number, number, number],
    };
    const fmtCOP = (v: any) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(v ?? 0));
    const fmtDate = (d: any) =>
      d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    const displayNumber = this.getInvoiceDisplayNumber(invoice);
    const typeLabel = (t: string) =>
      ({ VENTA: 'FACTURA DE VENTA', NOTA_CREDITO: 'NOTA CREDITO', NOTA_DEBITO: 'NOTA DEBITO' }[t] ?? t ?? 'FACTURA');
    const statusLabel = (s: string) =>
      ({ DRAFT: 'BORRADOR', SENT_DIAN: 'ENVIADA DIAN', ACCEPTED_DIAN: 'ACEPTADA DIAN', PAID: 'PAGADA', CANCELLED: 'ANULADA', OVERDUE: 'VENCIDA' }[s] ?? s ?? '-');
    const statusStyle = (status: string) => {
      if (status === 'PAID' || status === 'ACCEPTED_DIAN') return { bg: colors.greenBg, text: colors.greenText };
      if (status === 'DRAFT' || status === 'SENT_DIAN' || status === 'ISSUED') return { bg: colors.amberBg, text: colors.amberText };
      if (status === 'CANCELLED' || status === 'REJECTED_DIAN' || status === 'OVERDUE') return { bg: colors.redBg, text: colors.redText };
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
    const pdfUrlSafe = (value: any) =>
      normalizeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
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
          if (current) {
            lines.push(current);
            current = '';
          }
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

    const qrData = invoice.dianQrCode ? QRCode.create(invoice.dianQrCode, { errorCorrectionLevel: 'M' }) : null;
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
    const setFill = (rgb: [number, number, number]) => commands.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} rg`);
    const setStroke = (rgb: [number, number, number]) => commands.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} RG`);
    const setLineWidth = (width: number) => commands.push(`${width.toFixed(2)} w`);
    const addRect = (x: number, topY: number, width: number, height: number, mode: 'S' | 'f' | 'B' = 'S') => {
      commands.push(`${x.toFixed(2)} ${toPdfY(topY + height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${mode}`);
    };
    const addLine = (x1: number, topY1: number, x2: number, topY2: number) => {
      commands.push(`${x1.toFixed(2)} ${toPdfY(topY1).toFixed(2)} m ${x2.toFixed(2)} ${toPdfY(topY2).toFixed(2)} l S`);
    };
    const addLink = (x: number, topY: number, width: number, height: number, url: string) => {
      const rect = [
        x.toFixed(2),
        toPdfY(topY + height).toFixed(2),
        (x + width).toFixed(2),
        toPdfY(topY).toFixed(2),
      ].join(' ');
      annotations.push(`<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${rect}] /A << /S /URI /URI (${pdfUrlSafe(url)}) >> >>`);
    };
    const addText = (text: any, x: number, topY: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const font = options?.font ?? 'F1';
      if (options?.color) setFill(options.color);
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${toPdfY(topY).toFixed(2)} Tm (${pdfSafe(text) || '-'}) Tj ET`);
    };
    const addRightText = (text: any, rightX: number, topY: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const normalized = normalizeText(text) || '-';
      const width = estimateTextWidth(normalized, size);
      addText(normalized, Math.max(marginX, rightX - width), topY, options);
    };
    const drawTextBlock = (lines: string[], x: number, topY: number, lineHeight: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      lines.forEach((line, idx) => addText(line, x, topY + idx * lineHeight, options));
    };
    const drawLabelValueRows = (
      rows: Array<{ label: string; value: string[] }>,
      x: number,
      topY: number,
      width: number,
      options?: { valueAlign?: 'left' | 'right'; labelWidth?: number },
    ) => {
      let cursorY = topY;
      const valueAlign = options?.valueAlign ?? 'right';
      const labelWidth = options?.labelWidth ?? 70;
      for (const row of rows) {
        addText(row.label, x, cursorY, { size: 9, font: 'F2', color: colors.muted });
        row.value.forEach((line, idx) => {
          if (valueAlign === 'left') {
            addText(line, x + labelWidth, cursorY + idx * 11, { size: 10, color: colors.text });
          } else {
            addRightText(line, x + width, cursorY + idx * 11, { size: 10, color: colors.text });
          }
        });
        cursorY += Math.max(16, row.value.length * 11 + 4);
      }
      return cursorY - topY;
    };
    const drawQr = (x: number, topY: number, size: number) => {
      if (!qrData) return;
      const modules: any = qrData.modules;
      const count = modules.size;
      const padding = 6;
      setFill(colors.white);
      setStroke(colors.line);
      setLineWidth(0.6);
      addRect(x, topY, size, size, 'B');
      const inner = size - padding * 2;
      const cell = inner / count;
      setFill(colors.black);
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          const isDark = modules.get ? modules.get(row, col) : modules.data[row * count + col];
          if (!isDark) continue;
          addRect(x + padding + col * cell, topY + padding + row * cell, cell + 0.15, cell + 0.15, 'f');
        }
      }
    };
    const sectionTitle = (title: string, accent: [number, number, number] = colors.navy) => {
      ensureSpace(28);
      setFill(accent);
      addRect(marginX, y, 4, 14, 'f');
      addText(title, marginX + 12, y + 11, { size: 12, font: 'F2', color: colors.text });
      y += 24;
    };

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

    const metaWidth = 202;
    const metaX = pageWidth - marginX - metaWidth;
    const metaY = 34;
    setFill(colors.white);
    addRect(metaX, metaY, metaWidth, 74, 'f');
    setStroke([214, 223, 233]);
    setLineWidth(0.8);
    addRect(metaX, metaY, metaWidth, 74, 'S');
    addText(typeLabel(invoice.type), metaX + 14, metaY + 18, { size: 12, font: 'F2', color: colors.navy });
    addText(displayNumber, metaX + 14, metaY + 40, { size: 21, font: 'F2', color: colors.text });
    addText(`Emision ${fmtDate(invoice.issueDate)}`, metaX + 14, metaY + 56, { size: 9, color: colors.muted });
    if (invoice.dueDate) addText(`Vence ${fmtDate(invoice.dueDate)}`, metaX + 108, metaY + 56, { size: 9, color: colors.muted });

    const badge = statusStyle(invoice.status);
    const badgeWidth = Math.max(70, estimateTextWidth(statusLabel(invoice.status), 9) + 20);
    setFill(badge.bg);
    addRect(metaX + metaWidth - badgeWidth, metaY + 82, badgeWidth, 18, 'f');
    addText(statusLabel(invoice.status), metaX + metaWidth - badgeWidth + 10, metaY + 94, { size: 9, font: 'F2', color: badge.text });

    y = 140;

    const cardGap = 14;
    const cardWidth = (contentWidth - cardGap) / 2;
    const customerRows = [
      { label: 'Cliente', value: wrapText(invoice.customer?.name ?? '-', 150, 10) },
      { label: 'Documento', value: wrapText(invoice.customer?.documentNumber ?? '-', 150, 10) },
      ...(invoice.customer?.email ? [{ label: 'Email', value: wrapText(invoice.customer.email, 150, 10) }] : []),
      ...(invoice.customer?.phone ? [{ label: 'Telefono', value: wrapText(invoice.customer.phone, 150, 10) }] : []),
      ...(invoice.customer?.address ? [{ label: 'Direccion', value: wrapText(invoice.customer.address, 150, 10) }] : []),
    ];
    const summaryRows = [
      { label: 'Moneda', value: [normalizeText(invoice.currency ?? 'COP')] },
      { label: 'Subtotal', value: [normalizeText(fmtCOP(invoice.subtotal))] },
      { label: 'IVA', value: [normalizeText(fmtCOP(invoice.taxAmount))] },
      { label: 'Descuento', value: [normalizeText(fmtCOP(invoice.discountAmount ?? 0))] },
      { label: 'Total', value: [normalizeText(fmtCOP(invoice.total))] },
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
    drawLabelValueRows(customerRows, marginX + 14, y + 44, cardWidth - 28, { valueAlign: 'left', labelWidth: 70 });
    drawLabelValueRows(summaryRows, marginX + cardWidth + cardGap + 14, y + 44, cardWidth - 28, { valueAlign: 'right' });
    y += infoCardHeight + 18;

    sectionTitle(`Detalle de productos / servicios (${Array.isArray(invoice.items) ? invoice.items.length : 0})`, colors.blue);

    const columns = {
      idx: marginX + 10,
      desc: marginX + 42,
      qtyRight: marginX + 312,
      unitRight: marginX + 396,
      taxRight: marginX + 446,
      totalRight: pageWidth - marginX - 12,
    };
    const drawTableHeader = () => {
      ensureSpace(30);
      setFill(colors.navy);
      addRect(marginX, y, contentWidth, 24, 'f');
      addText('#', columns.idx, y + 15, { size: 9, font: 'F2', color: colors.white });
      addText('Descripcion', columns.desc, y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Cant.', columns.qtyRight, y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Precio', columns.unitRight, y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('IVA', columns.taxRight, y + 15, { size: 9, font: 'F2', color: colors.white });
      addRightText('Total', columns.totalRight, y + 15, { size: 9, font: 'F2', color: colors.white });
      y += 24;
    };
    drawTableHeader();

    const items = Array.isArray(invoice.items) ? invoice.items : [];
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
      if (y === topMargin && previousY !== topMargin) {
        drawTableHeader();
      }
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

    y += 8;
    const totalBoxWidth = 210;
    const totalBoxX = pageWidth - marginX - totalBoxWidth;
    const totalsRows = [
      ['Subtotal', fmtCOP(invoice.subtotal)],
      ['IVA', fmtCOP(invoice.taxAmount)],
      ...(Number(invoice.discountAmount ?? 0) > 0 ? [['Descuento', `-${fmtCOP(invoice.discountAmount)}`]] : []),
      ['TOTAL', fmtCOP(invoice.total)],
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

    if (invoice.notes) {
      const noteLines = wrapText(invoice.notes, contentWidth - 28, 10);
      const notesHeight = 30 + noteLines.length * 12 + 14;
      ensureSpace(notesHeight + 12);
      sectionTitle('Notas / Observaciones', colors.amberText);
      setFill([255, 251, 235]);
      setStroke([253, 230, 138]);
      addRect(marginX, y, contentWidth, notesHeight, 'B');
      drawTextBlock(noteLines, marginX + 14, y + 20, 12, { size: 10, color: [120, 53, 15] });
      y += notesHeight + 18;
    }

    if (invoice.dianCufe || invoice.dianQrCode) {
      sectionTitle('Informacion DIAN', colors.greenText);
      const qrSize = qrData ? 110 : 0;
      const labelWidth = 42;
      const valueX = marginX + 18 + labelWidth;
      const qrBoxWidth = qrData ? qrSize + 26 : 0;
      const textRightLimit = qrData ? pageWidth - marginX - qrBoxWidth - 22 : pageWidth - marginX - 18;
      const textWidth = Math.max(150, textRightLimit - valueX);
      const cufeLines = invoice.dianCufe ? wrapText(invoice.dianCufe, textWidth, 8) : [];
      const urlLines = invoice.dianQrCode ? wrapText(invoice.dianQrCode, textWidth, 8) : [];
      const cufeHeight = invoice.dianCufe ? Math.max(18, cufeLines.length * 10 + 8) : 0;
      const urlHeight = invoice.dianQrCode ? Math.max(18, urlLines.length * 10 + 8) : 0;
      const textBlockHeight = 20 + cufeHeight + urlHeight + 10;
      const cardHeight = Math.max(qrData ? 138 : 96, textBlockHeight + 18);
      ensureSpace(cardHeight + 10);
      setFill([240, 253, 244]);
      setStroke([187, 247, 208]);
      addRect(marginX, y, contentWidth, cardHeight, 'B');
      let infoY = y + 24;
      if (invoice.dianCufe) {
        addText('CUFE', marginX + 14, infoY, { size: 9, font: 'F2', color: colors.greenText });
        drawTextBlock(cufeLines, valueX, infoY, 10, { size: 8, color: colors.text });
        infoY += cufeHeight;
      }
      if (invoice.dianQrCode) {
        addText('URL', marginX + 14, infoY, { size: 9, font: 'F2', color: colors.greenText });
        drawTextBlock(urlLines, valueX, infoY, 10, { size: 8, color: colors.text });
        addLink(valueX - 2, infoY - 7, textWidth + 4, urlHeight + 4, invoice.dianQrCode);
        infoY += urlHeight;
      }
      if (qrData) {
        const qrX = pageWidth - marginX - qrSize - 14;
        const qrY = y + (cardHeight - qrSize) / 2;
        setFill(colors.white);
        setStroke([187, 247, 208]);
        addRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 'B');
        drawQr(qrX, qrY, qrSize);
      }
      y += cardHeight + 18;
    }

    ensureSpace(36);
    setStroke(colors.line);
    setLineWidth(0.8);
    addLine(marginX, y, pageWidth - marginX, y);
    y += 18;
    addText(`Generado el ${new Date().toLocaleString('es-CO')}`, marginX, y, { size: 9, color: colors.muted });
    addRightText('Generado por BeccaFact', pageWidth - marginX, y, { size: 9, color: colors.muted });
    if (invoice.status === 'DRAFT') {
      y += 14;
      addText('Documento en borrador - no valido como factura oficial', marginX, y, { size: 9, font: 'F2', color: colors.redText });
    }

    pushPage();

    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const pageObjectIds: number[] = [];
    const contentObjectIds: number[] = [];
    const pageAnnotsObjectIds: number[][] = [];
    let nextObjectId = 5;
    pages.forEach((page) => {
      pageObjectIds.push(nextObjectId++);
      contentObjectIds.push(nextObjectId++);
      const annotIds: number[] = [];
      page.annots.forEach(() => annotIds.push(nextObjectId++));
      pageAnnotsObjectIds.push(annotIds);
    });
    const kids = pageObjectIds.map((id) => `${id} 0 R`).join(' ');
    objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

    pages.forEach((page, index) => {
      const pageObj = pageObjectIds[index];
      const contentObj = contentObjectIds[index];
      const contentBuffer = Buffer.from(page.content, 'utf8');
      const annotRefs = pageAnnotsObjectIds[index].length ? ` /Annots [${pageAnnotsObjectIds[index].map((id) => `${id} 0 R`).join(' ')}]` : '';
      objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R${annotRefs} >>`;
      objects[contentObj] = `<< /Length ${contentBuffer.length} >>\nstream\n${page.content}\nendstream`;
      page.annots.forEach((annot, annotIndex) => {
        objects[pageAnnotsObjectIds[index][annotIndex]] = annot;
      });
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

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface DianSoapResult {
  success: boolean;
  zipKey?: string;
  errorMessages: string[];
  raw: string;
}

interface DianStatusResult {
  isValid: boolean;
  statusCode?: string;
  statusDescription?: string;
  statusMessage?: string;
  xmlBase64?: string;
  trackId?: string;
  errorMessages: string[];
  raw: string;
}
