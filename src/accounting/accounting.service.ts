import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JournalEntryStatus, JournalSourceType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../config/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { CreateAccountingBankAccountDto } from './dto/create-accounting-bank-account.dto';
import { ImportAccountingBankStatementDto } from './dto/import-accounting-bank-statement.dto';
import { ReconcileAccountingBankMovementDto } from './dto/reconcile-accounting-bank-movement.dto';
import { UpsertAccountingTaxConfigDto } from './dto/accounting-tax-config.dto';
import { UpsertInvoiceAccountingProfileDto } from './dto/invoice-accounting-profile.dto';
import {
  AmortizeAccountingDeferredChargeDto,
  CreateAccountingDeferredChargeDto,
  CreateAccountingFixedAssetDto,
  CreateAccountingProvisionTemplateDto,
  DepreciateAccountingFixedAssetDto,
  RunAccountingProvisionDto,
} from './dto/accounting-assets.dto';
import {
  AddJournalAttachmentDto,
  RejectJournalApprovalDto,
  RequestJournalApprovalDto,
  ReverseJournalEntryDto,
} from './dto/accounting-governance.dto';

type AccountingPeriodStatus = 'OPEN' | 'CLOSED';

type AccountingPeriodRecord = {
  id: string;
  companyId: string;
  name: string;
  year: number;
  month: number;
  startDate: Date;
  endDate: Date;
  status: AccountingPeriodStatus;
  isLocked: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  level: number;
  nature: 'DEBIT' | 'CREDIT';
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

type GeneralLedgerRow = {
  accountId: string;
  code: string;
  name: string;
  level: number;
  nature: 'DEBIT' | 'CREDIT';
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
};

type AccountAuxiliaryMovement = {
  entryId: string;
  number: string;
  date: string;
  description: string;
  reference: string | null;
  lineDescription: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

type FinancialStatementSection = {
  key: string;
  label: string;
  total: number;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    level: number;
    amount: number;
  }>;
};

type IntegrationStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

type AccountingIntegrationActivityRow = {
  id: string;
  module: string;
  resourceType: string;
  resourceId: string;
  sourceId: string | null;
  entryId: string | null;
  status: IntegrationStatus;
  message: string | null;
  payload: any;
  createdAt: Date;
};

type AccountingIntegrationSummaryRow = {
  module: string;
  label: string;
  eligible: number;
  integrated: number;
  pending: number;
  failed: number;
  lastActivityAt: Date | null;
};

type AccountingBankAccountRow = {
  id: string;
  companyId: string;
  bankCode: string | null;
  bankName: string | null;
  accountingAccountId: string;
  accountingAccountCode: string;
  accountingAccountName: string;
  name: string;
  accountNumber: string;
  currency: string;
  openingBalance: Prisma.Decimal | number | string;
  currentBalance: Prisma.Decimal | number | string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type AccountingBankMovementRow = {
  id: string;
  companyId: string;
  bankAccountId: string;
  bankAccountName: string;
  accountNumber: string;
  movementDate: Date;
  reference: string | null;
  description: string | null;
  amount: Prisma.Decimal | number | string;
  status: string;
  reconciledEntryId: string | null;
  reconciledEntryNumber: string | null;
  reconciledEntryDate: Date | null;
  reconciledAt: Date | null;
  createdAt: Date;
};

type AccountingFixedAssetRow = {
  id: string;
  companyId: string;
  assetCode: string;
  name: string;
  acquisitionDate: Date;
  startDepreciationDate: Date;
  cost: Prisma.Decimal | number | string;
  salvageValue: Prisma.Decimal | number | string;
  usefulLifeMonths: number;
  assetAccountId: string;
  assetAccountCode: string;
  assetAccountName: string;
  accumulatedDepAccountId: string;
  accumulatedDepAccountCode: string;
  accumulatedDepAccountName: string;
  depreciationExpenseAccountId: string;
  depreciationExpenseAccountCode: string;
  depreciationExpenseAccountName: string;
  status: string;
  notes: string | null;
  accumulatedAmount: Prisma.Decimal | number | string;
  createdAt: Date;
  updatedAt: Date;
};

type AccountingDeferredChargeRow = {
  id: string;
  companyId: string;
  chargeCode: string;
  name: string;
  startDate: Date;
  amount: Prisma.Decimal | number | string;
  termMonths: number;
  assetAccountId: string;
  assetAccountCode: string;
  assetAccountName: string;
  amortizationExpenseAccountId: string;
  amortizationExpenseAccountCode: string;
  amortizationExpenseAccountName: string;
  status: string;
  notes: string | null;
  amortizedAmount: Prisma.Decimal | number | string;
  createdAt: Date;
  updatedAt: Date;
};

type AccountingProvisionTemplateRow = {
  id: string;
  companyId: string;
  provisionCode: string;
  name: string;
  amount: Prisma.Decimal | number | string;
  frequencyMonths: number;
  startDate: Date;
  nextRunDate: Date;
  endDate: Date | null;
  expenseAccountId: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  liabilityAccountId: string;
  liabilityAccountCode: string;
  liabilityAccountName: string;
  isActive: boolean;
  notes: string | null;
  lastRunAmount: Prisma.Decimal | number | string;
  lastRunDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PendingBankLedgerRow = {
  entryId: string;
  number: string;
  date: Date;
  description: string;
  reference: string | null;
  amount: Prisma.Decimal | number | string;
};

type AccountingTaxConfigRow = {
  id: string;
  companyId: string;
  taxCode: string;
  label: string;
  rate: Prisma.Decimal | number | string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type InvoiceAccountingProfileRow = {
  id: string;
  companyId: string;
  profileName: string;
  invoiceType: string;
  sourceChannel: string | null;
  branchId: string | null;
  receivableAccountId: string;
  receivableAccountCode: string;
  receivableAccountName: string;
  revenueAccountId: string;
  revenueAccountCode: string;
  revenueAccountName: string;
  taxAccountId: string;
  taxAccountCode: string;
  taxAccountName: string;
  withholdingReceivableAccountId: string | null;
  withholdingReceivableAccountCode: string | null;
  withholdingReceivableAccountName: string | null;
  withholdingRate: Prisma.Decimal | number | string | null;
  icaReceivableAccountId: string | null;
  icaReceivableAccountCode: string | null;
  icaReceivableAccountName: string | null;
  icaRate: Prisma.Decimal | number | string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type JournalApprovalRow = {
  id: string;
  entryId: string;
  status: string;
  reason: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  requestedById: string | null;
  approvedById: string | null;
  requestedByName: string | null;
  approvedByName: string | null;
};

type JournalAttachmentRow = {
  id: string;
  entryId: string;
  fileName: string;
  fileUrl: string;
  createdAt: Date;
  uploadedById: string | null;
  uploadedByName: string | null;
};

type AuditTrailRow = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  createdAt: Date;
  before: any;
  after: any;
  userId: string | null;
  userName: string | null;
};

@Injectable()
export class AccountingService {
  constructor(private prisma: PrismaService) {}

  private mapEntryTotals<T extends { lines?: Array<{ debit: any; credit: any }> }>(entry: T): T & { totalDebit: number; totalCredit: number } {
    const totalDebit = (entry.lines ?? []).reduce((sum, line) => sum + Number(line?.debit ?? 0), 0);
    const totalCredit = (entry.lines ?? []).reduce((sum, line) => sum + Number(line?.credit ?? 0), 0);
    return {
      ...entry,
      totalDebit,
      totalCredit,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PERÍODOS CONTABLES
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllPeriods(
    companyId: string,
    filters: { year?: number; status?: string },
  ) {
    if (filters.status && !['OPEN', 'CLOSED'].includes(filters.status)) {
      throw new BadRequestException('Estado de período inválido');
    }

    const params: any[] = [companyId];
    const clauses = [`"companyId" = $1`];

    if (filters.year !== undefined) {
      params.push(filters.year);
      clauses.push(`"year" = $${params.length}`);
    }

    if (filters.status) {
      params.push(filters.status);
      clauses.push(`"status" = $${params.length}`);
    }

    const periods = await this.prisma.$queryRawUnsafe<AccountingPeriodRecord[]>(
      `
        SELECT *
        FROM "accounting_periods"
        WHERE ${clauses.join(' AND ')}
        ORDER BY "year" DESC, "month" DESC
      `,
      ...params,
    );

    return periods;
  }

  async createPeriod(companyId: string, dto: CreateAccountingPeriodDto) {
    const startDate = new Date(dto.year, dto.month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(dto.year, dto.month, 0, 23, 59, 59, 999);

    const overlapping = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM "accounting_periods"
        WHERE "companyId" = $1
          AND "startDate" <= $2
          AND "endDate" >= $3
        LIMIT 1
      `,
      companyId,
      endDate,
      startDate,
    );

    if (overlapping.length > 0) {
      throw new ConflictException('Ya existe un período contable que se cruza con ese rango');
    }

    const id = randomUUID();
    const now = new Date();
    const name = dto.name?.trim() || this.buildPeriodName(dto.year, dto.month);

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_periods" (
          "id", "companyId", "name", "year", "month",
          "startDate", "endDate", "status", "isLocked",
          "closedAt", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', false, NULL, $8, $8)
      `,
      id,
      companyId,
      name,
      dto.year,
      dto.month,
      startDate,
      endDate,
      now,
    );

    return this.getPeriodOrThrow(companyId, id);
  }

  async closePeriod(companyId: string, id: string) {
    const period = await this.getPeriodOrThrow(companyId, id);

    if (period.status === 'CLOSED') {
      throw new BadRequestException('El período ya se encuentra cerrado');
    }

    const draftEntries = await this.prisma.journalEntry.count({
      where: {
        companyId,
        deletedAt: null,
        status: JournalEntryStatus.DRAFT,
        date: {
          gte: period.startDate,
          lte: period.endDate,
        },
      },
    });

    if (draftEntries > 0) {
      throw new BadRequestException(
        `No se puede cerrar el período porque existen ${draftEntries} comprobantes en borrador dentro del rango`,
      );
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_periods"
        SET "status" = 'CLOSED',
            "isLocked" = true,
            "closedAt" = $3,
            "updatedAt" = $3
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      new Date(),
    );

    return this.getPeriodOrThrow(companyId, id);
  }

  async reopenPeriod(companyId: string, id: string) {
    const period = await this.getPeriodOrThrow(companyId, id);

    if (period.status !== 'CLOSED') {
      throw new BadRequestException('Solo los períodos cerrados pueden reabrirse');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_periods"
        SET "status" = 'OPEN',
            "isLocked" = false,
            "closedAt" = NULL,
            "updatedAt" = $3
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      new Date(),
    );

    return this.getPeriodOrThrow(companyId, id);
  }

  async lockPeriod(companyId: string, id: string) {
    const period = await this.getPeriodOrThrow(companyId, id);

    if (period.status === 'CLOSED') {
      throw new BadRequestException('Los períodos cerrados ya quedan bloqueados automáticamente');
    }

    if (period.isLocked) {
      throw new BadRequestException('El período ya está bloqueado');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_periods"
        SET "isLocked" = true,
            "updatedAt" = $3
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      new Date(),
    );

    return this.getPeriodOrThrow(companyId, id);
  }

  async unlockPeriod(companyId: string, id: string) {
    const period = await this.getPeriodOrThrow(companyId, id);

    if (period.status === 'CLOSED') {
      throw new BadRequestException('Un período cerrado debe reabrirse antes de desbloquearse');
    }

    if (!period.isLocked) {
      throw new BadRequestException('El período ya está desbloqueado');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_periods"
        SET "isLocked" = false,
            "updatedAt" = $3
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      new Date(),
    );

    return this.getPeriodOrThrow(companyId, id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CUENTAS CONTABLES (AccountingAccount)
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllAccounts(
    companyId: string,
    filters: { search?: string; level?: number; isActive?: boolean; page?: number; limit?: number },
  ) {
    const { search, level, isActive, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = { companyId };

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (level !== undefined) {
      where.level = level;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.accountingAccount.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take: +limit,
        include: {
          parent: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.accountingAccount.count({ where }),
    ]);

    return {
      data,
      total,
      page: +page,
      limit: +limit,
      totalPages: Math.ceil(total / +limit),
    };
  }

  /** Construye el árbol jerárquico completo del PUC para la empresa */
  async getAccountsTree(companyId: string) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });

    // Construir árbol: nodos raíz son los que no tienen padre
    const map = new Map<string, any>();
    accounts.forEach((acc) => map.set(acc.id, { ...acc, children: [] }));

    const roots: any[] = [];
    accounts.forEach((acc) => {
      if (acc.parentId && map.has(acc.parentId)) {
        map.get(acc.parentId).children.push(map.get(acc.id));
      } else {
        roots.push(map.get(acc.id));
      }
    });

    return roots;
  }

  async findOneAccount(companyId: string, id: string) {
    const account = await this.prisma.accountingAccount.findFirst({
      where: { id, companyId },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        children: { select: { id: true, code: true, name: true, level: true, isActive: true } },
      },
    });
    if (!account) throw new NotFoundException('Cuenta contable no encontrada');
    return account;
  }

  async createAccount(companyId: string, dto: CreateAccountDto) {
    // Verificar unicidad del código PUC dentro de la empresa
    const existing = await this.prisma.accountingAccount.findFirst({
      where: { companyId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Ya existe una cuenta con el código PUC '${dto.code}'`);
    }

    await this.validateAccountHierarchy(companyId, dto.level, dto.parentId);

    return this.prisma.accountingAccount.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        level: dto.level,
        nature: dto.nature,
        parentId: dto.parentId ?? null,
        isActive: true,
      },
    });
  }

  async updateAccount(companyId: string, id: string, dto: UpdateAccountDto) {
    const current = await this.findOneAccount(companyId, id);

    // Si se cambia el código, verificar que no exista otro con ese código
    if (dto.code) {
      const conflict = await this.prisma.accountingAccount.findFirst({
        where: { companyId, code: dto.code, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Ya existe otra cuenta con el código PUC '${dto.code}'`);
      }
    }

    const nextLevel = dto.level ?? current.level;
    const nextParentId = dto.parentId !== undefined ? dto.parentId : current.parentId;
    await this.validateAccountHierarchy(companyId, nextLevel, nextParentId ?? undefined, id);

    return this.prisma.accountingAccount.update({
      where: { id },
      data: { ...dto },
    });
  }

  /** Alterna el estado activo/inactivo de una cuenta */
  async toggleAccount(companyId: string, id: string) {
    const account = await this.findOneAccount(companyId, id);
    return this.prisma.accountingAccount.update({
      where: { id },
      data: { isActive: !account.isActive },
    });
  }

  /**
   * Elimina una cuenta contable.
   * Si la cuenta tiene líneas de comprobante asociadas → soft-delete (isActive=false).
   * Si no tiene líneas → eliminación física.
   */
  async removeAccount(companyId: string, id: string) {
    await this.findOneAccount(companyId, id);

    const childrenCount = await this.prisma.accountingAccount.count({
      where: { companyId, parentId: id },
    });

    if (childrenCount > 0) {
      return this.prisma.accountingAccount.update({
        where: { id },
        data: { isActive: false },
      });
    }

    const linesCount = await this.prisma.journalEntryLine.count({
      where: { accountId: id },
    });

    if (linesCount > 0) {
      // Soft-delete: desactivar la cuenta para preservar integridad referencial
      return this.prisma.accountingAccount.update({
        where: { id },
        data: { isActive: false },
      });
    }

    // Eliminación física si no hay líneas vinculadas
    return this.prisma.accountingAccount.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COMPROBANTES CONTABLES (JournalEntry)
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllEntries(
    companyId: string,
    filters: {
      search?: string;
      status?: JournalEntryStatus;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where: any = { companyId, deletedAt: null };

    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: +limit,
        include: {
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }

  async findOneEntry(companyId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        reversalOf: { select: { id: true, number: true, date: true } },
        reversals: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, number: true, date: true, status: true },
        },
        lines: {
          orderBy: { position: 'asc' },
          include: {
            account: { select: { id: true, code: true, name: true, nature: true } },
            branch: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true, documentNumber: true } },
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('Comprobante contable no encontrado');
    const [approvalFlow, attachments] = await Promise.all([
      this.getEntryApprovalFlow(companyId, id),
      this.getEntryAttachments(companyId, id),
    ]);
    return {
      ...this.mapEntryTotals(entry),
      approvalFlow,
      approval: approvalFlow.find((item) => item.status === 'PENDING') ?? approvalFlow[0] ?? null,
      attachments,
    };
  }

  async createEntry(companyId: string, dto: CreateJournalEntryDto, userId?: string) {
    await this.ensureDateIsAvailable(companyId, new Date(dto.date));

    // Validar partida doble: suma débitos === suma créditos
    this.validateDoubleEntry(dto.lines);

    // Verificar que todas las cuentas existen y pertenecen a la empresa
    await this.validateAccountsExist(companyId, dto.lines.map((l) => l.accountId));
    await this.validateDimensionsExist(companyId, dto.lines);

    // Generar número de comprobante autoincremental por empresa (AC-0001)
    const number = await this.generateEntryNumber(companyId);

    const created = await this.prisma.journalEntry.create({
      data: {
        companyId,
        number,
        date: new Date(dto.date),
        description: dto.description,
        reference: dto.reference ?? null,
        sourceType: dto.sourceType ?? JournalSourceType.MANUAL,
        sourceId: dto.sourceId ?? null,
        status: JournalEntryStatus.DRAFT,
        lines: {
          create: dto.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description ?? null,
            branchId: line.branchId ?? null,
            customerId: line.customerId ?? null,
            costCenter: line.costCenter?.trim() || null,
            projectCode: line.projectCode?.trim() || null,
            debit: line.debit,
            credit: line.credit,
            position: line.position,
          })),
        },
      },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: {
            account: { select: { id: true, code: true, name: true } },
            branch: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true, documentNumber: true } },
          },
        },
      },
    }).then((entry) => this.mapEntryTotals(entry));

    await this.logJournalAudit(companyId, userId ?? null, 'ACCOUNTING_ENTRY_CREATED', created.id, null, {
      number: created.number,
      status: created.status,
    });
    return created;
  }

  async createAutoPostedEntry(
    companyId: string,
    dto: CreateJournalEntryDto & { sourceType?: JournalSourceType; sourceId?: string | null },
  ) {
    await this.ensureDateIsAvailable(companyId, new Date(dto.date));
    this.validateDoubleEntry(dto.lines);
    await this.validateAccountsExist(companyId, dto.lines.map((l) => l.accountId));
    await this.validateDimensionsExist(companyId, dto.lines);
    const number = await this.generateEntryNumber(companyId);

    return this.prisma.journalEntry.create({
      data: {
        companyId,
        number,
        date: new Date(dto.date),
        description: dto.description,
        reference: dto.reference ?? null,
        sourceType: dto.sourceType ?? JournalSourceType.ADJUSTMENT,
        sourceId: dto.sourceId ?? null,
        status: JournalEntryStatus.POSTED,
        lines: {
          create: dto.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description ?? null,
            branchId: line.branchId ?? null,
            customerId: line.customerId ?? null,
            costCenter: line.costCenter?.trim() || null,
            projectCode: line.projectCode?.trim() || null,
            debit: line.debit,
            credit: line.credit,
            position: line.position,
          })),
        },
      },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: {
            account: { select: { id: true, code: true, name: true } },
            branch: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true, documentNumber: true } },
          },
        },
      },
    }).then((entry) => this.mapEntryTotals(entry));
  }

  async updateEntry(companyId: string, id: string, dto: UpdateJournalEntryDto, userId?: string) {
    const entry = await this.findOneEntryBase(companyId, id);

    // Solo comprobantes en estado DRAFT pueden modificarse
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        'Solo se pueden modificar comprobantes en estado DRAFT',
      );
    }

    await this.ensureDateIsAvailable(companyId, dto.date ? new Date(dto.date) : new Date(entry.date));

    // Si se envían líneas, revalidar partida doble y cuentas
    if (dto.lines && dto.lines.length > 0) {
      this.validateDoubleEntry(dto.lines);
      await this.validateAccountsExist(companyId, dto.lines.map((l) => l.accountId));
      await this.validateDimensionsExist(companyId, dto.lines as any);
    }

    return this.prisma.$transaction(async (tx) => {
      // Eliminar líneas existentes y recrear si se incluyen en el DTO
      if (dto.lines && dto.lines.length > 0) {
        await tx.journalEntryLine.deleteMany({ where: { entryId: id } });
      }

      const updated = await tx.journalEntry.update({
        where: { id },
        data: {
          ...(dto.date ? { date: new Date(dto.date) } : {}),
          ...(dto.description ? { description: dto.description } : {}),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          ...(dto.sourceType ? { sourceType: dto.sourceType } : {}),
          ...(dto.sourceId !== undefined ? { sourceId: dto.sourceId } : {}),
          ...(dto.lines && dto.lines.length > 0
            ? {
                lines: {
                  create: dto.lines.map((line) => ({
                    accountId: line.accountId,
                    description: line.description ?? null,
                    branchId: (line as any).branchId ?? null,
                    customerId: (line as any).customerId ?? null,
                    costCenter: (line as any).costCenter?.trim() || null,
                    projectCode: (line as any).projectCode?.trim() || null,
                    debit: line.debit,
                    credit: line.credit,
                    position: line.position,
                  })),
                },
              }
            : {}),
        },
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: {
              account: { select: { id: true, code: true, name: true } },
              branch: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true, documentNumber: true } },
            },
          },
        },
      }).then((updated) => this.mapEntryTotals(updated));

      await this.logJournalAudit(companyId, userId ?? null, 'ACCOUNTING_ENTRY_UPDATED', id, {
        status: entry.status,
      }, {
        status: updated.status,
      });
      return updated;
    });
  }

  /** Contabiliza un comprobante: cambia estado DRAFT → POSTED */
  async postEntry(companyId: string, id: string, userId?: string) {
    const entry = await this.findOneEntryBase(companyId, id);

    await this.ensureDateIsAvailable(companyId, new Date(entry.date));

    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        `El comprobante no puede contabilizarse porque está en estado '${entry.status}'`,
      );
    }

    const latestApproval = (await this.getEntryApprovalFlow(companyId, id))[0];
    if (latestApproval?.status === 'PENDING') {
      throw new BadRequestException('El comprobante tiene una aprobación pendiente y no puede contabilizarse aún');
    }
    if (latestApproval?.status === 'REJECTED') {
      throw new BadRequestException('El comprobante fue rechazado y debe ajustarse antes de contabilizarse');
    }

    const posted = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalEntryStatus.POSTED },
    });
    await this.logJournalAudit(companyId, userId ?? null, 'ACCOUNTING_ENTRY_POSTED', id, { status: entry.status }, { status: posted.status });
    return posted;
  }

  /** Anula un comprobante: cambia estado POSTED → CANCELLED (solo ADMIN) */
  async cancelEntry(companyId: string, id: string, userId?: string) {
    const entry = await this.findOneEntryBase(companyId, id);

    if (entry.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestException(
        `El comprobante no puede anularse porque está en estado '${entry.status}'`,
      );
    }

    const cancelled = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalEntryStatus.CANCELLED },
    });
    await this.logJournalAudit(companyId, userId ?? null, 'ACCOUNTING_ENTRY_CANCELLED', id, { status: entry.status }, { status: cancelled.status });
    return cancelled;
  }

  /** Elimina un comprobante (soft-delete). Solo si está en estado DRAFT */
  async removeEntry(companyId: string, id: string, userId?: string) {
    const entry = await this.findOneEntryBase(companyId, id);

    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        'Solo se pueden eliminar comprobantes en estado DRAFT',
      );
    }

    const removed = await this.prisma.journalEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.logJournalAudit(companyId, userId ?? null, 'ACCOUNTING_ENTRY_DELETED', id, { status: entry.status }, { deletedAt: removed.deletedAt });
    return removed;
  }

  async getEntryApprovalFlow(companyId: string, id: string) {
    await this.findOneEntryBase(companyId, id);
    const rows = await this.prisma.$queryRawUnsafe<JournalApprovalRow[]>(
      `
        SELECT
          jar."id",
          jar."entryId",
          jar."status",
          jar."reason",
          jar."requestedAt",
          jar."approvedAt",
          jar."rejectedAt",
          jar."rejectedReason",
          jar."requestedById",
          jar."approvedById",
          TRIM(COALESCE(rq."firstName",'') || ' ' || COALESCE(rq."lastName",'')) AS "requestedByName",
          TRIM(COALESCE(ap."firstName",'') || ' ' || COALESCE(ap."lastName",'')) AS "approvedByName"
        FROM "journal_entry_approval_requests" jar
        LEFT JOIN "users" rq ON rq."id" = jar."requestedById"
        LEFT JOIN "users" ap ON ap."id" = jar."approvedById"
        WHERE jar."companyId" = $1
          AND jar."entryId" = $2
        ORDER BY jar."requestedAt" DESC
      `,
      companyId,
      id,
    );
    return rows.map((row) => ({
      ...row,
      requestedByName: row.requestedByName?.trim() || null,
      approvedByName: row.approvedByName?.trim() || null,
    }));
  }

  async requestEntryApproval(companyId: string, id: string, dto: RequestJournalApprovalDto, userId: string) {
    const entry = await this.findOneEntryBase(companyId, id);
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException('Solo se pueden solicitar aprobaciones sobre comprobantes en borrador');
    }

    const latest = (await this.getEntryApprovalFlow(companyId, id))[0];
    if (latest?.status === 'PENDING') {
      throw new BadRequestException('El comprobante ya tiene una solicitud de aprobación pendiente');
    }

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "journal_entry_approval_requests" (
          "id","companyId","entryId","status","reason","requestedById","requestedAt","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,'PENDING',$4,$5,NOW(),NOW(),NOW())
      `,
      randomUUID(),
      companyId,
      id,
      dto.reason?.trim() || null,
      userId,
    );

    await this.logJournalAudit(companyId, userId, 'ACCOUNTING_ENTRY_APPROVAL_REQUESTED', id, null, {
      reason: dto.reason?.trim() || null,
      number: entry.number,
    });

    return this.getEntryApprovalFlow(companyId, id);
  }

  async approveEntry(companyId: string, id: string, userId: string) {
    await this.findOneEntryBase(companyId, id);
    const approval = (await this.getEntryApprovalFlow(companyId, id)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para este comprobante');

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "journal_entry_approval_requests"
        SET "status" = 'APPROVED',
            "approvedById" = $3,
            "approvedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      approval.id,
      userId,
    );

    await this.logJournalAudit(companyId, userId, 'ACCOUNTING_ENTRY_APPROVED', id, null, {
      approvalId: approval.id,
    });

    return this.getEntryApprovalFlow(companyId, id);
  }

  async rejectEntryApproval(companyId: string, id: string, dto: RejectJournalApprovalDto, userId: string) {
    await this.findOneEntryBase(companyId, id);
    const approval = (await this.getEntryApprovalFlow(companyId, id)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para este comprobante');

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "journal_entry_approval_requests"
        SET "status" = 'REJECTED',
            "approvedById" = $3,
            "rejectedAt" = NOW(),
            "rejectedReason" = $4,
            "updatedAt" = NOW()
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      approval.id,
      userId,
      dto.reason?.trim() || 'Rechazado por control interno',
    );

    await this.logJournalAudit(companyId, userId, 'ACCOUNTING_ENTRY_REJECTED', id, null, {
      approvalId: approval.id,
      reason: dto.reason?.trim() || 'Rechazado por control interno',
    });

    return this.getEntryApprovalFlow(companyId, id);
  }

  async getEntryAttachments(companyId: string, id: string) {
    await this.findOneEntryBase(companyId, id);
    const rows = await this.prisma.$queryRawUnsafe<JournalAttachmentRow[]>(
      `
        SELECT
          ja."id",
          ja."entryId",
          ja."fileName",
          ja."fileUrl",
          ja."createdAt",
          ja."uploadedById",
          TRIM(COALESCE(u."firstName",'') || ' ' || COALESCE(u."lastName",'')) AS "uploadedByName"
        FROM "journal_entry_attachments" ja
        LEFT JOIN "users" u ON u."id" = ja."uploadedById"
        WHERE ja."companyId" = $1
          AND ja."entryId" = $2
        ORDER BY ja."createdAt" DESC
      `,
      companyId,
      id,
    );
    return rows.map((row) => ({
      ...row,
      uploadedByName: row.uploadedByName?.trim() || null,
    }));
  }

  async addEntryAttachment(companyId: string, id: string, dto: AddJournalAttachmentDto, userId: string) {
    await this.findOneEntryBase(companyId, id);
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "journal_entry_attachments" (
          "id","companyId","entryId","fileName","fileUrl","uploadedById","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      `,
      randomUUID(),
      companyId,
      id,
      dto.fileName.trim(),
      dto.fileUrl.trim(),
      userId,
    );

    await this.logJournalAudit(companyId, userId, 'ACCOUNTING_ENTRY_ATTACHMENT_ADDED', id, null, {
      fileName: dto.fileName.trim(),
      fileUrl: dto.fileUrl.trim(),
    });

    return this.getEntryAttachments(companyId, id);
  }

  async getEntryAuditTrail(companyId: string, id: string) {
    await this.findOneEntryBase(companyId, id);
    const rows = await this.prisma.$queryRawUnsafe<AuditTrailRow[]>(
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
          AND al."resource" = 'accounting'
          AND al."resourceId" = $2
        ORDER BY al."createdAt" DESC
      `,
      companyId,
      id,
    );
    return rows.map((row) => ({
      ...row,
      userName: row.userName?.trim() || null,
    }));
  }

  async reverseEntry(companyId: string, id: string, dto: ReverseJournalEntryDto, userId: string) {
    const entry = await this.findOneEntry(companyId, id);
    if (entry.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestException('Solo se pueden reversar comprobantes contabilizados');
    }
    if (entry.reversalOf || entry.reversals?.length) {
      throw new BadRequestException('El comprobante ya tiene un reverso asociado');
    }

    const existingReversal = await this.prisma.$queryRawUnsafe<Array<{ id: string; number: string }>>(
      `
        SELECT "id", "number"
        FROM "journal_entries"
        WHERE "companyId" = $1
          AND "reversedById" = $2
          AND "deletedAt" IS NULL
        ORDER BY "createdAt" DESC
        LIMIT 1
      `,
      companyId,
      id,
    );
    if (existingReversal[0]) {
      throw new BadRequestException(`Ya existe un reverso creado para este comprobante (${existingReversal[0].number})`);
    }

    const reversal = await this.createAutoPostedEntry(companyId, {
      date: new Date().toISOString(),
      description: `Reverso de ${entry.number}${dto.reason?.trim() ? ` - ${dto.reason.trim()}` : ''}`,
      reference: entry.number,
      sourceType: JournalSourceType.ADJUSTMENT,
      sourceId: `journal-reversal:${id}`,
      lines: (entry.lines ?? []).map((line: any, index: number) => ({
        accountId: line.accountId,
        description: line.description ?? `Reverso ${entry.number}`,
        branchId: line.branchId ?? null,
        customerId: line.customerId ?? null,
        costCenter: line.costCenter ?? null,
        projectCode: line.projectCode ?? null,
        debit: Number(line.credit ?? 0),
        credit: Number(line.debit ?? 0),
        position: index + 1,
      })),
    });

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "journal_entries"
        SET "reversedById" = $2,
            "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      reversal.id,
      id,
    );

    await this.logJournalAudit(companyId, userId, 'ACCOUNTING_ENTRY_REVERSED', id, null, {
      reversalEntryId: reversal.id,
      reversalEntryNumber: reversal.number,
      reason: dto.reason?.trim() || null,
    });

    return this.findOneEntry(companyId, reversal.id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INTEGRACIONES CONTABLES AUTOMÁTICAS
  // ───────────────────────────────────────────────────────────────────────────

  async getIntegrationsSummary(companyId: string) {
    const [invoiceEligible, invoiceIntegrated, payrollEligible, payrollIntegrated, purchaseIntegrated, carteraIntegrated, inventoryLatest, posEligibleRows, posIntegrated] =
      await Promise.all([
        this.prisma.invoice.count({
          where: {
            companyId,
            deletedAt: null,
            status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'PAID', 'OVERDUE'] as any[] },
          },
        }),
        this.prisma.journalEntry.count({
          where: {
            companyId,
            deletedAt: null,
            sourceId: { startsWith: 'invoice:' },
          },
        }),
        (this.prisma.payroll_records as any).count({
          where: {
            companyId,
            isAnulado: false,
            status: { in: ['SUBMITTED', 'ACCEPTED'] },
          },
        }),
        this.prisma.journalEntry.count({
          where: {
            companyId,
            deletedAt: null,
            sourceId: { startsWith: 'payroll:' },
          },
        }),
        this.prisma.journalEntry.count({
          where: { companyId, deletedAt: null, sourceType: JournalSourceType.PURCHASE },
        }),
        this.prisma.journalEntry.count({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { sourceId: { startsWith: 'receipt:' } },
              { sourceId: { startsWith: 'cartera-adjustment:' } },
            ],
          },
        }),
        this.prisma.$queryRawUnsafe<Array<{ integrated: number; failed: number; lastActivityAt: Date | null }>>(
          `
            SELECT
              COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS "integrated",
              COUNT(*) FILTER (WHERE status = 'FAILED')::int AS "failed",
              MAX("createdAt") AS "lastActivityAt"
            FROM "accounting_integrations"
            WHERE "companyId" = $1
              AND "module" = 'inventory'
          `,
          companyId,
        ),
        this.prisma.$queryRawUnsafe<Array<{ total: number }>>(
          `
            SELECT (
              (SELECT COUNT(*) FROM "pos_sales" ps WHERE ps."companyId" = $1 AND ps."invoiceId" IS NULL AND ps."status" = 'COMPLETED')
              +
              (SELECT COUNT(*) FROM "pos_sales" ps WHERE ps."companyId" = $1 AND ps."invoiceId" IS NULL AND ps."status" IN ('REFUNDED', 'CANCELLED'))
              +
              (SELECT COUNT(*) FROM "pos_cash_movements" pcm WHERE pcm."companyId" = $1)
            )::int AS total
          `,
          companyId,
        ),
        this.prisma.journalEntry.count({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { sourceId: { startsWith: 'pos-sale:' } },
              { sourceId: { startsWith: 'pos-refund:' } },
              { sourceId: { startsWith: 'pos-cash-movement:' } },
            ],
          },
        }),
      ]);

    const failureRows = await this.prisma.$queryRawUnsafe<Array<{ module: string; failed: number; lastActivityAt: Date | null }>>(
      `
        SELECT
          "module",
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS "failed",
          MAX("createdAt") AS "lastActivityAt"
        FROM "accounting_integrations"
        WHERE "companyId" = $1
        GROUP BY "module"
      `,
      companyId,
    );

    const failureMap = new Map(failureRows.map((row) => [row.module, row]));
    const inventoryStats = inventoryLatest[0] ?? { integrated: 0, failed: 0, lastActivityAt: null };
    const posEligible = Number(posEligibleRows[0]?.total ?? 0);

    const rows: AccountingIntegrationSummaryRow[] = [
      {
        module: 'invoices',
        label: 'Facturación',
        eligible: invoiceEligible,
        integrated: invoiceIntegrated,
        pending: Math.max(0, invoiceEligible - invoiceIntegrated),
        failed: Number(failureMap.get('invoices')?.failed ?? 0),
        lastActivityAt: failureMap.get('invoices')?.lastActivityAt ?? null,
      },
      {
        module: 'purchasing',
        label: 'Compras',
        eligible: purchaseIntegrated,
        integrated: purchaseIntegrated,
        pending: 0,
        failed: Number(failureMap.get('purchasing')?.failed ?? 0),
        lastActivityAt: failureMap.get('purchasing')?.lastActivityAt ?? null,
      },
      {
        module: 'cartera',
        label: 'Cartera',
        eligible: carteraIntegrated,
        integrated: carteraIntegrated,
        pending: 0,
        failed: Number(failureMap.get('cartera')?.failed ?? 0),
        lastActivityAt: failureMap.get('cartera')?.lastActivityAt ?? null,
      },
      {
        module: 'payroll',
        label: 'Nómina',
        eligible: payrollEligible,
        integrated: payrollIntegrated,
        pending: Math.max(0, payrollEligible - payrollIntegrated),
        failed: Number(failureMap.get('payroll')?.failed ?? 0),
        lastActivityAt: failureMap.get('payroll')?.lastActivityAt ?? null,
      },
      {
        module: 'inventory',
        label: 'Inventario',
        eligible: Number(inventoryStats.integrated ?? 0) + Number(inventoryStats.failed ?? 0),
        integrated: Number(inventoryStats.integrated ?? 0),
        pending: 0,
        failed: Number(inventoryStats.failed ?? 0),
        lastActivityAt: inventoryStats.lastActivityAt ?? null,
      },
      {
        module: 'pos',
        label: 'POS',
        eligible: posEligible,
        integrated: posIntegrated,
        pending: Math.max(0, posEligible - posIntegrated),
        failed: Number(failureMap.get('pos')?.failed ?? 0),
        lastActivityAt: failureMap.get('pos')?.lastActivityAt ?? null,
      },
    ];

    return {
      data: rows,
      totals: {
        eligible: rows.reduce((sum, row) => sum + row.eligible, 0),
        integrated: rows.reduce((sum, row) => sum + row.integrated, 0),
        pending: rows.reduce((sum, row) => sum + row.pending, 0),
        failed: rows.reduce((sum, row) => sum + row.failed, 0),
      },
    };
  }

  async getIntegrationsActivity(
    companyId: string,
    filters: { module?: string; status?: string; page?: number; limit?: number },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;
    const params: any[] = [companyId];
    const clauses = [`"companyId" = $1`];

    if (filters.module) {
      params.push(filters.module);
      clauses.push(`"module" = $${params.length}`);
    }

    if (filters.status) {
      params.push(filters.status.toUpperCase());
      clauses.push(`"status" = $${params.length}`);
    }

    const [data, totalRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<AccountingIntegrationActivityRow[]>(
        `
          SELECT *
          FROM "accounting_integrations"
          WHERE ${clauses.join(' AND ')}
          ORDER BY "createdAt" DESC
          LIMIT $${params.length + 1}
          OFFSET $${params.length + 2}
        `,
        ...params,
        limit,
        offset,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `
          SELECT COUNT(*)::int AS total
          FROM "accounting_integrations"
          WHERE ${clauses.join(' AND ')}
        `,
        ...params,
      ),
    ]);

    const total = Number(totalRows[0]?.total ?? 0);
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async syncPendingIntegrations(companyId: string) {
    const pendingInvoices = await this.prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['SENT_DIAN', 'ACCEPTED_DIAN', 'PAID', 'OVERDUE'] as any[] },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    const pendingPayroll = await (this.prisma.payroll_records as any).findMany({
      where: {
        companyId,
        isAnulado: false,
        status: { in: ['SUBMITTED', 'ACCEPTED'] },
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    });

    const pendingPosSales = await this.prisma.posSale.findMany({
      where: { companyId, invoiceId: null, status: 'COMPLETED' as any },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    const pendingPosRefunds = await this.prisma.posSale.findMany({
      where: { companyId, invoiceId: null, status: { in: ['REFUNDED', 'CANCELLED'] as any[] } },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
      take: 25,
    });

    const pendingPosCashMovements = await this.prisma.posCashMovement.findMany({
      where: { companyId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    const results = {
      invoices: [] as any[],
      payroll: [] as any[],
      pos: [] as any[],
    };

    for (const invoice of pendingInvoices) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `invoice:${invoice.id}` },
        select: { id: true },
      });
      if (!existing) results.invoices.push(await this.syncInvoiceEntry(companyId, invoice.id));
    }

    for (const payroll of pendingPayroll) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `payroll:${payroll.id}` },
        select: { id: true },
      });
      if (!existing) results.payroll.push(await this.syncPayrollEntry(companyId, payroll.id));
    }

    for (const sale of pendingPosSales) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `pos-sale:${sale.id}` },
        select: { id: true },
      });
      if (!existing) results.pos.push(await this.syncPosSaleEntry(companyId, sale.id));
    }

    for (const sale of pendingPosRefunds) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `pos-refund:${sale.id}` },
        select: { id: true },
      });
      if (!existing) results.pos.push(await this.syncPosRefundEntry(companyId, sale.id));
    }

    for (const movement of pendingPosCashMovements) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { companyId, deletedAt: null, sourceId: `pos-cash-movement:${movement.id}` },
        select: { id: true },
      });
      if (!existing) results.pos.push(await this.syncPosCashMovementEntry(companyId, movement.id));
    }

    return results;
  }

  async syncIntegrationResource(companyId: string, module: string, resourceId: string) {
    const normalized = module.trim().toLowerCase();
    if (normalized === 'invoices') return this.syncInvoiceEntry(companyId, resourceId);
    if (normalized === 'payroll') return this.syncPayrollEntry(companyId, resourceId);
    if (normalized === 'pos' || normalized === 'pos-sale') return this.syncPosSaleEntry(companyId, resourceId);
    if (normalized === 'pos-refund') return this.syncPosRefundEntry(companyId, resourceId);
    if (normalized === 'pos-cash-movement') return this.syncPosCashMovementEntry(companyId, resourceId);
    throw new BadRequestException('Solo se soporta resincronización manual para facturación, nómina y POS');
  }

  async syncInvoiceEntry(companyId: string, invoiceId: string) {
    const sourceId = `invoice:${invoiceId}`;
    const existing = await this.prisma.journalEntry.findFirst({
      where: { companyId, deletedAt: null, sourceId },
      select: { id: true, number: true },
    });
    if (existing) {
      return this.recordIntegration(companyId, {
        module: 'invoices',
        resourceType: 'invoice',
        resourceId: invoiceId,
        sourceId,
        entryId: existing.id,
        status: 'SKIPPED',
        message: `La factura ya estaba integrada en el comprobante ${existing.number}`,
      });
    }

    try {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: invoiceId, companyId, deletedAt: null },
        select: {
          id: true,
          branchId: true,
          sourceChannel: true,
          invoiceNumber: true,
          issueDate: true,
          subtotal: true,
          taxAmount: true,
          withholdingAmount: true,
          icaAmount: true,
          total: true,
          type: true,
          status: true,
        },
      });
      if (!invoice) throw new NotFoundException('Factura no encontrada');
      if (!['SENT_DIAN', 'ACCEPTED_DIAN', 'PAID', 'OVERDUE'].includes(invoice.status as any)) {
        return this.recordIntegration(companyId, {
          module: 'invoices',
          resourceType: 'invoice',
          resourceId: invoiceId,
          sourceId,
          status: 'SKIPPED',
          message: `La factura ${invoice.invoiceNumber} aún no está lista para contabilización automática`,
        });
      }

      const accounts = await this.resolveInvoiceAccounts(companyId, {
        invoiceType: invoice.type,
        sourceChannel: invoice.sourceChannel ?? null,
        branchId: invoice.branchId ?? null,
      });
      const subtotal = Number(invoice.subtotal);
      const taxAmount = Number(invoice.taxAmount);
      const grossTotal = Number(invoice.total);
      const withholdingAmount = Number(invoice.withholdingAmount ?? 0);
      const icaAmount = Number(invoice.icaAmount ?? 0);
      const netReceivable = this.roundMoney(grossTotal - withholdingAmount - icaAmount);
      const isCreditNote = invoice.type === 'NOTA_CREDITO';
      let position = 1;
      const lines: Array<any> = [];

      if (isCreditNote) {
        lines.push(
          {
            accountId: accounts.revenue.id,
            description: `Reverso ingreso ${invoice.invoiceNumber}`,
            debit: subtotal,
            credit: 0,
            position: position++,
          },
          {
            accountId: accounts.receivable.id,
            description: `Reverso cuenta por cobrar ${invoice.invoiceNumber}`,
            debit: 0,
            credit: netReceivable,
            position: position++,
          },
        );
        if (taxAmount > 0) {
          lines.push({
            accountId: accounts.tax.id,
            description: `Reverso IVA ${invoice.invoiceNumber}`,
            debit: taxAmount,
            credit: 0,
            position: position++,
          });
        }
        if (withholdingAmount > 0 && accounts.withholdingReceivable) {
          lines.push({
            accountId: accounts.withholdingReceivable.id,
            description: `Reverso retefuente ${invoice.invoiceNumber}`,
            debit: 0,
            credit: withholdingAmount,
            position: position++,
          });
        }
        if (icaAmount > 0 && accounts.icaReceivable) {
          lines.push({
            accountId: accounts.icaReceivable.id,
            description: `Reverso ICA ${invoice.invoiceNumber}`,
            debit: 0,
            credit: icaAmount,
            position: position++,
          });
        }
      } else {
        lines.push(
          {
            accountId: accounts.receivable.id,
            description: `Cuenta por cobrar ${invoice.invoiceNumber}`,
            debit: netReceivable,
            credit: 0,
            position: position++,
          },
          {
            accountId: accounts.revenue.id,
            description: `Ingreso operativo ${invoice.invoiceNumber}`,
            debit: 0,
            credit: subtotal,
            position: position++,
          },
        );
        if (taxAmount > 0) {
          lines.push({
            accountId: accounts.tax.id,
            description: `IVA generado ${invoice.invoiceNumber}`,
            debit: 0,
            credit: taxAmount,
            position: position++,
          });
        }
        if (withholdingAmount > 0 && accounts.withholdingReceivable) {
          lines.push({
            accountId: accounts.withholdingReceivable.id,
            description: `ReteFuente por cobrar ${invoice.invoiceNumber}`,
            debit: withholdingAmount,
            credit: 0,
            position: position++,
          });
        }
        if (icaAmount > 0 && accounts.icaReceivable) {
          lines.push({
            accountId: accounts.icaReceivable.id,
            description: `ICA por cobrar ${invoice.invoiceNumber}`,
            debit: icaAmount,
            credit: 0,
            position: position++,
          });
        }
      }

      const entry = await this.createAutoPostedEntry(companyId, {
        date: new Date(invoice.issueDate).toISOString(),
        description:
          invoice.type === 'NOTA_CREDITO'
            ? `Contabilización automática nota crédito ${invoice.invoiceNumber}`
            : invoice.type === 'NOTA_DEBITO'
              ? `Contabilización automática nota débito ${invoice.invoiceNumber}`
              : `Contabilización automática factura ${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        sourceType: JournalSourceType.INVOICE,
        sourceId,
        lines,
      });

      return this.recordIntegration(companyId, {
        module: 'invoices',
        resourceType: 'invoice',
        resourceId: invoiceId,
        sourceId,
        entryId: entry.id,
        status: 'SUCCESS',
        message: `Factura ${invoice.invoiceNumber} integrada correctamente`,
        context: {
          invoiceType: invoice.type,
          sourceChannel: invoice.sourceChannel ?? null,
          branchId: invoice.branchId ?? null,
          profileId: accounts.profileId ?? null,
          withholdingAmount,
          icaAmount,
          netReceivable,
        },
      });
    } catch (error: any) {
      return this.recordIntegration(companyId, {
        module: 'invoices',
        resourceType: 'invoice',
        resourceId: invoiceId,
        sourceId,
        status: 'FAILED',
        message: error?.message ?? 'No fue posible integrar la factura',
      });
    }
  }

  async syncPayrollEntry(companyId: string, payrollId: string) {
    const sourceId = `payroll:${payrollId}`;
    const existing = await this.prisma.journalEntry.findFirst({
      where: { companyId, deletedAt: null, sourceId },
      select: { id: true, number: true },
    });
    if (existing) {
      return this.recordIntegration(companyId, {
        module: 'payroll',
        resourceType: 'payroll',
        resourceId: payrollId,
        sourceId,
        entryId: existing.id,
        status: 'SKIPPED',
        message: `La nómina ya estaba integrada en el comprobante ${existing.number}`,
      });
    }

    try {
      const payroll = await (this.prisma.payroll_records as any).findFirst({
        where: { id: payrollId, companyId },
        select: {
          id: true,
          payrollNumber: true,
          payDate: true,
          status: true,
          isAnulado: true,
          totalEarnings: true,
          totalDeductions: true,
          netPay: true,
          totalEmployerCost: true,
        },
      });
      if (!payroll) throw new NotFoundException('Registro de nómina no encontrado');
      if (payroll.isAnulado || !['SUBMITTED', 'ACCEPTED'].includes(payroll.status)) {
        return this.recordIntegration(companyId, {
          module: 'payroll',
          resourceType: 'payroll',
          resourceId: payrollId,
          sourceId,
          status: 'SKIPPED',
          message: 'La nómina aún no está finalizada para contabilización automática',
        });
      }

      const employerBurden = Math.max(0, Number(payroll.totalEmployerCost) - Number(payroll.totalEarnings));
      const contributionLiability = Number(payroll.totalDeductions) + employerBurden;
      const accounts = await this.resolvePayrollAccounts(companyId);

      const lines = [
        { accountId: accounts.expense.id, description: `Gasto nómina ${payroll.payrollNumber ?? payroll.id}`, debit: Number(payroll.totalEmployerCost), credit: 0, position: 1 },
        { accountId: accounts.payable.id, description: `Nómina por pagar ${payroll.payrollNumber ?? payroll.id}`, debit: 0, credit: Number(payroll.netPay), position: 2 },
      ];
      if (contributionLiability > 0) {
        lines.push({
          accountId: accounts.contributions.id,
          description: `Aportes y deducciones ${payroll.payrollNumber ?? payroll.id}`,
          debit: 0,
          credit: contributionLiability,
          position: 3,
        });
      }

      const entry = await this.createAutoPostedEntry(companyId, {
        date: new Date(payroll.payDate).toISOString(),
        description: `Contabilización automática nómina ${payroll.payrollNumber ?? payroll.id}`,
        reference: payroll.payrollNumber ?? payroll.id,
        sourceType: JournalSourceType.PAYROLL,
        sourceId,
        lines,
      });

      return this.recordIntegration(companyId, {
        module: 'payroll',
        resourceType: 'payroll',
        resourceId: payrollId,
        sourceId,
        entryId: entry.id,
        status: 'SUCCESS',
        message: `Nómina ${payroll.payrollNumber ?? payroll.id} integrada correctamente`,
      });
    } catch (error: any) {
      return this.recordIntegration(companyId, {
        module: 'payroll',
        resourceType: 'payroll',
        resourceId: payrollId,
        sourceId,
        status: 'FAILED',
        message: error?.message ?? 'No fue posible integrar la nómina',
      });
    }
  }

  async syncInventoryAdjustmentEntry(
    companyId: string,
    payload: { productId: string; delta: number; reason?: string | null; userId?: string | null; eventId?: string | null },
  ) {
    const sourceId = payload.eventId || `inventory-adjustment:${payload.productId}:${Date.now()}`;

    try {
      const product = await this.prisma.product.findFirst({
        where: { id: payload.productId, companyId, deletedAt: null },
        select: { id: true, name: true, sku: true, cost: true },
      });
      if (!product) throw new NotFoundException('Producto no encontrado para integración de inventario');

      const amount = Math.abs(Number(payload.delta) * Number(product.cost ?? 0));
      if (amount <= 0) {
        return this.recordIntegration(companyId, {
          module: 'inventory',
          resourceType: 'product',
          resourceId: payload.productId,
          sourceId,
          status: 'SKIPPED',
          message: `El producto ${product.sku} no tiene costo valorizado para generar asiento`,
        });
      }

      const accounts = await this.resolveInventoryAccounts(companyId);
      const isIncrease = payload.delta > 0;
      const lines = [
        {
          accountId: isIncrease ? accounts.inventory.id : accounts.adjustment.id,
          description: `${isIncrease ? 'Ingreso' : 'Salida'} ajuste inventario ${product.sku}`,
          debit: amount,
          credit: 0,
          position: 1,
        },
        {
          accountId: isIncrease ? accounts.adjustment.id : accounts.inventory.id,
          description: `${isIncrease ? 'Contrapartida' : 'Salida'} ajuste inventario ${product.sku}`,
          debit: 0,
          credit: amount,
          position: 2,
        },
      ];

      const entry = await this.createAutoPostedEntry(companyId, {
        date: new Date().toISOString(),
        description: `Ajuste de inventario ${product.sku} (${payload.delta > 0 ? '+' : ''}${payload.delta})`,
        reference: product.sku,
        sourceType: JournalSourceType.ADJUSTMENT,
        sourceId,
        lines,
      });

      return this.recordIntegration(companyId, {
        module: 'inventory',
        resourceType: 'product',
        resourceId: payload.productId,
        sourceId,
        entryId: entry.id,
        status: 'SUCCESS',
        message: `Ajuste de inventario integrado para ${product.name}`,
      });
    } catch (error: any) {
      return this.recordIntegration(companyId, {
        module: 'inventory',
        resourceType: 'product',
        resourceId: payload.productId,
        sourceId,
        status: 'FAILED',
        message: error?.message ?? 'No fue posible integrar el ajuste de inventario',
      });
    }
  }

  async syncPosSaleEntry(companyId: string, saleId: string) {
    const sourceId = `pos-sale:${saleId}`;
    const existing = await this.prisma.journalEntry.findFirst({
      where: { companyId, deletedAt: null, sourceId },
      select: { id: true, number: true },
    });
    if (existing) {
      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-sale',
        resourceId: saleId,
        sourceId,
        entryId: existing.id,
        status: 'SKIPPED',
        message: `La venta POS ya estaba integrada en el comprobante ${existing.number}`,
      });
    }

    try {
      const sale = await this.prisma.posSale.findFirst({
        where: { id: saleId, companyId },
        include: {
          payments: true,
          session: {
            select: {
              id: true,
              branchId: true,
              terminalId: true,
              terminal: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
          items: {
            include: {
              product: { select: { cost: true, sku: true } },
            },
          },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      });
      if (!sale) throw new NotFoundException('Venta POS no encontrada');
      if (sale.invoiceId) {
        return this.recordIntegration(companyId, {
          module: 'pos',
          resourceType: 'pos-sale',
          resourceId: saleId,
          sourceId,
          status: 'SKIPPED',
          message: `La venta POS ${sale.saleNumber} se integra desde la factura ${sale.invoice?.invoiceNumber ?? sale.invoiceId}`,
        });
      }
      if (sale.status !== 'COMPLETED') {
        return this.recordIntegration(companyId, {
          module: 'pos',
          resourceType: 'pos-sale',
          resourceId: saleId,
          sourceId,
          status: 'SKIPPED',
          message: `La venta POS ${sale.saleNumber} aún no está completada para contabilización`,
        });
      }

      const posAccounts = await this.resolvePosAccounts(companyId);
      const lines: Array<any> = [];
      const paymentLines =
        sale.payments.length > 0
          ? sale.payments.map((payment) => ({
              paymentMethod: payment.paymentMethod,
              amount: Number(payment.amount),
            }))
          : [{ paymentMethod: sale.paymentMethod as any, amount: Number(sale.amountPaid || sale.total) }];

      let position = 1;
      const groupedPayments = paymentLines.reduce<Record<string, number>>((acc, item) => {
        acc[item.paymentMethod] = Number(acc[item.paymentMethod] ?? 0) + Number(item.amount ?? 0);
        return acc;
      }, {});
      for (const [paymentMethod, amount] of Object.entries(groupedPayments)) {
        if (Number(amount) <= 0) continue;
        const account = this.resolvePosPaymentAccount(posAccounts, paymentMethod);
        lines.push({
          accountId: account!.id,
          description: `Ingreso ${String(paymentMethod).toLowerCase()} POS ${sale.saleNumber}`,
          branchId: sale.session?.branchId ?? null,
          customerId: sale.customerId ?? null,
          debit: this.roundMoney(amount),
          credit: 0,
          position: position++,
        });
      }

      lines.push({
        accountId: posAccounts.revenue.id,
        description: `Ingreso POS ${sale.saleNumber}`,
        branchId: sale.session?.branchId ?? null,
        customerId: sale.customerId ?? null,
        debit: 0,
        credit: Number(sale.subtotal),
        position: position++,
      });

      if (Number(sale.taxAmount) > 0) {
        lines.push({
          accountId: posAccounts.tax.id,
          description: `IVA POS ${sale.saleNumber}`,
          branchId: sale.session?.branchId ?? null,
          customerId: sale.customerId ?? null,
          debit: 0,
          credit: Number(sale.taxAmount),
          position: position++,
        });
      }

      const saleCost = sale.items.reduce(
        (sum, item) => sum + Number(item.product?.cost ?? 0) * Number(item.quantity),
        0,
      );
      if (saleCost > 0) {
        lines.push({
          accountId: posAccounts.cost.id,
          description: `Costo POS ${sale.saleNumber}`,
          branchId: sale.session?.branchId ?? null,
          debit: this.roundMoney(saleCost),
          credit: 0,
          position: position++,
        });
        lines.push({
          accountId: posAccounts.inventory.id,
          description: `Salida inventario POS ${sale.saleNumber}`,
          branchId: sale.session?.branchId ?? null,
          debit: 0,
          credit: this.roundMoney(saleCost),
          position: position++,
        });
      }

      const entry = await this.createAutoPostedEntry(companyId, {
        date: sale.createdAt.toISOString(),
        description: `Contabilización automática POS ${sale.saleNumber}`,
        reference: sale.saleNumber,
        sourceType: JournalSourceType.ADJUSTMENT,
        sourceId,
        lines,
      });

      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-sale',
        resourceId: saleId,
        sourceId,
        entryId: entry.id,
        status: 'SUCCESS',
        message: `Venta POS ${sale.saleNumber} integrada correctamente`,
      });
    } catch (error: any) {
      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-sale',
        resourceId: saleId,
        sourceId,
        status: 'FAILED',
        message: error?.message ?? 'No fue posible integrar la venta POS',
      });
    }
  }

  async syncPosRefundEntry(companyId: string, saleId: string) {
    const sourceId = `pos-refund:${saleId}`;
    const existing = await this.prisma.journalEntry.findFirst({
      where: { companyId, deletedAt: null, sourceId },
      select: { id: true, number: true },
    });
    if (existing) {
      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-refund',
        resourceId: saleId,
        sourceId,
        entryId: existing.id,
        status: 'SKIPPED',
        message: `La reversión POS ya estaba integrada en el comprobante ${existing.number}`,
      });
    }

    try {
      const sale = await this.prisma.posSale.findFirst({
        where: { id: saleId, companyId },
        include: {
          payments: true,
          items: {
            include: {
              product: { select: { cost: true } },
            },
          },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      });
      if (!sale) throw new NotFoundException('Venta POS no encontrada');
      if (sale.invoiceId) {
        return this.recordIntegration(companyId, {
          module: 'pos',
          resourceType: 'pos-refund',
          resourceId: saleId,
          sourceId,
          status: 'SKIPPED',
          message: `La reversión POS ${sale.saleNumber} se controla desde la factura ${sale.invoice?.invoiceNumber ?? sale.invoiceId}`,
        });
      }
      if (!['REFUNDED', 'CANCELLED'].includes(String(sale.status))) {
        return this.recordIntegration(companyId, {
          module: 'pos',
          resourceType: 'pos-refund',
          resourceId: saleId,
          sourceId,
          status: 'SKIPPED',
          message: `La venta POS ${sale.saleNumber} no está en estado reversible`,
        });
      }

      const posAccounts = await this.resolvePosAccounts(companyId);
      const paymentLines =
        sale.payments.length > 0
          ? sale.payments.map((payment) => ({
              paymentMethod: payment.paymentMethod,
              amount: Number(payment.amount),
            }))
          : [{ paymentMethod: sale.paymentMethod as any, amount: Number(sale.amountPaid || sale.total) }];

      const cashAmount = paymentLines
        .filter((item) => item.paymentMethod === 'CASH')
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const bankAmount = paymentLines
        .filter((item) => item.paymentMethod !== 'CASH')
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const saleCost = sale.items.reduce(
        (sum, item) => sum + Number(item.product?.cost ?? 0) * Number(item.quantity),
        0,
      );

      const lines: Array<any> = [];
      let position = 1;
      lines.push({
        accountId: posAccounts.revenue.id,
        description: `Reverso ingreso POS ${sale.saleNumber}`,
        debit: Number(sale.subtotal),
        credit: 0,
        position: position++,
      });
      if (Number(sale.taxAmount) > 0) {
        lines.push({
          accountId: posAccounts.tax.id,
          description: `Reverso IVA POS ${sale.saleNumber}`,
          debit: Number(sale.taxAmount),
          credit: 0,
          position: position++,
        });
      }
      if (cashAmount > 0) {
        lines.push({
          accountId: posAccounts.cash.id,
          description: `Salida efectivo reembolso POS ${sale.saleNumber}`,
          debit: 0,
          credit: this.roundMoney(cashAmount),
          position: position++,
        });
      }
      if (bankAmount > 0) {
        lines.push({
          accountId: posAccounts.bank.id,
          description: `Salida electrónica reembolso POS ${sale.saleNumber}`,
          debit: 0,
          credit: this.roundMoney(bankAmount),
          position: position++,
        });
      }
      if (saleCost > 0) {
        lines.push({
          accountId: posAccounts.inventory.id,
          description: `Reingreso inventario POS ${sale.saleNumber}`,
          debit: this.roundMoney(saleCost),
          credit: 0,
          position: position++,
        });
        lines.push({
          accountId: posAccounts.cost.id,
          description: `Reverso costo POS ${sale.saleNumber}`,
          debit: 0,
          credit: this.roundMoney(saleCost),
          position: position++,
        });
      }

      const entry = await this.createAutoPostedEntry(companyId, {
        date: new Date().toISOString(),
        description: `Reverso automático POS ${sale.saleNumber}`,
        reference: sale.saleNumber,
        sourceType: JournalSourceType.ADJUSTMENT,
        sourceId,
        lines,
      });

      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-refund',
        resourceId: saleId,
        sourceId,
        entryId: entry.id,
        status: 'SUCCESS',
        message: `Reversión POS ${sale.saleNumber} integrada correctamente`,
      });
    } catch (error: any) {
      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-refund',
        resourceId: saleId,
        sourceId,
        status: 'FAILED',
        message: error?.message ?? 'No fue posible integrar el reembolso POS',
      });
    }
  }

  async syncPosCashMovementEntry(companyId: string, movementId: string) {
    const sourceId = `pos-cash-movement:${movementId}`;
    const existing = await this.prisma.journalEntry.findFirst({
      where: { companyId, deletedAt: null, sourceId },
      select: { id: true, number: true },
    });
    if (existing) {
      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-cash-movement',
        resourceId: movementId,
        sourceId,
        entryId: existing.id,
        status: 'SKIPPED',
        message: `El movimiento de caja POS ya estaba integrado en el comprobante ${existing.number}`,
      });
    }

    try {
      const movement = await this.prisma.posCashMovement.findFirst({
        where: { id: movementId, companyId },
        include: {
          session: { select: { id: true, userId: true } },
        },
      });
      if (!movement) throw new NotFoundException('Movimiento de caja POS no encontrado');

      const posAccounts = await this.resolvePosAccounts(companyId);
      const isIn = movement.type === 'IN';
      const entry = await this.createAutoPostedEntry(companyId, {
        date: movement.createdAt.toISOString(),
        description: `${isIn ? 'Ingreso' : 'Retiro'} caja POS: ${movement.reason}`,
        reference: movement.id,
        sourceType: JournalSourceType.ADJUSTMENT,
        sourceId,
        lines: [
          {
            accountId: isIn ? posAccounts.cash.id : posAccounts.adjustment.id,
            description: `${isIn ? 'Ingreso' : 'Contrapartida'} movimiento POS`,
            debit: Number(movement.amount),
            credit: 0,
            position: 1,
          },
          {
            accountId: isIn ? posAccounts.adjustment.id : posAccounts.cash.id,
            description: `${isIn ? 'Contrapartida' : 'Salida'} movimiento POS`,
            debit: 0,
            credit: Number(movement.amount),
            position: 2,
          },
        ],
      });

      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-cash-movement',
        resourceId: movementId,
        sourceId,
        entryId: entry.id,
        status: 'SUCCESS',
        message: `Movimiento de caja POS integrado correctamente`,
      });
    } catch (error: any) {
      return this.recordIntegration(companyId, {
        module: 'pos',
        resourceType: 'pos-cash-movement',
        resourceId: movementId,
        sourceId,
        status: 'FAILED',
        message: error?.message ?? 'No fue posible integrar el movimiento de caja POS',
      });
    }
  }

  async findAllBankAccounts(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingBankAccountRow[]>(
      `
        SELECT
          aba."id",
          aba."companyId",
          aba."bankCode",
          b."name" AS "bankName",
          aba."accountingAccountId",
          aa."code" AS "accountingAccountCode",
          aa."name" AS "accountingAccountName",
          aba."name",
          aba."accountNumber",
          aba."currency",
          aba."openingBalance",
          aba."currentBalance",
          aba."isActive",
          aba."createdAt",
          aba."updatedAt"
        FROM "accounting_bank_accounts" aba
        INNER JOIN "accounting_accounts" aa ON aa."id" = aba."accountingAccountId"
        LEFT JOIN "banks" b ON b."code" = aba."bankCode"
        WHERE aba."companyId" = $1
        ORDER BY aba."createdAt" DESC
      `,
      companyId,
    );

    return rows.map((row) => this.mapBankAccountRow(row));
  }

  async createBankAccount(companyId: string, dto: CreateAccountingBankAccountDto) {
    const account = await this.prisma.accountingAccount.findFirst({
      where: {
        id: dto.accountingAccountId,
        companyId,
        isActive: true,
      },
      select: { id: true, code: true, name: true },
    });
    if (!account) {
      throw new NotFoundException('La cuenta contable bancaria no existe o está inactiva');
    }

    if (dto.bankCode) {
      const bank = await this.prisma.bank.findFirst({
        where: { code: dto.bankCode, isActive: true },
        select: { code: true },
      });
      if (!bank) throw new NotFoundException('Banco no encontrado');
    }

    const existing = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM "accounting_bank_accounts"
        WHERE "companyId" = $1
          AND "accountNumber" = $2
        LIMIT 1
      `,
      companyId,
      dto.accountNumber.trim(),
    );
    if (existing.length) {
      throw new ConflictException('Ya existe una cuenta bancaria con ese número');
    }

    const id = randomUUID();
    const openingBalance = Number(dto.openingBalance ?? 0);
    const now = new Date();

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_bank_accounts" (
          "id", "companyId", "bankCode", "accountingAccountId", "name", "accountNumber",
          "currency", "openingBalance", "currentBalance", "isActive", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $10)
      `,
      id,
      companyId,
      dto.bankCode ?? null,
      dto.accountingAccountId,
      dto.name.trim(),
      dto.accountNumber.trim(),
      dto.currency?.trim() || 'COP',
      openingBalance,
      dto.isActive ?? true,
      now,
    );

    return this.findBankAccountOrThrow(companyId, id);
  }

  async findAllBankMovements(
    companyId: string,
    filters: { bankAccountId?: string; status?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.max(1, filters.limit ?? 20);
    const offset = (page - 1) * limit;
    const params: any[] = [companyId];
    const conditions = [`m."companyId" = $1`];

    if (filters.bankAccountId) {
      params.push(filters.bankAccountId);
      conditions.push(`m."bankAccountId" = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`m."status" = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const totalResult = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `
        SELECT COUNT(*)::int AS count
        FROM "accounting_bank_movements" m
        WHERE ${whereClause}
      `,
      ...params,
    );

    params.push(limit);
    params.push(offset);
    const rows = await this.prisma.$queryRawUnsafe<AccountingBankMovementRow[]>(
      `
        SELECT
          m."id",
          m."companyId",
          m."bankAccountId",
          aba."name" AS "bankAccountName",
          aba."accountNumber",
          m."movementDate",
          m."reference",
          m."description",
          m."amount",
          m."status",
          m."reconciledEntryId",
          je."number" AS "reconciledEntryNumber",
          je."date" AS "reconciledEntryDate",
          m."reconciledAt",
          m."createdAt"
        FROM "accounting_bank_movements" m
        INNER JOIN "accounting_bank_accounts" aba ON aba."id" = m."bankAccountId"
        LEFT JOIN "journal_entries" je ON je."id" = m."reconciledEntryId"
        WHERE ${whereClause}
        ORDER BY m."movementDate" DESC, m."createdAt" DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      ...params,
    );

    const total = Number(totalResult[0]?.count ?? 0);
    return {
      data: rows.map((row) => this.mapBankMovementRow(row)),
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async importBankStatement(
    companyId: string,
    dto: ImportAccountingBankStatementDto,
    userId: string,
  ) {
    const bankAccount = await this.findBankAccountOrThrow(companyId, dto.bankAccountId);
    const rows = this.parseDelimitedRows(dto.csvText, dto.delimiter);
    const imported: any[] = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (const [index, row] of rows.entries()) {
      try {
        const movementDate = row.date || row.movementdate || row.fecha;
        const reference = row.reference || row.referencia || null;
        const description = row.description || row.descripcion || row.concept || row.concepto || null;
        const amount = Number(row.amount ?? row.value ?? row.valor ?? 0);

        if (!movementDate || Number.isNaN(amount) || amount === 0) {
          throw new BadRequestException('Fila incompleta: date y amount son obligatorios');
        }

        const id = randomUUID();
        await this.prisma.$executeRaw`
          INSERT INTO "accounting_bank_movements" (
            "id","companyId","bankAccountId","movementDate","reference","description",
            "amount","status","reconciledEntryId","importedById","reconciledById",
            "reconciledAt","createdAt","updatedAt"
          ) VALUES (
            ${id}, ${companyId}, ${dto.bankAccountId}, ${new Date(movementDate)}, ${reference}, ${description},
            ${amount}, ${'UNRECONCILED'}, ${null}, ${userId}, ${null}, ${null}, NOW(), NOW()
          )
        `;

        if (dto.autoMatchEntries !== false) {
          const matchedEntry = await this.findAutoMatchEntry(companyId, bankAccount.accountingAccountId, reference, amount);
          if (matchedEntry) {
            await this.reconcileBankMovement(companyId, id, { entryId: matchedEntry.entryId }, userId);
          }
        }

        imported.push({ id, movementDate, reference, amount });
      } catch (error: any) {
        errors.push({ row: index + 1, message: error?.message ?? 'Error no controlado' });
      }
    }

    await this.refreshBankAccountBalance(companyId, dto.bankAccountId);

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
    dto: ReconcileAccountingBankMovementDto,
    userId: string,
  ) {
    const movement = await this.findBankMovementOrThrow(companyId, id);
    if (movement.status === 'RECONCILED') {
      throw new BadRequestException('El movimiento ya está conciliado');
    }

    const bankAccount = await this.findBankAccountOrThrow(companyId, movement.bankAccountId);
    const entry = await this.findEntryBankAmount(companyId, dto.entryId, bankAccount.accountingAccountId);

    if (!entry) {
      throw new NotFoundException('El comprobante no existe o no impacta la cuenta bancaria seleccionada');
    }

    if (Math.abs(this.toNumber(entry.amount) - movement.amount) > 0.01) {
      throw new BadRequestException('El valor del comprobante no coincide con el movimiento del extracto');
    }

    await this.prisma.$executeRaw`
      UPDATE "accounting_bank_movements"
      SET
        "status" = ${'RECONCILED'},
        "reconciledEntryId" = ${dto.entryId},
        "reconciledById" = ${userId},
        "reconciledAt" = NOW(),
        "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'ACCOUNTING_BANK_MOVEMENT_RECONCILED',
        resource: 'accounting',
        resourceId: id,
        after: {
          bankAccountId: bankAccount.id,
          entryId: entry.entryId,
          entryNumber: entry.number,
        } as Prisma.InputJsonObject,
      },
    });

    return this.findBankMovementOrThrow(companyId, id);
  }

  async getPendingBankReconciliation(
    companyId: string,
    filters: { bankAccountId: string; dateTo?: string },
  ) {
    if (!filters.bankAccountId) {
      throw new BadRequestException('Debes seleccionar una cuenta bancaria');
    }

    const bankAccount = await this.findBankAccountOrThrow(companyId, filters.bankAccountId);
    const params: any[] = [companyId, filters.bankAccountId];
    const bankDateClause = filters.dateTo
      ? (() => {
          params.push(new Date(filters.dateTo));
          return ` AND m."movementDate" <= $${params.length}`;
        })()
      : '';

    const bankPending = await this.prisma.$queryRawUnsafe<AccountingBankMovementRow[]>(
      `
        SELECT
          m."id",
          m."companyId",
          m."bankAccountId",
          aba."name" AS "bankAccountName",
          aba."accountNumber",
          m."movementDate",
          m."reference",
          m."description",
          m."amount",
          m."status",
          m."reconciledEntryId",
          je."number" AS "reconciledEntryNumber",
          je."date" AS "reconciledEntryDate",
          m."reconciledAt",
          m."createdAt"
        FROM "accounting_bank_movements" m
        INNER JOIN "accounting_bank_accounts" aba ON aba."id" = m."bankAccountId"
        LEFT JOIN "journal_entries" je ON je."id" = m."reconciledEntryId"
        WHERE m."companyId" = $1
          AND m."bankAccountId" = $2
          AND m."status" <> 'RECONCILED'
          ${bankDateClause}
        ORDER BY m."movementDate" DESC, m."createdAt" DESC
      `,
      ...params,
    );

    const ledgerParams: any[] = [companyId, bankAccount.accountingAccountId];
    const ledgerDateClause = filters.dateTo
      ? (() => {
          ledgerParams.push(new Date(filters.dateTo));
          return ` AND je."date" <= $${ledgerParams.length}`;
        })()
      : '';

    const ledgerPending = await this.prisma.$queryRawUnsafe<PendingBankLedgerRow[]>(
      `
        SELECT
          je."id" AS "entryId",
          je."number",
          je."date",
          je."description",
          je."reference",
          ROUND(COALESCE(SUM(jel."debit" - jel."credit"), 0), 2) AS "amount"
        FROM "journal_entries" je
        INNER JOIN "journal_entry_lines" jel ON jel."entryId" = je."id"
        WHERE je."companyId" = $1
          AND je."deletedAt" IS NULL
          AND je."status" = 'POSTED'
          AND jel."accountId" = $2
          ${ledgerDateClause}
          AND NOT EXISTS (
            SELECT 1
            FROM "accounting_bank_movements" abm
            WHERE abm."companyId" = $1
              AND abm."reconciledEntryId" = je."id"
              AND abm."status" = 'RECONCILED'
          )
        GROUP BY je."id"
        HAVING ABS(COALESCE(SUM(jel."debit" - jel."credit"), 0)) > 0.009
        ORDER BY je."date" DESC, je."number" DESC
      `,
      ...ledgerParams,
    );

    return {
      bankAccount,
      summary: {
        bankPendingCount: bankPending.length,
        bankPendingTotal: bankPending.reduce((sum, row) => sum + this.toNumber(row.amount), 0),
        ledgerPendingCount: ledgerPending.length,
        ledgerPendingTotal: ledgerPending.reduce((sum, row) => sum + this.toNumber(row.amount), 0),
      },
      bankPending: bankPending.map((row) => this.mapBankMovementRow(row)),
      ledgerPending: ledgerPending.map((row) => ({
        entryId: row.entryId,
        number: row.number,
        date: row.date,
        description: row.description,
        reference: row.reference,
        amount: this.toNumber(row.amount),
      })),
    };
  }

  async getTaxConfigs(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingTaxConfigRow[]>(
      `
        SELECT
          atc."id",
          atc."companyId",
          atc."taxCode",
          atc."label",
          atc."rate",
          atc."accountId",
          aa."code" AS "accountCode",
          aa."name" AS "accountName",
          atc."isActive",
          atc."createdAt",
          atc."updatedAt"
        FROM "accounting_tax_configs" atc
        INNER JOIN "accounting_accounts" aa ON aa."id" = atc."accountId"
        WHERE atc."companyId" = $1
        ORDER BY atc."taxCode" ASC
      `,
      companyId,
    );

    return rows.map((row) => this.mapTaxConfigRow(row));
  }

  async upsertTaxConfig(companyId: string, dto: UpsertAccountingTaxConfigDto) {
    const account = await this.prisma.accountingAccount.findFirst({
      where: { id: dto.accountId, companyId, isActive: true },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('La cuenta contable seleccionada no existe o está inactiva');

    const existing = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM "accounting_tax_configs"
        WHERE "companyId" = $1
          AND "taxCode" = $2
        LIMIT 1
      `,
      companyId,
      dto.taxCode.trim().toUpperCase(),
    );

    if (existing.length) {
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "accounting_tax_configs"
          SET
            "label" = $3,
            "rate" = $4,
            "accountId" = $5,
            "isActive" = $6,
            "updatedAt" = $7
          WHERE "companyId" = $1
            AND "taxCode" = $2
        `,
        companyId,
        dto.taxCode.trim().toUpperCase(),
        dto.label.trim(),
        dto.rate ?? null,
        dto.accountId,
        dto.isActive ?? true,
        new Date(),
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "accounting_tax_configs" (
            "id","companyId","taxCode","label","rate","accountId","isActive","createdAt","updatedAt"
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
        `,
        randomUUID(),
        companyId,
        dto.taxCode.trim().toUpperCase(),
        dto.label.trim(),
        dto.rate ?? null,
        dto.accountId,
        dto.isActive ?? true,
        new Date(),
      );
    }

    const rows = await this.getTaxConfigs(companyId);
    const current = rows.find((row) => row.taxCode === dto.taxCode.trim().toUpperCase());
    if (!current) throw new NotFoundException('No fue posible recuperar la configuración fiscal');
    return current;
  }

  async getFiscalSummary(companyId: string, filters: { dateFrom?: string | Date; dateTo?: string | Date }) {
    const range = this.resolveDateRange(filters.dateFrom, filters.dateTo);
    const [salesRows, purchaseRows, withholdingRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ subtotal: Prisma.Decimal | number | string; taxAmount: Prisma.Decimal | number | string; total: Prisma.Decimal | number | string; count: number }>>(
        `
          SELECT
            COALESCE(SUM("subtotal"), 0) AS "subtotal",
            COALESCE(SUM("taxAmount"), 0) AS "taxAmount",
            COALESCE(SUM("total"), 0) AS "total",
            COUNT(*)::int AS "count"
          FROM "invoices"
          WHERE "companyId" = $1
            AND "deletedAt" IS NULL
            AND "type" IN ('VENTA','NOTA_DEBITO')
            AND "issueDate" BETWEEN $2 AND $3
        `,
        companyId,
        range.dateFrom,
        range.dateTo,
      ),
      this.prisma.$queryRawUnsafe<Array<{ subtotal: Prisma.Decimal | number | string; taxAmount: Prisma.Decimal | number | string; total: Prisma.Decimal | number | string; count: number }>>(
        `
          SELECT
            COALESCE(SUM("subtotal"), 0) AS "subtotal",
            COALESCE(SUM("taxAmount"), 0) AS "taxAmount",
            COALESCE(SUM("total"), 0) AS "total",
            COUNT(*)::int AS "count"
          FROM "purchase_invoices"
          WHERE "companyId" = $1
            AND "deletedAt" IS NULL
            AND "issueDate" BETWEEN $2 AND $3
        `,
        companyId,
        range.dateFrom,
        range.dateTo,
      ),
      this.getWithholdingsBook(companyId, range),
    ]);

    return {
      dateFrom: range.dateFrom.toISOString(),
      dateTo: range.dateTo.toISOString(),
      sales: {
        count: Number(salesRows[0]?.count ?? 0),
        taxableBase: this.toNumber(salesRows[0]?.subtotal),
        iva: this.toNumber(salesRows[0]?.taxAmount),
        total: this.toNumber(salesRows[0]?.total),
      },
      purchases: {
        count: Number(purchaseRows[0]?.count ?? 0),
        taxableBase: this.toNumber(purchaseRows[0]?.subtotal),
        iva: this.toNumber(purchaseRows[0]?.taxAmount),
        total: this.toNumber(purchaseRows[0]?.total),
      },
      withholdings: withholdingRows.summary,
    };
  }

  async getVatSalesBook(companyId: string, filters: { dateFrom?: string | Date; dateTo?: string | Date }) {
    const range = this.resolveDateRange(filters.dateFrom, filters.dateTo);
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          i."id",
          i."invoiceNumber",
          i."type",
          i."issueDate",
          c."documentNumber" AS "customerDocumentNumber",
          c."name" AS "customerName",
          i."subtotal",
          i."taxAmount",
          i."total"
        FROM "invoices" i
        INNER JOIN "customers" c ON c."id" = i."customerId"
        WHERE i."companyId" = $1
          AND i."deletedAt" IS NULL
          AND i."type" IN ('VENTA','NOTA_DEBITO','NOTA_CREDITO')
          AND i."issueDate" BETWEEN $2 AND $3
        ORDER BY i."issueDate" DESC, i."invoiceNumber" DESC
      `,
      companyId,
      range.dateFrom,
      range.dateTo,
    );

    const data = rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      type: row.type,
      issueDate: row.issueDate,
      customerDocumentNumber: row.customerDocumentNumber,
      customerName: row.customerName,
      taxableBase: this.toNumber(row.subtotal),
      iva: this.toNumber(row.taxAmount),
      total: this.toNumber(row.total),
    }));

    return {
      dateFrom: range.dateFrom.toISOString(),
      dateTo: range.dateTo.toISOString(),
      totals: {
        taxableBase: data.reduce((sum, row) => sum + row.taxableBase, 0),
        iva: data.reduce((sum, row) => sum + row.iva, 0),
        total: data.reduce((sum, row) => sum + row.total, 0),
      },
      data,
    };
  }

  async getVatPurchasesBook(companyId: string, filters: { dateFrom?: string | Date; dateTo?: string | Date }) {
    const range = this.resolveDateRange(filters.dateFrom, filters.dateTo);
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          pi."id",
          pi."number",
          pi."supplierInvoiceNumber",
          pi."issueDate",
          c."documentNumber" AS "supplierDocumentNumber",
          c."name" AS "supplierName",
          pi."subtotal",
          pi."taxAmount",
          pi."total"
        FROM "purchase_invoices" pi
        INNER JOIN "customers" c ON c."id" = pi."customerId"
        WHERE pi."companyId" = $1
          AND pi."deletedAt" IS NULL
          AND pi."issueDate" BETWEEN $2 AND $3
        ORDER BY pi."issueDate" DESC, pi."number" DESC
      `,
      companyId,
      range.dateFrom,
      range.dateTo,
    );

    const data = rows.map((row) => ({
      id: row.id,
      number: row.number,
      supplierInvoiceNumber: row.supplierInvoiceNumber,
      issueDate: row.issueDate,
      supplierDocumentNumber: row.supplierDocumentNumber,
      supplierName: row.supplierName,
      taxableBase: this.toNumber(row.subtotal),
      iva: this.toNumber(row.taxAmount),
      total: this.toNumber(row.total),
    }));

    return {
      dateFrom: range.dateFrom.toISOString(),
      dateTo: range.dateTo.toISOString(),
      totals: {
        taxableBase: data.reduce((sum, row) => sum + row.taxableBase, 0),
        iva: data.reduce((sum, row) => sum + row.iva, 0),
        total: data.reduce((sum, row) => sum + row.total, 0),
      },
      data,
    };
  }

  async getWithholdingsBook(companyId: string, filters: { dateFrom?: string | Date; dateTo?: string | Date }) {
    const range = this.resolveDateRange(filters.dateFrom, filters.dateTo);
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          atc."taxCode",
          atc."label",
          je."id" AS "entryId",
          je."number",
          je."date",
          je."reference",
          je."description",
          aa."code" AS "accountCode",
          aa."name" AS "accountName",
          ROUND(COALESCE(jel."credit", 0) - COALESCE(jel."debit", 0), 2) AS "amount"
        FROM "accounting_tax_configs" atc
        INNER JOIN "journal_entry_lines" jel ON jel."accountId" = atc."accountId"
        INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
        INNER JOIN "accounting_accounts" aa ON aa."id" = atc."accountId"
        WHERE atc."companyId" = $1
          AND atc."isActive" = true
          AND atc."taxCode" IN ('RETEFUENTE','ICA')
          AND je."companyId" = $1
          AND je."deletedAt" IS NULL
          AND je."status" = 'POSTED'
          AND je."date" BETWEEN $2 AND $3
          AND ABS(COALESCE(jel."credit", 0) - COALESCE(jel."debit", 0)) > 0.009
        ORDER BY je."date" DESC, je."number" DESC
      `,
      companyId,
      range.dateFrom,
      range.dateTo,
    );

    const data = rows.map((row) => ({
      taxCode: row.taxCode,
      label: row.label,
      entryId: row.entryId,
      number: row.number,
      date: row.date,
      reference: row.reference,
      description: row.description,
      accountCode: row.accountCode,
      accountName: row.accountName,
      amount: this.toNumber(row.amount),
    }));

    return {
      dateFrom: range.dateFrom.toISOString(),
      dateTo: range.dateTo.toISOString(),
      summary: {
        retefuente: data.filter((row) => row.taxCode === 'RETEFUENTE').reduce((sum, row) => sum + row.amount, 0),
        ica: data.filter((row) => row.taxCode === 'ICA').reduce((sum, row) => sum + row.amount, 0),
        count: data.length,
      },
      data,
    };
  }

  async getEnterpriseAssetsSummary(companyId: string) {
    const [fixedAssets, deferredCharges, provisionTemplates] = await Promise.all([
      this.findAllFixedAssets(companyId),
      this.findAllDeferredCharges(companyId),
      this.findAllProvisionTemplates(companyId),
    ]);

    return {
      fixedAssets: {
        count: fixedAssets.length,
        cost: fixedAssets.reduce((sum, item) => sum + item.cost, 0),
        accumulatedDepreciation: fixedAssets.reduce((sum, item) => sum + item.accumulatedDepreciation, 0),
        netBookValue: fixedAssets.reduce((sum, item) => sum + item.netBookValue, 0),
      },
      deferredCharges: {
        count: deferredCharges.length,
        amount: deferredCharges.reduce((sum, item) => sum + item.amount, 0),
        amortized: deferredCharges.reduce((sum, item) => sum + item.amortizedAmount, 0),
        pending: deferredCharges.reduce((sum, item) => sum + item.pendingAmount, 0),
      },
      provisions: {
        count: provisionTemplates.length,
        monthlyAmount: provisionTemplates.reduce((sum, item) => sum + item.amount, 0),
        activeCount: provisionTemplates.filter((item) => item.isActive).length,
        dueCount: provisionTemplates.filter((item) => item.isActive && new Date(item.nextRunDate) <= new Date()).length,
      },
    };
  }

  async findAllFixedAssets(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingFixedAssetRow[]>(
      `
        SELECT
          afa."id",
          afa."companyId",
          afa."assetCode",
          afa."name",
          afa."acquisitionDate",
          afa."startDepreciationDate",
          afa."cost",
          afa."salvageValue",
          afa."usefulLifeMonths",
          afa."assetAccountId",
          aa."code" AS "assetAccountCode",
          aa."name" AS "assetAccountName",
          afa."accumulatedDepAccountId",
          ad."code" AS "accumulatedDepAccountCode",
          ad."name" AS "accumulatedDepAccountName",
          afa."depreciationExpenseAccountId",
          ae."code" AS "depreciationExpenseAccountCode",
          ae."name" AS "depreciationExpenseAccountName",
          afa."status",
          afa."notes",
          COALESCE(SUM(afar."amount"), 0) AS "accumulatedAmount",
          afa."createdAt",
          afa."updatedAt"
        FROM "accounting_fixed_assets" afa
        INNER JOIN "accounting_accounts" aa ON aa."id" = afa."assetAccountId"
        INNER JOIN "accounting_accounts" ad ON ad."id" = afa."accumulatedDepAccountId"
        INNER JOIN "accounting_accounts" ae ON ae."id" = afa."depreciationExpenseAccountId"
        LEFT JOIN "accounting_fixed_asset_runs" afar ON afar."assetId" = afa."id"
        WHERE afa."companyId" = $1
        GROUP BY afa."id", aa."id", ad."id", ae."id"
        ORDER BY afa."assetCode" ASC
      `,
      companyId,
    );

    return rows.map((row) => this.mapFixedAssetRow(row));
  }

  async createFixedAsset(companyId: string, dto: CreateAccountingFixedAssetDto) {
    await this.validateAccountsExist(companyId, [
      dto.assetAccountId,
      dto.accumulatedDepAccountId,
      dto.depreciationExpenseAccountId,
    ]);

    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_fixed_assets" (
          "id","companyId","assetCode","name","acquisitionDate","startDepreciationDate",
          "cost","salvageValue","usefulLifeMonths","assetAccountId","accumulatedDepAccountId",
          "depreciationExpenseAccountId","status","notes","createdAt","updatedAt"
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',$13,NOW(),NOW()
        )
      `,
      id,
      companyId,
      dto.assetCode.trim(),
      dto.name.trim(),
      new Date(dto.acquisitionDate),
      new Date(dto.startDepreciationDate),
      Number(dto.cost),
      Number(dto.salvageValue ?? 0),
      Number(dto.usefulLifeMonths),
      dto.assetAccountId,
      dto.accumulatedDepAccountId,
      dto.depreciationExpenseAccountId,
      dto.notes?.trim() || null,
    );

    await this.logJournalAudit(companyId, null, 'ACCOUNTING_FIXED_ASSET_CREATED', id, null, {
      assetCode: dto.assetCode.trim(),
      name: dto.name.trim(),
      cost: Number(dto.cost),
    });

    return (await this.findAllFixedAssets(companyId)).find((item) => item.id === id);
  }

  async depreciateFixedAsset(companyId: string, id: string, dto: DepreciateAccountingFixedAssetDto) {
    const asset = await this.findFixedAssetOrThrow(companyId, id);
    if (asset.status === 'FULLY_DEPRECIATED') {
      throw new BadRequestException('Este activo ya se encuentra totalmente depreciado');
    }

    const runDate = dto.runDate ? new Date(dto.runDate) : new Date();
    await this.ensureDateIsAvailable(companyId, runDate);
    const periodYear = runDate.getFullYear();
    const periodMonth = runDate.getMonth() + 1;
    await this.ensureAssetRunDoesNotExist(companyId, id, 'accounting_fixed_asset_runs', 'assetId', periodYear, periodMonth, 'Ya existe una depreciación registrada para este período');

    const depreciableBase = Math.max(asset.cost - asset.salvageValue, 0);
    const monthlyAmount = this.roundMoney(depreciableBase / Math.max(asset.usefulLifeMonths, 1));
    const remaining = this.roundMoney(depreciableBase - asset.accumulatedDepreciation);
    if (remaining <= 0) {
      throw new BadRequestException('No hay valor pendiente por depreciar');
    }

    const amount = Math.min(monthlyAmount, remaining);
    const entry = await this.createAutoPostedEntry(companyId, {
      date: runDate.toISOString(),
      description: `Depreciación ${asset.assetCode} - ${asset.name}`,
      reference: asset.assetCode,
      sourceType: JournalSourceType.ADJUSTMENT,
      sourceId: `fixed-asset:${asset.id}:${periodYear}-${String(periodMonth).padStart(2, '0')}`,
      lines: [
        { accountId: asset.depreciationExpenseAccount.id, description: `Gasto depreciación ${asset.assetCode}`, debit: amount, credit: 0, position: 1 },
        { accountId: asset.accumulatedDepAccount.id, description: `Depreciación acumulada ${asset.assetCode}`, debit: 0, credit: amount, position: 2 },
      ],
    });

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_fixed_asset_runs" (
          "id","companyId","assetId","periodYear","periodMonth","runDate","amount","entryId","createdAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      randomUUID(),
      companyId,
      id,
      periodYear,
      periodMonth,
      runDate,
      amount,
      entry.id,
    );

    const newAccumulated = this.roundMoney(asset.accumulatedDepreciation + amount);
    const nextStatus = newAccumulated >= depreciableBase - 0.01 ? 'FULLY_DEPRECIATED' : 'ACTIVE';
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_fixed_assets"
        SET "status" = $3,
            "updatedAt" = NOW()
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      nextStatus,
    );

    await this.logJournalAudit(companyId, null, 'ACCOUNTING_FIXED_ASSET_DEPRECIATED', id, null, {
      amount,
      periodYear,
      periodMonth,
      entryId: entry.id,
      entryNumber: entry.number,
    });

    return {
      asset: await this.findFixedAssetOrThrow(companyId, id),
      entry,
      amount,
      periodYear,
      periodMonth,
    };
  }

  async findAllDeferredCharges(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingDeferredChargeRow[]>(
      `
        SELECT
          adc."id",
          adc."companyId",
          adc."chargeCode",
          adc."name",
          adc."startDate",
          adc."amount",
          adc."termMonths",
          adc."assetAccountId",
          aa."code" AS "assetAccountCode",
          aa."name" AS "assetAccountName",
          adc."amortizationExpenseAccountId",
          ae."code" AS "amortizationExpenseAccountCode",
          ae."name" AS "amortizationExpenseAccountName",
          adc."status",
          adc."notes",
          COALESCE(SUM(adcr."amount"), 0) AS "amortizedAmount",
          adc."createdAt",
          adc."updatedAt"
        FROM "accounting_deferred_charges" adc
        INNER JOIN "accounting_accounts" aa ON aa."id" = adc."assetAccountId"
        INNER JOIN "accounting_accounts" ae ON ae."id" = adc."amortizationExpenseAccountId"
        LEFT JOIN "accounting_deferred_charge_runs" adcr ON adcr."deferredChargeId" = adc."id"
        WHERE adc."companyId" = $1
        GROUP BY adc."id", aa."id", ae."id"
        ORDER BY adc."chargeCode" ASC
      `,
      companyId,
    );

    return rows.map((row) => this.mapDeferredChargeRow(row));
  }

  async createDeferredCharge(companyId: string, dto: CreateAccountingDeferredChargeDto) {
    await this.validateAccountsExist(companyId, [dto.assetAccountId, dto.amortizationExpenseAccountId]);
    const id = randomUUID();

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_deferred_charges" (
          "id","companyId","chargeCode","name","startDate","amount","termMonths",
          "assetAccountId","amortizationExpenseAccountId","status","notes","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,NOW(),NOW())
      `,
      id,
      companyId,
      dto.chargeCode.trim(),
      dto.name.trim(),
      new Date(dto.startDate),
      Number(dto.amount),
      Number(dto.termMonths),
      dto.assetAccountId,
      dto.amortizationExpenseAccountId,
      dto.notes?.trim() || null,
    );

    await this.logJournalAudit(companyId, null, 'ACCOUNTING_DEFERRED_CREATED', id, null, {
      chargeCode: dto.chargeCode.trim(),
      amount: Number(dto.amount),
    });

    return (await this.findAllDeferredCharges(companyId)).find((item) => item.id === id);
  }

  async amortizeDeferredCharge(companyId: string, id: string, dto: AmortizeAccountingDeferredChargeDto) {
    const deferred = await this.findDeferredChargeOrThrow(companyId, id);
    if (deferred.status === 'FULLY_AMORTIZED') {
      throw new BadRequestException('Este diferido ya está totalmente amortizado');
    }

    const runDate = dto.runDate ? new Date(dto.runDate) : new Date();
    await this.ensureDateIsAvailable(companyId, runDate);
    const periodYear = runDate.getFullYear();
    const periodMonth = runDate.getMonth() + 1;
    await this.ensureAssetRunDoesNotExist(companyId, id, 'accounting_deferred_charge_runs', 'deferredChargeId', periodYear, periodMonth, 'Ya existe una amortización registrada para este período');

    const monthlyAmount = this.roundMoney(deferred.amount / Math.max(deferred.termMonths, 1));
    const remaining = this.roundMoney(deferred.amount - deferred.amortizedAmount);
    if (remaining <= 0) {
      throw new BadRequestException('No hay valor pendiente por amortizar');
    }

    const amount = Math.min(monthlyAmount, remaining);
    const entry = await this.createAutoPostedEntry(companyId, {
      date: runDate.toISOString(),
      description: `Amortización ${deferred.chargeCode} - ${deferred.name}`,
      reference: deferred.chargeCode,
      sourceType: JournalSourceType.ADJUSTMENT,
      sourceId: `deferred-charge:${deferred.id}:${periodYear}-${String(periodMonth).padStart(2, '0')}`,
      lines: [
        { accountId: deferred.amortizationExpenseAccount.id, description: `Gasto amortización ${deferred.chargeCode}`, debit: amount, credit: 0, position: 1 },
        { accountId: deferred.assetAccount.id, description: `Disminución diferido ${deferred.chargeCode}`, debit: 0, credit: amount, position: 2 },
      ],
    });

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_deferred_charge_runs" (
          "id","companyId","deferredChargeId","periodYear","periodMonth","runDate","amount","entryId","createdAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      randomUUID(),
      companyId,
      id,
      periodYear,
      periodMonth,
      runDate,
      amount,
      entry.id,
    );

    const newAmortized = this.roundMoney(deferred.amortizedAmount + amount);
    const nextStatus = newAmortized >= deferred.amount - 0.01 ? 'FULLY_AMORTIZED' : 'ACTIVE';
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_deferred_charges"
        SET "status" = $3,
            "updatedAt" = NOW()
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      nextStatus,
    );

    await this.logJournalAudit(companyId, null, 'ACCOUNTING_DEFERRED_AMORTIZED', id, null, {
      amount,
      periodYear,
      periodMonth,
      entryId: entry.id,
      entryNumber: entry.number,
    });

    return {
      deferredCharge: await this.findDeferredChargeOrThrow(companyId, id),
      entry,
      amount,
      periodYear,
      periodMonth,
    };
  }

  async findAllProvisionTemplates(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingProvisionTemplateRow[]>(
      `
        SELECT
          apt."id",
          apt."companyId",
          apt."provisionCode",
          apt."name",
          apt."amount",
          apt."frequencyMonths",
          apt."startDate",
          apt."nextRunDate",
          apt."endDate",
          apt."expenseAccountId",
          ae."code" AS "expenseAccountCode",
          ae."name" AS "expenseAccountName",
          apt."liabilityAccountId",
          al."code" AS "liabilityAccountCode",
          al."name" AS "liabilityAccountName",
          apt."isActive",
          apt."notes",
          apr."amount" AS "lastRunAmount",
          apr."runDate" AS "lastRunDate",
          apt."createdAt",
          apt."updatedAt"
        FROM "accounting_provision_templates" apt
        INNER JOIN "accounting_accounts" ae ON ae."id" = apt."expenseAccountId"
        INNER JOIN "accounting_accounts" al ON al."id" = apt."liabilityAccountId"
        LEFT JOIN LATERAL (
          SELECT "amount", "runDate"
          FROM "accounting_provision_runs"
          WHERE "templateId" = apt."id"
          ORDER BY "runDate" DESC, "createdAt" DESC
          LIMIT 1
        ) apr ON TRUE
        WHERE apt."companyId" = $1
        ORDER BY apt."provisionCode" ASC
      `,
      companyId,
    );

    return rows.map((row) => this.mapProvisionTemplateRow(row));
  }

  async createProvisionTemplate(companyId: string, dto: CreateAccountingProvisionTemplateDto) {
    await this.validateAccountsExist(companyId, [dto.expenseAccountId, dto.liabilityAccountId]);
    const id = randomUUID();
    const startDate = new Date(dto.startDate);
    const nextRunDate = dto.nextRunDate ? new Date(dto.nextRunDate) : startDate;

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_provision_templates" (
          "id","companyId","provisionCode","name","amount","frequencyMonths",
          "startDate","nextRunDate","endDate","expenseAccountId","liabilityAccountId",
          "isActive","notes","createdAt","updatedAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
      `,
      id,
      companyId,
      dto.provisionCode.trim(),
      dto.name.trim(),
      Number(dto.amount),
      Number(dto.frequencyMonths ?? 1),
      startDate,
      nextRunDate,
      dto.endDate ? new Date(dto.endDate) : null,
      dto.expenseAccountId,
      dto.liabilityAccountId,
      dto.isActive ?? true,
      dto.notes?.trim() || null,
    );

    await this.logJournalAudit(companyId, null, 'ACCOUNTING_PROVISION_TEMPLATE_CREATED', id, null, {
      provisionCode: dto.provisionCode.trim(),
      amount: Number(dto.amount),
    });

    return (await this.findAllProvisionTemplates(companyId)).find((item) => item.id === id);
  }

  async runProvisionTemplate(companyId: string, id: string, dto: RunAccountingProvisionDto) {
    const template = await this.findProvisionTemplateOrThrow(companyId, id);
    if (!template.isActive) {
      throw new BadRequestException('La plantilla de provisión se encuentra inactiva');
    }

    const runDate = dto.runDate ? new Date(dto.runDate) : new Date();
    await this.ensureDateIsAvailable(companyId, runDate);
    if (new Date(template.nextRunDate) > runDate) {
      throw new BadRequestException('La plantilla aún no está programada para ejecutarse en esta fecha');
    }
    if (template.endDate && new Date(template.endDate) < runDate) {
      throw new BadRequestException('La plantilla de provisión ya superó su fecha final');
    }

    const periodYear = runDate.getFullYear();
    const periodMonth = runDate.getMonth() + 1;
    await this.ensureAssetRunDoesNotExist(companyId, id, 'accounting_provision_runs', 'templateId', periodYear, periodMonth, 'Ya existe una provisión ejecutada para este período');

    const amount = this.roundMoney(template.amount);
    const entry = await this.createAutoPostedEntry(companyId, {
      date: runDate.toISOString(),
      description: `Provisión ${template.provisionCode} - ${template.name}`,
      reference: template.provisionCode,
      sourceType: JournalSourceType.ADJUSTMENT,
      sourceId: `provision:${template.id}:${periodYear}-${String(periodMonth).padStart(2, '0')}`,
      lines: [
        { accountId: template.expenseAccount.id, description: `Gasto provisión ${template.provisionCode}`, debit: amount, credit: 0, position: 1 },
        { accountId: template.liabilityAccount.id, description: `Pasivo provisión ${template.provisionCode}`, debit: 0, credit: amount, position: 2 },
      ],
    });

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_provision_runs" (
          "id","companyId","templateId","periodYear","periodMonth","runDate","amount","entryId","createdAt"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      randomUUID(),
      companyId,
      id,
      periodYear,
      periodMonth,
      runDate,
      amount,
      entry.id,
    );

    const nextRunDate = new Date(runDate);
    nextRunDate.setMonth(nextRunDate.getMonth() + Math.max(template.frequencyMonths, 1));
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_provision_templates"
        SET "nextRunDate" = $3,
            "updatedAt" = NOW()
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      id,
      nextRunDate,
    );

    await this.logJournalAudit(companyId, null, 'ACCOUNTING_PROVISION_RUN_EXECUTED', id, null, {
      amount,
      periodYear,
      periodMonth,
      entryId: entry.id,
      entryNumber: entry.number,
    });

    return {
      template: await this.findProvisionTemplateOrThrow(companyId, id),
      entry,
      amount,
      periodYear,
      periodMonth,
    };
  }

  async getTrialBalance(
    companyId: string,
    filters: {
      dateFrom?: string;
      dateTo?: string;
      level?: number;
      search?: string;
      includeZero?: boolean;
    },
  ) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new BadRequestException('Los filtros dateFrom y dateTo son obligatorios para el balance de prueba');
    }

    const dateFrom = new Date(`${filters.dateFrom}T00:00:00`);
    const dateTo = new Date(`${filters.dateTo}T23:59:59.999`);

    const params: any[] = [companyId, dateFrom, dateTo];
    const accountFilters = [`a."companyId" = $1`];

    if (filters.level !== undefined) {
      params.push(filters.level);
      accountFilters.push(`a."level" = $${params.length}`);
    }

    if (filters.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      accountFilters.push(`(a."code" ILIKE $${params.length} OR a."name" ILIKE $${params.length})`);
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{
      accountId: string;
      code: string;
      name: string;
      level: number;
      nature: 'DEBIT' | 'CREDIT';
      totalDebit: any;
      totalCredit: any;
    }>>(
      `
        SELECT
          a."id" AS "accountId",
          a."code" AS "code",
          a."name" AS "name",
          a."level" AS "level",
          a."nature" AS "nature",
          COALESCE(m."totalDebit", 0) AS "totalDebit",
          COALESCE(m."totalCredit", 0) AS "totalCredit"
        FROM "accounting_accounts" a
        LEFT JOIN (
          SELECT
            jel."accountId" AS "accountId",
            SUM(jel."debit") AS "totalDebit",
            SUM(jel."credit") AS "totalCredit"
          FROM "journal_entry_lines" jel
          INNER JOIN "journal_entries" je
            ON je."id" = jel."entryId"
          WHERE je."companyId" = $1
            AND je."deletedAt" IS NULL
            AND je."status" = 'POSTED'
            AND je."date" >= $2
            AND je."date" <= $3
          GROUP BY jel."accountId"
        ) m ON m."accountId" = a."id"
        WHERE ${accountFilters.join(' AND ')}
        ORDER BY a."code" ASC
      `,
      ...params,
    );

    const data: TrialBalanceRow[] = rows
      .map((row) => {
        const totalDebit = Number(row.totalDebit ?? 0);
        const totalCredit = Number(row.totalCredit ?? 0);

        return {
          accountId: row.accountId,
          code: row.code,
          name: row.name,
          level: Number(row.level),
          nature: row.nature,
          totalDebit,
          totalCredit,
          balance: totalDebit - totalCredit,
        };
      })
      .filter((row) => filters.includeZero || row.totalDebit !== 0 || row.totalCredit !== 0);

    return {
      data,
      totals: {
        debit: data.reduce((sum, row) => sum + row.totalDebit, 0),
        credit: data.reduce((sum, row) => sum + row.totalCredit, 0),
        balance: data.reduce((sum, row) => sum + row.balance, 0),
      },
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    };
  }

  async getGeneralLedger(
    companyId: string,
    filters: {
      dateFrom?: string;
      dateTo?: string;
      level?: number;
      search?: string;
      includeZero?: boolean;
    },
  ) {
    const { dateFrom, dateTo } = this.parseDateRange(filters.dateFrom, filters.dateTo);
    const params: any[] = [companyId, dateFrom, dateTo];
    const accountFilters = [`a."companyId" = $1`];

    if (filters.level !== undefined) {
      params.push(filters.level);
      accountFilters.push(`a."level" = $${params.length}`);
    }

    if (filters.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      accountFilters.push(`(a."code" ILIKE $${params.length} OR a."name" ILIKE $${params.length})`);
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{
      accountId: string;
      code: string;
      name: string;
      level: number;
      nature: 'DEBIT' | 'CREDIT';
      openingDebit: any;
      openingCredit: any;
      periodDebit: any;
      periodCredit: any;
    }>>(
      `
        SELECT
          a."id" AS "accountId",
          a."code" AS "code",
          a."name" AS "name",
          a."level" AS "level",
          a."nature" AS "nature",
          COALESCE(opening."debit", 0) AS "openingDebit",
          COALESCE(opening."credit", 0) AS "openingCredit",
          COALESCE(period."debit", 0) AS "periodDebit",
          COALESCE(period."credit", 0) AS "periodCredit"
        FROM "accounting_accounts" a
        LEFT JOIN (
          SELECT
            jel."accountId" AS "accountId",
            SUM(jel."debit") AS "debit",
            SUM(jel."credit") AS "credit"
          FROM "journal_entry_lines" jel
          INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
          WHERE je."companyId" = $1
            AND je."deletedAt" IS NULL
            AND je."status" = 'POSTED'
            AND je."date" < $2
          GROUP BY jel."accountId"
        ) opening ON opening."accountId" = a."id"
        LEFT JOIN (
          SELECT
            jel."accountId" AS "accountId",
            SUM(jel."debit") AS "debit",
            SUM(jel."credit") AS "credit"
          FROM "journal_entry_lines" jel
          INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
          WHERE je."companyId" = $1
            AND je."deletedAt" IS NULL
            AND je."status" = 'POSTED'
            AND je."date" >= $2
            AND je."date" <= $3
          GROUP BY jel."accountId"
        ) period ON period."accountId" = a."id"
        WHERE ${accountFilters.join(' AND ')}
        ORDER BY a."code" ASC
      `,
      ...params,
    );

    const data = rows
      .map((row): GeneralLedgerRow => {
        const openingDebit = Number(row.openingDebit ?? 0);
        const openingCredit = Number(row.openingCredit ?? 0);
        const periodDebit = Number(row.periodDebit ?? 0);
        const periodCredit = Number(row.periodCredit ?? 0);
        const openingBalance = this.normalizeBalanceByNature(row.nature, openingDebit, openingCredit);
        const endingBalance = this.normalizeBalanceByNature(
          row.nature,
          openingDebit + periodDebit,
          openingCredit + periodCredit,
        );

        return {
          accountId: row.accountId,
          code: row.code,
          name: row.name,
          level: Number(row.level),
          nature: row.nature,
          openingBalance,
          periodDebit,
          periodCredit,
          endingBalance,
        };
      })
      .filter(
        (row) =>
          filters.includeZero ||
          row.openingBalance !== 0 ||
          row.periodDebit !== 0 ||
          row.periodCredit !== 0 ||
          row.endingBalance !== 0,
      );

    return {
      data,
      totals: {
        openingBalance: data.reduce((sum, row) => sum + row.openingBalance, 0),
        periodDebit: data.reduce((sum, row) => sum + row.periodDebit, 0),
        periodCredit: data.reduce((sum, row) => sum + row.periodCredit, 0),
        endingBalance: data.reduce((sum, row) => sum + row.endingBalance, 0),
      },
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    };
  }

  async getAccountAuxiliary(
    companyId: string,
    filters: { accountId?: string; dateFrom?: string; dateTo?: string },
  ) {
    if (!filters.accountId) {
      throw new BadRequestException('El filtro accountId es obligatorio para consultar el auxiliar');
    }

    const { dateFrom, dateTo } = this.parseDateRange(filters.dateFrom, filters.dateTo);
    const account = await this.findOneAccount(companyId, filters.accountId);

    const opening = await this.prisma.$queryRawUnsafe<Array<{ debit: any; credit: any }>>(
      `
        SELECT
          COALESCE(SUM(jel."debit"), 0) AS "debit",
          COALESCE(SUM(jel."credit"), 0) AS "credit"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
        WHERE je."companyId" = $1
          AND je."deletedAt" IS NULL
          AND je."status" = 'POSTED'
          AND jel."accountId" = $2
          AND je."date" < $3
      `,
      companyId,
      filters.accountId,
      dateFrom,
    );

    const openingBalance = this.normalizeBalanceByNature(
      account.nature,
      Number(opening[0]?.debit ?? 0),
      Number(opening[0]?.credit ?? 0),
    );

    const movements = await this.prisma.$queryRawUnsafe<Array<{
      entryId: string;
      number: string;
      date: Date;
      description: string;
      reference: string | null;
      lineDescription: string | null;
      debit: any;
      credit: any;
    }>>(
      `
        SELECT
          je."id" AS "entryId",
          je."number" AS "number",
          je."date" AS "date",
          je."description" AS "description",
          je."reference" AS "reference",
          jel."description" AS "lineDescription",
          jel."debit" AS "debit",
          jel."credit" AS "credit"
        FROM "journal_entry_lines" jel
        INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
        WHERE je."companyId" = $1
          AND je."deletedAt" IS NULL
          AND je."status" = 'POSTED'
          AND jel."accountId" = $2
          AND je."date" >= $3
          AND je."date" <= $4
        ORDER BY je."date" ASC, je."number" ASC, jel."position" ASC
      `,
      companyId,
      filters.accountId,
      dateFrom,
      dateTo,
    );

    let runningBalance = openingBalance;
    const data: AccountAuxiliaryMovement[] = movements.map((movement) => {
      const debit = Number(movement.debit ?? 0);
      const credit = Number(movement.credit ?? 0);
      runningBalance += this.normalizeBalanceByNature(account.nature, debit, credit);

      return {
        entryId: movement.entryId,
        number: movement.number,
        date: movement.date.toISOString(),
        description: movement.description,
        reference: movement.reference,
        lineDescription: movement.lineDescription,
        debit,
        credit,
        runningBalance,
      };
    });

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        level: account.level,
        nature: account.nature,
      },
      openingBalance,
      totals: {
        debit: data.reduce((sum, row) => sum + row.debit, 0),
        credit: data.reduce((sum, row) => sum + row.credit, 0),
        endingBalance: data.length ? data[data.length - 1].runningBalance : openingBalance,
      },
      data,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    };
  }

  async getFinancialStatements(
    companyId: string,
    filters: { dateFrom?: string; dateTo?: string; level?: number },
  ) {
    const { dateFrom, dateTo } = this.parseDateRange(filters.dateFrom, filters.dateTo);
    const balanceParams: any[] = [companyId, dateTo];
    const balanceAccountFilters = [`a."companyId" = $1`];

    if (filters.level !== undefined) {
      balanceParams.push(filters.level);
      balanceAccountFilters.push(`a."level" = $${balanceParams.length}`);
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{
      accountId: string;
      code: string;
      name: string;
      level: number;
      nature: 'DEBIT' | 'CREDIT';
      totalDebit: any;
      totalCredit: any;
    }>>(
      `
        SELECT
          a."id" AS "accountId",
          a."code" AS "code",
          a."name" AS "name",
          a."level" AS "level",
          a."nature" AS "nature",
          COALESCE(m."totalDebit", 0) AS "totalDebit",
          COALESCE(m."totalCredit", 0) AS "totalCredit"
        FROM "accounting_accounts" a
        LEFT JOIN (
          SELECT
            jel."accountId" AS "accountId",
            SUM(jel."debit") AS "totalDebit",
            SUM(jel."credit") AS "totalCredit"
          FROM "journal_entry_lines" jel
          INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
          WHERE je."companyId" = $1
            AND je."deletedAt" IS NULL
            AND je."status" = 'POSTED'
            AND je."date" <= $2
          GROUP BY jel."accountId"
        ) m ON m."accountId" = a."id"
        WHERE ${balanceAccountFilters.join(' AND ')}
        ORDER BY a."code" ASC
      `,
      ...balanceParams,
    );

    const balanceSheetRows = rows
      .map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        level: Number(row.level),
        nature: row.nature,
        amount: this.normalizeBalanceByCode(
          row.code,
          row.nature,
          Number(row.totalDebit ?? 0),
          Number(row.totalCredit ?? 0),
        ),
      }))
      .filter((row) => row.amount !== 0);

    const incomeParams: any[] = [companyId, dateFrom, dateTo];
    const incomeAccountFilters = [`a."companyId" = $1`];
    if (filters.level !== undefined) {
      incomeParams.push(filters.level);
      incomeAccountFilters.push(`a."level" = $${incomeParams.length}`);
    }

    const incomeRows = await this.prisma.$queryRawUnsafe<Array<{
      accountId: string;
      code: string;
      name: string;
      level: number;
      nature: 'DEBIT' | 'CREDIT';
      totalDebit: any;
      totalCredit: any;
    }>>(
      `
        SELECT
          a."id" AS "accountId",
          a."code" AS "code",
          a."name" AS "name",
          a."level" AS "level",
          a."nature" AS "nature",
          COALESCE(m."totalDebit", 0) AS "totalDebit",
          COALESCE(m."totalCredit", 0) AS "totalCredit"
        FROM "accounting_accounts" a
        LEFT JOIN (
          SELECT
            jel."accountId" AS "accountId",
            SUM(jel."debit") AS "totalDebit",
            SUM(jel."credit") AS "totalCredit"
          FROM "journal_entry_lines" jel
          INNER JOIN "journal_entries" je ON je."id" = jel."entryId"
          WHERE je."companyId" = $1
            AND je."deletedAt" IS NULL
            AND je."status" = 'POSTED'
            AND je."date" >= $2
            AND je."date" <= $3
          GROUP BY jel."accountId"
        ) m ON m."accountId" = a."id"
        WHERE ${incomeAccountFilters.join(' AND ')}
        ORDER BY a."code" ASC
      `,
      ...incomeParams,
    );

    const incomeStatementRows = incomeRows
      .map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        level: Number(row.level),
        amount: this.normalizeBalanceByCode(
          row.code,
          row.nature,
          Number(row.totalDebit ?? 0),
          Number(row.totalCredit ?? 0),
        ),
      }))
      .filter((row) => row.amount !== 0);

    const incomeStatement = this.buildIncomeStatement(incomeStatementRows);
    const balanceSheet = this.buildBalanceSheet(balanceSheetRows, incomeStatement.totals.netIncome);

    return {
      balanceSheet,
      incomeStatement,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MÉTODOS PRIVADOS DE SOPORTE
  // ─────────────────────────────────────────────────────────────────────────────

  /** Valida que la suma de débitos sea igual a la suma de créditos (partida doble) */
  private validateDoubleEntry(lines: { debit: number; credit: number }[]) {
    for (const [index, line] of lines.entries()) {
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);

      if (debit < 0 || credit < 0) {
        throw new BadRequestException(`La línea ${index + 1} no puede tener valores negativos`);
      }

      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new BadRequestException(
          `La línea ${index + 1} debe tener valor en débito o crédito, pero no en ambos`,
        );
      }
    }

    const totalDebit  = lines.reduce((acc, l) => acc + Number(l.debit),  0);
    const totalCredit = lines.reduce((acc, l) => acc + Number(l.credit), 0);

    // Comparación con tolerancia de 0.001 para evitar errores de punto flotante
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new BadRequestException(
        `El comprobante no cuadra por partida doble. ` +
        `Débitos: ${totalDebit.toFixed(2)} — Créditos: ${totalCredit.toFixed(2)}`,
      );
    }
  }

  /** Verifica que todas las cuentas existan y pertenezcan a la empresa */
  private async validateAccountsExist(companyId: string, accountIds: string[]) {
    const uniqueIds = [...new Set(accountIds)];
    const found = await this.prisma.accountingAccount.findMany({
      where: { id: { in: uniqueIds }, companyId, isActive: true },
      select: { id: true },
    });

    if (found.length !== uniqueIds.length) {
      const foundIds = found.map((a) => a.id);
      const missing  = uniqueIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(
        `Las siguientes cuentas no existen o están inactivas: ${missing.join(', ')}`,
      );
    }
  }

  private async validateDimensionsExist(
    companyId: string,
    lines: Array<{ branchId?: string | null; customerId?: string | null }>,
  ) {
    const branchIds = [...new Set(lines.map((line) => line.branchId).filter(Boolean))] as string[];
    const customerIds = [...new Set(lines.map((line) => line.customerId).filter(Boolean))] as string[];

    if (branchIds.length > 0) {
      const foundBranches = await this.prisma.branch.findMany({
        where: { id: { in: branchIds }, companyId, deletedAt: null },
        select: { id: true },
      });
      if (foundBranches.length !== branchIds.length) {
        throw new NotFoundException('Una o más sucursales de dimensión no existen en esta empresa');
      }
    }

    if (customerIds.length > 0) {
      const foundCustomers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds }, companyId, deletedAt: null },
        select: { id: true },
      });
      if (foundCustomers.length !== customerIds.length) {
        throw new NotFoundException('Uno o más clientes de dimensión no existen en esta empresa');
      }
    }
  }

  private parseDateRange(dateFrom?: string, dateTo?: string) {
    if (!dateFrom || !dateTo) {
      throw new BadRequestException('Los filtros dateFrom y dateTo son obligatorios');
    }

    return {
      dateFrom: new Date(`${dateFrom}T00:00:00`),
      dateTo: new Date(`${dateTo}T23:59:59.999`),
    };
  }

  private async ensureDateIsAvailable(companyId: string, date: Date) {
    const periods = await this.prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `
        SELECT COUNT(*)::int AS "count"
        FROM "accounting_periods"
        WHERE "companyId" = $1
      `,
      companyId,
    );

    const configuredPeriods = Number(periods[0]?.count ?? 0);
    if (configuredPeriods === 0) {
      return;
    }

    const period = await this.prisma.$queryRawUnsafe<AccountingPeriodRecord[]>(
      `
        SELECT *
        FROM "accounting_periods"
        WHERE "companyId" = $1
          AND "startDate" <= $2
          AND "endDate" >= $2
        ORDER BY "startDate" DESC
        LIMIT 1
      `,
      companyId,
      date,
    );

    if (period.length === 0) {
      throw new BadRequestException('La fecha del comprobante no pertenece a un período contable configurado');
    }

    if (period[0].status === 'CLOSED') {
      throw new BadRequestException(`El período ${period[0].name} se encuentra cerrado`);
    }

    if (period[0].isLocked) {
      throw new BadRequestException(`El período ${period[0].name} está bloqueado para contabilización`);
    }
  }

  private async validateAccountHierarchy(
    companyId: string,
    level: number,
    parentId?: string,
    accountId?: string,
  ) {
    if (level === 1) {
      if (parentId) {
        throw new BadRequestException('Las cuentas de nivel 1 no pueden tener cuenta padre');
      }
      return;
    }

    if (!parentId) {
      throw new BadRequestException(`Las cuentas de nivel ${level} deben tener cuenta padre`);
    }

    if (accountId && parentId === accountId) {
      throw new BadRequestException('Una cuenta no puede ser su propia cuenta padre');
    }

    const parent = await this.prisma.accountingAccount.findFirst({
      where: { id: parentId, companyId },
      select: { id: true, level: true, parentId: true },
    });

    if (!parent) {
      throw new NotFoundException('Cuenta padre no encontrada en esta empresa');
    }

    if (parent.level !== level - 1) {
      throw new BadRequestException(
        `La cuenta padre debe ser de nivel ${level - 1} para una cuenta de nivel ${level}`,
      );
    }

    if (!accountId) return;

    let cursorParentId = parent.parentId;
    while (cursorParentId) {
      if (cursorParentId === accountId) {
        throw new BadRequestException('No se puede asignar una cuenta hija como cuenta padre');
      }

      const ancestor = await this.prisma.accountingAccount.findFirst({
        where: { id: cursorParentId, companyId },
        select: { parentId: true },
      });

      cursorParentId = ancestor?.parentId ?? null;
    }
  }

  /**
   * Genera el número de comprobante en formato AC-{NNNN}.
   * Busca el último comprobante de la empresa y calcula el siguiente número.
   */
  private async generateEntryNumber(companyId: string): Promise<string> {
    const last = await this.prisma.journalEntry.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    let nextNumber = 1;
    if (last?.number) {
      // Extraer la parte numérica: "AC-0042" → 42
      const match = last.number.match(/AC-(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    // Formatear con ceros a la izquierda hasta 4 dígitos
    return `AC-${String(nextNumber).padStart(4, '0')}`;
  }

  private normalizeBalanceByNature(
    nature: 'DEBIT' | 'CREDIT',
    totalDebit: number,
    totalCredit: number,
  ) {
    return nature === 'DEBIT'
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;
  }

  private normalizeBalanceByCode(
    code: string,
    nature: 'DEBIT' | 'CREDIT',
    totalDebit: number,
    totalCredit: number,
  ) {
    const firstDigit = String(code ?? '').trim().charAt(0);

    if (['2', '3', '4'].includes(firstDigit)) {
      return totalCredit - totalDebit;
    }

    if (['1', '5', '6', '7'].includes(firstDigit)) {
      return totalDebit - totalCredit;
    }

    return this.normalizeBalanceByNature(nature, totalDebit, totalCredit);
  }

  private buildBalanceSheet(
    rows: Array<{ accountId: string; code: string; name: string; level: number; amount: number }>,
    netIncome: number,
  ) {
    const assets = this.buildStatementSection(rows, ['1'], 'assets', 'Activos');
    const liabilities = this.buildStatementSection(rows, ['2'], 'liabilities', 'Pasivos');
    const equity = this.buildStatementSection(rows, ['3'], 'equity', 'Patrimonio');
    const equityRows = [...equity.rows];

    if (netIncome !== 0) {
      equityRows.push({
        accountId: 'current-period-net-income',
        code: 'RESULTADO',
        name: 'Resultado del período',
        level: 0,
        amount: netIncome,
      });
    }

    const equityTotal = equityRows.reduce((sum, row) => sum + row.amount, 0);

    return {
      sections: [
        assets,
        liabilities,
        {
          ...equity,
          total: equityTotal,
          rows: equityRows,
        },
      ],
      totals: {
        assets: assets.total,
        liabilities: liabilities.total,
        equity: equityTotal,
        liabilitiesPlusEquity: liabilities.total + equityTotal,
      },
    };
  }

  private buildIncomeStatement(
    rows: Array<{ accountId: string; code: string; name: string; level: number; amount: number }>,
  ) {
    const revenues = this.buildStatementSection(rows, ['4'], 'revenues', 'Ingresos');
    const expenses = this.buildStatementSection(rows, ['5', '6', '7'], 'expenses', 'Gastos y costos');

    return {
      sections: [revenues, expenses],
      totals: {
        revenues: revenues.total,
        expenses: expenses.total,
        netIncome: revenues.total - expenses.total,
      },
    };
  }

  private buildStatementSection(
    rows: Array<{ accountId: string; code: string; name: string; level: number; amount: number }>,
    codePrefixes: string[],
    key: string,
    label: string,
  ): FinancialStatementSection {
    const filteredRows = rows
      .filter((row) => codePrefixes.includes(String(row.code ?? '').charAt(0)))
      .map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        level: row.level,
        amount: row.amount,
      }));

    return {
      key,
      label,
      total: filteredRows.reduce((sum, row) => sum + row.amount, 0),
      rows: filteredRows,
    };
  }

  private async getPeriodOrThrow(companyId: string, id: string) {
    const periods = await this.prisma.$queryRawUnsafe<AccountingPeriodRecord[]>(
      `
        SELECT *
        FROM "accounting_periods"
        WHERE "companyId" = $1
          AND "id" = $2
        LIMIT 1
      `,
      companyId,
      id,
    );

    if (periods.length === 0) {
      throw new NotFoundException('Período contable no encontrado');
    }

    return periods[0];
  }

  private buildPeriodName(year: number, month: number) {
    const monthName = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ][month - 1] ?? `Mes ${month}`;

    return `${monthName} ${year}`;
  }

  private async findOneEntryBase(companyId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        number: true,
        date: true,
        description: true,
        reference: true,
        status: true,
        sourceType: true,
        sourceId: true,
        reversedById: true,
        createdAt: true,
      },
    });

    if (!entry) {
      throw new NotFoundException('Comprobante contable no encontrado');
    }

    return entry;
  }

  private async logJournalAudit(
    companyId: string,
    userId: string | null,
    action: string,
    resourceId: string,
    before?: unknown,
    after?: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action,
        resource: 'accounting',
        resourceId,
        before: before === undefined ? undefined : this.toJsonValue(before),
        after: after === undefined ? undefined : this.toJsonValue(after),
      },
    });
  }

  private async recordIntegration(
    companyId: string,
    payload: {
      module: string;
      resourceType: string;
      resourceId: string;
      sourceId?: string | null;
      entryId?: string | null;
      status: IntegrationStatus;
      message?: string | null;
      context?: Record<string, any>;
    },
  ) {
    const id = randomUUID();
    const createdAt = new Date();
    const entry = payload.entryId
      ? await this.prisma.journalEntry.findFirst({
          where: { id: payload.entryId, companyId },
          select: { id: true, number: true, date: true, description: true, status: true },
        })
      : null;

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounting_integrations" (
          "id", "companyId", "module", "resourceType", "resourceId",
          "sourceId", "entryId", "status", "message", "payload", "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS jsonb), $11)
      `,
      id,
      companyId,
      payload.module,
      payload.resourceType,
      payload.resourceId,
      payload.sourceId ?? null,
      payload.entryId ?? null,
      payload.status,
      payload.message ?? null,
      JSON.stringify({ ...(entry ?? {}), ...(payload.context ?? {}) }),
      createdAt,
    );

    return {
      id,
      ...payload,
      createdAt,
      entry,
    };
  }

  async getInvoiceAccountingProfiles(companyId: string) {
    const rows = await this.prisma.$queryRawUnsafe<InvoiceAccountingProfileRow[]>(
      `
        SELECT
          iap."id",
          iap."companyId",
          iap."profileName",
          iap."invoiceType",
          iap."sourceChannel",
          iap."branchId",
          iap."receivableAccountId",
          ar."code" AS "receivableAccountCode",
          ar."name" AS "receivableAccountName",
          iap."revenueAccountId",
          ai."code" AS "revenueAccountCode",
          ai."name" AS "revenueAccountName",
          iap."taxAccountId",
          at."code" AS "taxAccountCode",
          at."name" AS "taxAccountName",
          iap."withholdingReceivableAccountId",
          aw."code" AS "withholdingReceivableAccountCode",
          aw."name" AS "withholdingReceivableAccountName",
          iap."withholdingRate",
          iap."icaReceivableAccountId",
          aica."code" AS "icaReceivableAccountCode",
          aica."name" AS "icaReceivableAccountName",
          iap."icaRate",
          iap."isActive",
          iap."createdAt",
          iap."updatedAt"
        FROM "invoice_accounting_profiles" iap
        INNER JOIN "accounting_accounts" ar ON ar."id" = iap."receivableAccountId"
        INNER JOIN "accounting_accounts" ai ON ai."id" = iap."revenueAccountId"
        INNER JOIN "accounting_accounts" at ON at."id" = iap."taxAccountId"
        LEFT JOIN "accounting_accounts" aw ON aw."id" = iap."withholdingReceivableAccountId"
        LEFT JOIN "accounting_accounts" aica ON aica."id" = iap."icaReceivableAccountId"
        WHERE iap."companyId" = $1
        ORDER BY iap."invoiceType" ASC, iap."sourceChannel" ASC NULLS FIRST, iap."profileName" ASC
      `,
      companyId,
    );

    return rows.map((row) => ({
      id: row.id,
      profileName: row.profileName,
      invoiceType: row.invoiceType,
      sourceChannel: row.sourceChannel,
      branchId: row.branchId,
      isActive: row.isActive,
      receivableAccount: { id: row.receivableAccountId, code: row.receivableAccountCode, name: row.receivableAccountName },
      revenueAccount: { id: row.revenueAccountId, code: row.revenueAccountCode, name: row.revenueAccountName },
      taxAccount: { id: row.taxAccountId, code: row.taxAccountCode, name: row.taxAccountName },
      withholdingReceivableAccount: row.withholdingReceivableAccountId
        ? { id: row.withholdingReceivableAccountId, code: row.withholdingReceivableAccountCode, name: row.withholdingReceivableAccountName }
        : null,
      withholdingRate: row.withholdingRate !== null ? this.toNumber(row.withholdingRate) : null,
      icaReceivableAccount: row.icaReceivableAccountId
        ? { id: row.icaReceivableAccountId, code: row.icaReceivableAccountCode, name: row.icaReceivableAccountName }
        : null,
      icaRate: row.icaRate !== null ? this.toNumber(row.icaRate) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async upsertInvoiceAccountingProfile(companyId: string, dto: UpsertInvoiceAccountingProfileDto) {
    await this.validateAccountsExist(companyId, [
      dto.receivableAccountId,
      dto.revenueAccountId,
      dto.taxAccountId,
      ...(dto.withholdingReceivableAccountId ? [dto.withholdingReceivableAccountId] : []),
      ...(dto.icaReceivableAccountId ? [dto.icaReceivableAccountId] : []),
    ]);

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('La sucursal indicada no pertenece a la empresa');
    }

    const id = dto.id ?? randomUUID();
    const exists = dto.id
      ? await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "invoice_accounting_profiles" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
          companyId,
          dto.id,
        )
      : [];

    if (exists[0]) {
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "invoice_accounting_profiles"
          SET
            "profileName" = $3,
            "invoiceType" = $4,
            "sourceChannel" = $5,
            "branchId" = $6,
            "receivableAccountId" = $7,
            "revenueAccountId" = $8,
            "taxAccountId" = $9,
            "withholdingReceivableAccountId" = $10,
            "withholdingRate" = $11,
            "icaReceivableAccountId" = $12,
            "icaRate" = $13,
            "isActive" = $14,
            "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        id,
        dto.profileName.trim(),
        dto.invoiceType.trim().toUpperCase(),
        dto.sourceChannel?.trim().toUpperCase() || null,
        dto.branchId ?? null,
        dto.receivableAccountId,
        dto.revenueAccountId,
        dto.taxAccountId,
        dto.withholdingReceivableAccountId ?? null,
        dto.withholdingRate ?? null,
        dto.icaReceivableAccountId ?? null,
        dto.icaRate ?? null,
        dto.isActive ?? true,
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "invoice_accounting_profiles" (
            "id","companyId","profileName","invoiceType","sourceChannel","branchId",
            "receivableAccountId","revenueAccountId","taxAccountId",
            "withholdingReceivableAccountId","withholdingRate",
            "icaReceivableAccountId","icaRate","isActive","createdAt","updatedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
        `,
        id,
        companyId,
        dto.profileName.trim(),
        dto.invoiceType.trim().toUpperCase(),
        dto.sourceChannel?.trim().toUpperCase() || null,
        dto.branchId ?? null,
        dto.receivableAccountId,
        dto.revenueAccountId,
        dto.taxAccountId,
        dto.withholdingReceivableAccountId ?? null,
        dto.withholdingRate ?? null,
        dto.icaReceivableAccountId ?? null,
        dto.icaRate ?? null,
        dto.isActive ?? true,
      );
    }

    return (await this.getInvoiceAccountingProfiles(companyId)).find((item) => item.id === id);
  }

  private async resolveInvoiceAccounts(
    companyId: string,
    params?: { invoiceType?: string | null; sourceChannel?: string | null; branchId?: string | null },
  ) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    const taxConfigs = await this.prisma.accountingTaxConfig.findMany({
      where: { companyId, isActive: true, taxCode: { in: ['IVA_VENTAS', 'IVA_GENERADO', 'RETEFUENTE', 'ICA'] } },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    const profiles = await this.getInvoiceAccountingProfiles(companyId);
    const normalizedType = (params?.invoiceType ?? 'VENTA').trim().toUpperCase();
    const normalizedChannel = params?.sourceChannel?.trim().toUpperCase() ?? null;
    const profile =
      profiles.find((item) => item.isActive && item.invoiceType === normalizedType && item.branchId === params?.branchId && item.sourceChannel === normalizedChannel) ||
      profiles.find((item) => item.isActive && item.invoiceType === normalizedType && !item.branchId && item.sourceChannel === normalizedChannel) ||
      profiles.find((item) => item.isActive && item.invoiceType === normalizedType && item.branchId === params?.branchId && !item.sourceChannel) ||
      profiles.find((item) => item.isActive && item.invoiceType === normalizedType && !item.branchId && !item.sourceChannel) ||
      null;
    const receivable = this.findAccountByPrefixes(accounts, '1305', '130505', '13');
    const revenue = this.findAccountByPrefixes(accounts, '4135', '41', '42');
    const tax = taxConfigs.find((item) => ['IVA_VENTAS', 'IVA_GENERADO'].includes(item.taxCode))?.account
      ?? this.findAccountByPrefixes(accounts, '2408', '24');
    const withholdingReceivable = taxConfigs.find((item) => item.taxCode === 'RETEFUENTE')?.account ?? null;
    const icaReceivable = taxConfigs.find((item) => item.taxCode === 'ICA')?.account ?? null;

    if (!receivable || !revenue || !tax) {
      throw new BadRequestException('No se encontraron cuentas contables base para integrar facturación');
    }
    return {
      profileId: profile?.id ?? null,
      receivable: profile?.receivableAccount ?? receivable,
      revenue: profile?.revenueAccount ?? revenue,
      tax: profile?.taxAccount ?? tax,
      withholdingReceivable: profile?.withholdingReceivableAccount ?? withholdingReceivable,
      withholdingRate: profile?.withholdingRate ?? 0,
      icaReceivable: profile?.icaReceivableAccount ?? icaReceivable,
      icaRate: profile?.icaRate ?? 0,
    };
  }

  private async resolvePayrollAccounts(companyId: string) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    const expense = this.findAccountByPrefixes(accounts, '5105', '51');
    const payable = this.findAccountByPrefixes(accounts, '2505', '25');
    const contributions = this.findAccountByPrefixes(accounts, '2370', '2380', '23', '24');

    if (!expense || !payable || !contributions) {
      throw new BadRequestException('No se encontraron cuentas contables base para integrar nómina');
    }
    return { expense, payable, contributions };
  }

  private async resolveInventoryAccounts(companyId: string) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    const inventory = this.findAccountByPrefixes(accounts, '1435', '14');
    const adjustment = this.findAccountByPrefixes(accounts, '6135', '61', '5199', '51');

    if (!inventory || !adjustment) {
      throw new BadRequestException('No se encontraron cuentas contables base para integrar inventario');
    }
    return { inventory, adjustment };
  }

  private async resolvePosAccounts(companyId: string) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true },
    });
    const cash = this.findAccountByPrefixes(accounts, '1105', '110505', '11');
    const bank = this.findAccountByPrefixes(accounts, '1110', '111005', '1120', '11');
    const revenue = this.findAccountByPrefixes(accounts, '4135', '41', '42');
    const tax = this.findAccountByPrefixes(accounts, '2408', '24');
    const inventory = this.findAccountByPrefixes(accounts, '1435', '14');
    const cost = this.findAccountByPrefixes(accounts, '6135', '61', '51');
    const adjustment = this.findAccountByPrefixes(accounts, '5199', '5295', '6135', '61', '51');
    const agreement = this.findAccountByPrefixes(accounts, '1305', '1330', '13');
    const voucher = this.findAccountByPrefixes(accounts, '2805', '2380', '28', '23');
    const giftCard = this.findAccountByPrefixes(accounts, '2810', '2385', '28', '23');
    const wallet = this.findAccountByPrefixes(accounts, '1110', '111005', '1120', '11') ?? bank;
    const dataphone = this.findAccountByPrefixes(accounts, '1110', '111005', '1120', '11') ?? bank;

    if (!cash || !bank || !revenue || !tax || !inventory || !cost || !adjustment) {
      throw new BadRequestException('No se encontraron cuentas contables base para integrar el POS');
    }
    return {
      cash,
      bank,
      wallet,
      dataphone,
      agreement: agreement ?? adjustment,
      voucher: voucher ?? adjustment,
      giftCard: giftCard ?? adjustment,
      revenue,
      tax,
      inventory,
      cost,
      adjustment,
    };
  }

  private resolvePosPaymentAccount(
    posAccounts: Awaited<ReturnType<AccountingService['resolvePosAccounts']>>,
    paymentMethod: string,
  ) {
    switch (String(paymentMethod)) {
      case 'CASH':
        return posAccounts.cash;
      case 'DATAPHONE':
        return posAccounts.dataphone;
      case 'WALLET':
        return posAccounts.wallet;
      case 'VOUCHER':
        return posAccounts.voucher;
      case 'GIFT_CARD':
        return posAccounts.giftCard;
      case 'AGREEMENT':
        return posAccounts.agreement;
      default:
        return posAccounts.bank;
    }
  }

  private findAccountByPrefixes<T extends { code: string }>(accounts: T[], ...prefixes: string[]) {
    return (
      accounts.find((account) => prefixes.some((prefix) => String(account.code ?? '').startsWith(prefix))) ??
      null
    );
  }

  private mapBankAccountRow(row: AccountingBankAccountRow) {
    return {
      id: row.id,
      bankCode: row.bankCode,
      accountingAccountId: row.accountingAccountId,
      name: row.name,
      accountNumber: row.accountNumber,
      currency: row.currency,
      openingBalance: this.toNumber(row.openingBalance),
      currentBalance: this.toNumber(row.currentBalance),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      bank: row.bankCode
        ? {
            code: row.bankCode,
            name: row.bankName,
          }
        : null,
      accountingAccount: {
        id: row.accountingAccountId,
        code: row.accountingAccountCode,
        name: row.accountingAccountName,
      },
    };
  }

  private mapTaxConfigRow(row: AccountingTaxConfigRow) {
    return {
      id: row.id,
      taxCode: row.taxCode,
      label: row.label,
      rate: row.rate !== null ? this.toNumber(row.rate) : null,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      account: {
        id: row.accountId,
        code: row.accountCode,
        name: row.accountName,
      },
    };
  }

  private mapBankMovementRow(row: AccountingBankMovementRow) {
    return {
      id: row.id,
      bankAccountId: row.bankAccountId,
      bankAccountName: row.bankAccountName,
      accountNumber: row.accountNumber,
      movementDate: row.movementDate,
      reference: row.reference,
      description: row.description,
      amount: this.toNumber(row.amount),
      status: row.status,
      reconciledEntryId: row.reconciledEntryId,
      reconciledEntryNumber: row.reconciledEntryNumber,
      reconciledEntryDate: row.reconciledEntryDate,
      reconciledAt: row.reconciledAt,
      createdAt: row.createdAt,
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

  private resolveDateRange(dateFrom?: string | Date, dateTo?: string | Date) {
    const end = dateTo ? new Date(dateTo) : new Date();
    const start = dateFrom ? new Date(dateFrom) : new Date(end.getFullYear(), end.getMonth(), 1);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('El rango de fechas fiscal no es válido');
    }

    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: start, dateTo: end };
  }

  private async refreshBankAccountBalance(companyId: string, bankAccountId: string) {
    const summary = await this.prisma.$queryRawUnsafe<Array<{ openingBalance: Prisma.Decimal | number | string; movementTotal: Prisma.Decimal | number | string }>>(
      `
        SELECT
          aba."openingBalance",
          COALESCE(SUM(abm."amount"), 0) AS "movementTotal"
        FROM "accounting_bank_accounts" aba
        LEFT JOIN "accounting_bank_movements" abm
          ON abm."bankAccountId" = aba."id"
         AND abm."companyId" = aba."companyId"
        WHERE aba."companyId" = $1
          AND aba."id" = $2
        GROUP BY aba."id"
      `,
      companyId,
      bankAccountId,
    );

    const row = summary[0];
    if (!row) return;

    const currentBalance = this.toNumber(row.openingBalance) + this.toNumber(row.movementTotal);
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounting_bank_accounts"
        SET "currentBalance" = $3,
            "updatedAt" = $4
        WHERE "companyId" = $1
          AND "id" = $2
      `,
      companyId,
      bankAccountId,
      currentBalance,
      new Date(),
    );
  }

  private async findAutoMatchEntry(
    companyId: string,
    accountId: string,
    reference: string | null,
    amount: number,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<PendingBankLedgerRow[]>(
      `
        SELECT
          je."id" AS "entryId",
          je."number",
          je."date",
          je."description",
          je."reference",
          ROUND(COALESCE(SUM(jel."debit" - jel."credit"), 0), 2) AS "amount"
        FROM "journal_entries" je
        INNER JOIN "journal_entry_lines" jel ON jel."entryId" = je."id"
        WHERE je."companyId" = $1
          AND je."deletedAt" IS NULL
          AND je."status" = 'POSTED'
          AND jel."accountId" = $2
          AND ($3::text IS NULL OR COALESCE(je."reference", '') = $3 OR COALESCE(je."number", '') = $3)
          AND NOT EXISTS (
            SELECT 1
            FROM "accounting_bank_movements" abm
            WHERE abm."companyId" = $1
              AND abm."reconciledEntryId" = je."id"
              AND abm."status" = 'RECONCILED'
          )
        GROUP BY je."id"
        HAVING ABS(ROUND(COALESCE(SUM(jel."debit" - jel."credit"), 0), 2) - $4) <= 0.01
        ORDER BY je."date" DESC, je."number" DESC
        LIMIT 1
      `,
      companyId,
      accountId,
      reference,
      amount,
    );

    return rows[0] ?? null;
  }

  private async findEntryBankAmount(companyId: string, entryId: string, accountId: string) {
    const rows = await this.prisma.$queryRawUnsafe<PendingBankLedgerRow[]>(
      `
        SELECT
          je."id" AS "entryId",
          je."number",
          je."date",
          je."description",
          je."reference",
          ROUND(COALESCE(SUM(jel."debit" - jel."credit"), 0), 2) AS "amount"
        FROM "journal_entries" je
        INNER JOIN "journal_entry_lines" jel ON jel."entryId" = je."id"
        WHERE je."companyId" = $1
          AND je."id" = $2
          AND je."deletedAt" IS NULL
          AND je."status" = 'POSTED'
          AND jel."accountId" = $3
        GROUP BY je."id"
        LIMIT 1
      `,
      companyId,
      entryId,
      accountId,
    );

    return rows[0] ?? null;
  }

  private async findBankAccountOrThrow(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingBankAccountRow[]>(
      `
        SELECT
          aba."id",
          aba."companyId",
          aba."bankCode",
          b."name" AS "bankName",
          aba."accountingAccountId",
          aa."code" AS "accountingAccountCode",
          aa."name" AS "accountingAccountName",
          aba."name",
          aba."accountNumber",
          aba."currency",
          aba."openingBalance",
          aba."currentBalance",
          aba."isActive",
          aba."createdAt",
          aba."updatedAt"
        FROM "accounting_bank_accounts" aba
        INNER JOIN "accounting_accounts" aa ON aa."id" = aba."accountingAccountId"
        LEFT JOIN "banks" b ON b."code" = aba."bankCode"
        WHERE aba."companyId" = $1
          AND aba."id" = $2
        LIMIT 1
      `,
      companyId,
      id,
    );

    const row = rows[0];
    if (!row) throw new NotFoundException('Cuenta bancaria no encontrada');
    return this.mapBankAccountRow(row) as any;
  }

  private async findBankMovementOrThrow(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<AccountingBankMovementRow[]>(
      `
        SELECT
          m."id",
          m."companyId",
          m."bankAccountId",
          aba."name" AS "bankAccountName",
          aba."accountNumber",
          m."movementDate",
          m."reference",
          m."description",
          m."amount",
          m."status",
          m."reconciledEntryId",
          je."number" AS "reconciledEntryNumber",
          je."date" AS "reconciledEntryDate",
          m."reconciledAt",
          m."createdAt"
        FROM "accounting_bank_movements" m
        INNER JOIN "accounting_bank_accounts" aba ON aba."id" = m."bankAccountId"
        LEFT JOIN "journal_entries" je ON je."id" = m."reconciledEntryId"
        WHERE m."companyId" = $1
          AND m."id" = $2
        LIMIT 1
      `,
      companyId,
      id,
    );

    const row = rows[0];
    if (!row) throw new NotFoundException('Movimiento bancario no encontrado');
    return this.mapBankMovementRow(row) as any;
  }

  private mapFixedAssetRow(row: AccountingFixedAssetRow) {
    const cost = this.toNumber(row.cost);
    const salvageValue = this.toNumber(row.salvageValue);
    const accumulatedDepreciation = this.toNumber(row.accumulatedAmount);
    const depreciableBase = Math.max(cost - salvageValue, 0);
    return {
      id: row.id,
      assetCode: row.assetCode,
      name: row.name,
      acquisitionDate: row.acquisitionDate,
      startDepreciationDate: row.startDepreciationDate,
      cost,
      salvageValue,
      usefulLifeMonths: row.usefulLifeMonths,
      status: row.status,
      notes: row.notes,
      accumulatedDepreciation,
      netBookValue: this.roundMoney(Math.max(cost - accumulatedDepreciation, salvageValue)),
      pendingDepreciation: this.roundMoney(Math.max(depreciableBase - accumulatedDepreciation, 0)),
      assetAccount: { id: row.assetAccountId, code: row.assetAccountCode, name: row.assetAccountName },
      accumulatedDepAccount: { id: row.accumulatedDepAccountId, code: row.accumulatedDepAccountCode, name: row.accumulatedDepAccountName },
      depreciationExpenseAccount: { id: row.depreciationExpenseAccountId, code: row.depreciationExpenseAccountCode, name: row.depreciationExpenseAccountName },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDeferredChargeRow(row: AccountingDeferredChargeRow) {
    const amount = this.toNumber(row.amount);
    const amortizedAmount = this.toNumber(row.amortizedAmount);
    return {
      id: row.id,
      chargeCode: row.chargeCode,
      name: row.name,
      startDate: row.startDate,
      amount,
      amortizedAmount,
      pendingAmount: this.roundMoney(Math.max(amount - amortizedAmount, 0)),
      termMonths: row.termMonths,
      status: row.status,
      notes: row.notes,
      assetAccount: { id: row.assetAccountId, code: row.assetAccountCode, name: row.assetAccountName },
      amortizationExpenseAccount: {
        id: row.amortizationExpenseAccountId,
        code: row.amortizationExpenseAccountCode,
        name: row.amortizationExpenseAccountName,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapProvisionTemplateRow(row: AccountingProvisionTemplateRow) {
    return {
      id: row.id,
      provisionCode: row.provisionCode,
      name: row.name,
      amount: this.toNumber(row.amount),
      frequencyMonths: row.frequencyMonths,
      startDate: row.startDate,
      nextRunDate: row.nextRunDate,
      endDate: row.endDate,
      isActive: row.isActive,
      notes: row.notes,
      lastRunAmount: this.toNumber(row.lastRunAmount),
      lastRunDate: row.lastRunDate,
      expenseAccount: { id: row.expenseAccountId, code: row.expenseAccountCode, name: row.expenseAccountName },
      liabilityAccount: { id: row.liabilityAccountId, code: row.liabilityAccountCode, name: row.liabilityAccountName },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async findFixedAssetOrThrow(companyId: string, id: string) {
    const item = (await this.findAllFixedAssets(companyId)).find((row) => row.id === id);
    if (!item) throw new NotFoundException('Activo fijo no encontrado');
    return item;
  }

  private async findDeferredChargeOrThrow(companyId: string, id: string) {
    const item = (await this.findAllDeferredCharges(companyId)).find((row) => row.id === id);
    if (!item) throw new NotFoundException('Diferido no encontrado');
    return item;
  }

  private async findProvisionTemplateOrThrow(companyId: string, id: string) {
    const item = (await this.findAllProvisionTemplates(companyId)).find((row) => row.id === id);
    if (!item) throw new NotFoundException('Plantilla de provisión no encontrada');
    return item;
  }

  private async ensureAssetRunDoesNotExist(
    companyId: string,
    targetId: string,
    tableName: 'accounting_fixed_asset_runs' | 'accounting_deferred_charge_runs' | 'accounting_provision_runs',
    foreignKey: 'assetId' | 'deferredChargeId' | 'templateId',
    periodYear: number,
    periodMonth: number,
    message: string,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM "${tableName}"
        WHERE "companyId" = $1
          AND "${foreignKey}" = $2
          AND "periodYear" = $3
          AND "periodMonth" = $4
        LIMIT 1
      `,
      companyId,
      targetId,
      periodYear,
      periodMonth,
    );

    if (rows[0]) {
      throw new BadRequestException(message);
    }
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    return Number(value ?? 0);
  }

  private toJsonValue(value: unknown) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }
}
