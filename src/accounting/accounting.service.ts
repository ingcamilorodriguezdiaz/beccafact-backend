import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JournalEntryStatus, JournalSourceType } from '@prisma/client';
import { PrismaService } from '../config/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';

@Injectable()
export class AccountingService {
  constructor(private prisma: PrismaService) {}

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

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
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

    // Verificar que la cuenta padre existe y pertenece a la misma empresa
    if (dto.parentId) {
      const parent = await this.prisma.accountingAccount.findFirst({
        where: { id: dto.parentId, companyId },
      });
      if (!parent) throw new NotFoundException('Cuenta padre no encontrada en esta empresa');
    }

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
    await this.findOneAccount(companyId, id);

    // Si se cambia el código, verificar que no exista otro con ese código
    if (dto.code) {
      const conflict = await this.prisma.accountingAccount.findFirst({
        where: { companyId, code: dto.code, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`Ya existe otra cuenta con el código PUC '${dto.code}'`);
      }
    }

    // Verificar cuenta padre si se proporciona
    if (dto.parentId) {
      const parent = await this.prisma.accountingAccount.findFirst({
        where: { id: dto.parentId, companyId },
      });
      if (!parent) throw new NotFoundException('Cuenta padre no encontrada en esta empresa');
    }

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
    return entry;
  }

  async createEntry(companyId: string, dto: CreateJournalEntryDto) {
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
    });
  }

  async updateEntry(companyId: string, id: string, dto: UpdateJournalEntryDto) {
    const entry = await this.findOneEntry(companyId, id);

    // Solo comprobantes en estado DRAFT pueden modificarse
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        'Solo se pueden modificar comprobantes en estado DRAFT',
      );
    }

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
      });
    });
  }

  /** Contabiliza un comprobante: cambia estado DRAFT → POSTED */
  async postEntry(companyId: string, id: string) {
    const entry = await this.findOneEntry(companyId, id);

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

  // ─────────────────────────────────────────────────────────────────────────────
  // MÉTODOS PRIVADOS DE SOPORTE
  // ─────────────────────────────────────────────────────────────────────────────

  /** Valida que la suma de débitos sea igual a la suma de créditos (partida doble) */
  private validateDoubleEntry(lines: { debit: number; credit: number }[]) {
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
}
