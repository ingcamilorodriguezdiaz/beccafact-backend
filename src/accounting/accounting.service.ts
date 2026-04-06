import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JournalEntryStatus, JournalSourceType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../config/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';

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
        lines: {
          orderBy: { position: 'asc' },
          include: {
            account: { select: { id: true, code: true, name: true, nature: true } },
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('Comprobante contable no encontrado');
    return this.mapEntryTotals(entry);
  }

  async createEntry(companyId: string, dto: CreateJournalEntryDto) {
    await this.ensureDateIsAvailable(companyId, new Date(dto.date));

    // Validar partida doble: suma débitos === suma créditos
    this.validateDoubleEntry(dto.lines);

    // Verificar que todas las cuentas existen y pertenecen a la empresa
    await this.validateAccountsExist(companyId, dto.lines.map((l) => l.accountId));

    // Generar número de comprobante autoincremental por empresa (AC-0001)
    const number = await this.generateEntryNumber(companyId);

    return this.prisma.journalEntry.create({
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
          },
        },
      },
    }).then((entry) => this.mapEntryTotals(entry));
  }

  async updateEntry(companyId: string, id: string, dto: UpdateJournalEntryDto) {
    const entry = await this.findOneEntry(companyId, id);

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
    }

    return this.prisma.$transaction(async (tx) => {
      // Eliminar líneas existentes y recrear si se incluyen en el DTO
      if (dto.lines && dto.lines.length > 0) {
        await tx.journalEntryLine.deleteMany({ where: { entryId: id } });
      }

      return tx.journalEntry.update({
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
            },
          },
        },
      }).then((updated) => this.mapEntryTotals(updated));
    });
  }

  /** Contabiliza un comprobante: cambia estado DRAFT → POSTED */
  async postEntry(companyId: string, id: string) {
    const entry = await this.findOneEntry(companyId, id);

    await this.ensureDateIsAvailable(companyId, new Date(entry.date));

    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        `El comprobante no puede contabilizarse porque está en estado '${entry.status}'`,
      );
    }

    return this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalEntryStatus.POSTED },
    });
  }

  /** Anula un comprobante: cambia estado POSTED → CANCELLED (solo ADMIN) */
  async cancelEntry(companyId: string, id: string) {
    const entry = await this.findOneEntry(companyId, id);

    if (entry.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestException(
        `El comprobante no puede anularse porque está en estado '${entry.status}'`,
      );
    }

    return this.prisma.journalEntry.update({
      where: { id },
      data: { status: JournalEntryStatus.CANCELLED },
    });
  }

  /** Elimina un comprobante (soft-delete). Solo si está en estado DRAFT */
  async removeEntry(companyId: string, id: string) {
    const entry = await this.findOneEntry(companyId, id);

    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        'Solo se pueden eliminar comprobantes en estado DRAFT',
      );
    }

    return this.prisma.journalEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
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
}
