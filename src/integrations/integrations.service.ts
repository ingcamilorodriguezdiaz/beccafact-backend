import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

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
}
