import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

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
      select: {
        dianTestMode: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianTestSetId: true,
        dianClaveTecnica: true,
        dianResolucion: true,
        dianPrefijo: true,
        dianRangoDesde: true,
        dianRangoHasta: true,
        dianFechaDesde: true,
        dianFechaHasta: true,
        dianCertificate: true,
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return {
      enabled: !!(company.dianSoftwareId && company.dianResolucion),
      ambiente: company.dianTestMode ? 'habilitacion' : 'produccion',
      softwareId: company.dianSoftwareId ?? '',
      softwarePin: company.dianSoftwarePin ?? '',
      testSetId: company.dianTestSetId ?? '',
      claveTecnica: company.dianClaveTecnica ?? '',
      resolucion: company.dianResolucion ?? '',
      prefijo: company.dianPrefijo ?? '',
      rangoDesde: company.dianRangoDesde ?? null,
      rangoHasta: company.dianRangoHasta ?? null,
      vigenciaDesde: company.dianFechaDesde ?? '',
      vigenciaHasta: company.dianFechaHasta ?? '',
      hasCertificate: !!company.dianCertificate,
    };
  }

  async updateDianFacturacion(companyId: string, dto: any) {
    await this.getDianFacturacion(companyId);
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        dianTestMode: dto.ambiente === 'habilitacion',
        dianSoftwareId: dto.softwareId || null,
        dianSoftwarePin: dto.softwarePin || null,
        dianTestSetId: dto.testSetId || null,
        dianClaveTecnica: dto.claveTecnica || null,
        dianResolucion: dto.resolucion || null,
        dianPrefijo: dto.prefijo || null,
        dianRangoDesde: dto.rangoDesde != null ? Number(dto.rangoDesde) : null,
        dianRangoHasta: dto.rangoHasta != null ? Number(dto.rangoHasta) : null,
        dianFechaDesde: dto.vigenciaDesde || null,
        dianFechaHasta: dto.vigenciaHasta || null,
      },
    });
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
