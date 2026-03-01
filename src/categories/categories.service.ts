import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: { search?: string; parentId?: string; includeInactive?: boolean },
  ) {
    const { search, parentId, includeInactive } = filters;
    const where: any = { companyId, deletedAt: null };

    if (!includeInactive) where.isActive = true;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (parentId === 'null') {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parentId;
    }

    const data = await this.prisma.category.findMany({
      where,
      include: {
        children: { where: { deletedAt: null, isActive: true } },
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    return { data, total: data.length };
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        children: { where: { deletedAt: null } },
        products: {
          where: { deletedAt: null, status: 'ACTIVE' },
          select: { id: true, name: true, sku: true, price: true, stock: true },
          take: 20,
        },
        _count: { select: { products: true } },
      },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return category;
  }

  async create(companyId: string, dto: CreateCategoryDto) {
    // Check name uniqueness within company + parent scope
    const existing = await this.prisma.category.findFirst({
      where: {
        companyId,
        name: dto.name,
        parentId: dto.parentId ?? null,
        deletedAt: null,
      },
    });
    if (existing) throw new ConflictException(`Ya existe una categoría con el nombre "${dto.name}"`);

    // Validate parentId belongs to same company
    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, companyId, deletedAt: null },
      });
      if (!parent) throw new NotFoundException('Categoría padre no encontrada');
    }

    return this.prisma.category.create({
      data: { ...dto, companyId },
    });
  }

  async update(companyId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(companyId, id);

    // Prevent self-referencing
    if (dto.parentId === id) {
      throw new BadRequestException('Una categoría no puede ser su propio padre');
    }

    // Check name uniqueness if changing name
    if (dto.name) {
      const existing = await this.prisma.category.findFirst({
        where: {
          companyId,
          name: dto.name,
          parentId: dto.parentId ?? null,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (existing) throw new ConflictException(`Ya existe una categoría con el nombre "${dto.name}"`);
    }

    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);

    // Check if there are products using this category
    const productCount = await this.prisma.product.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (productCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${productCount} producto(s) usan esta categoría. Reasigna los productos primero.`,
      );
    }

    // Soft delete
    return this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
