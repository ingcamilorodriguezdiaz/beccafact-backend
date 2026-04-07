import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../config/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { PaymentMethod, RegisterPaymentDto } from './dto/register-payment.dto';
import { ApplyReceiptDto } from './dto/apply-receipt.dto';
import {
  CreateReceiptDto,
  ReceiptApplicationDto,
} from './dto/create-receipt.dto';
import { CreatePaymentPromiseDto } from './dto/create-promise.dto';
import { UpdatePaymentPromiseStatusDto } from './dto/update-promise-status.dto';
import { CreateCollectionFollowUpDto } from './dto/create-follow-up.dto';
import { CreateCarteraAdjustmentDto } from './dto/create-adjustment.dto';
import { RejectCarteraAdjustmentDto } from './dto/reject-adjustment.dto';
import { ImportReceiptsBatchDto } from './dto/import-receipts-batch.dto';
import { ImportBankStatementDto } from './dto/import-bank-statement.dto';
import { ReconcileBankMovementDto } from './dto/reconcile-bank-movement.dto';

export type CarteraStatus = 'AL_DIA' | 'POR_VENCER' | 'VENCIDA' | 'EN_MORA';
type ReceiptStatus = 'OPEN' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'VOID';
type CarteraAdjustmentType =
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'WRITE_OFF'
  | 'PROVISION'
  | 'RECOVERY'
  | 'RECEIPT_REVERSAL';
type CarteraAdjustmentStatus = 'PENDING_APPROVAL' | 'APPLIED' | 'REJECTED';

interface ReceiptListFilters {
  search?: string;
  status?: string;
  customerId?: string;
  page?: number;
  limit?: number;
}

interface ReceiptRow {
  id: string;
  number: string;
  companyId: string;
  customerId: string;
  amount: Prisma.Decimal | number | string;
  appliedAmount: Prisma.Decimal | number | string;
  unappliedAmount: Prisma.Decimal | number | string;
  paymentMethod: string;
  reference: string | null;
  notes: string | null;
  paymentDate: Date | string;
  status: string;
  createdById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  customerName?: string;
  customerDocumentNumber?: string;
  customerEmail?: string | null;
}

interface ReceiptApplicationRow {
  id: string;
  receiptId: string;
  invoiceId: string;
  amount: Prisma.Decimal | number | string;
  appliedAt: Date | string;
  createdById: string;
  invoiceNumber?: string;
  invoiceIssueDate?: Date | string;
  invoiceDueDate?: Date | string | null;
  invoiceTotal?: Prisma.Decimal | number | string;
}

interface PaymentPromiseRow {
  id: string;
  companyId: string;
  customerId: string;
  invoiceId: string | null;
  amount: Prisma.Decimal | number | string;
  promisedDate: Date | string;
  status: string;
  notes: string | null;
  createdById: string;
  resolvedById: string | null;
  resolvedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  customerName?: string;
  customerDocumentNumber?: string;
  invoiceNumber?: string | null;
}

interface CollectionFollowUpRow {
  id: string;
  companyId: string;
  customerId: string;
  invoiceId: string | null;
  activityType: string;
  outcome: string;
  nextActionDate: Date | string | null;
  nextAction: string | null;
  createdById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  customerName?: string;
  invoiceNumber?: string | null;
}

interface AdjustmentFilters {
  status?: string;
  type?: string;
  customerId?: string;
}

interface CarteraAdjustmentRow {
  id: string;
  companyId: string;
  customerId: string;
  invoiceId: string | null;
  receiptId: string | null;
  sourceInvoiceId: string | null;
  type: CarteraAdjustmentType;
  status: CarteraAdjustmentStatus;
  amount: Prisma.Decimal | number | string;
  reason: string;
  notes: string | null;
  requestedById: string;
  approvedById: string | null;
  approvedAt: Date | string | null;
  appliedAt: Date | string | null;
  rejectedAt: Date | string | null;
  rejectedReason: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  customerName?: string;
  customerDocumentNumber?: string;
  invoiceNumber?: string | null;
  receiptNumber?: string | null;
  sourceInvoiceNumber?: string | null;
  requestedByName?: string | null;
  approvedByName?: string | null;
}

interface BankMovementFilters {
  status?: string;
}

interface BankMovementRow {
  id: string;
  companyId: string;
  bankCode: string | null;
  accountNumber: string | null;
  movementDate: Date | string;
  reference: string | null;
  description: string | null;
  amount: Prisma.Decimal | number | string;
  status: string;
  matchedReceiptId: string | null;
  reconciledById: string | null;
  reconciledAt: Date | string | null;
  importedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  matchedReceiptNumber?: string | null;
  customerName?: string | null;
}

@Injectable()
export class CarteraService {
  constructor(
    private prisma: PrismaService,
    private accountingService: AccountingService,
  ) {}

  async getDashboard(companyId: string, branchId?: string) {
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);

    const where: any = {
      companyId,
      deletedAt: null,
      status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
    };
    if (branchId) where.branchId = branchId;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true } },
        payments: { select: { amount: true } },
      },
    });
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(
      companyId,
      invoices.map((invoice) => invoice.id),
    );

    let totalCartera = 0;
    let totalOverdue = 0;
    let totalDueSoon = 0;
    let totalCurrent = 0;
    const aging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };

    for (const inv of invoices) {
      const paid = inv.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const amount = this.calculateInvoiceBalance(
        Number(inv.total),
        paid,
        adjustmentMap.get(inv.id) ?? 0,
      );
      if (amount <= 0) continue;
      totalCartera += amount;

      if (!inv.dueDate) {
        totalCurrent += amount;
        aging.current += amount;
        continue;
      }

      const due = new Date(inv.dueDate);
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);

      if (due < today) {
        totalOverdue += amount;
        if (daysOverdue <= 30) aging.days30 += amount;
        else if (daysOverdue <= 60) aging.days60 += amount;
        else if (daysOverdue <= 90) aging.days90 += amount;
        else aging.over90 += amount;
      } else if (due <= in30Days) {
        totalDueSoon += amount;
        aging.current += amount;
      } else {
        totalCurrent += amount;
        aging.current += amount;
      }
    }

    const clientesEnMora = new Set(
      invoices
        .filter((invoice) => {
          if (!invoice.dueDate) return false;
          const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
          return (
            this.calculateInvoiceBalance(
              Number(invoice.total),
              paid,
              adjustmentMap.get(invoice.id) ?? 0,
            ) > 0.01 && new Date(invoice.dueDate) < today
          );
        })
        .map((invoice) => invoice.customerId),
    ).size;

    return {
      summary: {
        totalCartera,
        totalOverdue,
        totalDueSoon,
        totalCurrent,
        totalInvoices: invoices.length,
        clientesEnMora,
      },
      aging,
    };
  }

  async findAll(
    companyId: string,
    filters: {
      branchId?: string;
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

    if (filters.branchId) where.branchId = filters.branchId;

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { documentNumber: { contains: search } } },
      ];
    }

    if (customerId) where.customerId = customerId;

    if (status === 'VENCIDA') {
      where.dueDate = { lt: today };
      where.status = { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] };
    } else if (status === 'EN_MORA') {
      const in60DaysAgo = new Date(today);
      in60DaysAgo.setDate(in60DaysAgo.getDate() - 60);
      where.dueDate = { lt: in60DaysAgo };
      where.status = { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] };
    } else if (status === 'POR_VENCER') {
      const in30 = new Date(today);
      in30.setDate(in30.getDate() + 30);
      where.dueDate = { gte: today, lte: in30 };
      where.status = { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] };
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
              id: true,
              name: true,
              documentNumber: true,
              documentType: true,
              email: true,
              phone: true,
              city: true,
              creditLimit: true,
              creditDays: true,
            },
          },
          payments: { select: { amount: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(
      companyId,
      data.map((invoice) => invoice.id),
    );

    const enriched = data.map((invoice) =>
      this.mapInvoiceBalance(invoice, today, adjustmentMap.get(invoice.id) ?? 0),
    );

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findAllReceipts(companyId: string, filters: ReceiptListFilters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;
    const conditions: Prisma.Sql[] = [Prisma.sql`r."companyId" = ${companyId}`];

    if (filters.customerId) {
      conditions.push(Prisma.sql`r."customerId" = ${filters.customerId}`);
    }
    if (filters.status) {
      conditions.push(Prisma.sql`r."status" = ${filters.status}`);
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      conditions.push(
        Prisma.sql`(
          r."number" ILIKE ${term}
          OR COALESCE(r."reference", '') ILIKE ${term}
          OR c."name" ILIKE ${term}
          OR c."documentNumber" ILIKE ${term}
        )`,
      );
    }

    const whereSql = Prisma.join(conditions, ' AND ');
    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<ReceiptRow[]>`
        SELECT
          r."id",
          r."number",
          r."companyId",
          r."customerId",
          r."amount",
          r."appliedAmount",
          r."unappliedAmount",
          r."paymentMethod",
          r."reference",
          r."notes",
          r."paymentDate",
          r."status",
          r."createdById",
          r."createdAt",
          r."updatedAt",
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          c."email" AS "customerEmail"
        FROM "cartera_receipts" r
        INNER JOIN "customers" c ON c."id" = r."customerId"
        WHERE ${whereSql}
        ORDER BY r."paymentDate" DESC, r."createdAt" DESC
        LIMIT ${limit}
        OFFSET ${skip}
      `,
      this.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*)::bigint AS total
        FROM "cartera_receipts" r
        INNER JOIN "customers" c ON c."id" = r."customerId"
        WHERE ${whereSql}
      `,
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    return {
      data: rows.map((row) => this.mapReceiptRow(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneReceipt(companyId: string, id: string) {
    const receiptRows = await this.prisma.$queryRaw<ReceiptRow[]>`
      SELECT
        r."id",
        r."number",
        r."companyId",
        r."customerId",
        r."amount",
        r."appliedAmount",
        r."unappliedAmount",
        r."paymentMethod",
        r."reference",
        r."notes",
        r."paymentDate",
        r."status",
        r."createdById",
        r."createdAt",
        r."updatedAt",
        c."name" AS "customerName",
        c."documentNumber" AS "customerDocumentNumber",
        c."email" AS "customerEmail"
      FROM "cartera_receipts" r
      INNER JOIN "customers" c ON c."id" = r."customerId"
      WHERE r."companyId" = ${companyId} AND r."id" = ${id}
      LIMIT 1
    `;
    const receipt = receiptRows[0];
    if (!receipt) throw new NotFoundException('Recaudo no encontrado');

    const applications = await this.prisma.$queryRaw<ReceiptApplicationRow[]>`
      SELECT
        a."id",
        a."receiptId",
        a."invoiceId",
        a."amount",
        a."appliedAt",
        a."createdById",
        i."invoiceNumber" AS "invoiceNumber",
        i."issueDate" AS "invoiceIssueDate",
        i."dueDate" AS "invoiceDueDate",
        i."total" AS "invoiceTotal"
      FROM "cartera_receipt_applications" a
      INNER JOIN "invoices" i ON i."id" = a."invoiceId"
      WHERE a."receiptId" = ${id}
      ORDER BY a."appliedAt" DESC, a."createdAt" DESC
    `;

    return {
      ...this.mapReceiptRow(receipt),
      applications: applications.map((application) => ({
        id: application.id,
        invoiceId: application.invoiceId,
        invoiceNumber: application.invoiceNumber,
        invoiceIssueDate: application.invoiceIssueDate,
        invoiceDueDate: application.invoiceDueDate,
        invoiceTotal: this.toNumber(application.invoiceTotal),
        amount: this.toNumber(application.amount),
        appliedAt: application.appliedAt,
      })),
    };
  }

  async createReceipt(companyId: string, dto: CreateReceiptDto, userId: string) {
    await this.ensureCustomerExists(companyId, dto.customerId);
    this.validateReceiptApplications(dto.amount, dto.applications ?? []);

    const receiptId = await this.prisma.$transaction(async (tx) => {
      const id = this.generateId();
      const number = await this.generateReceiptNumber(tx, companyId);
      const initialStatus: ReceiptStatus =
        dto.applications && dto.applications.length > 0
          ? 'PARTIALLY_APPLIED'
          : 'OPEN';

      await tx.$executeRaw`
        INSERT INTO "cartera_receipts" (
          "id",
          "companyId",
          "customerId",
          "number",
          "amount",
          "appliedAmount",
          "unappliedAmount",
          "paymentMethod",
          "reference",
          "notes",
          "paymentDate",
          "status",
          "createdById",
          "createdAt",
          "updatedAt"
        ) VALUES (
          ${id},
          ${companyId},
          ${dto.customerId},
          ${number},
          ${dto.amount},
          ${0},
          ${dto.amount},
          ${dto.paymentMethod},
          ${dto.reference ?? null},
          ${dto.notes ?? null},
          ${new Date(dto.paymentDate)},
          ${initialStatus},
          ${userId},
          NOW(),
          NOW()
        )
      `;

      if (dto.applications?.length) {
        await this.applyReceiptInternal(tx, companyId, id, dto.applications, userId);
      }

      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'RECEIPT_CREATED',
          resource: 'cartera',
          resourceId: id,
          after: {
            number,
            customerId: dto.customerId,
            amount: dto.amount,
            paymentMethod: dto.paymentMethod,
            paymentDate: dto.paymentDate,
          },
        },
      });

      return id;
    });

    const receipt = await this.findOneReceipt(companyId, receiptId);
    if (dto.applications?.length) {
      await this.tryCreateReceiptAccountingEntry(companyId, receipt, dto.applications);
    }
    return receipt;
  }

  async applyReceipt(companyId: string, receiptId: string, dto: ApplyReceiptDto, userId: string) {
    if (!dto.applications?.length) {
      throw new BadRequestException('Debes enviar al menos una aplicación');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applyReceiptInternal(tx, companyId, receiptId, dto.applications, userId);
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'RECEIPT_APPLIED',
          resource: 'cartera',
          resourceId: receiptId,
          after: {
            applications: dto.applications.map((application) => ({
              invoiceId: application.invoiceId,
              amount: Number(application.amount),
            })),
          } as Prisma.InputJsonObject,
        },
      });
    });

    const receipt = await this.findOneReceipt(companyId, receiptId);
    await this.tryCreateReceiptAccountingEntry(companyId, receipt, dto.applications);
    return receipt;
  }

  async importReceiptsBatch(
    companyId: string,
    dto: ImportReceiptsBatchDto,
    userId: string,
  ) {
    const rows = this.parseDelimitedRows(dto.csvText, dto.delimiter);
    const created: any[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (const [index, row] of rows.entries()) {
      try {
        const customerDocumentNumber = row.customerdocumentnumber || row.documentnumber || row.customer || '';
        const amount = Number(row.amount ?? row.value ?? 0);
        const paymentDate = row.paymentdate || row.date;
        const paymentMethod = this.normalizePaymentMethod(
          row.paymentmethod || row.method || 'TRANSFERENCIA',
        );
        const reference = row.reference || row.bankreference || row.receiptreference || undefined;
        const notes = row.notes || undefined;
        const invoiceNumber = row.invoicenumber || row.invoice || undefined;

        if (!customerDocumentNumber || !amount || !paymentDate) {
          throw new BadRequestException('Fila incompleta: customerDocumentNumber, amount y paymentDate son obligatorios');
        }

        const customer = await this.prisma.customer.findFirst({
          where: { companyId, documentNumber: customerDocumentNumber, deletedAt: null },
          select: { id: true },
        });
        if (!customer) throw new NotFoundException(`Cliente ${customerDocumentNumber} no encontrado`);

        let applications: ReceiptApplicationDto[] = [];
        if (dto.applyByInvoiceNumber && invoiceNumber) {
          const invoice = await this.prisma.invoice.findFirst({
            where: {
              companyId,
              customerId: customer.id,
              invoiceNumber,
              deletedAt: null,
            },
            include: { payments: { select: { amount: true } } },
          });
          if (!invoice) {
            throw new NotFoundException(`Factura ${invoiceNumber} no encontrada para el cliente ${customerDocumentNumber}`);
          }
          const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(companyId, [invoice.id]);
          const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
          const balance = this.calculateInvoiceBalance(Number(invoice.total), paid, adjustmentMap.get(invoice.id) ?? 0);
          if (balance > 0.01) {
            applications = [{ invoiceId: invoice.id, amount: Math.min(balance, amount) }];
          }
        }

        const receipt = await this.createReceipt(companyId, {
          customerId: customer.id,
          amount,
          paymentDate,
          paymentMethod,
          reference,
          notes,
          applications,
        }, userId);
        created.push(receipt);
      } catch (error: any) {
        errors.push({ row: index + 1, message: error?.message ?? 'Error no controlado' });
      }
    }

    return {
      imported: created.length,
      failed: errors.length,
      receipts: created,
      errors,
    };
  }

  async getClienteCartera(companyId: string, branchId: string | undefined, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const today = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        customerId,
        ...(branchId ? { branchId } : {}),
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE', 'PAID'] },
      },
      include: {
        payments: { select: { amount: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(
      companyId,
      invoices.map((invoice) => invoice.id),
    );

    const normalizedInvoices = invoices.map((invoice) =>
      this.mapInvoiceBalance(invoice, today, adjustmentMap.get(invoice.id) ?? 0),
    );
    const pending = normalizedInvoices.filter((invoice) => invoice.balance > 0.01);
    const paid = normalizedInvoices.filter((invoice) => invoice.balance <= 0.01);
    const balancePending = pending.reduce((sum, invoice) => sum + invoice.balance, 0);
    const balanceOverdue = pending
      .filter((invoice) => invoice.dueDate && new Date(invoice.dueDate) < today)
      .reduce((sum, invoice) => sum + invoice.balance, 0);

    const statement = await this.getCustomerStatement(companyId, customerId, branchId);
    const [promises, followUps] = await Promise.all([
      this.prisma.$queryRaw<PaymentPromiseRow[]>`
        SELECT
          p."id",
          p."companyId",
          p."customerId",
          p."invoiceId",
          p."amount",
          p."promisedDate",
          p."status",
          p."notes",
          p."createdById",
          p."resolvedById",
          p."resolvedAt",
          p."createdAt",
          p."updatedAt",
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          i."invoiceNumber" AS "invoiceNumber"
        FROM "cartera_payment_promises" p
        INNER JOIN "customers" c ON c."id" = p."customerId"
        LEFT JOIN "invoices" i ON i."id" = p."invoiceId"
        WHERE p."companyId" = ${companyId} AND p."customerId" = ${customerId}
        ORDER BY p."promisedDate" DESC, p."createdAt" DESC
        LIMIT 20
      `,
      this.prisma.$queryRaw<CollectionFollowUpRow[]>`
        SELECT
          f."id",
          f."companyId",
          f."customerId",
          f."invoiceId",
          f."activityType",
          f."outcome",
          f."nextActionDate",
          f."nextAction",
          f."createdById",
          f."createdAt",
          f."updatedAt",
          c."name" AS "customerName",
          i."invoiceNumber" AS "invoiceNumber"
        FROM "cartera_collection_followups" f
        INNER JOIN "customers" c ON c."id" = f."customerId"
        LEFT JOIN "invoices" i ON i."id" = f."invoiceId"
        WHERE f."companyId" = ${companyId} AND f."customerId" = ${customerId}
        ORDER BY COALESCE(f."nextActionDate", f."createdAt") DESC, f."createdAt" DESC
        LIMIT 20
      `,
    ]);

    return {
      customer,
      summary: {
        balancePending,
        balanceOverdue,
        totalInvoices: normalizedInvoices.length,
        invoicesPending: pending.length,
        invoicesPaid: paid.length,
        unappliedBalance: statement.summary.unappliedBalance,
      },
      invoices: normalizedInvoices,
      statement,
      promises: promises.map((item) => this.mapPromiseRow(item)),
      followUps: followUps.map((item) => this.mapFollowUpRow(item)),
    };
  }

  async getCustomerStatement(companyId: string, customerId: string, branchId?: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const invoiceWhere: any = {
      companyId,
      customerId,
      deletedAt: null,
      status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE', 'PAID'] },
    };
    if (branchId) invoiceWhere.branchId = branchId;

    const [invoices, receipts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        include: { payments: { select: { amount: true } } },
        orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.$queryRaw<ReceiptRow[]>`
        SELECT
          r."id",
          r."number",
          r."companyId",
          r."customerId",
          r."amount",
          r."appliedAmount",
          r."unappliedAmount",
          r."paymentMethod",
          r."reference",
          r."notes",
          r."paymentDate",
          r."status",
          r."createdById",
          r."createdAt",
          r."updatedAt"
        FROM "cartera_receipts" r
        WHERE r."companyId" = ${companyId} AND r."customerId" = ${customerId}
        ORDER BY r."paymentDate" ASC, r."createdAt" ASC
      `,
    ]);
    const [adjustmentMap, creditBalance] = await Promise.all([
      this.getAppliedInvoiceAdjustmentMap(
        companyId,
        invoices.map((invoice) => invoice.id),
      ),
      this.getCustomerCreditBalance(companyId, customerId),
    ]);

    const payments = await this.prisma.carteraPayment.findMany({
      where: {
        companyId,
        invoiceId: { in: invoices.map((invoice) => invoice.id) },
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
    });

    const movements = [
      ...invoices.map((invoice) => ({
        id: `INV-${invoice.id}`,
        date: invoice.issueDate,
        type: 'FACTURA',
        number: invoice.invoiceNumber,
        reference: invoice.invoiceNumber,
        description: `Factura ${invoice.invoiceNumber}`,
        debit: Number(invoice.total),
        credit: 0,
      })),
      ...payments.map((payment) => ({
        id: `PAY-${payment.id}`,
        date: payment.paymentDate,
        type: Number(payment.amount) >= 0 ? 'PAGO_APLICADO' : 'REVERSO_RECAUDO',
        number: payment.invoice.invoiceNumber,
        reference: payment.reference ?? payment.paymentMethod,
        description:
          Number(payment.amount) >= 0
            ? `Pago aplicado a factura ${payment.invoice.invoiceNumber}`
            : `Reversión aplicada a factura ${payment.invoice.invoiceNumber}`,
        debit: Number(payment.amount) < 0 ? Math.abs(Number(payment.amount)) : 0,
        credit: Number(payment.amount) > 0 ? Number(payment.amount) : 0,
      })),
      ...(await this.findAppliedAdjustmentsForStatement(companyId, customerId)).map((adjustment) => ({
        id: `ADJ-${adjustment.id}`,
        date: adjustment.appliedAt ?? adjustment.createdAt,
        type: adjustment.type,
        number: adjustment.invoiceNumber ?? adjustment.receiptNumber ?? adjustment.id,
        reference: adjustment.reason,
        description: adjustment.reason,
        debit: ['DEBIT_NOTE', 'RECOVERY'].includes(adjustment.type) ? adjustment.amount : 0,
        credit: ['CREDIT_NOTE', 'WRITE_OFF'].includes(adjustment.type) ? adjustment.amount : 0,
      })),
      ...receipts
        .filter((receipt) => this.toNumber(receipt.unappliedAmount) > 0.01)
        .map((receipt) => ({
          id: `REC-${receipt.id}`,
          date: receipt.paymentDate,
          type: 'RECAUDO_SIN_APLICAR',
          number: receipt.number,
          reference: receipt.reference ?? receipt.paymentMethod,
          description: `Recaudo sin aplicar ${receipt.number}`,
          debit: 0,
          credit: this.toNumber(receipt.unappliedAmount),
        })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    const statementMovements = movements.map((movement) => {
      runningBalance += movement.debit - movement.credit;
      return {
        ...movement,
        runningBalance,
      };
    });

    const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const unappliedBalance = receipts.reduce(
      (sum, receipt) => sum + this.toNumber(receipt.unappliedAmount),
      0,
    );
    const outstandingBalance = invoices.reduce((sum, invoice) => {
      const paid = invoice.payments.reduce((acc, payment) => acc + Number(payment.amount), 0);
      return sum + this.calculateInvoiceBalance(Number(invoice.total), paid, adjustmentMap.get(invoice.id) ?? 0);
    }, 0);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        documentType: customer.documentType,
        documentNumber: customer.documentNumber,
        email: customer.email,
        phone: customer.phone,
      },
      summary: {
        totalInvoiced,
        totalPaid,
        creditBalance,
        unappliedBalance,
        outstandingBalance,
        balance: outstandingBalance - unappliedBalance - creditBalance,
      },
      movements: statementMovements,
    };
  }

  async registrarPago(
    companyId: string,
    invoiceId: string,
    dto: RegisterPaymentDto,
    userId: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === 'PAID') {
      throw new BadRequestException('La factura ya está pagada');
    }
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('La factura está cancelada');
    }

    const totalPaid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(companyId, [invoiceId]);
    const balance = this.calculateInvoiceBalance(
      Number(invoice.total),
      totalPaid,
      adjustmentMap.get(invoiceId) ?? 0,
    );

    if (dto.amount > balance + 0.01) {
      throw new BadRequestException(
        `El monto ($${dto.amount.toFixed(2)}) supera el saldo pendiente ($${balance.toFixed(2)})`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const receiptId = this.generateId();
      const number = await this.generateReceiptNumber(tx, companyId);

      await tx.$executeRaw`
        INSERT INTO "cartera_receipts" (
          "id",
          "companyId",
          "customerId",
          "number",
          "amount",
          "appliedAmount",
          "unappliedAmount",
          "paymentMethod",
          "reference",
          "notes",
          "paymentDate",
          "status",
          "createdById",
          "createdAt",
          "updatedAt"
        ) VALUES (
          ${receiptId},
          ${companyId},
          ${invoice.customer.id},
          ${number},
          ${dto.amount},
          ${0},
          ${dto.amount},
          ${dto.paymentMethod},
          ${dto.reference ?? null},
          ${dto.notes ?? null},
          ${new Date(dto.paymentDate)},
          ${'OPEN'},
          ${userId},
          NOW(),
          NOW()
        )
      `;

      const createdPayments = await this.applyReceiptInternal(
        tx,
        companyId,
        receiptId,
        [{ invoiceId, amount: dto.amount }],
        userId,
      );

      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'PAYMENT_REGISTERED',
          resource: 'cartera',
          resourceId: invoiceId,
          after: {
            amount: dto.amount,
            paymentDate: dto.paymentDate,
            paymentMethod: dto.paymentMethod,
            reference: dto.reference,
            invoiceNumber: invoice.invoiceNumber,
            receiptNumber: number,
          },
        },
      });

      return { payment: createdPayments[0], receiptId };
    });

    const invoiceAfter = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!invoiceAfter) throw new NotFoundException('Factura no encontrada');

    const paidAmount = invoiceAfter.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const adjustmentMapAfter = await this.getAppliedInvoiceAdjustmentMap(companyId, [invoiceId]);
    const newBalance = this.calculateInvoiceBalance(
      Number(invoiceAfter.total),
      paidAmount,
      adjustmentMapAfter.get(invoiceId) ?? 0,
    );

    const receipt = await this.findOneReceipt(companyId, result.receiptId);
    await this.tryCreateReceiptAccountingEntry(companyId, receipt, [{ invoiceId, amount: dto.amount }]);

    return {
      payment: result.payment,
      invoice: {
        id: invoiceAfter.id,
        invoiceNumber: invoiceAfter.invoiceNumber,
        total: Number(invoiceAfter.total),
        paidAmount,
        balance: newBalance,
        status: invoiceAfter.status,
        customer: invoiceAfter.customer,
      },
    };
  }

  async getPaymentHistory(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    const payments = await this.prisma.carteraPayment.findMany({
      where: { invoiceId, companyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { paymentDate: 'desc' },
    });

    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(companyId, [invoiceId]);

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        total: Number(invoice.total),
        status: invoice.status,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        customer: invoice.customer,
        paidAmount: totalPaid,
        balance: this.calculateInvoiceBalance(
          Number(invoice.total),
          totalPaid,
          adjustmentMap.get(invoiceId) ?? 0,
        ),
      },
      payments: payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
    };
  }

  async getAgingReport(companyId: string, branchId?: string) {
    const today = new Date();
    const where: any = {
      companyId,
      deletedAt: null,
      status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
    };
    if (branchId) where.branchId = branchId;

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, documentNumber: true } },
        payments: { select: { amount: true } },
      },
    });
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(
      companyId,
      invoices.map((invoice) => invoice.id),
    );

    const byCustomer: Record<string, {
      customer: any;
      current: number;
      days30: number;
      days60: number;
      days90: number;
      over90: number;
      total: number;
    }> = {};

    for (const invoice of invoices) {
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = this.calculateInvoiceBalance(
        Number(invoice.total),
        paid,
        adjustmentMap.get(invoice.id) ?? 0,
      );
      if (balance === 0) continue;

      if (!byCustomer[invoice.customerId]) {
        byCustomer[invoice.customerId] = {
          customer: invoice.customer,
          current: 0,
          days30: 0,
          days60: 0,
          days90: 0,
          over90: 0,
          total: 0,
        };
      }

      byCustomer[invoice.customerId].total += balance;

      if (!invoice.dueDate || new Date(invoice.dueDate) >= today) {
        byCustomer[invoice.customerId].current += balance;
        continue;
      }

      const daysLate = Math.floor(
        (today.getTime() - new Date(invoice.dueDate).getTime()) / 86400000,
      );
      if (daysLate <= 30) byCustomer[invoice.customerId].days30 += balance;
      else if (daysLate <= 60) byCustomer[invoice.customerId].days60 += balance;
      else if (daysLate <= 90) byCustomer[invoice.customerId].days90 += balance;
      else byCustomer[invoice.customerId].over90 += balance;
    }

    const rows = Object.values(byCustomer).sort((a, b) => b.total - a.total);
    const totals = rows.reduce(
      (acc, row) => {
        acc.current += row.current;
        acc.days30 += row.days30;
        acc.days60 += row.days60;
        acc.days90 += row.days90;
        acc.over90 += row.over90;
        acc.total += row.total;
        return acc;
      },
      { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 },
    );

    return { rows, totals };
  }

  async getCollectionWorkbench(companyId: string, branchId?: string) {
    const [promises, followUps, priorityInvoices] = await Promise.all([
      this.prisma.$queryRaw<PaymentPromiseRow[]>`
        SELECT
          p."id",
          p."companyId",
          p."customerId",
          p."invoiceId",
          p."amount",
          p."promisedDate",
          p."status",
          p."notes",
          p."createdById",
          p."resolvedById",
          p."resolvedAt",
          p."createdAt",
          p."updatedAt",
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          i."invoiceNumber" AS "invoiceNumber"
        FROM "cartera_payment_promises" p
        INNER JOIN "customers" c ON c."id" = p."customerId"
        LEFT JOIN "invoices" i ON i."id" = p."invoiceId"
        WHERE p."companyId" = ${companyId}
        ORDER BY p."promisedDate" ASC, p."createdAt" DESC
        LIMIT 100
      `,
      this.prisma.$queryRaw<CollectionFollowUpRow[]>`
        SELECT
          f."id",
          f."companyId",
          f."customerId",
          f."invoiceId",
          f."activityType",
          f."outcome",
          f."nextActionDate",
          f."nextAction",
          f."createdById",
          f."createdAt",
          f."updatedAt",
          c."name" AS "customerName",
          i."invoiceNumber" AS "invoiceNumber"
        FROM "cartera_collection_followups" f
        INNER JOIN "customers" c ON c."id" = f."customerId"
        LEFT JOIN "invoices" i ON i."id" = f."invoiceId"
        WHERE f."companyId" = ${companyId}
        ORDER BY COALESCE(f."nextActionDate", f."createdAt") ASC, f."createdAt" DESC
        LIMIT 100
      `,
      this.prisma.invoice.findMany({
        where: {
          companyId,
          ...(branchId ? { branchId } : {}),
          deletedAt: null,
          status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'OVERDUE'] },
        },
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          payments: { select: { amount: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { issueDate: 'asc' }],
        take: 30,
      }),
    ]);
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(
      companyId,
      priorityInvoices.map((invoice) => invoice.id),
    );

    const today = new Date();
    const normalizedInvoices = priorityInvoices
      .map((invoice) => this.mapInvoiceBalance(invoice, today, adjustmentMap.get(invoice.id) ?? 0))
      .filter((invoice) => invoice.balance > 0.01)
      .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));

    const openPromises = promises.filter((item) => item.status === 'OPEN');
    const brokenPromises = promises.filter((item) => item.status === 'BROKEN');
    const dueTodayPromises = openPromises.filter((item) => {
      const promised = new Date(item.promisedDate);
      return promised <= today;
    });
    const pendingFollowUps = followUps.filter((item) => {
      if (!item.nextActionDate) return false;
      return new Date(item.nextActionDate) <= today;
    });

    return {
      summary: {
        openPromises: openPromises.length,
        brokenPromises: brokenPromises.length,
        dueTodayPromises: dueTodayPromises.length,
        pendingFollowUps: pendingFollowUps.length,
        priorityInvoices: normalizedInvoices.filter((invoice) => (invoice.daysOverdue ?? 0) > 0).length,
      },
      promises: promises.map((item) => this.mapPromiseRow(item)),
      followUps: followUps.map((item) => this.mapFollowUpRow(item)),
      priorityInvoices: normalizedInvoices.slice(0, 15),
    };
  }

  async createPaymentPromise(companyId: string, dto: CreatePaymentPromiseDto, userId: string) {
    await this.ensureCustomerExists(companyId, dto.customerId);
    if (dto.invoiceId) {
      await this.ensureInvoiceBelongsToCustomer(companyId, dto.customerId, dto.invoiceId);
    }

    const id = this.generateId();
    await this.prisma.$executeRaw`
      INSERT INTO "cartera_payment_promises" (
        "id",
        "companyId",
        "customerId",
        "invoiceId",
        "amount",
        "promisedDate",
        "status",
        "notes",
        "createdById",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${companyId},
        ${dto.customerId},
        ${dto.invoiceId ?? null},
        ${dto.amount},
        ${new Date(dto.promisedDate)},
        ${'OPEN'},
        ${dto.notes ?? null},
        ${userId},
        NOW(),
        NOW()
      )
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYMENT_PROMISE_CREATED',
        resource: 'cartera',
        resourceId: id,
        after: {
          customerId: dto.customerId,
          invoiceId: dto.invoiceId ?? null,
          amount: dto.amount,
          promisedDate: dto.promisedDate,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findPromiseById(companyId, id);
  }

  async updatePaymentPromiseStatus(
    companyId: string,
    id: string,
    dto: UpdatePaymentPromiseStatusDto,
    userId: string,
  ) {
    const existing = await this.findPromiseById(companyId, id);
    await this.prisma.$executeRaw`
      UPDATE "cartera_payment_promises"
      SET
        "status" = ${dto.status},
        "notes" = ${dto.notes ?? existing.notes ?? null},
        "resolvedById" = ${dto.status === 'OPEN' ? null : userId},
        "resolvedAt" = ${dto.status === 'OPEN' ? null : new Date()},
        "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYMENT_PROMISE_STATUS_UPDATED',
        resource: 'cartera',
        resourceId: id,
        after: {
          status: dto.status,
          notes: dto.notes ?? existing.notes ?? null,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findPromiseById(companyId, id);
  }

  async createCollectionFollowUp(
    companyId: string,
    dto: CreateCollectionFollowUpDto,
    userId: string,
  ) {
    await this.ensureCustomerExists(companyId, dto.customerId);
    if (dto.invoiceId) {
      await this.ensureInvoiceBelongsToCustomer(companyId, dto.customerId, dto.invoiceId);
    }

    const id = this.generateId();
    await this.prisma.$executeRaw`
      INSERT INTO "cartera_collection_followups" (
        "id",
        "companyId",
        "customerId",
        "invoiceId",
        "activityType",
        "outcome",
        "nextActionDate",
        "nextAction",
        "createdById",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${companyId},
        ${dto.customerId},
        ${dto.invoiceId ?? null},
        ${dto.activityType},
        ${dto.outcome},
        ${dto.nextActionDate ? new Date(dto.nextActionDate) : null},
        ${dto.nextAction ?? null},
        ${userId},
        NOW(),
        NOW()
      )
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'COLLECTION_FOLLOWUP_CREATED',
        resource: 'cartera',
        resourceId: id,
        after: {
          customerId: dto.customerId,
          invoiceId: dto.invoiceId ?? null,
          activityType: dto.activityType,
          nextActionDate: dto.nextActionDate ?? null,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findFollowUpById(companyId, id);
  }

  async findAllAdjustments(companyId: string, filters: AdjustmentFilters) {
    const conditions: Prisma.Sql[] = [Prisma.sql`a."companyId" = ${companyId}`];
    if (filters.status) conditions.push(Prisma.sql`a."status" = ${filters.status}`);
    if (filters.type) conditions.push(Prisma.sql`a."type" = ${filters.type}`);
    if (filters.customerId) conditions.push(Prisma.sql`a."customerId" = ${filters.customerId}`);
    const whereSql = Prisma.join(conditions, ' AND ');

    const rows = await this.prisma.$queryRaw<CarteraAdjustmentRow[]>`
      SELECT
        a."id",
        a."companyId",
        a."customerId",
        a."invoiceId",
        a."receiptId",
        a."sourceInvoiceId",
        a."type",
        a."status",
        a."amount",
        a."reason",
        a."notes",
        a."requestedById",
        a."approvedById",
        a."approvedAt",
        a."appliedAt",
        a."rejectedAt",
        a."rejectedReason",
        a."createdAt",
        a."updatedAt",
        c."name" AS "customerName",
        c."documentNumber" AS "customerDocumentNumber",
        i."invoiceNumber" AS "invoiceNumber",
        r."number" AS "receiptNumber",
        si."invoiceNumber" AS "sourceInvoiceNumber",
        CONCAT(COALESCE(ru."firstName", ''), ' ', COALESCE(ru."lastName", '')) AS "requestedByName",
        CONCAT(COALESCE(au."firstName", ''), ' ', COALESCE(au."lastName", '')) AS "approvedByName"
      FROM "cartera_adjustments" a
      INNER JOIN "customers" c ON c."id" = a."customerId"
      LEFT JOIN "invoices" i ON i."id" = a."invoiceId"
      LEFT JOIN "cartera_receipts" r ON r."id" = a."receiptId"
      LEFT JOIN "invoices" si ON si."id" = a."sourceInvoiceId"
      LEFT JOIN "users" ru ON ru."id" = a."requestedById"
      LEFT JOIN "users" au ON au."id" = a."approvedById"
      WHERE ${whereSql}
      ORDER BY
        CASE WHEN a."status" = 'PENDING_APPROVAL' THEN 0 ELSE 1 END,
        a."createdAt" DESC
      LIMIT 200
    `;

    return rows.map((row) => this.mapAdjustmentRow(row));
  }

  async createAdjustment(
    companyId: string,
    dto: CreateCarteraAdjustmentDto,
    userId: string,
  ) {
    await this.ensureCustomerExists(companyId, dto.customerId);
    await this.validateAdjustmentRequest(companyId, dto);

    const id = this.generateId();
    await this.prisma.$executeRaw`
      INSERT INTO "cartera_adjustments" (
        "id",
        "companyId",
        "customerId",
        "invoiceId",
        "receiptId",
        "sourceInvoiceId",
        "type",
        "status",
        "amount",
        "reason",
        "notes",
        "requestedById",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${companyId},
        ${dto.customerId},
        ${dto.invoiceId ?? null},
        ${dto.receiptId ?? null},
        ${dto.sourceInvoiceId ?? null},
        ${dto.type},
        ${'PENDING_APPROVAL'},
        ${dto.amount},
        ${dto.reason},
        ${dto.notes ?? null},
        ${userId},
        NOW(),
        NOW()
      )
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'CARTERA_ADJUSTMENT_REQUESTED',
        resource: 'cartera',
        resourceId: id,
        after: {
          customerId: dto.customerId,
          invoiceId: dto.invoiceId ?? null,
          receiptId: dto.receiptId ?? null,
          type: dto.type,
          amount: dto.amount,
          reason: dto.reason,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findAdjustmentById(companyId, id);
  }

  async approveAdjustment(companyId: string, id: string, userId: string) {
    const adjustment = await this.findAdjustmentById(companyId, id);
    if (adjustment.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('El ajuste ya fue procesado');
    }

    await this.prisma.$transaction(async (tx) => {
      if (adjustment.type === 'RECEIPT_REVERSAL') {
        await this.applyReceiptReversalInternal(tx, companyId, adjustment, userId);
      }

      await tx.$executeRaw`
        UPDATE "cartera_adjustments"
        SET
          "status" = ${'APPLIED'},
          "approvedById" = ${userId},
          "approvedAt" = NOW(),
          "appliedAt" = NOW(),
          "updatedAt" = NOW()
        WHERE "id" = ${id}
      `;

      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CARTERA_ADJUSTMENT_APPROVED',
          resource: 'cartera',
          resourceId: id,
          after: {
            type: adjustment.type,
            amount: adjustment.amount,
            invoiceId: adjustment.invoiceId,
            receiptId: adjustment.receiptId,
          } as Prisma.InputJsonObject,
        },
      });
    });

    const approved = await this.findAdjustmentById(companyId, id);
    await this.tryCreateAdjustmentAccountingEntry(companyId, approved);
    return approved;
  }

  async rejectAdjustment(
    companyId: string,
    id: string,
    dto: RejectCarteraAdjustmentDto,
    userId: string,
  ) {
    const adjustment = await this.findAdjustmentById(companyId, id);
    if (adjustment.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('El ajuste ya fue procesado');
    }

    await this.prisma.$executeRaw`
      UPDATE "cartera_adjustments"
      SET
        "status" = ${'REJECTED'},
        "approvedById" = ${userId},
        "rejectedAt" = NOW(),
        "rejectedReason" = ${dto.reason ?? 'Rechazado por control financiero'},
        "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'CARTERA_ADJUSTMENT_REJECTED',
        resource: 'cartera',
        resourceId: id,
        after: {
          reason: dto.reason ?? null,
          type: adjustment.type,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findAdjustmentById(companyId, id);
  }

  async findAllBankMovements(companyId: string, filters: BankMovementFilters) {
    const conditions: Prisma.Sql[] = [Prisma.sql`m."companyId" = ${companyId}`];
    if (filters.status) conditions.push(Prisma.sql`m."status" = ${filters.status}`);
    const whereSql = Prisma.join(conditions, ' AND ');

    const rows = await this.prisma.$queryRaw<BankMovementRow[]>`
      SELECT
        m."id",
        m."companyId",
        m."bankCode",
        m."accountNumber",
        m."movementDate",
        m."reference",
        m."description",
        m."amount",
        m."status",
        m."matchedReceiptId",
        m."reconciledById",
        m."reconciledAt",
        m."importedById",
        m."createdAt",
        m."updatedAt",
        r."number" AS "matchedReceiptNumber",
        c."name" AS "customerName"
      FROM "cartera_bank_movements" m
      LEFT JOIN "cartera_receipts" r ON r."id" = m."matchedReceiptId"
      LEFT JOIN "customers" c ON c."id" = r."customerId"
      WHERE ${whereSql}
      ORDER BY m."movementDate" DESC, m."createdAt" DESC
      LIMIT 200
    `;

    return rows.map((row) => this.mapBankMovementRow(row));
  }

  async importBankStatement(
    companyId: string,
    dto: ImportBankStatementDto,
    userId: string,
  ) {
    const rows = this.parseDelimitedRows(dto.csvText, dto.delimiter);
    const imported: any[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (const [index, row] of rows.entries()) {
      try {
        const movementDate = row.date || row.movementdate;
        const reference = row.reference || row.bankreference || null;
        const description = row.description || row.concept || null;
        const amount = Number(row.amount ?? row.value ?? 0);

        if (!movementDate || !amount) {
          throw new BadRequestException('Fila incompleta: date y amount son obligatorios');
        }

        const id = this.generateId();
        await this.prisma.$executeRaw`
          INSERT INTO "cartera_bank_movements" (
            "id","companyId","bankCode","accountNumber","movementDate","reference","description",
            "amount","status","matchedReceiptId","reconciledById","reconciledAt","importedById","createdAt","updatedAt"
          ) VALUES (
            ${id}, ${companyId}, ${dto.bankCode ?? null}, ${dto.accountNumber ?? null}, ${new Date(movementDate)},
            ${reference}, ${description}, ${amount}, ${'UNRECONCILED'}, ${null}, ${null}, ${null}, ${userId}, NOW(), NOW()
          )
        `;

        if (dto.autoMatchReceipts !== false && reference) {
          const receipt = await this.prisma.$queryRaw<ReceiptRow[]>`
            SELECT
              r."id", r."number", r."companyId", r."customerId", r."amount", r."appliedAmount",
              r."unappliedAmount", r."paymentMethod", r."reference", r."notes", r."paymentDate",
              r."status", r."createdById", r."createdAt", r."updatedAt"
            FROM "cartera_receipts" r
            WHERE r."companyId" = ${companyId}
              AND COALESCE(r."reference", '') = ${reference}
              AND ABS(r."amount" - ${amount}) <= 0.01
            ORDER BY r."paymentDate" DESC
            LIMIT 1
          `;
          if (receipt[0]) {
            await this.reconcileBankMovement(companyId, id, { receiptId: receipt[0].id }, userId);
          }
        }

        imported.push({ id, reference, amount });
      } catch (error: any) {
        errors.push({ row: index + 1, message: error?.message ?? 'Error no controlado' });
      }
    }

    return {
      imported: imported.length,
      failed: errors.length,
      rows: imported,
      errors,
    };
  }

  async reconcileBankMovement(
    companyId: string,
    id: string,
    dto: ReconcileBankMovementDto,
    userId: string,
  ) {
    const movement = await this.findBankMovementById(companyId, id);
    if (movement.status === 'RECONCILED') {
      throw new BadRequestException('El movimiento ya está conciliado');
    }
    if (!dto.receiptId) {
      throw new BadRequestException('Debes indicar el recaudo con el cual conciliar');
    }

    const receipt = await this.findOneReceipt(companyId, dto.receiptId);
    if (Math.abs(receipt.amount - movement.amount) > 0.01) {
      throw new BadRequestException('El valor del recaudo no coincide con el movimiento bancario');
    }

    await this.prisma.$executeRaw`
      UPDATE "cartera_bank_movements"
      SET
        "status" = ${'RECONCILED'},
        "matchedReceiptId" = ${dto.receiptId},
        "reconciledById" = ${userId},
        "reconciledAt" = NOW(),
        "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'BANK_MOVEMENT_RECONCILED',
        resource: 'cartera',
        resourceId: id,
        after: {
          receiptId: dto.receiptId,
          receiptNumber: receipt.number,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findBankMovementById(companyId, id);
  }

  async getAccountingReconciliation(companyId: string) {
    const [receiptSummary, adjustmentSummary, bankSummary, missingReceiptEntries, missingAdjustmentEntries] = await Promise.all([
      this.prisma.$queryRaw<Array<{ receipts: bigint | number; total: Prisma.Decimal | number | string }>>`
        SELECT COUNT(*)::int AS receipts, COALESCE(SUM("amount"), 0) AS total
        FROM "cartera_receipts"
        WHERE "companyId" = ${companyId} AND "status" <> 'VOID'
      `,
      this.prisma.$queryRaw<Array<{ adjustments: bigint | number; total: Prisma.Decimal | number | string }>>`
        SELECT COUNT(*)::int AS adjustments, COALESCE(SUM("amount"), 0) AS total
        FROM "cartera_adjustments"
        WHERE "companyId" = ${companyId} AND "status" = 'APPLIED'
      `,
      this.prisma.$queryRaw<Array<{ unreconciled: bigint | number; total: Prisma.Decimal | number | string }>>`
        SELECT COUNT(*)::int AS unreconciled, COALESCE(SUM("amount"), 0) AS total
        FROM "cartera_bank_movements"
        WHERE "companyId" = ${companyId} AND "status" = 'UNRECONCILED'
      `,
      this.prisma.$queryRawUnsafe<Array<{ id: string; number: string; amount: Prisma.Decimal | number | string }>>(
        `
          SELECT r."id", r."number", r."amount"
          FROM "cartera_receipts" r
          WHERE r."companyId" = $1
            AND r."status" <> 'VOID'
            AND NOT EXISTS (
              SELECT 1
              FROM "journal_entries" je
              WHERE je."companyId" = $1
                AND je."deletedAt" IS NULL
                AND je."status" = 'POSTED'
                AND je."sourceId" = CONCAT('receipt:', r."id")
            )
        `,
        companyId,
      ),
      this.prisma.$queryRawUnsafe<Array<{ id: string; type: string; amount: Prisma.Decimal | number | string }>>(
        `
          SELECT a."id", a."type", a."amount"
          FROM "cartera_adjustments" a
          WHERE a."companyId" = $1
            AND a."status" = 'APPLIED'
            AND NOT EXISTS (
              SELECT 1
              FROM "journal_entries" je
              WHERE je."companyId" = $1
                AND je."deletedAt" IS NULL
                AND je."status" = 'POSTED'
                AND je."sourceId" = CONCAT('cartera-adjustment:', a."id")
            )
        `,
        companyId,
      ),
    ]);

    return {
      receipts: {
        count: Number(receiptSummary[0]?.receipts ?? 0),
        total: this.toNumber(receiptSummary[0]?.total),
        missingEntries: missingReceiptEntries.map((row) => ({
          id: row.id,
          number: row.number,
          amount: this.toNumber(row.amount),
        })),
      },
      adjustments: {
        count: Number(adjustmentSummary[0]?.adjustments ?? 0),
        total: this.toNumber(adjustmentSummary[0]?.total),
        missingEntries: missingAdjustmentEntries.map((row) => ({
          id: row.id,
          type: row.type,
          amount: this.toNumber(row.amount),
        })),
      },
      bank: {
        unreconciledCount: Number(bankSummary[0]?.unreconciled ?? 0),
        unreconciledTotal: this.toNumber(bankSummary[0]?.total),
      },
    };
  }

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

  private async applyReceiptInternal(
    tx: Prisma.TransactionClient,
    companyId: string,
    receiptId: string,
    applications: ReceiptApplicationDto[],
    userId: string,
  ) {
    this.validateReceiptApplications(
      applications.reduce((sum, application) => sum + Number(application.amount), 0),
      applications,
      true,
    );

    const receipt = await this.getReceiptForUpdate(tx, companyId, receiptId);
    if (receipt.status === 'VOID') {
      throw new BadRequestException('No se puede aplicar un recaudo anulado');
    }

    const totalToApply = applications.reduce((sum, application) => sum + Number(application.amount), 0);
    const unapplied = this.toNumber(receipt.unappliedAmount);
    if (totalToApply > unapplied + 0.01) {
      throw new BadRequestException('El monto aplicado supera el saldo disponible del recaudo');
    }

    const uniqueInvoiceIds = [...new Set(applications.map((application) => application.invoiceId))];
    const invoices = await tx.invoice.findMany({
      where: {
        id: { in: uniqueInvoiceIds },
        companyId,
        customerId: receipt.customerId,
        deletedAt: null,
      },
      include: {
        payments: { select: { amount: true } },
      },
    });
    const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(
      companyId,
      invoices.map((invoice) => invoice.id),
      tx,
    );
    if (invoices.length !== uniqueInvoiceIds.length) {
      throw new BadRequestException('Una o varias facturas no pertenecen al cliente del recaudo');
    }

    const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const createdPayments: any[] = [];

    for (const application of applications) {
      const invoice = invoiceMap.get(application.invoiceId);
      if (!invoice) throw new BadRequestException('Factura inválida en la aplicación');
      if (invoice.status === 'CANCELLED') {
        throw new BadRequestException(`La factura ${invoice.invoiceNumber} está cancelada`);
      }

      const currentPaid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = this.calculateInvoiceBalance(
        Number(invoice.total),
        currentPaid,
        adjustmentMap.get(invoice.id) ?? 0,
      );
      if (application.amount > balance + 0.01) {
        throw new BadRequestException(
          `La aplicación a la factura ${invoice.invoiceNumber} supera su saldo pendiente`,
        );
      }

      const payment = await tx.carteraPayment.create({
        data: {
          companyId,
          invoiceId: invoice.id,
          userId,
          amount: application.amount,
          paymentMethod: receipt.paymentMethod,
          reference: receipt.reference,
          notes: this.buildPaymentNotes(receipt, application),
          paymentDate: new Date(receipt.paymentDate),
        },
      });

      await tx.$executeRaw`
        INSERT INTO "cartera_receipt_applications" (
          "id",
          "companyId",
          "receiptId",
          "invoiceId",
          "amount",
          "appliedAt",
          "createdById",
          "createdAt",
          "updatedAt"
        ) VALUES (
          ${this.generateId()},
          ${companyId},
          ${receiptId},
          ${invoice.id},
          ${application.amount},
          ${new Date(receipt.paymentDate)},
          ${userId},
          NOW(),
          NOW()
        )
      `;

      const newBalance = balance - application.amount;
      if (newBalance <= 0.01) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID' },
        });
      }

      createdPayments.push(payment);
    }

    const currentApplied = this.toNumber(receipt.appliedAmount);
    const appliedAmount = this.roundMoney(currentApplied + totalToApply);
    const unappliedAmount = this.roundMoney(this.toNumber(receipt.amount) - appliedAmount);
    const status: ReceiptStatus =
      unappliedAmount <= 0.01
        ? 'APPLIED'
        : appliedAmount > 0.01
          ? 'PARTIALLY_APPLIED'
          : 'OPEN';

    await tx.$executeRaw`
      UPDATE "cartera_receipts"
      SET
        "appliedAmount" = ${appliedAmount},
        "unappliedAmount" = ${Math.max(0, unappliedAmount)},
        "status" = ${status},
        "updatedAt" = NOW()
      WHERE "id" = ${receiptId}
    `;

    return createdPayments;
  }

  private async getReceiptForUpdate(
    tx: Prisma.TransactionClient,
    companyId: string,
    receiptId: string,
  ) {
    const rows = await tx.$queryRaw<ReceiptRow[]>`
      SELECT
        r."id",
        r."number",
        r."companyId",
        r."customerId",
        r."amount",
        r."appliedAmount",
        r."unappliedAmount",
        r."paymentMethod",
        r."reference",
        r."notes",
        r."paymentDate",
        r."status",
        r."createdById",
        r."createdAt",
        r."updatedAt"
      FROM "cartera_receipts" r
      WHERE r."companyId" = ${companyId} AND r."id" = ${receiptId}
      LIMIT 1
    `;
    const receipt = rows[0];
    if (!receipt) throw new NotFoundException('Recaudo no encontrado');
    return receipt;
  }

  private async generateReceiptNumber(tx: Prisma.TransactionClient, companyId: string) {
    const rows = await tx.$queryRaw<Array<{ number: string }>>`
      SELECT "number"
      FROM "cartera_receipts"
      WHERE "companyId" = ${companyId}
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    const lastNumber = rows[0]?.number ?? 'RC-000000';
    const lastSequence = Number(lastNumber.split('-').pop() ?? 0);
    return `RC-${String(lastSequence + 1).padStart(6, '0')}`;
  }

  private async ensureCustomerExists(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
  }

  private async ensureInvoiceBelongsToCustomer(companyId: string, customerId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, customerId, deletedAt: null },
      select: { id: true },
    });
    if (!invoice) {
      throw new BadRequestException('La factura no pertenece al cliente seleccionado');
    }
  }

  private validateReceiptApplications(
    maxAmount: number,
    applications: ReceiptApplicationDto[],
    exactSum = false,
  ) {
    if (!applications.length) return;
    const duplicateIds = applications
      .map((application) => application.invoiceId)
      .filter((invoiceId, index, list) => list.indexOf(invoiceId) !== index);
    if (duplicateIds.length) {
      throw new BadRequestException('No puedes repetir la misma factura dentro de un recaudo');
    }

    const totalApplied = applications.reduce((sum, application) => sum + Number(application.amount), 0);
    if (exactSum && totalApplied <= 0) {
      throw new BadRequestException('El total aplicado debe ser mayor a cero');
    }
    if (totalApplied > Number(maxAmount) + 0.01) {
      throw new BadRequestException('El total aplicado supera el valor disponible');
    }
  }

  private mapInvoiceBalance(invoice: any, today = new Date(), adjustmentNet = 0) {
    const paid = invoice.payments.reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
    const balance = this.calculateInvoiceBalance(Number(invoice.total), paid, adjustmentNet);
    return {
      ...invoice,
      payments: undefined,
      carteraStatus: this.calcStatus(invoice.dueDate, balance <= 0.01 ? 'PAID' : invoice.status),
      daysOverdue: invoice.dueDate
        ? Math.floor((today.getTime() - new Date(invoice.dueDate).getTime()) / 86400000)
        : null,
      balance,
      paidAmount: paid,
      adjustmentNet,
    };
  }

  private calculateInvoiceBalance(total: number, paidAmount: number, adjustmentNet: number) {
    return Math.max(0, this.roundMoney(total + adjustmentNet - paidAmount));
  }

  private mapReceiptRow(row: ReceiptRow) {
    return {
      id: row.id,
      number: row.number,
      customerId: row.customerId,
      amount: this.toNumber(row.amount),
      appliedAmount: this.toNumber(row.appliedAmount),
      unappliedAmount: this.toNumber(row.unappliedAmount),
      paymentMethod: row.paymentMethod,
      reference: row.reference,
      notes: row.notes,
      paymentDate: row.paymentDate,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customer: row.customerName
        ? {
            id: row.customerId,
            name: row.customerName,
            documentNumber: row.customerDocumentNumber,
            email: row.customerEmail,
          }
        : undefined,
    };
  }

  private mapPromiseRow(row: PaymentPromiseRow) {
    return {
      id: row.id,
      customerId: row.customerId,
      invoiceId: row.invoiceId,
      amount: this.toNumber(row.amount),
      promisedDate: row.promisedDate,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      resolvedAt: row.resolvedAt,
      customer: row.customerName
        ? {
            id: row.customerId,
            name: row.customerName,
            documentNumber: row.customerDocumentNumber,
          }
        : undefined,
      invoiceNumber: row.invoiceNumber,
    };
  }

  private mapFollowUpRow(row: CollectionFollowUpRow) {
    return {
      id: row.id,
      customerId: row.customerId,
      invoiceId: row.invoiceId,
      activityType: row.activityType,
      outcome: row.outcome,
      nextActionDate: row.nextActionDate,
      nextAction: row.nextAction,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customer: row.customerName
        ? {
            id: row.customerId,
            name: row.customerName,
          }
        : undefined,
      invoiceNumber: row.invoiceNumber,
    };
  }

  private mapAdjustmentRow(row: CarteraAdjustmentRow) {
    return {
      id: row.id,
      customerId: row.customerId,
      invoiceId: row.invoiceId,
      receiptId: row.receiptId,
      sourceInvoiceId: row.sourceInvoiceId,
      type: row.type,
      status: row.status,
      amount: this.toNumber(row.amount),
      reason: row.reason,
      notes: row.notes,
      approvedAt: row.approvedAt,
      appliedAt: row.appliedAt,
      rejectedAt: row.rejectedAt,
      rejectedReason: row.rejectedReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customer: row.customerName
        ? {
            id: row.customerId,
            name: row.customerName,
            documentNumber: row.customerDocumentNumber,
          }
        : undefined,
      invoiceNumber: row.invoiceNumber,
      receiptNumber: row.receiptNumber,
      sourceInvoiceNumber: row.sourceInvoiceNumber,
      requestedByName: row.requestedByName?.trim() || null,
      approvedByName: row.approvedByName?.trim() || null,
    };
  }

  private mapBankMovementRow(row: BankMovementRow) {
    return {
      id: row.id,
      bankCode: row.bankCode,
      accountNumber: row.accountNumber,
      movementDate: row.movementDate,
      reference: row.reference,
      description: row.description,
      amount: this.toNumber(row.amount),
      status: row.status,
      matchedReceiptId: row.matchedReceiptId,
      reconciledAt: row.reconciledAt,
      createdAt: row.createdAt,
      matchedReceiptNumber: row.matchedReceiptNumber,
      customerName: row.customerName,
    };
  }

  private parseDelimitedRows(csvText: string, delimiter = ',') {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return [];

    const normalize = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

    const headers = lines[0].split(delimiter).map((header) => normalize(header));
    return lines.slice(1).map((line) => {
      const values = line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''));
      return headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = values[index] ?? '';
        return acc;
      }, {});
    });
  }

  private normalizePaymentMethod(rawValue: string): PaymentMethod {
    const normalized = String(rawValue ?? '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const aliases: Record<string, PaymentMethod> = {
      EFECTIVO: PaymentMethod.EFECTIVO,
      CASH: PaymentMethod.EFECTIVO,
      TRANSFERENCIA: PaymentMethod.TRANSFERENCIA,
      TRANSFER: PaymentMethod.TRANSFERENCIA,
      TRANSFERENCIA_BANCARIA: PaymentMethod.TRANSFERENCIA,
      CHEQUE: PaymentMethod.CHEQUE,
      CHECK: PaymentMethod.CHEQUE,
      TARJETA: PaymentMethod.TARJETA,
      CARD: PaymentMethod.TARJETA,
      CONSIGNACION: PaymentMethod.CONSIGNACION,
      CONSIGNMENT: PaymentMethod.CONSIGNACION,
      DEPOSITO: PaymentMethod.CONSIGNACION,
      DEPOSITO_BANCARIO: PaymentMethod.CONSIGNACION,
    };

    const resolved = aliases[normalized];
    if (!resolved) {
      throw new BadRequestException(`Medio de pago inválido en importación: ${rawValue}`);
    }

    return resolved;
  }

  private async getAppliedInvoiceAdjustmentMap(
    companyId: string,
    invoiceIds: string[],
    tx?: Prisma.TransactionClient,
  ) {
    const map = new Map<string, number>();
    if (!invoiceIds.length) return map;

    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<Array<{ invoiceId: string; net: Prisma.Decimal | number | string }>>`
      SELECT
        a."invoiceId" AS "invoiceId",
        COALESCE(SUM(
          CASE
            WHEN a."type" IN ('CREDIT_NOTE', 'WRITE_OFF') THEN -a."amount"
            WHEN a."type" IN ('DEBIT_NOTE', 'RECOVERY') THEN a."amount"
            ELSE 0
          END
        ), 0) AS net
      FROM "cartera_adjustments" a
      WHERE
        a."companyId" = ${companyId}
        AND a."status" = 'APPLIED'
        AND a."invoiceId" IN (${Prisma.join(invoiceIds)})
      GROUP BY a."invoiceId"
    `;

    for (const row of rows) {
      map.set(row.invoiceId, this.toNumber(row.net));
    }
    return map;
  }

  private async findBankMovementById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<BankMovementRow[]>`
      SELECT
        m."id",
        m."companyId",
        m."bankCode",
        m."accountNumber",
        m."movementDate",
        m."reference",
        m."description",
        m."amount",
        m."status",
        m."matchedReceiptId",
        m."reconciledById",
        m."reconciledAt",
        m."importedById",
        m."createdAt",
        m."updatedAt",
        r."number" AS "matchedReceiptNumber",
        c."name" AS "customerName"
      FROM "cartera_bank_movements" m
      LEFT JOIN "cartera_receipts" r ON r."id" = m."matchedReceiptId"
      LEFT JOIN "customers" c ON c."id" = r."customerId"
      WHERE m."companyId" = ${companyId} AND m."id" = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Movimiento bancario no encontrado');
    return this.mapBankMovementRow(row);
  }

  private async getCustomerCreditBalance(companyId: string, customerId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ total: Prisma.Decimal | number | string }>>`
      SELECT COALESCE(SUM(a."amount"), 0) AS total
      FROM "cartera_adjustments" a
      WHERE
        a."companyId" = ${companyId}
        AND a."customerId" = ${customerId}
        AND a."status" = 'APPLIED'
        AND a."invoiceId" IS NULL
        AND a."type" = 'CREDIT_NOTE'
    `;
    return this.toNumber(rows[0]?.total);
  }

  private async findAppliedAdjustmentsForStatement(companyId: string, customerId: string) {
    const rows = await this.prisma.$queryRaw<CarteraAdjustmentRow[]>`
      SELECT
        a."id",
        a."companyId",
        a."customerId",
        a."invoiceId",
        a."receiptId",
        a."sourceInvoiceId",
        a."type",
        a."status",
        a."amount",
        a."reason",
        a."notes",
        a."requestedById",
        a."approvedById",
        a."approvedAt",
        a."appliedAt",
        a."rejectedAt",
        a."rejectedReason",
        a."createdAt",
        a."updatedAt",
        i."invoiceNumber" AS "invoiceNumber",
        r."number" AS "receiptNumber"
      FROM "cartera_adjustments" a
      LEFT JOIN "invoices" i ON i."id" = a."invoiceId"
      LEFT JOIN "cartera_receipts" r ON r."id" = a."receiptId"
      WHERE
        a."companyId" = ${companyId}
        AND a."customerId" = ${customerId}
        AND a."status" = 'APPLIED'
        AND a."type" IN ('CREDIT_NOTE', 'DEBIT_NOTE', 'WRITE_OFF', 'RECOVERY')
      ORDER BY COALESCE(a."appliedAt", a."createdAt") ASC, a."createdAt" ASC
    `;

    return rows.map((row) => this.mapAdjustmentRow(row));
  }

  private async tryCreateReceiptAccountingEntry(
    companyId: string,
    receipt: ReturnType<CarteraService['mapReceiptRow']>,
    applications: ReceiptApplicationDto[],
  ) {
    if (!applications.length) return;
    try {
      const accounts = await this.resolveAccountingAccounts(companyId, {
        cashLike: receipt.paymentMethod,
      });
      if (!accounts.receivable || !accounts.cashLike) return;

      const total = this.roundMoney(applications.reduce((sum, item) => sum + Number(item.amount), 0));
      if (total <= 0) return;

      await this.accountingService.createAutoPostedEntry(companyId, {
        date: String(receipt.paymentDate).slice(0, 10),
        description: `Recaudo de cartera ${receipt.number}`,
        reference: receipt.reference ?? receipt.number,
        sourceType: 'ADJUSTMENT' as any,
        sourceId: `receipt:${receipt.id}`,
        lines: [
          {
            accountId: accounts.cashLike.id,
            description: `Ingreso por recaudo ${receipt.number}`,
            debit: total,
            credit: 0,
            position: 1,
          },
          {
            accountId: accounts.receivable.id,
            description: `Aplicación a cuentas por cobrar ${receipt.number}`,
            debit: 0,
            credit: total,
            position: 2,
          },
        ],
      });
    } catch (error: any) {
      await this.prisma.auditLog.create({
        data: {
          companyId,
          action: 'CARTERA_ACCOUNTING_INTEGRATION_FAILED',
          resource: 'cartera',
          resourceId: receipt.id,
          after: {
            source: 'receipt',
            error: error?.message ?? 'Error contable no controlado',
          } as Prisma.InputJsonObject,
        },
      });
    }
  }

  private async tryCreateAdjustmentAccountingEntry(
    companyId: string,
    adjustment: ReturnType<CarteraService['mapAdjustmentRow']>,
  ) {
    try {
      const accounts = await this.resolveAccountingAccounts(companyId);
      const amount = Number(adjustment.amount ?? 0);
      if (amount <= 0 || !accounts.receivable) return;

      const lines: Array<{ accountId: string; description: string; debit: number; credit: number; position: number }> = [];

      if (adjustment.type === 'CREDIT_NOTE' && accounts.creditNote) {
        lines.push(
          { accountId: accounts.creditNote.id, description: adjustment.reason, debit: amount, credit: 0, position: 1 },
          { accountId: accounts.receivable.id, description: adjustment.reason, debit: 0, credit: amount, position: 2 },
        );
      } else if (adjustment.type === 'DEBIT_NOTE' && accounts.debitNote) {
        lines.push(
          { accountId: accounts.receivable.id, description: adjustment.reason, debit: amount, credit: 0, position: 1 },
          { accountId: accounts.debitNote.id, description: adjustment.reason, debit: 0, credit: amount, position: 2 },
        );
      } else if (adjustment.type === 'WRITE_OFF' && accounts.writeOffExpense) {
        lines.push(
          { accountId: accounts.writeOffExpense.id, description: adjustment.reason, debit: amount, credit: 0, position: 1 },
          { accountId: accounts.receivable.id, description: adjustment.reason, debit: 0, credit: amount, position: 2 },
        );
      } else if (adjustment.type === 'PROVISION' && accounts.provisionExpense && accounts.allowance) {
        lines.push(
          { accountId: accounts.provisionExpense.id, description: adjustment.reason, debit: amount, credit: 0, position: 1 },
          { accountId: accounts.allowance.id, description: adjustment.reason, debit: 0, credit: amount, position: 2 },
        );
      } else if (adjustment.type === 'RECOVERY' && accounts.recoveryIncome) {
        lines.push(
          { accountId: accounts.receivable.id, description: adjustment.reason, debit: amount, credit: 0, position: 1 },
          { accountId: accounts.recoveryIncome.id, description: adjustment.reason, debit: 0, credit: amount, position: 2 },
        );
      } else if (adjustment.type === 'RECEIPT_REVERSAL' && accounts.cashLike) {
        lines.push(
          { accountId: accounts.receivable.id, description: adjustment.reason, debit: amount, credit: 0, position: 1 },
          { accountId: accounts.cashLike.id, description: adjustment.reason, debit: 0, credit: amount, position: 2 },
        );
      }

      if (!lines.length) return;

      await this.accountingService.createAutoPostedEntry(companyId, {
        date: String(adjustment.appliedAt ?? adjustment.createdAt).slice(0, 10),
        description: `Ajuste de cartera ${adjustment.type}`,
        reference: adjustment.invoiceNumber ?? adjustment.receiptNumber ?? adjustment.id,
        sourceType: 'ADJUSTMENT' as any,
        sourceId: `cartera-adjustment:${adjustment.id}`,
        lines,
      });
    } catch (error: any) {
      await this.prisma.auditLog.create({
        data: {
          companyId,
          action: 'CARTERA_ACCOUNTING_INTEGRATION_FAILED',
          resource: 'cartera',
          resourceId: adjustment.id,
          after: {
            source: 'adjustment',
            error: error?.message ?? 'Error contable no controlado',
          } as Prisma.InputJsonObject,
        },
      });
    }
  }

  private async resolveAccountingAccounts(companyId: string, options?: { cashLike?: string }) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true },
    });

    const findByPrefixes = (...prefixes: string[]) =>
      accounts.find((account) => prefixes.some((prefix) => account.code === prefix || account.code.startsWith(prefix)));

    const prefersCash = (options?.cashLike ?? '').toUpperCase() === 'EFECTIVO';

    return {
      receivable: findByPrefixes('130505', '1305', '13'),
      cashLike: prefersCash ? findByPrefixes('110505', '1105', '11') : findByPrefixes('111005', '1110', '11'),
      creditNote: findByPrefixes('4175', '4170', '41'),
      debitNote: findByPrefixes('4295', '4290', '42', '41'),
      writeOffExpense: findByPrefixes('519910', '5199', '51'),
      provisionExpense: findByPrefixes('519905', '5199', '51'),
      allowance: findByPrefixes('139905', '1399', '139'),
      recoveryIncome: findByPrefixes('425035', '4250', '42'),
    };
  }

  private buildPaymentNotes(receipt: ReceiptRow, application: ReceiptApplicationDto) {
    const base = receipt.notes?.trim();
    const detail = `Aplicado desde recaudo ${receipt.number}`;
    return base ? `${base} | ${detail}` : detail;
  }

  private async validateAdjustmentRequest(companyId: string, dto: CreateCarteraAdjustmentDto) {
    if (['CREDIT_NOTE', 'DEBIT_NOTE', 'WRITE_OFF', 'PROVISION', 'RECOVERY'].includes(dto.type) && !dto.invoiceId) {
      throw new BadRequestException('Este tipo de ajuste requiere una factura');
    }
    if (dto.type === 'RECEIPT_REVERSAL' && !dto.receiptId) {
      throw new BadRequestException('La reversión debe indicar el recaudo a anular');
    }

    if (dto.invoiceId) {
      await this.ensureInvoiceBelongsToCustomer(companyId, dto.customerId, dto.invoiceId);
    }
    if (dto.sourceInvoiceId) {
      const sourceInvoice = await this.prisma.invoice.findFirst({
        where: { id: dto.sourceInvoiceId, companyId, customerId: dto.customerId, deletedAt: null },
        select: { id: true },
      });
      if (!sourceInvoice) {
        throw new BadRequestException('El documento origen no pertenece al cliente seleccionado');
      }
    }
    if (dto.receiptId) {
      const receipt = await this.prisma.$queryRaw<ReceiptRow[]>`
        SELECT
          r."id",
          r."number",
          r."companyId",
          r."customerId",
          r."amount",
          r."appliedAmount",
          r."unappliedAmount",
          r."paymentMethod",
          r."reference",
          r."notes",
          r."paymentDate",
          r."status",
          r."createdById",
          r."createdAt",
          r."updatedAt"
        FROM "cartera_receipts" r
        WHERE r."companyId" = ${companyId} AND r."id" = ${dto.receiptId}
        LIMIT 1
      `;
      const receiptRow = receipt[0];
      if (!receiptRow || receiptRow.customerId !== dto.customerId) {
        throw new BadRequestException('El recaudo no pertenece al cliente seleccionado');
      }
      if (dto.type === 'RECEIPT_REVERSAL' && receiptRow.status === 'VOID') {
        throw new BadRequestException('El recaudo ya está anulado');
      }
    }
  }

  private async applyReceiptReversalInternal(
    tx: Prisma.TransactionClient,
    companyId: string,
    adjustment: ReturnType<CarteraService['mapAdjustmentRow']>,
    userId: string,
  ) {
    if (!adjustment.receiptId) {
      throw new BadRequestException('La reversión no tiene recaudo asociado');
    }

    const receipt = await this.getReceiptForUpdate(tx, companyId, adjustment.receiptId);
    if (receipt.status === 'VOID') {
      throw new BadRequestException('El recaudo ya fue anulado');
    }

    const applications = await tx.$queryRaw<ReceiptApplicationRow[]>`
      SELECT
        a."id",
        a."receiptId",
        a."invoiceId",
        a."amount",
        a."appliedAt",
        a."createdById",
        i."invoiceNumber" AS "invoiceNumber",
        i."issueDate" AS "invoiceIssueDate",
        i."dueDate" AS "invoiceDueDate",
        i."total" AS "invoiceTotal"
      FROM "cartera_receipt_applications" a
      INNER JOIN "invoices" i ON i."id" = a."invoiceId"
      WHERE a."receiptId" = ${adjustment.receiptId}
      ORDER BY a."appliedAt" ASC, a."createdAt" ASC
    `;

    for (const application of applications) {
      await tx.carteraPayment.create({
        data: {
          companyId,
          invoiceId: application.invoiceId,
          userId,
          amount: -Math.abs(this.toNumber(application.amount)),
          paymentMethod: `REVERSO_${receipt.paymentMethod}`,
          reference: receipt.reference ? `${receipt.reference}-REV` : `${receipt.number}-REV`,
          notes: `Reversión aprobada del recaudo ${receipt.number}`,
          paymentDate: new Date(),
        },
      });

      const invoice = await tx.invoice.findFirst({
        where: { id: application.invoiceId, companyId, deletedAt: null },
        include: { payments: { select: { amount: true } } },
      });
      if (!invoice) continue;

      const adjustmentMap = await this.getAppliedInvoiceAdjustmentMap(companyId, [invoice.id], tx);
      const paidAmount = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = this.calculateInvoiceBalance(
        Number(invoice.total),
        paidAmount,
        adjustmentMap.get(invoice.id) ?? 0,
      );

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: balance <= 0.01 ? 'PAID' : invoice.dueDate && new Date(invoice.dueDate) < new Date() ? 'OVERDUE' : 'ACCEPTED_DIAN',
        },
      });
    }

    await tx.$executeRaw`
      UPDATE "cartera_receipts"
      SET
        "appliedAmount" = 0,
        "unappliedAmount" = 0,
        "status" = ${'VOID'},
        "notes" = ${receipt.notes ? `${receipt.notes} | Recaudo anulado por ajuste aprobado` : 'Recaudo anulado por ajuste aprobado'},
        "updatedAt" = NOW()
      WHERE "id" = ${adjustment.receiptId}
    `;
  }

  private calcStatus(dueDate: Date | null, invoiceStatus: string): CarteraStatus {
    if (invoiceStatus === 'PAID') return 'AL_DIA';
    if (!dueDate) return 'AL_DIA';
    const today = new Date();
    const due = new Date(dueDate);
    const in30 = new Date(today);
    in30.setDate(in30.getDate() + 30);

    const daysLate = Math.floor((today.getTime() - due.getTime()) / 86400000);
    if (due < today && daysLate > 60) return 'EN_MORA';
    if (due < today) return 'VENCIDA';
    if (due <= in30) return 'POR_VENCER';
    return 'AL_DIA';
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    return Number(value ?? 0);
  }

  private roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private generateId() {
    return `crt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  private async findPromiseById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<PaymentPromiseRow[]>`
      SELECT
        p."id",
        p."companyId",
        p."customerId",
        p."invoiceId",
        p."amount",
        p."promisedDate",
        p."status",
        p."notes",
        p."createdById",
        p."resolvedById",
        p."resolvedAt",
        p."createdAt",
        p."updatedAt",
        c."name" AS "customerName",
        c."documentNumber" AS "customerDocumentNumber",
        i."invoiceNumber" AS "invoiceNumber"
      FROM "cartera_payment_promises" p
      INNER JOIN "customers" c ON c."id" = p."customerId"
      LEFT JOIN "invoices" i ON i."id" = p."invoiceId"
      WHERE p."companyId" = ${companyId} AND p."id" = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Promesa de pago no encontrada');
    return this.mapPromiseRow(row);
  }

  private async findAdjustmentById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<CarteraAdjustmentRow[]>`
      SELECT
        a."id",
        a."companyId",
        a."customerId",
        a."invoiceId",
        a."receiptId",
        a."sourceInvoiceId",
        a."type",
        a."status",
        a."amount",
        a."reason",
        a."notes",
        a."requestedById",
        a."approvedById",
        a."approvedAt",
        a."appliedAt",
        a."rejectedAt",
        a."rejectedReason",
        a."createdAt",
        a."updatedAt",
        c."name" AS "customerName",
        c."documentNumber" AS "customerDocumentNumber",
        i."invoiceNumber" AS "invoiceNumber",
        r."number" AS "receiptNumber",
        si."invoiceNumber" AS "sourceInvoiceNumber",
        CONCAT(COALESCE(ru."firstName", ''), ' ', COALESCE(ru."lastName", '')) AS "requestedByName",
        CONCAT(COALESCE(au."firstName", ''), ' ', COALESCE(au."lastName", '')) AS "approvedByName"
      FROM "cartera_adjustments" a
      INNER JOIN "customers" c ON c."id" = a."customerId"
      LEFT JOIN "invoices" i ON i."id" = a."invoiceId"
      LEFT JOIN "cartera_receipts" r ON r."id" = a."receiptId"
      LEFT JOIN "invoices" si ON si."id" = a."sourceInvoiceId"
      LEFT JOIN "users" ru ON ru."id" = a."requestedById"
      LEFT JOIN "users" au ON au."id" = a."approvedById"
      WHERE a."companyId" = ${companyId} AND a."id" = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Ajuste de cartera no encontrado');
    return this.mapAdjustmentRow(row);
  }

  private async findFollowUpById(companyId: string, id: string) {
    const rows = await this.prisma.$queryRaw<CollectionFollowUpRow[]>`
      SELECT
        f."id",
        f."companyId",
        f."customerId",
        f."invoiceId",
        f."activityType",
        f."outcome",
        f."nextActionDate",
        f."nextAction",
        f."createdById",
        f."createdAt",
        f."updatedAt",
        c."name" AS "customerName",
        i."invoiceNumber" AS "invoiceNumber"
      FROM "cartera_collection_followups" f
      INNER JOIN "customers" c ON c."id" = f."customerId"
      LEFT JOIN "invoices" i ON i."id" = f."invoiceId"
      WHERE f."companyId" = ${companyId} AND f."id" = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Seguimiento de cobranza no encontrado');
    return this.mapFollowUpRow(row);
  }
}
