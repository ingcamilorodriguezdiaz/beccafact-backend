import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, filters: {
    search?: string; categoryId?: string; status?: string; page?: number; limit?: number;
  }) {
    const { search, categoryId, status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * +limit;

    const where: any = { companyId, deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: +limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }

  async getLowStock(companyId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { stock: 'asc' },
    });

    // Filter where stock <= minStock
    const lowStock = products.filter((p) => p.stock <= p.minStock);
    return { data: lowStock, total: lowStock.length };
  }

  async findOne(companyId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { category: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async create(companyId: string, dto: CreateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { companyId, sku: dto.sku, deletedAt: null },
    });
    if (existing) throw new ConflictException(`El SKU "${dto.sku}" ya existe en esta empresa`);

    return this.prisma.product.create({
      data: { ...dto, companyId },
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async update(companyId: string, id: string, dto: UpdateProductDto) {
    const product = await this.findOne(companyId, id);

    if (dto.sku && dto.sku !== product.sku) {
      const existing = await this.prisma.product.findFirst({
        where: { companyId, sku: dto.sku, deletedAt: null, id: { not: id } },
      });
      if (existing) throw new ConflictException(`El SKU "${dto.sku}" ya existe`);
    }

    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async adjustStock(companyId: string, id: string, delta: number) {
    const product = await this.findOne(companyId, id);
    const newStock = product.stock + delta;
    if (newStock < 0) {
      throw new BadRequestException(
        `Stock insuficiente. Stock actual: ${product.stock}, ajuste solicitado: ${delta}`,
      );
    }
    return this.prisma.product.update({
      where: { id },
      data: {
        stock: newStock,
        status: newStock === 0 ? 'OUT_OF_STOCK' : product.status === 'OUT_OF_STOCK' ? 'ACTIVE' : product.status,
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async incrementUsage(companyId: string) {
    const period = this.getPeriod();
    await this.prisma.usageTracking.upsert({
      where: { companyId_metric_period: { companyId, metric: 'max_products', period } },
      create: { companyId, metric: 'max_products', period, value: 1 },
      update: { value: { increment: 1 } },
    });
  }

  private getPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
