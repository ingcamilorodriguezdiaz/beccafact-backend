import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

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
    } catch {
      throw new BadRequestException(
        'Las columnas de resolución POS aún no existen en la base de datos. Ejecuta la migración de Prisma y vuelve a intentar.',
      );
    }
  }

  // ── Genérico Integration model ───────────────────────────────────────────

  async findAll(companyId: string) {
    return this.prisma.integration.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id, companyId },
    });
    if (!integration) throw new NotFoundException('Integración no encontrada');
    return integration;
  }

  async create(companyId: string, dto: any) {
    return this.prisma.integration.create({
      data: { ...dto, companyId },
    });
  }

  async update(companyId: string, id: string, dto: any) {
    await this.findOne(companyId, id);
    return this.prisma.integration.update({ where: { id }, data: dto });
  }

  async toggle(companyId: string, id: string) {
    const integration = await this.findOne(companyId, id);
    return this.prisma.integration.update({
      where: { id },
      data: { isActive: !integration.isActive },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.integration.delete({ where: { id } });
  }

  // ── DIAN Facturación Electrónica ─────────────────────────────────────────

  async getDianFacturacion(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    }) as any;
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const posRow = await this.getCompanyDianPosResolution(companyId);
    const venta = this.mapDianResolutionBlock(
      company.dianResolucion,
      company.dianPrefijo,
      company.dianRangoDesde,
      company.dianRangoHasta,
      company.dianFechaDesde,
      company.dianFechaHasta,
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
      enabled: !!(company.dianSoftwareId && (company.dianResolucion || posRow.dianPosResolucion)),
      ambiente: company.dianTestMode ? 'habilitacion' : 'produccion',
      softwareId: company.dianSoftwareId ?? '',
      softwarePin: company.dianSoftwarePin ?? '',
      testSetId: company.dianTestSetId ?? '',
      claveTecnica: company.dianClaveTecnica ?? '',
      venta,
      pos,
      ...venta,
      hasCertificate: !!company.dianCertificate,
    };
  }

  async updateDianFacturacion(companyId: string, dto: any) {
    const current = await this.prisma.company.findUnique({ where: { id: companyId } }) as any;
    if (!current) throw new NotFoundException('Empresa no encontrada');
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
    return this.getDianFacturacion(companyId);
  }

  // ── DIAN Nómina Electrónica ───────────────────────────────────────────────

  async getDianNomina(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        nominaSoftwareId: true,
        nominaSoftwarePin: true,
        nominaTestSetId: true,
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return {
      enabled: !!company.nominaSoftwareId,
      softwareId: company.nominaSoftwareId ?? '',
      softwarePin: company.nominaSoftwarePin ?? '',
      testSetId: company.nominaTestSetId ?? '',
    };
  }

  async updateDianNomina(companyId: string, dto: any) {
    await this.getDianNomina(companyId);
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        nominaSoftwareId: dto.softwareId || null,
        nominaSoftwarePin: dto.softwarePin || null,
        nominaTestSetId: dto.testSetId || null,
      },
    });
    return this.getDianNomina(companyId);
  }

  // ── DIAN Certificado Digital (compartido) ────────────────────────────────────

  async getDianCertificate(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { dianCertificate: true, dianCertificateKey: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return {
      hasCertificate: !!company.dianCertificate,
      certificate: company.dianCertificate ?? '',
      certificateKey: company.dianCertificateKey ?? '',
    };
  }

  async updateDianCertificate(companyId: string, dto: any) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        dianCertificate: dto.certificate || null,
        dianCertificateKey: dto.certificateKey || null,
      },
    });
    return this.getDianCertificate(companyId);
  }
}
