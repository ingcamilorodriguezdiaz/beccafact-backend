import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService) {}

  // ─── ROLES ───────────────────────────────────────────────────────────────────

  /** Listar roles disponibles (excluye SUPER_ADMIN) */
  async getRoles() {
    return this.prisma.role.findMany({
      where: { name: { not: 'SUPER_ADMIN' } },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        permissions: { select: { id: true, action: true, resource: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ─── COMPANIES ───────────────────────────────────────────────────────────────

  async getCompanies(filters: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, page = 1, limit = 20 } = filters;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        include: {
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'TRIAL'] } },
            include: { plan: { select: { id: true, name: true, displayName: true, price: true } } },
            take: 1,
            orderBy: { startDate: 'desc' },
          },
          _count: { select: { users: true, invoices: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      this.prisma.company.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) };
  }

  async getCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id, deletedAt: null },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL'] } },
          include: { plan: true },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
        _count: { select: { users: true, invoices: true } },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  /** Crear empresa + suscripción inicial */
  async createCompany(data: any) {
    const { planId, ...companyData } = data;

    if (!companyData.name || !companyData.email) {
      throw new BadRequestException('Nombre y email son obligatorios');
    }
    if (!planId) {
      throw new BadRequestException('Plan inicial es obligatorio');
    }

    const existing = await this.prisma.company.findFirst({
      where: { OR: [{ nit: companyData.nit }, { email: companyData.email }], deletedAt: null },
    });
    if (existing) throw new ConflictException('Ya existe una empresa con ese NIT o email');

    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { ...companyData, status: 'ACTIVE' },
      });

      await tx.subscription.create({
        data: {
          companyId: company.id,
          planId,
          status: 'ACTIVE',
          startDate: new Date(),
        },
      });

      return tx.company.findUnique({
        where: { id: company.id },
        include: {
          subscriptions: {
            include: { plan: true },
            take: 1,
            orderBy: { startDate: 'desc' },
          },
          _count: { select: { users: true, invoices: true } },
        },
      });
    });
  }

  /** Actualizar datos básicos de una empresa (NIT no se actualiza) */
  async updateCompany(id: string, data: any) {
    await this.getCompany(id);
    // NIT es inmutable
    const { nit, planId, ...updateData } = data;
    return this.prisma.company.update({
      where: { id },
      data: updateData,
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL'] } },
          include: { plan: true },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
        _count: { select: { users: true, invoices: true } },
      },
    });
  }

  async suspendCompany(id: string, reason?: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    await Promise.all([
      this.prisma.company.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      this.prisma.subscription.updateMany({
        where: { companyId: id, status: { in: ['ACTIVE', 'TRIAL'] } },
        data: { status: 'SUSPENDED' },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        companyId: id,
        action: 'SUSPEND',
        resource: 'company',
        resourceId: id,
        after: { reason },
      },
    });

    return { message: 'Empresa suspendida correctamente' };
  }

  async activateCompany(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    await Promise.all([
      this.prisma.company.update({ where: { id }, data: { status: 'ACTIVE' } }),
      this.prisma.subscription.updateMany({
        where: { companyId: id, status: 'SUSPENDED' },
        data: { status: 'ACTIVE' },
      }),
    ]);

    return { message: 'Empresa reactivada correctamente' };
  }

  async changePlan(companyId: string, planId: string, customLimits?: Record<string, string>) {
    const [company, plan] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId } }),
      this.prisma.plan.findUnique({ where: { id: planId } }),
    ]);

    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (!plan) throw new NotFoundException('Plan no encontrado');

    await this.prisma.subscription.updateMany({
      where: { companyId, status: { in: ['ACTIVE', 'TRIAL'] } },
      data: { status: 'CANCELLED' },
    });

    return this.prisma.subscription.create({
      data: {
        companyId,
        planId,
        status: 'ACTIVE',
        startDate: new Date(),
        customLimits: customLimits ?? undefined,
      },
      include: { plan: true },
    });
  }

  // ─── USERS PER COMPANY ───────────────────────────────────────────────────────

  async getCompanyUsers(companyId: string) {
    await this.getCompany(companyId);
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null, isSuperAdmin: false },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        roles: {
          include: {
            role: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Crear un usuario nuevo e invitarlo a la empresa con un rol */
  async createCompanyUser(companyId: string, data: any) {
    await this.getCompany(companyId);

    const { firstName, lastName, email, password, roleId } = data;

    if (!firstName || !email || !password) {
      throw new BadRequestException('Nombre, email y contraseña son obligatorios');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Ya existe un usuario con ese email');

    if (roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role) throw new NotFoundException('Rol no encontrado');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName: lastName ?? '',
          phone: data.phone,
          companyId,
          isActive: true,
        },
      });

      if (roleId) {
        await tx.userRole.create({ data: { userId: user.id, roleId } });
      }

      return tx.user.findUnique({
        where: { id: user.id },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          isActive: true, createdAt: true,
          roles: { include: { role: { select: { id: true, name: true, displayName: true } } } },
        },
      });
    });
  }

  /** Actualizar nombre, apellido, rol de un usuario de una empresa */
  async updateCompanyUser(companyId: string, userId: string, data: any) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado en esta empresa');

    const { roleId, firstName, lastName, phone } = data;

    return this.prisma.$transaction(async (tx) => {
      // Actualizar datos básicos
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(phone !== undefined && { phone }),
        },
      });

      // Actualizar rol si se envió
      if (roleId !== undefined) {
        await tx.userRole.deleteMany({ where: { userId } });
        if (roleId) {
          const role = await tx.role.findUnique({ where: { id: roleId } });
          if (!role) throw new NotFoundException('Rol no encontrado');
          await tx.userRole.create({ data: { userId, roleId } });
        }
      }

      return tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          isActive: true, createdAt: true,
          roles: { include: { role: { select: { id: true, name: true, displayName: true } } } },
        },
      });
    });
  }

  /** Alternar estado activo/inactivo de un usuario de una empresa */
  async toggleCompanyUserActive(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado en esta empresa');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
      select: { id: true, isActive: true, firstName: true, lastName: true },
    });

    return {
      message: updated.isActive ? 'Usuario activado correctamente' : 'Usuario desactivado correctamente',
      user: updated,
    };
  }

  // ─── PLANS ───────────────────────────────────────────────────────────────────

  async getPlans() {
    return this.prisma.plan.findMany({
      include: { features: true, _count: { select: { subscriptions: true } } },
      orderBy: { price: 'asc' },
    });
  }

  async createPlan(data: any) {
    const { features, ...planData } = data;
    return this.prisma.plan.create({
      data: {
        ...planData,
        features: features ? { create: features } : undefined,
      },
      include: { features: true },
    });
  }

  async updatePlan(id: string, data: any) {
    const { features, ...planData } = data;
    return this.prisma.$transaction(async (tx) => {
      if (features) {
        await tx.planFeature.deleteMany({ where: { planId: id } });
        await tx.planFeature.createMany({
          data: features.map((f: any) => ({ ...f, planId: id })),
        });
      }
      return tx.plan.update({ where: { id }, data: planData, include: { features: true } });
    });
  }

  // ─── METRICS ─────────────────────────────────────────────────────────────────

  async getGlobalMetrics() {
    const [
      totalCompanies,
      activeCompanies,
      suspendedCompanies,
      totalUsers,
      totalInvoices,
      totalProducts,
      recentInvoices,
    ] = await Promise.all([
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.company.count({ where: { status: 'ACTIVE' } }),
      this.prisma.company.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.user.count({ where: { deletedAt: null, isSuperAdmin: false } }),
      this.prisma.invoice.count({ where: { deletedAt: null } }),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.invoice.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { company: { select: { name: true } } },
      }),
    ]);

    return {
      companies: { total: totalCompanies, active: activeCompanies, suspended: suspendedCompanies },
      users: { total: totalUsers },
      invoices: { total: totalInvoices },
      products: { total: totalProducts },
      recentInvoices,
    };
  }

  async getAuditLogs(filters: {
    companyId?: string;
    resource?: string;
    page?: number;
    limit?: number;
  }) {
    const { companyId, resource, page = 1, limit = 50 } = filters;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (resource) where.resource = resource;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          company: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  // ─── GLOBAL USERS ────────────────────────────────────────────────────────────

  async getGlobalUsers(filters: {
    search?: string;
    companyId?: string;
    isActive?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, companyId, isActive, page = 1, limit = 20 } = filters;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
      ];
    }
    if (companyId) where.companyId = companyId;
    if (isActive !== undefined && isActive !== '') where.isActive = isActive === 'true';

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true, firstName: true, lastName: true, email: true,
          isActive: true, isSuperAdmin: true, createdAt: true,
          company: { select: { id: true, name: true, nit: true } },
          roles: { select: { role: { select: { name: true, displayName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async toggleGlobalUserActive(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isSuperAdmin) throw new BadRequestException('No se puede desactivar un Super Admin');
    return this.prisma.user.update({
      where: { id: userId },
      data:  { isActive: !user.isActive },
      select: { id: true, isActive: true, firstName: true, lastName: true, email: true },
    });
  }

  // ─── BANKS ───────────────────────────────────────────────────────────────────

  async getBanks(filters: { search?: string; isActive?: string }) {
    const where: any = {};
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { code: { contains: filters.search } },
      ];
    }
    if (filters.isActive !== undefined && filters.isActive !== '')
      where.isActive = filters.isActive === 'true';
    return this.prisma.bank.findMany({ where, orderBy: { code: 'asc' } });
  }

  async createBank(data: { code: string; name: string; isActive?: boolean }) {
    const exists = await this.prisma.bank.findUnique({ where: { code: data.code } });
    if (exists) throw new ConflictException(`Ya existe un banco con el código ${data.code}`);
    return this.prisma.bank.create({
      data: { code: data.code.trim(), name: data.name.trim(), isActive: data.isActive ?? true },
    });
  }

  async updateBank(code: string, data: { name?: string; isActive?: boolean }) {
    const bank = await this.prisma.bank.findUnique({ where: { code } });
    if (!bank) throw new NotFoundException(`Banco con código ${code} no encontrado`);
    return this.prisma.bank.update({ where: { code }, data });
  }

  async deleteBank(code: string) {
    const bank = await this.prisma.bank.findUnique({
      where: { code },
      include: { _count: { select: { employees: true } } },
    });
    if (!bank) throw new NotFoundException(`Banco con código ${code} no encontrado`);
    if ((bank as any)._count.employees > 0)
      throw new BadRequestException('No se puede eliminar: hay empleados asociados a este banco');
    return this.prisma.bank.delete({ where: { code } });
  }

  // ─── INTEGRATIONS COMPANIES LIST ─────────────────────────────────────────

  async getIntegrationsCompanies() {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        nit: true,
        razonSocial: true,
        status: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIAL'] } },
          select: {
            plan: {
              select: {
                displayName: true,
                features: {
                  where: { key: { in: ['dian_enabled', 'has_payroll'] } },
                  select: { key: true, value: true },
                },
              },
            },
          },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return companies.map(c => {
      const features = c.subscriptions[0]?.plan?.features ?? [];
      const hasDian    = features.some(f => f.key === 'dian_enabled' && f.value === 'true');
      const hasPayroll = features.some(f => f.key === 'has_payroll'  && f.value === 'true');
      return {
        id:              c.id,
        name:            c.name,
        nit:             c.nit,
        razonSocial:     c.razonSocial,
        status:          c.status,
        planDisplayName: c.subscriptions[0]?.plan?.displayName ?? null,
        hasDian,
        hasPayroll,
      };
    });
  }

  // ─── DIAN INTEGRATIONS PER COMPANY ────────────────────────────────────────

  private async getCompanyOrFail(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  private mapDianResolutionBlock(
    resolucion?: string | null,
    prefijo?: string | null,
    rangoDesde?: number | null,
    rangoHasta?: number | null,
    vigenciaDesde?: string | null,
    vigenciaHasta?: string | null,
  ) {
    return {
      resolucion: resolucion ?? '',
      prefijo: prefijo ?? '',
      rangoDesde: rangoDesde ?? null,
      rangoHasta: rangoHasta ?? null,
      vigenciaDesde: vigenciaDesde ?? '',
      vigenciaHasta: vigenciaHasta ?? '',
    };
  }

  private async getCompanyDianPosResolution(companyId: string) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            "dianPosResolucion",
            "dianPosPrefijo",
            "dianPosRangoDesde",
            "dianPosRangoHasta",
            "dianPosFechaDesde",
            "dianPosFechaHasta"
          FROM "companies"
          WHERE "id" = $1
          LIMIT 1
        `,
        companyId,
      );
      return rows[0] ?? {};
    } catch {
      return {};
    }
  }

  private async saveCompanyDianPosResolution(companyId: string, pos: any) {
    try {
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "companies"
          SET
            "dianPosResolucion" = $1,
            "dianPosPrefijo" = $2,
            "dianPosRangoDesde" = $3,
            "dianPosRangoHasta" = $4,
            "dianPosFechaDesde" = $5,
            "dianPosFechaHasta" = $6
          WHERE "id" = $7
        `,
        pos?.resolucion || null,
        pos?.prefijo || null,
        pos?.rangoDesde != null ? Number(pos.rangoDesde) : null,
        pos?.rangoHasta != null ? Number(pos.rangoHasta) : null,
        pos?.vigenciaDesde || null,
        pos?.vigenciaHasta || null,
        companyId,
      );
    } catch (error) {
      throw new BadRequestException(
        'Las columnas de resolución POS aún no existen en la base de datos. Ejecuta la migración de Prisma y vuelve a intentar.',
      );
    }
  }

  async getCompanyDianFacturacion(companyId: string) {
    const c = await this.getCompanyOrFail(companyId) as any;
    const posRow = await this.getCompanyDianPosResolution(companyId);
    const venta = this.mapDianResolutionBlock(
      c.dianResolucion,
      c.dianPrefijo,
      c.dianRangoDesde,
      c.dianRangoHasta,
      c.dianFechaDesde,
      c.dianFechaHasta,
    );
    const pos = this.mapDianResolutionBlock(
      posRow.dianPosResolucion,
      posRow.dianPosPrefijo,
      posRow.dianPosRangoDesde,
      posRow.dianPosRangoHasta,
      posRow.dianPosFechaDesde,
      posRow.dianPosFechaHasta,
    );
    return {
      enabled: !!(c.dianSoftwareId && (c.dianResolucion || posRow.dianPosResolucion)),
      ambiente: c.dianTestMode ? 'habilitacion' : 'produccion',
      softwareId: c.dianSoftwareId ?? '',
      softwarePin: c.dianSoftwarePin ?? '',
      testSetId: c.dianTestSetId ?? '',
      claveTecnica: c.dianClaveTecnica ?? '',
      venta,
      pos,
      ...venta,
      hasCertificate: !!c.dianCertificate,
    };
  }

  async updateCompanyDianFacturacion(companyId: string, dto: any) {
    const current = await this.getCompanyOrFail(companyId) as any;
    const currentPos = await this.getCompanyDianPosResolution(companyId);
    const venta = dto.venta ?? {
      resolucion: dto.resolucion,
      prefijo: dto.prefijo,
      rangoDesde: dto.rangoDesde,
      rangoHasta: dto.rangoHasta,
      vigenciaDesde: dto.vigenciaDesde,
      vigenciaHasta: dto.vigenciaHasta,
    };
    const pos = dto.pos ?? {
      resolucion: currentPos.dianPosResolucion,
      prefijo: currentPos.dianPosPrefijo,
      rangoDesde: currentPos.dianPosRangoDesde,
      rangoHasta: currentPos.dianPosRangoHasta,
      vigenciaDesde: currentPos.dianPosFechaDesde,
      vigenciaHasta: currentPos.dianPosFechaHasta,
    };
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        dianTestMode: dto.ambiente === 'habilitacion',
        dianSoftwareId: dto.softwareId || null,
        dianSoftwarePin: dto.softwarePin || null,
        dianTestSetId: dto.testSetId || null,
        dianClaveTecnica: dto.claveTecnica || null,
        dianResolucion: venta?.resolucion || null,
        dianPrefijo: venta?.prefijo || null,
        dianRangoDesde: venta?.rangoDesde != null ? Number(venta.rangoDesde) : null,
        dianRangoHasta: venta?.rangoHasta != null ? Number(venta.rangoHasta) : null,
        dianFechaDesde: venta?.vigenciaDesde || null,
        dianFechaHasta: venta?.vigenciaHasta || null,
      } as any,
    });
    await this.saveCompanyDianPosResolution(companyId, pos);
    return this.getCompanyDianFacturacion(companyId);
  }

  async getCompanyDianNomina(companyId: string) {
    const c = await this.getCompanyOrFail(companyId);
    return {
      enabled: !!c.nominaSoftwareId,
      softwareId: c.nominaSoftwareId ?? '',
      softwarePin: c.nominaSoftwarePin ?? '',
      testSetId: c.nominaTestSetId ?? '',
    };
  }

  async updateCompanyDianNomina(companyId: string, dto: any) {
    await this.getCompanyOrFail(companyId);
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        nominaSoftwareId: dto.softwareId || null,
        nominaSoftwarePin: dto.softwarePin || null,
        nominaTestSetId: dto.testSetId || null,
      },
    });
    return this.getCompanyDianNomina(companyId);
  }

  async getCompanyDianCertificate(companyId: string) {
    const c = await this.getCompanyOrFail(companyId);
    return {
      hasCertificate: !!c.dianCertificate,
      certificate: c.dianCertificate ?? '',
      certificateKey: c.dianCertificateKey ?? '',
    };
  }

  async updateCompanyDianCertificate(companyId: string, dto: any) {
    await this.getCompanyOrFail(companyId);
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        dianCertificate: dto.certificate || null,
        dianCertificateKey: dto.certificateKey || null,
      },
    });
    return this.getCompanyDianCertificate(companyId);
  }

  // ─── PARAMETERS ──────────────────────────────────────────────────────────────

  async getParameters(filters: { category?: string; search?: string }) {
    const where: any = {};
    if (filters.category) where.category = filters.category;
    if (filters.search) {
      where.OR = [
        { category: { contains: filters.search, mode: 'insensitive' } },
        { value:    { contains: filters.search, mode: 'insensitive' } },
        { label:    { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.parameter.findMany({ where, orderBy: [{ category: 'asc' }, { value: 'asc' }] });
  }

  async createParameter(data: { category: string; value: string; label?: string; isActive?: boolean }) {
    return this.prisma.parameter.create({
      data: {
        category: data.category.trim(),
        value:    data.value.trim(),
        label:    data.label?.trim(),
        isActive: data.isActive ?? true,
      },
    });
  }

  async updateParameter(id: string, data: { category?: string; value?: string; label?: string; isActive?: boolean }) {
    const param = await this.prisma.parameter.findUnique({ where: { id } });
    if (!param) throw new NotFoundException('Parámetro no encontrado');
    return this.prisma.parameter.update({ where: { id }, data });
  }

  async deleteParameter(id: string) {
    const param = await this.prisma.parameter.findUnique({ where: { id } });
    if (!param) throw new NotFoundException('Parámetro no encontrado');
    return this.prisma.parameter.delete({ where: { id } });
  }
}
