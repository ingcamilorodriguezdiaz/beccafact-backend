import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters: { search?: string; isActive?: boolean; page?: number; limit?: number },
  ) {
    const { search, isActive, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { documentNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // isActive filter: if provided, filter by it; if not provided, show all
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: +limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page: +page, limit: +limit, totalPages: Math.ceil(total / +limit) };
  }

  async findOne(companyId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        invoices: {
          where: { deletedAt: null },
          orderBy: { issueDate: 'desc' },
          take: 10,
          select: {
            id: true, invoiceNumber: true, total: true,
            status: true, issueDate: true, dueDate: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  async create(companyId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        companyId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        deletedAt: null,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un cliente con ${dto.documentType} ${dto.documentNumber}`,
      );
    }
    return this.prisma.customer.create({ data: { ...dto, companyId } });
  }

  async update(companyId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(companyId, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getBalance(companyId: string, customerId: string) {
    await this.findOne(companyId, customerId);
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId, customerId, deletedAt: null },
      select: { total: true, status: true, dueDate: true },
    });

    const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = invoices
      .filter((i) => i.status === 'PAID')
      .reduce((s, i) => s + Number(i.total), 0);
    const totalOverdue = invoices
      .filter(
        (i) =>
          i.status === 'OVERDUE' ||
          (i.dueDate && new Date(i.dueDate) < new Date() && i.status !== 'PAID'),
      )
      .reduce((s, i) => s + Number(i.total), 0);

    return {
      totalInvoiced,
      totalPaid,
      balance: totalInvoiced - totalPaid,
      totalOverdue,
      invoiceCount: invoices.length,
    };
  }
}
