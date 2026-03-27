import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateBranchStockDto } from './dto/update-branch-stock.dto';
import { AssignUserBranchDto } from './dto/assign-user-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  // ─── Branch CRUD ────────────────────────────────────────────────────────────

  async findAll(companyId: string) {
    const branches = await this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
      include: {
        _count: {
          select: {
            userBranches: true,
            posSessions: true,
            invoices: true,
          },
        },
      },
      orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
    });

    return { data: branches, total: branches.length };
  }

  async findOne(companyId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        userBranches: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
            },
          },
        },
        _count: {
          select: {
            userBranches: true,
            posSessions: true,
            invoices: true,
          },
        },
      },
    });

    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    return branch;
  }

  async create(companyId: string, dto: CreateBranchDto) {
    const existing = await this.prisma.branch.findFirst({
      where: { companyId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe una sucursal con el nombre "${dto.name}" en esta empresa`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // If this branch will be the main one, unset isMain on all others first
      if (dto.isMain) {
        await tx.branch.updateMany({
          where: { companyId, isMain: true, deletedAt: null },
          data: { isMain: false },
        });
      }

      const branch = await tx.branch.create({
        data: { ...dto, companyId },
      });

      return branch;
    });
  }

  async update(companyId: string, id: string, dto: UpdateBranchDto) {
    await this.findOne(companyId, id);

    if (dto.name) {
      const nameConflict = await this.prisma.branch.findFirst({
        where: { companyId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameConflict) {
        throw new ConflictException(
          `Ya existe una sucursal con el nombre "${dto.name}" en esta empresa`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isMain) {
        await tx.branch.updateMany({
          where: { companyId, isMain: true, deletedAt: null, id: { not: id } },
          data: { isMain: false },
        });
      }

      return tx.branch.update({
        where: { id },
        data: dto,
      });
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);

    // Cannot delete if there are open POS sessions
    const openSessions = await this.prisma.posSession.count({
      where: { branchId: id, status: 'OPEN' },
    });
    if (openSessions > 0) {
      throw new BadRequestException(
        'No se puede eliminar la sucursal porque tiene sesiones de caja abiertas',
      );
    }

    // Cannot delete if there are pending invoices
    const pendingInvoices = await this.prisma.invoice.count({
      where: { branchId: id, status: { in: ['DRAFT', 'SENT_DIAN'] } },
    });
    if (pendingInvoices > 0) {
      throw new BadRequestException(
        'No se puede eliminar la sucursal porque tiene facturas pendientes',
      );
    }

    return this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async toggleActive(companyId: string, id: string) {
    const branch = await this.findOne(companyId, id);

    return this.prisma.branch.update({
      where: { id },
      data: { isActive: !branch.isActive },
    });
  }

  // ─── Stock Management ────────────────────────────────────────────────────────

  async getStocks(
    companyId: string,
    branchId: string,
    filters: { search?: string; lowStock?: boolean },
  ) {
    await this.findOne(companyId, branchId);

    const { search, lowStock } = filters;

    const where: any = { companyId, branchId, deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const result = lowStock ? products.filter((p) => p.stock <= p.minStock) : products;
    return { data: result, total: result.length };
  }

  async updateStock(
    companyId: string,
    branchId: string,
    dto: UpdateBranchStockDto,
  ) {
    await this.findOne(companyId, branchId);

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, branchId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Producto no encontrado en esta sucursal');

    return this.prisma.product.update({
      where: { id: dto.productId },
      data: {
        stock: dto.stock,
        minStock: dto.minStock,
        status: dto.stock === 0 ? 'OUT_OF_STOCK' : product.status === 'OUT_OF_STOCK' ? 'ACTIVE' : product.status,
      },
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async transferStock(
    companyId: string,
    fromBranchId: string,
    toBranchId: string,
    productId: string,
    quantity: number,
  ) {
    const [fromBranch, toBranch] = await Promise.all([
      this.prisma.branch.findFirst({ where: { id: fromBranchId, companyId, deletedAt: null } }),
      this.prisma.branch.findFirst({ where: { id: toBranchId, companyId, deletedAt: null } }),
    ]);

    if (!fromBranch) throw new NotFoundException('Sucursal de origen no encontrada');
    if (!toBranch) throw new NotFoundException('Sucursal de destino no encontrada');

    return this.prisma.$transaction(async (tx) => {
      const sourceProduct = await tx.product.findFirst({
        where: { id: productId, companyId, branchId: fromBranchId, deletedAt: null },
      });
      if (!sourceProduct) throw new NotFoundException('Producto no encontrado en sucursal de origen');
      if (sourceProduct.stock < quantity) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${sourceProduct.stock}, solicitado: ${quantity}`,
        );
      }

      // Find matching product in destination branch by SKU
      const destProduct = await tx.product.findFirst({
        where: { companyId, branchId: toBranchId, sku: sourceProduct.sku, deletedAt: null },
      });
      if (!destProduct) {
        throw new NotFoundException(
          `El producto SKU "${sourceProduct.sku}" no existe en la sucursal de destino`,
        );
      }

      await tx.product.update({
        where: { id: sourceProduct.id },
        data: { stock: { decrement: quantity } },
      });
      await tx.product.update({
        where: { id: destProduct.id },
        data: { stock: { increment: quantity } },
      });

      return {
        fromBranchId,
        toBranchId,
        sku: sourceProduct.sku,
        quantity,
        message: `Transferencia de ${quantity} unidades realizada`,
      };
    });
  }

  async initializeStocks(companyId: string, branchId: string) {
    await this.findOne(companyId, branchId);

    // Get company-wide products (no branch assigned)
    const masterProducts = await this.prisma.product.findMany({
      where: { companyId, branchId: null, deletedAt: null },
      select: {
        sku: true, name: true, description: true, price: true, cost: true,
        unit: true, taxRate: true, taxType: true, categoryId: true, barcode: true, minStock: true,
      },
    });

    if (masterProducts.length === 0) {
      return { initialized: 0, message: 'No hay productos del catálogo general para inicializar' };
    }

    // Only create products that don't already exist in this branch (by SKU)
    const existingSkus = await this.prisma.product.findMany({
      where: { companyId, branchId, deletedAt: null },
      select: { sku: true },
    });
    const existingSet = new Set(existingSkus.map((p) => p.sku));
    const toCreate = masterProducts.filter((p) => !existingSet.has(p.sku));

    if (toCreate.length === 0) {
      return { initialized: 0, message: 'Todos los productos ya están en esta sucursal' };
    }

    await this.prisma.product.createMany({
      data: toCreate.map((p) => ({ ...p, companyId, branchId, stock: 0 })),
      skipDuplicates: true,
    });

    return {
      initialized: toCreate.length,
      message: `${toCreate.length} productos copiados al catálogo de la sucursal`,
    };
  }

  // ─── User Assignment ─────────────────────────────────────────────────────────

  async getBranchUsers(companyId: string, branchId: string) {
    await this.findOne(companyId, branchId);

    const userBranches = await this.prisma.userBranch.findMany({
      where: { branchId, companyId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return { data: userBranches, total: userBranches.length };
  }

  async assignUser(
    companyId: string,
    branchId: string,
    dto: AssignUserBranchDto,
  ) {
    await this.findOne(companyId, branchId);

    // Verify the user belongs to the company
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado en esta empresa');

    const existing = await this.prisma.userBranch.findUnique({
      where: { userId_branchId: { userId: dto.userId, branchId } },
    });
    if (existing) {
      throw new ConflictException('El usuario ya está asignado a esta sucursal');
    }

    return this.prisma.userBranch.create({
      data: { userId: dto.userId, branchId, companyId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async removeUser(companyId: string, branchId: string, userId: string) {
    await this.findOne(companyId, branchId);

    const assignment = await this.prisma.userBranch.findUnique({
      where: { userId_branchId: { userId, branchId } },
    });
    if (!assignment) {
      throw new NotFoundException('El usuario no está asignado a esta sucursal');
    }

    await this.prisma.userBranch.delete({
      where: { userId_branchId: { userId, branchId } },
    });

    return { message: 'Usuario removido de la sucursal exitosamente' };
  }
}
