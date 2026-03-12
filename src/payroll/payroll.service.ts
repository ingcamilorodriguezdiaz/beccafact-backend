import { payroll_records } from './../../node_modules/.prisma/client/index.d';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

export interface CreateEmployeeDto {
  documentType: string;
  documentNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  position: string;
  baseSalary: number;
  contractType: string;
  hireDate: string;
  city?: string;
  bankAccount?: string;
  bankName?: string;
}

export interface UpdateEmployeeDto extends Partial<CreateEmployeeDto> {}

export interface CreatePayrollDto {
  employeeId: string;
  period: string;
  payDate: string;
  baseSalary: number;
  daysWorked: number;
  overtimeHours?: number;
  bonuses?: number;
  commissions?: number;
  transportAllowance?: number;
  vacationPay?: number;
  sickLeave?: number;
  loans?: number;
  otherDeductions?: number;
  notes?: string;
}

export interface PayrollCalcResult {
  autoTransport: number;
  healthEmployee: number;
  pensionEmployee: number;
  healthEmployer: number;
  pensionEmployer: number;
  arl: number;
  compensationFund: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  totalEmployerCost: number;
}

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  // ── EMPLOYEES ────────────────────────────────────────────────────────────

  async findAllEmployees(
    companyId: string,
    filters: { search?: string; active?: boolean; page?: number; limit?: number },
  ) {
    const { search, active, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };
    if (active !== undefined) where.isActive = active;
    if (search) {
      where.OR = [
        { firstName:      { contains: search, mode: 'insensitive' } },
        { lastName:       { contains: search, mode: 'insensitive' } },
        { documentNumber: { contains: search } },
        { position:       { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.employees.findMany({ where, orderBy: { lastName: 'asc' }, skip, take: limit }),
      this.prisma.employees.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findEmployee(companyId: string, id: string) {
    const emp = await this.prisma.employees.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { payroll_records: { orderBy: { period: 'desc' }, take: 12 } },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async createEmployee(companyId: string, dto: CreateEmployeeDto, userId: string) {
    const exists = await this.prisma.employees.findFirst({
      where: { companyId, documentNumber: dto.documentNumber, deletedAt: null },
    });
    if (exists) throw new ConflictException(`Employee with document ${dto.documentNumber} already exists`);

    const employee = await this.prisma.employees.create({
      data: {
        companyId,
        documentType:   dto.documentType,
        documentNumber: dto.documentNumber,
        firstName:      dto.firstName,
        lastName:       dto.lastName,
        email:          dto.email,
        phone:          dto.phone,
        position:       dto.position,
        baseSalary:     dto.baseSalary,
        contractType:   dto.contractType,
        hireDate:       new Date(dto.hireDate),
        city:           dto.city,
        bankAccount:    dto.bankAccount,
        bankName:       dto.bankName,
      },
    });

    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'employee', resourceId: employee.id, after: dto as any },
    });
    return employee;
  }

  async updateEmployee(companyId: string, id: string, dto: UpdateEmployeeDto, userId: string) {
    const before = await this.findEmployee(companyId, id);
    const data: any = { ...dto };
    if (dto.hireDate) data.hireDate = new Date(dto.hireDate);
    const updated = await this.prisma.employees.update({ where: { id }, data });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'UPDATE', resource: 'employee', resourceId: id, before: before as any, after: dto as any },
    });
    return updated;
  }

  async deactivateEmployee(companyId: string, id: string, userId: string) {
    await this.findEmployee(companyId, id);
    const updated = await this.prisma.employees.update({ where: { id }, data: { isActive: false } });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'DEACTIVATE', resource: 'employee', resourceId: id },
    });
    return updated;
  }

  // ── PAYROLL RECORDS ──────────────────────────────────────────────────────

  async findAllPayroll(
    companyId: string,
    filters: { period?: string; employeeId?: string; status?: string; page?: number; limit?: number },
  ) {
    const { period, employeeId, status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId };
    if (period)     where.period     = period;
    if (employeeId) where.employeeId = employeeId;
    if (status)     where.status     = status;

    const [data, total] = await Promise.all([
      this.prisma.payroll_records.findMany({
        where,
        include: {
          employees: { select: { id: true, firstName: true, lastName: true, documentNumber: true, position: true } },
        },
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        skip, take: limit,
      }),
      this.prisma.payroll_records.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findPayrollRecord(companyId: string, id: string) {
    const record = await this.prisma.payroll_records.findFirst({
      where: { id, companyId },
      include: { employees: true },
    });
    if (!record) throw new NotFoundException('Payroll record not found');
    return record;
  }

  async createPayroll(companyId: string, dto: CreatePayrollDto, userId: string) {
    const employee = await this.findEmployee(companyId, dto.employeeId);
    if (!employee.isActive) throw new BadRequestException('Cannot create payroll for an inactive employee');

    const existing = await this.prisma.payroll_records.findFirst({
      where: { companyId, employeeId: dto.employeeId, period: dto.period },
    });
    if (existing) throw new ConflictException(
      `Payroll for ${employee.firstName} ${employee.lastName} in ${dto.period} already exists`,
    );

    const calc = this.calculatePayroll(dto);

    const record = await this.prisma.payroll_records.create({
      data: {
        companyId,
        employeeId:         dto.employeeId,
        period:             dto.period,
        payDate:            new Date(dto.payDate),
        status:             'DRAFT',
        baseSalary:         dto.baseSalary,
        daysWorked:         dto.daysWorked,
        overtimeHours:      dto.overtimeHours      ?? 0,
        bonuses:            dto.bonuses            ?? 0,
        commissions:        dto.commissions        ?? 0,
        transportAllowance: calc.autoTransport,
        vacationPay:        dto.vacationPay        ?? 0,
        sickLeave:          dto.sickLeave          ?? 0,
        loans:              dto.loans              ?? 0,
        otherDeductions:    dto.otherDeductions    ?? 0,
        healthEmployee:     calc.healthEmployee,
        pensionEmployee:    calc.pensionEmployee,
        healthEmployer:     calc.healthEmployer,
        pensionEmployer:    calc.pensionEmployer,
        arl:                calc.arl,
        compensationFund:   calc.compensationFund,
        totalEarnings:      calc.totalEarnings,
        totalDeductions:    calc.totalDeductions,
        netPay:             calc.netPay,
        totalEmployerCost:  calc.totalEmployerCost,
        notes:              dto.notes,
      },
      include: { employees: { select: { id: true, firstName: true, lastName: true } } },
    });

    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll', resourceId: record.id,
              after: { period: dto.period, employeeId: dto.employeeId, netPay: calc.netPay } as any },
    });
    return record;
  }

  async submitPayroll(companyId: string, id: string, userId: string) {
    const record = await this.findPayrollRecord(companyId, id);
    if (record.status !== 'DRAFT') throw new BadRequestException('Only DRAFT records can be submitted');

    const updated = await this.prisma.payroll_records.update({
      where: { id },
      data: {
        status:      'SUBMITTED',
        submittedAt: new Date(),
        cune: `CUNE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      },
      include: { employees: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'SUBMIT', resource: 'payroll', resourceId: id },
    });
    return updated;
  }

  async voidPayroll(companyId: string, id: string, reason: string, userId: string) {
    const record = await this.findPayrollRecord(companyId, id);
    if (record.status === 'VOIDED')   throw new BadRequestException('Record is already voided');
    if (record.status === 'ACCEPTED') throw new BadRequestException('Accepted records cannot be voided');

    const updated = await this.prisma.payroll_records.update({
      where: { id },
      data: { status: 'VOIDED', notes: reason },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'VOID', resource: 'payroll', resourceId: id, after: { reason } as any },
    });
    return updated;
  }

  async getPeriodSummary(companyId: string, period: string) {
    const records = await this.prisma.payroll_records.findMany({
      where: { companyId, period, status: { not: 'VOIDED' } },
      include: {
        employees: { select: { id: true, firstName: true, lastName: true, position: true } },
      },
    });
    return {
      period,
      totalEmployees:    records.length,
      totalEarnings:     records.reduce((s, r) => s + Number(r.totalEarnings), 0),
      totalDeductions:   records.reduce((s, r) => s + Number(r.totalDeductions), 0),
      totalNetPay:       records.reduce((s, r) => s + Number(r.netPay), 0),
      totalEmployerCost: records.reduce((s, r) => s + Number(r.totalEmployerCost), 0),
      submitted:         records.filter((r) => r.status === 'SUBMITTED' || r.status === 'ACCEPTED').length,
      drafts:            records.filter((r) => r.status === 'DRAFT').length,
      records,
    };
  }

  // ── Colombian payroll calculation engine (2024) ──────────────────────────

  calculatePayroll(dto: CreatePayrollDto): PayrollCalcResult & { autoTransport: number } {
    const SMMLV      = 1_300_000;
    const AUTO_AUX   = 162_000;  // Transport allowance 2024

    const dailySalary        = dto.baseSalary / 30;
    const proportional       = dailySalary * (dto.daysWorked ?? 30);
    const transport          = (dto.transportAllowance !== undefined && dto.transportAllowance !== null)
      ? dto.transportAllowance
      : (dto.baseSalary <= SMMLV * 2 ? AUTO_AUX : 0);
    const overtimePay        = (dto.overtimeHours ?? 0) * (dto.baseSalary / 240) * 1.25;

    const totalEarnings =
      proportional + transport + overtimePay +
      (dto.bonuses ?? 0) + (dto.commissions ?? 0) + (dto.vacationPay ?? 0);

    const base = proportional + overtimePay + (dto.bonuses ?? 0); // base for social security

    const healthEmployee   = base * 0.04;
    const pensionEmployee  = base * 0.04;
    const healthEmployer   = base * 0.085;
    const pensionEmployer  = base * 0.12;
    const arl              = base * 0.00522;
    const compensationFund = base * 0.04;

    const totalDeductions =
      healthEmployee + pensionEmployee +
      (dto.sickLeave ?? 0) + (dto.loans ?? 0) + (dto.otherDeductions ?? 0);

    const netPay            = totalEarnings - totalDeductions;
    const totalEmployerCost = totalEarnings + healthEmployer + pensionEmployer + arl + compensationFund;

    return {
      autoTransport:     Math.round(transport),
      healthEmployee:    Math.round(healthEmployee),
      pensionEmployee:   Math.round(pensionEmployee),
      healthEmployer:    Math.round(healthEmployer),
      pensionEmployer:   Math.round(pensionEmployer),
      arl:               Math.round(arl),
      compensationFund:  Math.round(compensationFund),
      totalEarnings:     Math.round(totalEarnings),
      totalDeductions:   Math.round(totalDeductions),
      netPay:            Math.round(netPay),
      totalEmployerCost: Math.round(totalEmployerCost),
    };
  }

  previewPayroll(dto: CreatePayrollDto) {
    const { autoTransport, ...preview } = this.calculatePayroll(dto);
    return preview;
  }
}