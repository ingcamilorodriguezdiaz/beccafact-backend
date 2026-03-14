import { PrismaService } from '@/config/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class ParametersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve todos los parámetros activos */
  async findAll(category?: string) {
    return this.prisma.parameter.findMany({
      where: {
        ...(category ? { category } : {}),
        isActive: true,
      },
      orderBy: { category: 'asc' },
    });
  }

  /** Devuelve un parámetro por categoría */
  async findOne(category: string) {
    const param = await this.prisma.parameter.findFirst({
      where: { category, isActive: true },
    });

    if (!param) {
      throw new NotFoundException(`Parámetro ${category} no encontrado`);
    }

    return param;
  }

  /** Devuelve el JSON parseado */
  async getValue(category: string): Promise<Record<string, string>> {
    const param = await this.prisma.parameter.findFirst({
      where: { category, isActive: true },
      select: { value: true },
    });

    if (!param) return {};

    return JSON.parse(param.value);
  }

  /**
   * Devuelve el mapa key→value
   * Ejemplo:
   * DOCUMENT_TYPES → { NIT:'31', CC:'13' }
   */
  async getCategoryMap(category: string): Promise<Record<string, string>> {
    const param = await this.prisma.parameter.findFirst({
      where: { category, isActive: true },
      select: { value: true },
    });

    if (!param) return {};

    return JSON.parse(param.value);
  }

  /** Lista todas las categorías */
  async findCategories(): Promise<string[]> {
    const result = await this.prisma.parameter.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });

    return result.map((r) => r.category);
  }

  /** Crea o actualiza un parámetro por categoría */
  async upsert(data: {
    category: string;
    value: string;
    label?: string;
  }) {
    const { category, ...rest } = data;

    const existing = await this.prisma.parameter.findFirst({
      where: { category },
    });

    if (existing) {
      return this.prisma.parameter.update({
        where: { id: existing.id },
        data: rest,
      });
    }

    return this.prisma.parameter.create({
      data: { category, ...rest },
    });
  }

  /** Activa o desactiva un parámetro */
  async setActive(category: string, isActive: boolean) {
    const param = await this.prisma.parameter.findFirst({
      where: { category },
    });

    if (!param) {
      throw new NotFoundException(`Parámetro ${category} no encontrado`);
    }

    return this.prisma.parameter.update({
      where: { id: param.id },
      data: { isActive },
    });
  }
}