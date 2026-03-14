import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Resolución de ubicación desde el catálogo DIVIPOLA
  //
  // Si el DTO trae cityCode (ej: '25473') → busca en municipalities, completa
  // automáticamente: city, department, departmentCode, country.
  // cityCode inválido → BadRequestException con mensaje orientativo.
  // Sin cityCode → conserva city/department/country tal como vengan en el DTO.
  // ─────────────────────────────────────────────────────────────────────────────
  private async resolveLocation(dto: Partial<CreateCustomerDto>): Promise<{
    city?: string;
    department?: string;
    cityCode?: string;
    departmentCode?: string;
    country?: string;
  }> {
    if (!dto.cityCode) {
      return {
        city:           dto.city,
        department:     dto.department,
        cityCode:       undefined,
        departmentCode: dto.departmentCode,
        country:        dto.country ?? 'CO',
      };
    }

    const municipality = await this.prisma.municipality.findUnique({
      where: { code: dto.cityCode },
      include: {
        department: {
          include: { country: true },
        },
      },
    });

    if (!municipality) {
      throw new BadRequestException(
        `El código DIVIPOLA '${dto.cityCode}' no existe en el catálogo. ` +
        `Consulta GET /api/v1/location/municipalities/search?q={nombre} para encontrar el código correcto.`,
      );
    }

    return {
      city:           municipality.name,
      department:     municipality.department.name,
      cityCode:       municipality.code,
      departmentCode: municipality.department.code,
      country:        municipality.department.country?.code ?? 'CO',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────

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

    const location = await this.resolveLocation(dto);

    return this.prisma.customer.create({
      data: {
        ...dto,
        companyId,
        city:           location.city,
        department:     location.department,
        cityCode:       location.cityCode,
        departmentCode: location.departmentCode,
        country:        location.country ?? 'CO',
      },
    });
  }

  async update(companyId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(companyId, id);

    const hasLocationData =
      dto.cityCode       !== undefined ||
      dto.city           !== undefined ||
      dto.department     !== undefined ||
      dto.departmentCode !== undefined ||
      dto.country        !== undefined;

    let locationData: Partial<CreateCustomerDto> = {};
    if (hasLocationData) {
      locationData = await this.resolveLocation(dto);
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        ...(hasLocationData ? locationData : {}),
      },
    });
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

    const totalInvoiced  = invoices.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid      = invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + Number(i.total), 0);
    const totalOverdue   = invoices
      .filter((i) => i.status === 'OVERDUE' || (i.dueDate && new Date(i.dueDate) < new Date() && i.status !== 'PAID'))
      .reduce((s, i) => s + Number(i.total), 0);

    return { totalInvoiced, totalPaid, balance: totalInvoiced - totalPaid, totalOverdue, invoiceCount: invoices.length };
  }
}