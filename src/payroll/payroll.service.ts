import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { createHash, createSign, randomBytes } from 'crypto';
import * as archiver from 'archiver';
import * as https from 'https';
import * as http from 'http';
import * as QRCode from 'qrcode';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/create-payroll';
import {
  CreatePayrollCalendarDto,
  CreatePayrollConceptDto,
  CreatePayrollPolicyDto,
  CreatePayrollTypeConfigDto,
  UpdatePayrollCalendarDto,
  UpdatePayrollConceptDto,
  UpdatePayrollPolicyDto,
  UpdatePayrollTypeConfigDto,
} from './dto/payroll-masters.dto';
import { CreatePayrollNoveltyDto, UpdatePayrollNoveltyDto } from './dto/payroll-novelties.dto';
import { CreatePayrollBatchDto, PayrollPeriodControlDto } from './dto/payroll-batches.dto';
import {
  ChangePayrollEmploymentDto,
  CreateFinalSettlementDto,
  ExtendPayrollContractDto,
} from './dto/payroll-contracts.dto';
import { RunPayrollProvisionDto } from './dto/payroll-provisions.dto';
import {
  AddPayrollAttachmentDto,
  RejectPayrollApprovalDto,
  RequestPayrollApprovalDto,
  ReversePayrollDto,
} from './dto/payroll-governance.dto';
import { CreatePayrollEmployeeRequestDto } from './dto/payroll-portal.dto';
import { CreatePayrollEnterpriseRuleDto, UpdatePayrollEnterpriseRuleDto } from './dto/payroll-enterprise.dto';
import { AccountingService } from '../accounting/accounting.service';

// ─── Constantes DIAN Nómina Electrónica ── Fallbacks de habilitación ──────────
// Se usan SOLO cuando la empresa no tiene configuradas sus propias credenciales.
// En producción cada empresa DEBE registrar sus valores en el modelo Company
// (campos nominaSoftwareId, nominaSoftwarePin, nominaTestSetId).
const NOMINA_SOFTWARE_ID_DEFAULT  = '4f5c23a6-0004-46a1-923f-19f2cb4c36da';
const NOMINA_SOFTWARE_PIN_DEFAULT = '123456';
const NOMINA_TEST_SET_ID_DEFAULT  = '25e4b1c1-982c-465b-a380-eb1dd4a925ec';
const NOMINA_WS_HAB  = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc';
const NOMINA_WS_PROD = 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc';
const NOMINA_SEQUENCE_START = 990000001;

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
  branchId?: string;
  payrollCalendarId?: string;
  payrollPolicyId?: string;
  payrollTypeConfigId?: string;
  payrollCategory?: string;
  conceptLines?: Array<{
    conceptId?: string;
    quantity?: number;
    rate?: number;
    amount?: number;
  }>;
  cuneRef?: string;          // CUNE del documento predecesor
  payrollNumberRef?: string; // Número del documento predecesor
  fechaGenRef?: string;      // FechaGen del predecesor YYYY-MM-DD (FechaGenPred)
  /** 'Reemplazar': corrige devengados/deducciones (Resolución 000013 Art.17 párr. 4-6,11)
   *  'Eliminar':   anula sin contenido de nómina (Art.17 último párrafo) */
  tipoAjuste?: 'Reemplazar' | 'Eliminar';
  // Campos internos de cadena (gestionados por createNotaAjuste, no por el usuario)
  originalNieId?: string;    // FK al NIE raíz del período
  predecessorId?: string;    // FK al documento predecesor directo
}

export interface PayrollCalcResult {
  autoTransport: number;
  healthEmployee: number;
  pensionEmployee: number;
  healthEmployer: number;
  pensionEmployer: number;
  arl: number;
  compensationFund: number;
  senaEmployer: number;
  icbfEmployer: number;
  healthBase: number;
  pensionBase: number;
  arlBase: number;
  compensationBase: number;
  senaBase: number;
  icbfBase: number;
  warnings: string[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  totalEmployerCost: number;
}

interface DianNominaResult {
  success: boolean;
  zipKey?: string;
  errorMessages: string[];
  raw: string;
}

interface DianStatusResult {
  isValid: boolean;
  statusCode?: string;
  statusDescription?: string;
  statusMessage?: string;
  errorMessages: string[];
  raw: string;
}

interface PayrollPolicyContext {
  id?: string | null;
  name?: string | null;
  applyAutoTransport?: boolean;
  transportAllowanceAmount?: number;
  transportCapMultiplier?: number;
  minimumWageValue?: number;
  healthEmployeeRate?: number;
  pensionEmployeeRate?: number;
  healthEmployerRate?: number;
  pensionEmployerRate?: number;
  arlRate?: number;
  compensationFundRate?: number;
  senaRate?: number;
  icbfRate?: number;
  healthCapSmmlv?: number;
  pensionCapSmmlv?: number;
  parafiscalCapSmmlv?: number;
  applySena?: boolean;
  applyIcbf?: boolean;
  overtimeFactor?: number;
}

interface PayrollConceptResolvedLine {
  conceptId?: string | null;
  code: string;
  name: string;
  nature: 'EARNING' | 'DEDUCTION';
  formulaType: string;
  quantity?: number | null;
  rate?: number | null;
  amount: number;
  source: string;
}

interface PayrollNoveltyResolution {
  dto: CreatePayrollDto;
  noveltyLines: PayrollConceptResolvedLine[];
  noveltyIds: string[];
}

type PayrollAuditTrailRow = {
  id: string;
  action: string;
  resource: string;
  resourceId: string;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  before: any;
  after: any;
};

type PayrollPortalPaymentRow = {
  id: string;
  period: string;
  payDate: Date;
  status: string;
  payrollNumber: string | null;
  payrollType: string | null;
  netPay: any;
  totalEarnings: any;
  totalDeductions: any;
  totalEmployerCost: any;
};

type PayrollDianJobAction = 'SUBMIT_DIAN' | 'QUERY_DIAN_STATUS';

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private prisma: PrismaService,
    private accountingService: AccountingService,
  ) {}

  private async createPayrollDianJob(payload: {
    companyId: string;
    payrollRecordId?: string | null;
    payrollBatchId?: string | null;
    branchId?: string | null;
    actionType: PayrollDianJobAction;
    triggeredById?: string | null;
    status?: string;
    payload?: Record<string, any> | null;
  }) {
    return (this.prisma as any).payrollDianProcessingJob.create({
      data: {
        companyId: payload.companyId,
        payrollRecordId: payload.payrollRecordId ?? null,
        payrollBatchId: payload.payrollBatchId ?? null,
        branchId: payload.branchId ?? null,
        actionType: payload.actionType,
        status: payload.status ?? 'PENDING',
        triggeredById: payload.triggeredById ?? null,
        payload: payload.payload ?? null,
      },
    });
  }

  private async completePayrollDianJob(
    jobId: string,
    data: {
      status: 'SUCCESS' | 'FAILED';
      responseCode?: string | null;
      responseMessage?: string | null;
      result?: Record<string, any> | null;
    },
  ) {
    return (this.prisma as any).payrollDianProcessingJob.update({
      where: { id: jobId },
      data: {
        status: data.status,
        processedAt: new Date(),
        responseCode: data.responseCode ?? null,
        responseMessage: data.responseMessage ?? null,
        result: data.result ?? null,
      },
    });
  }

  private async getUserRoleNames(companyId: string, userId: string) {
    const roles = await this.prisma.userRole.findMany({
      where: { userId, user: { companyId } as any },
      select: { role: { select: { name: true } } },
    } as any);
    return roles.map((item: any) => item.role?.name).filter(Boolean);
  }

  private async resolvePayrollEnterpriseRule(companyId: string, branchId: string | null | undefined, actionType: string) {
    const prismaAny = this.prisma as any;
    const normalizedBranchId = this.normalizeBranchScope(branchId);
    const rules = await prismaAny.payrollEnterpriseRule.findMany({
      where: {
        companyId,
        isActive: true,
        actionType,
        OR: normalizedBranchId ? [{ branchId: normalizedBranchId }, { branchId: null }] : [{ branchId: null }],
      },
      orderBy: [{ branchId: 'desc' }, { createdAt: 'asc' }],
    });
    return rules?.[0] ?? null;
  }

  private async assertPayrollEnterpriseAction(
    companyId: string,
    userId: string,
    branchId: string | null | undefined,
    actionType: string,
    context?: {
      requestedById?: string | null;
      approvedById?: string | null;
      payrollTypeConfigId?: string | null;
    },
  ) {
    const prismaAny = this.prisma as any;
    const rule = await this.resolvePayrollEnterpriseRule(companyId, branchId, actionType);
    if (!rule) return null;

    if (rule.requireBranchScope && !branchId) {
      throw new BadRequestException(`La regla enterprise para ${actionType} exige operar con sucursal definida.`);
    }

    const allowedRoles = Array.isArray(rule.allowedRoles) ? rule.allowedRoles.filter(Boolean) : [];
    if (allowedRoles.length) {
      const userRoles = await this.getUserRoleNames(companyId, userId);
      const hasAllowedRole = userRoles.some((role) => allowedRoles.includes(role));
      if (!hasAllowedRole) {
        throw new ForbiddenException(`La regla enterprise "${rule.policyName}" no permite ejecutar ${actionType} con tus roles actuales.`);
      }
    }

    if (rule.requireDifferentActors) {
      if (context?.requestedById && context.requestedById === userId) {
        throw new ConflictException(`La regla "${rule.policyName}" exige segregación de funciones entre solicitante y ejecutor.`);
      }
      if (context?.approvedById && context.approvedById === userId) {
        throw new ConflictException(`La regla "${rule.policyName}" exige segregación de funciones entre aprobador y ejecutor.`);
      }
    }

    if (rule.requireAccountingReview) {
      const profileCount = await prismaAny.payrollAccountingProfile.count({
        where: {
          companyId,
          isActive: true,
          OR: [
            {
              branchId: branchId ?? null,
              payrollTypeConfigId: context?.payrollTypeConfigId ?? null,
            },
            {
              branchId: null,
              payrollTypeConfigId: context?.payrollTypeConfigId ?? null,
            },
            {
              branchId: branchId ?? null,
              payrollTypeConfigId: null,
            },
            {
              branchId: null,
              payrollTypeConfigId: null,
            },
          ],
        },
      });
      if (!profileCount) {
        throw new BadRequestException(`La regla "${rule.policyName}" exige perfil contable activo antes de ejecutar ${actionType}.`);
      }
    }

    return rule;
  }

  private async resolveEmployeeBranchId(companyId: string, branchId?: string | null): Promise<string | null> {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!branch) throw new BadRequestException('La sucursal seleccionada no existe o no está activa');
      return branch.id;
    }

    const mainBranch = await this.prisma.branch.findFirst({
      where: { companyId, isMain: true, deletedAt: null, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return mainBranch?.id ?? null;
  }

  /**
   * Convierte cualquier valor (Prisma.Decimal, string, number, null/undefined)
   * a un número seguro para campos Decimal(12,2) de PostgreSQL.
   * Máximo absoluto permitido: 9_999_999_999.99 (10 dígitos antes del decimal)
   */
  private safeNum(val: any, decimals = 2): number {
    const n = Number(val);
    if (!isFinite(n) || isNaN(n)) return 0;
    const max = 9_999_999_999;
    const clamped = Math.min(Math.abs(n), max) * Math.sign(n);
    return parseFloat(clamped.toFixed(decimals));
  }

  private applyContributionCap(base: number, smmlv: number, capSmmlv?: number | null) {
    const cap = this.safeNum((capSmmlv ?? 25) * smmlv);
    return Math.min(this.safeNum(base), cap);
  }

  private calculatePayrollAccruals(record: any) {
    const salaryBase = Number(record.baseSalary ?? 0);
    const transport = Number(record.transportAllowance ?? 0);
    const bonusBase = Number(record.bonuses ?? 0) + Number(record.commissions ?? 0);
    const accrualBase = Math.max(0, salaryBase + transport + bonusBase);
    const primaAccrued = accrualBase / 12;
    const cesantiasAccrued = accrualBase / 12;
    const interestsAccrued = cesantiasAccrued * 0.01;
    const vacationAccrued = salaryBase / 24;
    return {
      primaAccrued: this.safeNum(primaAccrued),
      cesantiasAccrued: this.safeNum(cesantiasAccrued),
      interestsAccrued: this.safeNum(interestsAccrued),
      vacationAccrued: this.safeNum(vacationAccrued),
      totalAccrued: this.safeNum(primaAccrued + cesantiasAccrued + interestsAccrued + vacationAccrued),
    };
  }

  private async syncAccrualBalanceFromPayroll(companyId: string, payrollRecord: any) {
    const prismaAny = this.prisma as any;
    const accruals = this.calculatePayrollAccruals(payrollRecord);
    await prismaAny.payrollAccrualBalance.upsert({
      where: {
        companyId_employeeId_period: {
          companyId,
          employeeId: payrollRecord.employeeId,
          period: payrollRecord.period,
        },
      },
      update: {
        branchId: payrollRecord.branchId ?? null,
        primaAccrued: accruals.primaAccrued,
        cesantiasAccrued: accruals.cesantiasAccrued,
        interestsAccrued: accruals.interestsAccrued,
        vacationAccrued: accruals.vacationAccrued,
        totalAccrued: accruals.totalAccrued,
        lastPayrollRecordId: payrollRecord.id,
      },
      create: {
        companyId,
        employeeId: payrollRecord.employeeId,
        branchId: payrollRecord.branchId ?? null,
        period: payrollRecord.period,
        primaAccrued: accruals.primaAccrued,
        cesantiasAccrued: accruals.cesantiasAccrued,
        interestsAccrued: accruals.interestsAccrued,
        vacationAccrued: accruals.vacationAccrued,
        totalAccrued: accruals.totalAccrued,
        lastPayrollRecordId: payrollRecord.id,
      },
    });
    return accruals;
  }

  private normalizeBranchScope(branchId?: string | null): string | null {
    return branchId || null;
  }

  private async createEmploymentEvent(companyId: string, employeeId: string, data: {
    branchId?: string | null;
    payrollRecordId?: string | null;
    eventType: string;
    effectiveDate: Date;
    description?: string | null;
    payload?: any;
  }) {
    const prismaAny = this.prisma as any;
    return prismaAny.payrollEmploymentEvent.create({
      data: {
        companyId,
        employeeId,
        branchId: data.branchId ?? null,
        payrollRecordId: data.payrollRecordId ?? null,
        eventType: data.eventType,
        effectiveDate: data.effectiveDate,
        description: data.description ?? null,
        payload: data.payload ?? null,
      },
    });
  }

  private async getLatestApprovalRequest(
    companyId: string,
    params: { payrollRecordId?: string; payrollBatchId?: string; actionType: string },
  ) {
    const prismaAny = this.prisma as any;
    return prismaAny.payrollApprovalRequest.findFirst({
      where: {
        companyId,
        payrollRecordId: params.payrollRecordId ?? null,
        payrollBatchId: params.payrollBatchId ?? null,
        actionType: params.actionType,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  private async consumeApprovalRequest(approvalId: string) {
    const prismaAny = this.prisma as any;
    await prismaAny.payrollApprovalRequest.update({
      where: { id: approvalId },
      data: { consumedAt: new Date(), updatedAt: new Date() },
    });
  }

  private async createInitialContractHistory(companyId: string, employee: any, dto: CreateEmployeeDto) {
    const prismaAny = this.prisma as any;
    await prismaAny.payrollContractHistory.create({
      data: {
        companyId,
        employeeId: employee.id,
        branchId: employee.branchId ?? null,
        payrollPolicyId: employee.payrollPolicyId ?? null,
        payrollTypeConfigId: employee.payrollTypeConfigId ?? null,
        version: 1,
        contractType: employee.contractType,
        position: employee.position,
        baseSalary: employee.baseSalary,
        startDate: new Date(employee.hireDate),
        endDate: dto.contractEndDate ? new Date(dto.contractEndDate) : null,
        status: 'ACTIVE',
        changeReason: 'INITIAL_ADMISSION',
        notes: 'Contrato inicial del empleado',
      },
    });
    await this.createEmploymentEvent(companyId, employee.id, {
      branchId: employee.branchId ?? null,
      eventType: 'ADMISSION',
      effectiveDate: new Date(employee.hireDate),
      description: 'Ingreso y creación inicial del contrato',
      payload: {
        contractType: employee.contractType,
        position: employee.position,
        baseSalary: Number(employee.baseSalary),
      },
    });
  }

  private async getActiveContract(companyId: string, employeeId: string) {
    const prismaAny = this.prisma as any;
    return prismaAny.payrollContractHistory.findFirst({
      where: { companyId, employeeId, status: 'ACTIVE' },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async resolvePayrollPolicy(companyId: string, branchId?: string | null, payrollPolicyId?: string | null) {
    const prismaAny = this.prisma as any;
    if (payrollPolicyId) {
      const selected = await prismaAny.payrollPolicy.findFirst({
        where: { id: payrollPolicyId, companyId, isActive: true },
      });
      if (!selected) throw new BadRequestException('La política laboral seleccionada no existe o no está activa');
      return selected as PayrollPolicyContext;
    }

    const scopedBranchId = this.normalizeBranchScope(branchId);
    const candidates = await prismaAny.payrollPolicy.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [{ branchId: scopedBranchId }, { branchId: null }],
      },
      orderBy: [{ isDefault: 'desc' }, { branchId: 'desc' }, { createdAt: 'asc' }],
      take: 5,
    });
    return (candidates?.[0] ?? null) as PayrollPolicyContext | null;
  }

  private async resolvePayrollCalendar(companyId: string, branchId?: string | null, payrollCalendarId?: string | null) {
    const prismaAny = this.prisma as any;
    if (payrollCalendarId) {
      const selected = await prismaAny.payrollCalendar.findFirst({
        where: { id: payrollCalendarId, companyId, isActive: true },
      });
      if (!selected) throw new BadRequestException('El calendario de nómina seleccionado no existe o no está activo');
      return selected;
    }
    const scopedBranchId = this.normalizeBranchScope(branchId);
    const calendars = await prismaAny.payrollCalendar.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [{ branchId: scopedBranchId }, { branchId: null }],
      },
      orderBy: [{ isDefault: 'desc' }, { branchId: 'desc' }, { createdAt: 'asc' }],
      take: 5,
    });
    return calendars?.[0] ?? null;
  }

  private async resolvePayrollTypeConfig(companyId: string, branchId?: string | null, payrollTypeConfigId?: string | null) {
    const prismaAny = this.prisma as any;
    if (payrollTypeConfigId) {
      const selected = await prismaAny.payrollTypeConfig.findFirst({
        where: { id: payrollTypeConfigId, companyId, isActive: true },
      });
      if (!selected) throw new BadRequestException('El tipo de nómina seleccionado no existe o no está activo');
      return selected;
    }
    const scopedBranchId = this.normalizeBranchScope(branchId);
    const types = await prismaAny.payrollTypeConfig.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [{ branchId: scopedBranchId }, { branchId: null }],
      },
      orderBy: [{ isDefault: 'desc' }, { branchId: 'desc' }, { createdAt: 'asc' }],
      take: 5,
    });
    return types?.[0] ?? null;
  }

  private resolveConceptAmount(
    dto: CreatePayrollDto,
    concept: any,
    item: { quantity?: number; rate?: number; amount?: number },
    policy?: PayrollPolicyContext | null,
  ) {
    const quantity = this.safeNum(item.quantity ?? concept.quantityDefault ?? 1);
    const rate = this.safeNum(item.rate ?? concept.defaultRate ?? 0, 4);
    const amount = this.safeNum(item.amount ?? concept.defaultAmount ?? 0);
    const proportional = (Number(dto.baseSalary) / 30) * Number(dto.daysWorked ?? 30);
    const overtimeBase = Number(dto.baseSalary) / 240;
    const overtimeFactor = Number(policy?.overtimeFactor ?? 1.25);

    switch (concept.formulaType) {
      case 'FIXED_AMOUNT':
        return { quantity, rate, amount };
      case 'BASE_SALARY_PERCENT':
        return { quantity, rate, amount: this.safeNum(Number(dto.baseSalary) * (rate / 100)) };
      case 'PROPORTIONAL_SALARY_PERCENT':
        return { quantity, rate, amount: this.safeNum(proportional * (rate / 100)) };
      case 'OVERTIME_FACTOR':
        return {
          quantity: this.safeNum(item.quantity ?? dto.overtimeHours ?? 0),
          rate: this.safeNum(item.rate ?? overtimeFactor, 4),
          amount: this.safeNum(Number(item.quantity ?? dto.overtimeHours ?? 0) * overtimeBase * Number(item.rate ?? overtimeFactor)),
        };
      default:
        return { quantity, rate, amount };
    }
  }

  private async resolvePayrollConceptLines(
    companyId: string,
    dto: CreatePayrollDto,
    branchId?: string | null,
    policy?: PayrollPolicyContext | null,
  ): Promise<PayrollConceptResolvedLine[]> {
    const prismaAny = this.prisma as any;
    const scopedBranchId = this.normalizeBranchScope(branchId);
    const explicitItems = dto.conceptLines ?? [];
    const explicitConceptIds = explicitItems.map(item => item.conceptId).filter(Boolean);

    const explicitConcepts = explicitConceptIds.length
      ? await prismaAny.payrollConcept.findMany({
          where: { companyId, id: { in: explicitConceptIds }, isActive: true },
        })
      : [];

    const defaultConcepts = await prismaAny.payrollConcept.findMany({
      where: {
        companyId,
        isActive: true,
        appliesByDefault: true,
        OR: [{ branchId: scopedBranchId }, { branchId: null }],
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const conceptMap = new Map<string, any>();
    [...explicitConcepts, ...defaultConcepts].forEach((concept: any) => conceptMap.set(concept.id, concept));

    const resolved: PayrollConceptResolvedLine[] = [];

    for (const concept of defaultConcepts) {
      const calc = this.resolveConceptAmount(dto, concept, {}, policy);
      if (!calc.amount) continue;
      resolved.push({
        conceptId: concept.id,
        code: concept.code,
        name: concept.name,
        nature: concept.nature,
        formulaType: concept.formulaType,
        quantity: calc.quantity,
        rate: calc.rate,
        amount: calc.amount,
        source: 'DEFAULT',
      });
    }

    for (const item of explicitItems) {
      if (!item?.conceptId) continue;
      const concept = conceptMap.get(item.conceptId);
      if (!concept) continue;
      const calc = this.resolveConceptAmount(dto, concept, item, policy);
      if (!calc.amount) continue;
      resolved.push({
        conceptId: concept.id,
        code: concept.code,
        name: concept.name,
        nature: concept.nature,
        formulaType: concept.formulaType,
        quantity: calc.quantity,
        rate: calc.rate,
        amount: calc.amount,
        source: 'SELECTED',
      });
    }

    return resolved;
  }

  async getPayrollMasters(companyId: string, branchId?: string) {
    const prismaAny = this.prisma as any;
    const scopedBranchId = this.normalizeBranchScope(branchId);
    const whereScoped = {
      companyId,
      OR: branchId ? [{ branchId: scopedBranchId }, { branchId: null }] : undefined,
    } as any;

    const [concepts, calendars, policies, payrollTypes] = await Promise.all([
      prismaAny.payrollConcept.findMany({
        where: { ...whereScoped, isActive: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      }),
      prismaAny.payrollCalendar.findMany({
        where: { ...whereScoped, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      prismaAny.payrollPolicy.findMany({
        where: { ...whereScoped, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      prismaAny.payrollTypeConfig.findMany({
        where: { ...whereScoped, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
    ]);

    return { concepts, calendars, policies, payrollTypes };
  }

  async getPayrollEnterpriseOverview(companyId: string, branchId?: string) {
    const prismaAny = this.prisma as any;
    const normalizedBranchId = this.normalizeBranchScope(branchId);

    const [rules, branches, pendingNovelties, pendingBatchApprovals, pendingRecordApprovals, pendingDianJobs, failedDianJobs, accountingPending, accountingFailed] = await Promise.all([
      prismaAny.payrollEnterpriseRule.findMany({
        where: {
          companyId,
          ...(normalizedBranchId ? { OR: [{ branchId: normalizedBranchId }, { branchId: null }] } : {}),
        },
        include: { branch: { select: { id: true, name: true } } },
        orderBy: [{ processArea: 'asc' }, { actionType: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.branch.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { id: true, name: true, isMain: true },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      }),
      prismaAny.payrollNovelty.count({ where: { companyId, status: 'PENDING', ...(normalizedBranchId ? { branchId: normalizedBranchId } : {}) } }),
      prismaAny.payrollApprovalRequest.count({ where: { companyId, payrollBatchId: { not: null }, status: 'PENDING' } }),
      prismaAny.payrollApprovalRequest.count({ where: { companyId, payrollRecordId: { not: null }, status: 'PENDING' } }),
      prismaAny.payrollDianProcessingJob.count({ where: { companyId, status: { in: ['PENDING', 'PROCESSING'] }, ...(normalizedBranchId ? { branchId: normalizedBranchId } : {}) } }),
      prismaAny.payrollDianProcessingJob.count({ where: { companyId, status: 'FAILED', ...(normalizedBranchId ? { branchId: normalizedBranchId } : {}) } }),
      prismaAny.accountingIntegration.count({ where: { companyId, module: 'payroll', status: { in: ['PENDING', 'PROCESSING'] } } }),
      prismaAny.accountingIntegration.count({ where: { companyId, module: 'payroll', status: 'FAILED' } }),
    ]);

    const branchCoverage = branches.map((item: any) => ({
      branchId: item.id,
      branchName: item.name,
      hasRules: rules.some((rule: any) => rule.branchId === item.id),
      usesCompanyDefaults: !rules.some((rule: any) => rule.branchId === item.id) && rules.some((rule: any) => !rule.branchId),
    }));

    const sharedBoard = [
      {
        area: 'HR',
        title: 'Novedades e incidencias pendientes',
        count: pendingNovelties,
        status: pendingNovelties > 0 ? 'attention' : 'healthy',
        actionHint: 'RRHH debe depurar novedades antes del cierre y la transmisión',
      },
      {
        area: 'PAYROLL',
        title: 'Aprobaciones operativas de nómina',
        count: pendingBatchApprovals + pendingRecordApprovals,
        status: pendingBatchApprovals + pendingRecordApprovals > 0 ? 'attention' : 'healthy',
        actionHint: 'Nómina debe gestionar aprobaciones de pre-nómina y liquidaciones',
      },
      {
        area: 'PAYROLL',
        title: 'Cola técnica DIAN',
        count: pendingDianJobs + failedDianJobs,
        status: pendingDianJobs + failedDianJobs > 0 ? 'attention' : 'healthy',
        actionHint: 'Operación técnica debe procesar pendientes y reprocesar fallidos',
      },
      {
        area: 'ACCOUNTING',
        title: 'Conciliación contable de nómina',
        count: accountingPending + accountingFailed,
        status: accountingPending + accountingFailed > 0 ? 'attention' : 'healthy',
        actionHint: 'Contabilidad debe revisar integraciones pendientes o fallidas',
      },
    ];

    return {
      rules,
      branchCoverage,
      segregationSummary: {
        totalRules: rules.length,
        activeRules: rules.filter((item: any) => item.isActive).length,
        segregatedRules: rules.filter((item: any) => item.requireDifferentActors).length,
        accountingReviewedRules: rules.filter((item: any) => item.requireAccountingReview).length,
      },
      sharedBoard,
      metrics: {
        pendingNovelties,
        pendingBatchApprovals,
        pendingRecordApprovals,
        pendingDianJobs,
        failedDianJobs,
        accountingPending,
        accountingFailed,
      },
    };
  }

  async createPayrollEnterpriseRule(companyId: string, dto: CreatePayrollEnterpriseRuleDto, userId: string) {
    const prismaAny = this.prisma as any;
    const created = await prismaAny.payrollEnterpriseRule.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        processArea: dto.processArea,
        actionType: dto.actionType.trim().toUpperCase(),
        policyName: dto.policyName.trim(),
        allowedRoles: dto.allowedRoles?.length ? dto.allowedRoles : [],
        requireDifferentActors: dto.requireDifferentActors ?? false,
        requireBranchScope: dto.requireBranchScope ?? false,
        requireAccountingReview: dto.requireAccountingReview ?? false,
        sharedWithAreas: dto.sharedWithAreas?.length ? dto.sharedWithAreas : [],
        isActive: dto.isActive ?? true,
        notes: dto.notes?.trim() || null,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_ENTERPRISE_RULE_CREATED',
        resource: 'payroll_enterprise_rule',
        resourceId: created.id,
        after: created as any,
      },
    });
    return created;
  }

  async updatePayrollEnterpriseRule(companyId: string, id: string, dto: UpdatePayrollEnterpriseRuleDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.payrollEnterpriseRule.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Regla enterprise de nómina no encontrada');

    const updated = await prismaAny.payrollEnterpriseRule.update({
      where: { id },
      data: {
        branchId: dto.branchId === undefined ? existing.branchId : (dto.branchId ?? null),
        processArea: dto.processArea ?? existing.processArea,
        actionType: dto.actionType ? dto.actionType.trim().toUpperCase() : existing.actionType,
        policyName: dto.policyName?.trim() ?? existing.policyName,
        allowedRoles: dto.allowedRoles ?? existing.allowedRoles,
        requireDifferentActors: dto.requireDifferentActors ?? existing.requireDifferentActors,
        requireBranchScope: dto.requireBranchScope ?? existing.requireBranchScope,
        requireAccountingReview: dto.requireAccountingReview ?? existing.requireAccountingReview,
        sharedWithAreas: dto.sharedWithAreas ?? existing.sharedWithAreas,
        isActive: dto.isActive ?? existing.isActive,
        notes: dto.notes === undefined ? existing.notes : (dto.notes?.trim() || null),
      },
      include: { branch: { select: { id: true, name: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_ENTERPRISE_RULE_UPDATED',
        resource: 'payroll_enterprise_rule',
        resourceId: id,
        before: existing as any,
        after: updated as any,
      },
    });
    return updated;
  }

  private async getPeriodControl(companyId: string, period: string, branchId?: string | null) {
    const prismaAny = this.prisma as any;
    return prismaAny.payrollPeriodControl.findFirst({
      where: { companyId, period, branchId: this.normalizeBranchScope(branchId) },
    });
  }

  private async ensurePeriodIsOpen(companyId: string, period: string, branchId?: string | null) {
    const control = await this.getPeriodControl(companyId, period, branchId);
    if (control?.status === 'CLOSED') {
      throw new BadRequestException(`El período ${period} está cerrado para nómina. Reábrelo antes de generar o modificar liquidaciones.`);
    }
    return control;
  }

  async listPayrollBatches(companyId: string, period?: string) {
    const prismaAny = this.prisma as any;
    return prismaAny.payrollBatch.findMany({
      where: { companyId, ...(period ? { period } : {}) },
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getPayrollPeriodDashboard(companyId: string, period: string, branchId?: string) {
    const prismaAny = this.prisma as any;
    const [control, batches] = await Promise.all([
      this.getPeriodControl(companyId, period, branchId ?? null),
      prismaAny.payrollBatch.findMany({
        where: { companyId, period, ...(branchId ? { branchId } : {}) },
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);
    return {
      control: control ?? { period, status: 'OPEN', branchId: branchId ?? null },
      batches,
    };
  }

  async previewPayrollBatch(companyId: string, dto: CreatePayrollBatchDto) {
    await this.ensurePeriodIsOpen(companyId, dto.period, dto.branchId ?? null);
    const where: any = {
      companyId,
      deletedAt: null,
      isActive: true,
      ...(dto.branchId ? { branchId: dto.branchId } : {}),
      ...(dto.employeeIds?.length ? { id: { in: dto.employeeIds } } : {}),
    };
    const employees = await this.prisma.employees.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, baseSalary: true, branchId: true },
      orderBy: [{ lastName: 'asc' }],
    });
    const existing = await this.prisma.payroll_records.findMany({
      where: { companyId, period: dto.period, employeeId: { in: employees.map(item => item.id) }, payrollType: 'NOMINA_ELECTRONICA' },
      select: { employeeId: true, netPay: true, totalEmployerCost: true },
    });
    const existingMap = new Map(existing.map((item: any) => [item.employeeId, item]));
    const candidates = employees.map((employee: any) => ({
      id: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      exists: existingMap.has(employee.id),
      estimatedNetPay: existingMap.get(employee.id)?.netPay ?? employee.baseSalary,
      estimatedEmployerCost: existingMap.get(employee.id)?.totalEmployerCost ?? employee.baseSalary,
    }));
    return {
      period: dto.period,
      totalEmployees: candidates.length,
      pendingGeneration: candidates.filter(item => !item.exists).length,
      candidates,
    };
  }

  async generatePayrollBatch(companyId: string, dto: CreatePayrollBatchDto, userId: string) {
    const prismaAny = this.prisma as any;
    await this.ensurePeriodIsOpen(companyId, dto.period, dto.branchId ?? null);
    const preview = await this.previewPayrollBatch(companyId, dto);
    const batch = await prismaAny.payrollBatch.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        period: dto.period,
        name: dto.name ?? `Pre-nómina ${dto.period}`,
        status: 'DRAFT',
        notes: dto.notes ?? null,
        totalEmployees: preview.totalEmployees,
      },
    });

    let generatedRecords = 0;
    let totalNetPay = 0;
    let totalEmployerCost = 0;
    const createdIds: string[] = [];

    for (const candidate of preview.candidates.filter((item: any) => !item.exists)) {
      const employee = await this.findEmployee(companyId, candidate.id);
      const created = await this.createPayroll(companyId, {
        employeeId: employee.id,
        period: dto.period,
        payDate: new Date().toISOString().split('T')[0],
        baseSalary: Number((employee as any).baseSalary),
        daysWorked: 30,
        branchId: (employee as any).branchId ?? dto.branchId,
      }, userId);
      await (this.prisma.payroll_records as any).update({
        where: { id: created.id },
        data: { payrollBatchId: batch.id },
      });
      createdIds.push(created.id);
      generatedRecords += 1;
      totalNetPay += Number(created.netPay ?? 0);
      totalEmployerCost += Number(created.totalEmployerCost ?? 0);
    }

    const updatedBatch = await prismaAny.payrollBatch.update({
      where: { id: batch.id },
      data: {
        status: 'GENERATED',
        generatedRecords,
        totalNetPay: this.safeNum(totalNetPay),
        totalEmployerCost: this.safeNum(totalEmployerCost),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'GENERATE_BATCH',
        resource: 'payroll_batch',
        resourceId: batch.id,
        after: { period: dto.period, generatedRecords, payrollRecordIds: createdIds } as any,
      },
    });
    return updatedBatch;
  }

  async closePayrollPeriod(companyId: string, dto: PayrollPeriodControlDto, userId: string) {
    const prismaAny = this.prisma as any;
    await this.assertPayrollEnterpriseAction(companyId, userId, dto.branchId ?? null, 'CLOSE_PERIOD');
    const latestBatch = await prismaAny.payrollBatch.findFirst({
      where: {
        companyId,
        period: dto.period,
        ...(dto.branchId ? { branchId: dto.branchId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latestBatch) {
      const approval = await this.getLatestApprovalRequest(companyId, {
        payrollBatchId: latestBatch.id,
        actionType: 'PREPAYROLL',
      });
      if (!approval || approval.status !== 'APPROVED' || approval.consumedAt) {
        throw new BadRequestException('Debes aprobar la pre-nómina del lote antes de cerrar el período');
      }
    }
    const existing = await this.getPeriodControl(companyId, dto.period, dto.branchId ?? null);
    const control = existing
      ? await prismaAny.payrollPeriodControl.update({
          where: { id: existing.id },
          data: { status: 'CLOSED', notes: dto.notes ?? existing.notes, closedAt: new Date() },
        })
      : await prismaAny.payrollPeriodControl.create({
          data: {
            companyId,
            branchId: dto.branchId ?? null,
            period: dto.period,
            status: 'CLOSED',
            notes: dto.notes ?? null,
            closedAt: new Date(),
          },
        });

    await prismaAny.payrollBatch.updateMany({
      where: { companyId, period: dto.period, ...(dto.branchId ? { branchId: dto.branchId } : {}) },
      data: { status: 'CLOSED' },
    });

    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CLOSE_PERIOD', resource: 'payroll_period', resourceId: control.id, after: control as any },
    });
    if (latestBatch) {
      const approval = await this.getLatestApprovalRequest(companyId, {
        payrollBatchId: latestBatch.id,
        actionType: 'PREPAYROLL',
      });
      if (approval?.status === 'APPROVED' && !approval.consumedAt) {
        await this.consumeApprovalRequest(approval.id);
      }
    }
    return control;
  }

  async reopenPayrollPeriod(companyId: string, dto: PayrollPeriodControlDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await this.getPeriodControl(companyId, dto.period, dto.branchId ?? null);
    if (!existing) {
      throw new NotFoundException('El período no tiene cierre registrado');
    }
    const control = await prismaAny.payrollPeriodControl.update({
      where: { id: existing.id },
      data: { status: 'OPEN', notes: dto.notes ?? existing.notes, reopenedAt: new Date() },
    });
    await prismaAny.payrollBatch.updateMany({
      where: { companyId, period: dto.period, ...(dto.branchId ? { branchId: dto.branchId } : {}) },
      data: { status: 'GENERATED' },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'REOPEN_PERIOD', resource: 'payroll_period', resourceId: control.id, after: control as any },
    });
    return control;
  }

  async getBatchApprovalFlow(companyId: string, batchId: string) {
    const prismaAny = this.prisma as any;
    const batch = await prismaAny.payrollBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new NotFoundException('Lote de pre-nómina no encontrado');
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          par."id",
          par."payrollBatchId",
          par."actionType",
          par."status",
          par."reason",
          par."requestedAt",
          par."approvedAt",
          par."rejectedAt",
          par."rejectedReason",
          par."consumedAt",
          par."requestedById",
          par."approvedById",
          TRIM(COALESCE(req."firstName",'') || ' ' || COALESCE(req."lastName",'')) AS "requestedByName",
          TRIM(COALESCE(app."firstName",'') || ' ' || COALESCE(app."lastName",'')) AS "approvedByName"
        FROM "payroll_approval_requests" par
        LEFT JOIN "users" req ON req."id" = par."requestedById"
        LEFT JOIN "users" app ON app."id" = par."approvedById"
        WHERE par."companyId" = $1
          AND par."payrollBatchId" = $2
        ORDER BY par."createdAt" DESC
      `,
      companyId,
      batchId,
    );
    return rows.map((row) => ({
      ...row,
      requestedByName: row.requestedByName?.trim() || null,
      approvedByName: row.approvedByName?.trim() || null,
    }));
  }

  async requestBatchApproval(companyId: string, batchId: string, dto: { actionType: string; reason?: string }, userId: string) {
    const prismaAny = this.prisma as any;
    const batch = await prismaAny.payrollBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new NotFoundException('Lote de pre-nómina no encontrado');
    if (dto.actionType !== 'PREPAYROLL') throw new BadRequestException('La aprobación del lote solo admite la acción PREPAYROLL');
    const latest = await this.getLatestApprovalRequest(companyId, { payrollBatchId: batchId, actionType: dto.actionType });
    if (latest?.status === 'PENDING') throw new BadRequestException('Ya existe una solicitud pendiente para este lote');

    await prismaAny.payrollApprovalRequest.create({
      data: {
        companyId,
        payrollBatchId: batchId,
        actionType: dto.actionType,
        reason: dto.reason?.trim() || null,
        requestedById: userId,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'PAYROLL_BATCH_APPROVAL_REQUESTED', resource: 'payroll_batch', resourceId: batchId, after: { actionType: dto.actionType, reason: dto.reason ?? null } as any },
    });
    return this.getBatchApprovalFlow(companyId, batchId);
  }

  async approveBatchApproval(companyId: string, batchId: string, userId: string) {
    const prismaAny = this.prisma as any;
    const batch = await prismaAny.payrollBatch.findFirst({ where: { id: batchId, companyId }, select: { branchId: true } });
    if (!batch) throw new NotFoundException('Lote de pre-nómina no encontrado');
    const approval = (await this.getBatchApprovalFlow(companyId, batchId)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para este lote');
    await this.assertPayrollEnterpriseAction(companyId, userId, batch.branchId ?? null, 'APPROVE_BATCH', {
      requestedById: approval.requestedById ?? null,
      approvedById: approval.approvedById ?? null,
    });
    await prismaAny.payrollApprovalRequest.update({
      where: { id: approval.id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'PAYROLL_BATCH_APPROVED', resource: 'payroll_batch', resourceId: batchId, after: { approvalId: approval.id } as any },
    });
    return this.getBatchApprovalFlow(companyId, batchId);
  }

  async rejectBatchApproval(companyId: string, batchId: string, dto: { reason?: string }, userId: string) {
    const prismaAny = this.prisma as any;
    const approval = (await this.getBatchApprovalFlow(companyId, batchId)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para este lote');
    await prismaAny.payrollApprovalRequest.update({
      where: { id: approval.id },
      data: {
        status: 'REJECTED',
        approvedById: userId,
        rejectedAt: new Date(),
        rejectedReason: dto.reason?.trim() || 'Rechazado por control interno',
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'PAYROLL_BATCH_REJECTED', resource: 'payroll_batch', resourceId: batchId, after: { approvalId: approval.id, reason: dto.reason ?? null } as any },
    });
    return this.getBatchApprovalFlow(companyId, batchId);
  }

  async getRecordApprovalFlow(companyId: string, payrollRecordId: string) {
    const prismaAny = this.prisma as any;
    const record = await prismaAny.payroll_records.findFirst({ where: { id: payrollRecordId, companyId } });
    if (!record) throw new NotFoundException('Liquidación de nómina no encontrada');
    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
      `
        SELECT
          par."id",
          par."payrollRecordId",
          par."actionType",
          par."status",
          par."reason",
          par."requestedAt",
          par."approvedAt",
          par."rejectedAt",
          par."rejectedReason",
          par."consumedAt",
          par."requestedById",
          par."approvedById",
          TRIM(COALESCE(req."firstName",'') || ' ' || COALESCE(req."lastName",'')) AS "requestedByName",
          TRIM(COALESCE(app."firstName",'') || ' ' || COALESCE(app."lastName",'')) AS "approvedByName"
        FROM "payroll_approval_requests" par
        LEFT JOIN "users" req ON req."id" = par."requestedById"
        LEFT JOIN "users" app ON app."id" = par."approvedById"
        WHERE par."companyId" = $1
          AND par."payrollRecordId" = $2
        ORDER BY par."createdAt" DESC
      `,
      companyId,
      payrollRecordId,
    );
    return rows.map((row) => ({
      ...row,
      requestedByName: row.requestedByName?.trim() || null,
      approvedByName: row.approvedByName?.trim() || null,
    }));
  }

  async requestRecordApproval(companyId: string, payrollRecordId: string, dto: RequestPayrollApprovalDto, userId: string) {
    const prismaAny = this.prisma as any;
    const record = await prismaAny.payroll_records.findFirst({ where: { id: payrollRecordId, companyId } });
    if (!record) throw new NotFoundException('Liquidación de nómina no encontrada');
    if (!['SUBMIT', 'VOID'].includes(dto.actionType)) {
      throw new BadRequestException('La solicitud solo admite las acciones SUBMIT o VOID');
    }
    if (dto.actionType === 'SUBMIT' && record.status !== 'DRAFT') {
      throw new BadRequestException('Solo las liquidaciones en borrador pueden solicitar aprobación de envío');
    }
    if (dto.actionType === 'VOID' && (record.status === 'VOIDED' || record.status === 'ACCEPTED')) {
      throw new BadRequestException('Esta liquidación no admite aprobación de anulación');
    }
    const latest = await this.getLatestApprovalRequest(companyId, { payrollRecordId, actionType: dto.actionType });
    if (latest?.status === 'PENDING') {
      throw new BadRequestException('Ya existe una solicitud pendiente para esta acción');
    }

    await prismaAny.payrollApprovalRequest.create({
      data: {
        companyId,
        payrollRecordId,
        actionType: dto.actionType,
        reason: dto.reason?.trim() || null,
        requestedById: userId,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_APPROVAL_REQUESTED',
        resource: 'payroll',
        resourceId: payrollRecordId,
        after: { actionType: dto.actionType, reason: dto.reason ?? null } as any,
      },
    });
    return this.getRecordApprovalFlow(companyId, payrollRecordId);
  }

  async approveRecordApproval(companyId: string, payrollRecordId: string, userId: string) {
    const prismaAny = this.prisma as any;
    const record = await prismaAny.payroll_records.findFirst({
      where: { id: payrollRecordId, companyId },
      select: { branchId: true, payrollTypeConfigId: true },
    });
    if (!record) throw new NotFoundException('Liquidación de nómina no encontrada');
    const approval = (await this.getRecordApprovalFlow(companyId, payrollRecordId)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para esta liquidación');
    await this.assertPayrollEnterpriseAction(companyId, userId, record.branchId ?? null, 'APPROVE_RECORD', {
      requestedById: approval.requestedById ?? null,
      approvedById: approval.approvedById ?? null,
      payrollTypeConfigId: record.payrollTypeConfigId ?? null,
    });
    await prismaAny.payrollApprovalRequest.update({
      where: { id: approval.id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_APPROVAL_APPROVED',
        resource: 'payroll',
        resourceId: payrollRecordId,
        after: { approvalId: approval.id, actionType: approval.actionType } as any,
      },
    });
    return this.getRecordApprovalFlow(companyId, payrollRecordId);
  }

  async rejectRecordApproval(companyId: string, payrollRecordId: string, dto: RejectPayrollApprovalDto, userId: string) {
    const prismaAny = this.prisma as any;
    const approval = (await this.getRecordApprovalFlow(companyId, payrollRecordId)).find((item) => item.status === 'PENDING');
    if (!approval) throw new BadRequestException('No existe una aprobación pendiente para esta liquidación');
    await prismaAny.payrollApprovalRequest.update({
      where: { id: approval.id },
      data: {
        status: 'REJECTED',
        approvedById: userId,
        rejectedAt: new Date(),
        rejectedReason: dto.reason?.trim() || 'Rechazado por control interno',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_APPROVAL_REJECTED',
        resource: 'payroll',
        resourceId: payrollRecordId,
        after: { approvalId: approval.id, actionType: approval.actionType, reason: dto.reason ?? null } as any,
      },
    });
    return this.getRecordApprovalFlow(companyId, payrollRecordId);
  }

  async getRecordAttachments(companyId: string, payrollRecordId: string) {
    const prismaAny = this.prisma as any;
    const record = await prismaAny.payroll_records.findFirst({ where: { id: payrollRecordId, companyId } });
    if (!record) throw new NotFoundException('Liquidación de nómina no encontrada');
    return prismaAny.payrollAttachment.findMany({
      where: { companyId, payrollRecordId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async addRecordAttachment(companyId: string, payrollRecordId: string, dto: AddPayrollAttachmentDto, userId: string) {
    const prismaAny = this.prisma as any;
    const record = await prismaAny.payroll_records.findFirst({ where: { id: payrollRecordId, companyId } });
    if (!record) throw new NotFoundException('Liquidación de nómina no encontrada');
    await prismaAny.payrollAttachment.create({
      data: {
        companyId,
        payrollRecordId,
        fileName: dto.fileName.trim(),
        fileUrl: dto.fileUrl.trim(),
        mimeType: dto.mimeType?.trim() || null,
        category: dto.category?.trim() || null,
        notes: dto.notes?.trim() || null,
        sizeBytes: dto.sizeBytes ?? null,
        uploadedById: userId,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_ATTACHMENT_ADDED',
        resource: 'payroll',
        resourceId: payrollRecordId,
        after: { fileName: dto.fileName, fileUrl: dto.fileUrl, category: dto.category ?? null } as any,
      },
    });
    return this.getRecordAttachments(companyId, payrollRecordId);
  }

  async getRecordAuditTrail(companyId: string, payrollRecordId: string) {
    const prismaAny = this.prisma as any;
    const record = await prismaAny.payroll_records.findFirst({ where: { id: payrollRecordId, companyId } });
    if (!record) throw new NotFoundException('Liquidación de nómina no encontrada');
    const rows = await this.prisma.$queryRawUnsafe<PayrollAuditTrailRow[]>(
      `
        SELECT
          al."id",
          al."action",
          al."resource",
          al."resourceId",
          al."createdAt",
          al."userId",
          TRIM(COALESCE(u."firstName",'') || ' ' || COALESCE(u."lastName",'')) AS "userName",
          al."before",
          al."after"
        FROM "audit_logs" al
        LEFT JOIN "users" u ON u."id" = al."userId"
        WHERE al."companyId" = $1
          AND al."resource" IN ('payroll', 'payroll_batch', 'payroll_period')
          AND (
            al."resourceId" = $2
            OR (al."after"->>'payrollRecordId') = $2
          )
        ORDER BY al."createdAt" DESC
      `,
      companyId,
      payrollRecordId,
    );
    return rows.map((row) => ({
      ...row,
      userName: row.userName?.trim() || null,
    }));
  }

  async reversePayroll(companyId: string, payrollRecordId: string, dto: ReversePayrollDto, userId: string) {
    const record = await this.findPayrollRecord(companyId, payrollRecordId);
    if (record.status !== 'ACCEPTED') {
      throw new BadRequestException('Solo las nóminas aceptadas admiten reverso controlado');
    }
    await this.assertPayrollEnterpriseAction(companyId, userId, (record as any).branchId ?? null, 'REVERSE_PAYROLL', {
      payrollTypeConfigId: (record as any).payrollTypeConfigId ?? null,
    });
    const reversal = await this.createNotaAjuste(
      companyId,
      payrollRecordId,
      {
        tipoAjuste: dto.tipoAjuste,
        notes: dto.notes ?? `Reverso controlado desde gobierno de nómina (${dto.tipoAjuste})`,
      },
      userId,
    );
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_CONTROLLED_REVERSAL',
        resource: 'payroll',
        resourceId: payrollRecordId,
        after: { tipoAjuste: dto.tipoAjuste, generatedPayrollRecordId: reversal?.nota?.id ?? null } as any,
      },
    });
    return reversal;
  }

  private async applyNoveltyLifecycleEffects(companyId: string, novelty: CreatePayrollNoveltyDto | UpdatePayrollNoveltyDto) {
    if (!novelty.employeeId && !(novelty as any).employeeId) return;
    const employeeId = (novelty as any).employeeId;
    if (!employeeId) return;
    const employee = await this.prisma.employees.findFirst({ where: { id: employeeId, companyId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Empleado no encontrado para la novedad');

    if (novelty.type === 'SALARY_CHANGE' && novelty.salaryTo !== undefined && novelty.salaryTo !== null) {
      await this.prisma.employees.update({
        where: { id: employeeId },
        data: { baseSalary: this.safeNum(novelty.salaryTo) as any },
      });
      await this.createEmploymentEvent(companyId, employeeId, {
        branchId: employee.branchId ?? null,
        eventType: 'SALARY_CHANGE',
        effectiveDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : new Date(),
        description: novelty.description ?? 'Cambio salarial desde novedad',
        payload: { salaryFrom: novelty.salaryFrom ?? Number(employee.baseSalary), salaryTo: novelty.salaryTo },
      });
    }

    if (novelty.type === 'ADMISSION') {
      await (this.prisma.employees as any).update({
        where: { id: employeeId },
        data: {
          hireDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : employee.hireDate,
          isActive: true,
          terminationDate: null,
        },
      });
      const activeContract = await this.getActiveContract(companyId, employeeId);
      if (!activeContract) {
        const prismaAny = this.prisma as any;
        await prismaAny.payrollContractHistory.create({
          data: {
            companyId,
            employeeId,
            branchId: employee.branchId ?? null,
            payrollPolicyId: (employee as any).payrollPolicyId ?? null,
            payrollTypeConfigId: (employee as any).payrollTypeConfigId ?? null,
            version: 1,
            contractType: employee.contractType,
            position: employee.position,
            baseSalary: employee.baseSalary,
            startDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : employee.hireDate,
            status: 'ACTIVE',
            changeReason: 'ADMISSION',
          },
        });
      }
      await this.createEmploymentEvent(companyId, employeeId, {
        branchId: employee.branchId ?? null,
        eventType: 'ADMISSION',
        effectiveDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : employee.hireDate,
        description: novelty.description ?? 'Ingreso del colaborador',
        payload: { source: 'novelty' },
      });
    }

    if (novelty.type === 'TERMINATION') {
      await (this.prisma.employees as any).update({
        where: { id: employeeId },
        data: {
          terminationDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : new Date(),
          isActive: false,
        },
      });
      const activeContract = await this.getActiveContract(companyId, employeeId);
      if (activeContract) {
        await (this.prisma as any).payrollContractHistory.update({
          where: { id: activeContract.id },
          data: {
            status: 'TERMINATED',
            endDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : new Date(),
            changeReason: 'TERMINATION',
          },
        });
      }
      await this.createEmploymentEvent(companyId, employeeId, {
        branchId: employee.branchId ?? null,
        eventType: 'TERMINATION',
        effectiveDate: novelty.effectiveDate ? new Date(novelty.effectiveDate) : new Date(),
        description: novelty.description ?? 'Retiro del colaborador',
        payload: { source: 'novelty' },
      });
    }
  }

  async findAllPayrollNovelties(
    companyId: string,
    filters: { period?: string; employeeId?: string; type?: string; status?: string; page?: number; limit?: number },
  ) {
    const prismaAny = this.prisma as any;
    const { period, employeeId, type, status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId };
    if (period) where.period = period;
    if (employeeId) where.employeeId = employeeId;
    if (type) where.type = type;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prismaAny.payrollNovelty.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, documentNumber: true, position: true } },
          branch: { select: { id: true, name: true } },
          payrollRecord: { select: { id: true, payrollNumber: true, period: true } },
        },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prismaAny.payrollNovelty.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createPayrollNovelty(companyId: string, dto: CreatePayrollNoveltyDto, userId: string) {
    const prismaAny = this.prisma as any;
    await this.findEmployee(companyId, dto.employeeId);
    await this.applyNoveltyLifecycleEffects(companyId, dto);
    const novelty = await prismaAny.payrollNovelty.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        branchId: dto.branchId ?? null,
        type: dto.type,
        status: 'PENDING',
        period: dto.period ?? null,
        effectiveDate: new Date(dto.effectiveDate),
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        hours: dto.hours ?? null,
        days: dto.days ?? null,
        quantity: dto.quantity ?? null,
        rate: dto.rate ?? null,
        amount: dto.amount ?? null,
        description: dto.description ?? null,
        notes: dto.notes ?? null,
        salaryFrom: dto.salaryFrom ?? null,
        salaryTo: dto.salaryTo ?? null,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll_novelty', resourceId: novelty.id, after: novelty as any },
    });
    return novelty;
  }

  async updatePayrollNovelty(companyId: string, id: string, dto: UpdatePayrollNoveltyDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.payrollNovelty.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Novedad de nómina no encontrada');
    const employeeId = dto.employeeId ?? existing.employeeId;
    if (employeeId) await this.findEmployee(companyId, employeeId);
    await this.applyNoveltyLifecycleEffects(companyId, { ...existing, ...dto, employeeId });
    const updated = await prismaAny.payrollNovelty.update({
      where: { id },
      data: {
        employeeId,
        branchId: dto.branchId === undefined ? existing.branchId : (dto.branchId ?? null),
        type: dto.type,
        status: dto.status ?? undefined,
        period: dto.period === undefined ? undefined : (dto.period ?? null),
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
        startDate: dto.startDate === undefined ? undefined : (dto.startDate ? new Date(dto.startDate) : null),
        endDate: dto.endDate === undefined ? undefined : (dto.endDate ? new Date(dto.endDate) : null),
        hours: dto.hours === undefined ? undefined : dto.hours,
        days: dto.days === undefined ? undefined : dto.days,
        quantity: dto.quantity === undefined ? undefined : dto.quantity,
        rate: dto.rate === undefined ? undefined : dto.rate,
        amount: dto.amount === undefined ? undefined : dto.amount,
        description: dto.description === undefined ? undefined : (dto.description ?? null),
        notes: dto.notes === undefined ? undefined : (dto.notes ?? null),
        salaryFrom: dto.salaryFrom === undefined ? undefined : dto.salaryFrom,
        salaryTo: dto.salaryTo === undefined ? undefined : dto.salaryTo,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'UPDATE', resource: 'payroll_novelty', resourceId: id, before: existing as any, after: updated as any },
    });
    return updated;
  }

  private async resolvePayrollNoveltyImpacts(
    companyId: string,
    employeeId: string,
    period: string,
  ): Promise<PayrollNoveltyResolution> {
    const prismaAny = this.prisma as any;
    const novelties = await prismaAny.payrollNovelty.findMany({
      where: {
        companyId,
        employeeId,
        status: 'PENDING',
        OR: [
          { period },
          { period: null, effectiveDate: { gte: new Date(`${period}-01T00:00:00.000Z`) } },
        ],
      },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    });

    const dto: Partial<CreatePayrollDto> = {};
    const noveltyLines: PayrollConceptResolvedLine[] = [];
    const noveltyIds = novelties.map((item: any) => item.id);

    for (const novelty of novelties) {
      const amount = this.safeNum(novelty.amount ?? 0);
      const hours = this.safeNum(novelty.hours ?? novelty.quantity ?? 0);
      const days = this.safeNum(novelty.days ?? novelty.quantity ?? 0);
      switch (novelty.type) {
        case 'OVERTIME':
          dto.overtimeHours = this.safeNum((dto.overtimeHours ?? 0) + hours, 2);
          break;
        case 'SURCHARGE':
          noveltyLines.push({
            code: 'RECARGO',
            name: novelty.description ?? 'Recargo',
            nature: 'EARNING',
            formulaType: 'FIXED_AMOUNT',
            quantity: hours || null,
            rate: novelty.rate ? this.safeNum(novelty.rate, 4) : null,
            amount,
            source: 'NOVELTY',
          });
          break;
        case 'SICK_LEAVE':
          dto.sickLeave = this.safeNum((dto.sickLeave ?? 0) + amount);
          dto.daysWorked = Math.max(0, Number(dto.daysWorked ?? 30) - Number(days || 0));
          break;
        case 'LICENSE':
          noveltyLines.push({
            code: 'LICENCIA',
            name: novelty.description ?? 'Licencia',
            nature: amount >= 0 ? 'EARNING' : 'DEDUCTION',
            formulaType: 'FIXED_AMOUNT',
            quantity: days || null,
            rate: novelty.rate ? this.safeNum(novelty.rate, 4) : null,
            amount: Math.abs(amount),
            source: 'NOVELTY',
          });
          if (amount <= 0) dto.daysWorked = Math.max(0, Number(dto.daysWorked ?? 30) - Number(days || 0));
          break;
        case 'VACATION':
          dto.vacationPay = this.safeNum((dto.vacationPay ?? 0) + amount);
          dto.daysWorked = Math.max(0, Number(dto.daysWorked ?? 30) - Number(days || 0));
          break;
        case 'LOAN':
          dto.loans = this.safeNum((dto.loans ?? 0) + amount);
          break;
        case 'GARNISHMENT':
          dto.otherDeductions = this.safeNum((dto.otherDeductions ?? 0) + amount);
          noveltyLines.push({
            code: 'EMBARGO',
            name: novelty.description ?? 'Embargo',
            nature: 'DEDUCTION',
            formulaType: 'FIXED_AMOUNT',
            quantity: null,
            rate: null,
            amount,
            source: 'NOVELTY',
          });
          break;
        case 'OTHER_EARNING':
          noveltyLines.push({
            code: 'NOVEDAD_DEV',
            name: novelty.description ?? 'Novedad devengada',
            nature: 'EARNING',
            formulaType: 'FIXED_AMOUNT',
            quantity: novelty.quantity ? this.safeNum(novelty.quantity, 2) : null,
            rate: novelty.rate ? this.safeNum(novelty.rate, 4) : null,
            amount,
            source: 'NOVELTY',
          });
          break;
        case 'OTHER_DEDUCTION':
          noveltyLines.push({
            code: 'NOVEDAD_DED',
            name: novelty.description ?? 'Novedad deducción',
            nature: 'DEDUCTION',
            formulaType: 'FIXED_AMOUNT',
            quantity: novelty.quantity ? this.safeNum(novelty.quantity, 2) : null,
            rate: novelty.rate ? this.safeNum(novelty.rate, 4) : null,
            amount,
            source: 'NOVELTY',
          });
          break;
        default:
          break;
      }
    }

    return { dto: dto as CreatePayrollDto, noveltyLines, noveltyIds };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Resolución de ubicación desde el catálogo DIVIPOLA
  //
  // Si el DTO trae cityCode (ej: '25473') → busca en municipalities, completa
  // automáticamente: city, departmentCode, country.
  // cityCode inválido → BadRequestException con mensaje orientativo.
  // Sin cityCode → conserva city/departmentCode/country tal como vengan en el DTO.
  // ─────────────────────────────────────────────────────────────────────────────
  private async resolveLocation(dto: Partial<CreateEmployeeDto>): Promise<{
    city?: string;
    cityCode?: string;
    departmentCode?: string;
    country?: string;
  }> {
    if (!dto.cityCode) {
      return {
        city:           dto.city,
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
      cityCode:       municipality.code,
      departmentCode: municipality.department.code,
      country:        municipality.department.country?.code ?? 'CO',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EMPLOYEES
  // ══════════════════════════════════════════════════════════════════════════

  async findAllEmployees(
    companyId: string,
    filters: { branchId?: string; search?: string; active?: boolean; page?: number; limit?: number },
  ) {
    const { branchId, search, active, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };
    if (branchId) where.branchId = branchId;
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
      this.prisma.employees.findMany({
        where,
        include: { branch: { select: { id: true, name: true, isMain: true } } },
        orderBy: { lastName: 'asc' }, skip, take: limit,
      }),
      this.prisma.employees.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findEmployee(companyId: string, id: string) {
    const prismaAny = this.prisma as any;
    const emp = await prismaAny.employees.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        payroll_records: { orderBy: { period: 'desc' }, take: 12 },
        payrollContracts: {
          orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
          include: {
            branch: { select: { id: true, name: true } },
            payrollPolicy: { select: { id: true, name: true } },
            payrollTypeConfig: { select: { id: true, name: true, category: true } },
          },
        },
        employmentEvents: {
          orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
          take: 30,
          include: { branch: { select: { id: true, name: true } } },
        },
      },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async getEmployeePortalSummary(companyId: string, employeeId: string, period?: string) {
    const prismaAny = this.prisma as any;
    const employee = await this.findEmployee(companyId, employeeId);
    const paymentWhere: any = { companyId, employeeId };
    if (period) paymentWhere.period = period;

    const [payments, requests] = await Promise.all([
      this.prisma.$queryRawUnsafe<PayrollPortalPaymentRow[]>(
        `
          SELECT
            pr."id",
            pr."period",
            pr."payDate",
            pr."status",
            pr."payrollNumber",
            pr."payrollType",
            pr."netPay",
            pr."totalEarnings",
            pr."totalDeductions",
            pr."totalEmployerCost"
          FROM "payroll_records" pr
          WHERE pr."companyId" = $1
            AND pr."employeeId" = $2
            ${period ? 'AND pr."period" = $3' : ''}
          ORDER BY pr."period" DESC, pr."payDate" DESC, pr."createdAt" DESC
          LIMIT 18
        `,
        ...(period ? [companyId, employeeId, period] : [companyId, employeeId]),
      ),
      prismaAny.payrollNovelty.findMany({
        where: {
          companyId,
          employeeId,
          type: { in: ['VACATION', 'LICENSE'] },
        },
        include: {
          payrollRecord: { select: { id: true, payrollNumber: true, period: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        take: 24,
      }),
    ]);

    const paymentHistory = payments.map((item) => ({
      ...item,
      payDate: item.payDate,
      netPay: this.safeNum(item.netPay),
      totalEarnings: this.safeNum(item.totalEarnings),
      totalDeductions: this.safeNum(item.totalDeductions),
      totalEmployerCost: this.safeNum(item.totalEmployerCost),
    }));

    const totalNetPaid = paymentHistory
      .filter((item) => item.status === 'ACCEPTED')
      .reduce((sum, item) => sum + this.safeNum(item.netPay), 0);

    return {
      employee: {
        id: (employee as any).id,
        firstName: (employee as any).firstName,
        lastName: (employee as any).lastName,
        documentNumber: (employee as any).documentNumber,
        documentType: (employee as any).documentType,
        position: (employee as any).position,
        email: (employee as any).email ?? null,
        phone: (employee as any).phone ?? null,
        hireDate: (employee as any).hireDate,
        contractType: (employee as any).contractType,
        baseSalary: this.safeNum((employee as any).baseSalary),
        branch: (employee as any).branch ?? null,
      },
      stats: {
        totalPayments: paymentHistory.length,
        acceptedPayments: paymentHistory.filter((item) => item.status === 'ACCEPTED').length,
        totalNetPaid: this.safeNum(totalNetPaid),
        pendingRequests: requests.filter((item: any) => item.status === 'PENDING').length,
      },
      paymentHistory,
      requests,
    };
  }

  async createEmployeePortalRequest(companyId: string, employeeId: string, dto: CreatePayrollEmployeeRequestDto, userId: string) {
    await this.findEmployee(companyId, employeeId);
    const payload: CreatePayrollNoveltyDto = {
      employeeId,
      type: dto.requestType === 'VACATION' ? 'VACATION' : 'LICENSE',
      period: dto.period ?? dto.startDate.slice(0, 7),
      effectiveDate: dto.startDate,
      startDate: dto.startDate,
      endDate: dto.endDate ?? dto.startDate,
      days: dto.days ?? undefined,
      amount: dto.amount ?? undefined,
      description: dto.description ?? `${dto.requestType === 'VACATION' ? 'Solicitud de vacaciones' : 'Solicitud de licencia'} desde portal`,
      notes: dto.notes ?? 'Solicitud creada desde portal de autoservicio',
    };
    await this.createPayrollNovelty(companyId, payload, userId);
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_PORTAL_REQUEST_CREATED',
        resource: 'employee',
        resourceId: employeeId,
        after: { requestType: dto.requestType, period: payload.period, startDate: dto.startDate, endDate: dto.endDate ?? dto.startDate } as any,
      },
    });
    return this.getEmployeePortalSummary(companyId, employeeId, dto.period ?? dto.startDate.slice(0, 7));
  }

  async createEmployee(companyId: string, dto: CreateEmployeeDto, userId: string) {
    const exists = await this.prisma.employees.findFirst({
      where: { companyId, documentNumber: dto.documentNumber, deletedAt: null },
    });
    if (exists) throw new ConflictException(`Employee with document ${dto.documentNumber} already exists`);

    const loc = await this.resolveLocation(dto);
    const resolvedBranchId = await this.resolveEmployeeBranchId(companyId, dto.branchId);

    const createData: any = {
      companyId,
      branchId:       resolvedBranchId,
      documentType:   dto.documentType,
      documentNumber: dto.documentNumber,
      firstName:      dto.firstName,
      lastName:       dto.lastName,
      email:          dto.email,
      phone:          dto.phone,
      position:       dto.position,
      baseSalary:     dto.baseSalary,
      contractType:   dto.contractType,
      hireDate:       (() => {
        if (!dto.hireDate) throw new BadRequestException('La fecha de ingreso es obligatoria');
        const d = new Date(dto.hireDate);
        if (isNaN(d.getTime())) throw new BadRequestException('La fecha de ingreso no es válida (formato esperado: YYYY-MM-DD)');
        return d;
      })(),
      city:           loc.city,
      cityCode:       loc.cityCode,
      departmentCode: loc.departmentCode,
      country:        loc.country ?? 'CO',
      bankAccount:    dto.bankAccount,
      bankName:       dto.bankName,
      bankCode:       dto.bankCode,
      payrollPolicyId: dto.payrollPolicyId ?? null,
      payrollTypeConfigId: dto.payrollTypeConfigId ?? null,
    };

    const employee = await this.prisma.employees.create({ data: createData });
    await this.createInitialContractHistory(companyId, employee, dto);
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'employee', resourceId: employee.id, after: dto as any },
    });
    return employee;
  }

  async updateEmployee(companyId: string, id: string, dto: UpdateEmployeeDto, userId: string) {
    const before = await this.findEmployee(companyId, id);
    const filteredData: any = {};

    for (const [key, value] of Object.entries(dto)) {
      if (value !== null && value !== undefined && value !== '') {
        filteredData[key] = value;
      }
    }
    const hasLocationData =
      dto.cityCode       !== undefined ||
      dto.city           !== undefined ||
      dto.departmentCode !== undefined ||
      dto.country        !== undefined;

    const data: any = { ...filteredData }; 
    delete data.contractEndDate;
    if (dto.hireDate) data.hireDate = new Date(dto.hireDate);

    if (hasLocationData) {
      const loc = await this.resolveLocation(dto);
      data.city           = loc.city;
      data.cityCode       = loc.cityCode;
      data.departmentCode = loc.departmentCode;
      data.country        = loc.country ?? 'CO';
    }

    
    data.branchId = await this.resolveEmployeeBranchId(companyId, dto.branchId ?? null);

    const salaryChanged = dto.baseSalary !== undefined && Number(dto.baseSalary) !== Number((before as any).baseSalary);
    const positionChanged = dto.position !== undefined && dto.position !== (before as any).position;
    const contractTypeChanged = dto.contractType !== undefined && dto.contractType !== (before as any).contractType;
    const branchChanged = data.branchId !== undefined && data.branchId !== ((before as any).branchId ?? null);
    const lifecycleChanged = salaryChanged || positionChanged || contractTypeChanged || branchChanged || !!dto.contractEndDate;

    const updated = await this.prisma.employees.update({ where: { id }, data });
    if (lifecycleChanged) {
      const prismaAny = this.prisma as any;
      const currentContract = await this.getActiveContract(companyId, id);
      const nextVersion = Number(currentContract?.version ?? 0) + 1;
      if (currentContract) {
        await prismaAny.payrollContractHistory.update({
          where: { id: currentContract.id },
          data: {
            status: 'SUPERSEDED',
            endDate: dto.hireDate ? new Date(dto.hireDate) : currentContract.endDate,
          },
        });
      }
      await prismaAny.payrollContractHistory.create({
        data: {
          companyId,
          employeeId: id,
          branchId: updated.branchId ?? null,
          payrollPolicyId: (updated as any).payrollPolicyId ?? null,
          payrollTypeConfigId: (updated as any).payrollTypeConfigId ?? null,
          version: nextVersion,
          contractType: updated.contractType,
          position: updated.position,
          baseSalary: updated.baseSalary,
          startDate: dto.hireDate ? new Date(dto.hireDate) : new Date(),
          endDate: dto.contractEndDate ? new Date(dto.contractEndDate) : null,
          status: 'ACTIVE',
          changeReason: salaryChanged ? 'SALARY_CHANGE' : positionChanged ? 'POSITION_CHANGE' : contractTypeChanged ? 'CONTRACT_CHANGE' : branchChanged ? 'BRANCH_CHANGE' : 'CONTRACT_UPDATE',
          notes: 'Actualización del ciclo de vida laboral',
        },
      });
      await this.createEmploymentEvent(companyId, id, {
        branchId: updated.branchId ?? null,
        eventType: salaryChanged ? 'SALARY_CHANGE' : positionChanged ? 'POSITION_CHANGE' : contractTypeChanged ? 'CONTRACT_CHANGE' : branchChanged ? 'BRANCH_CHANGE' : 'CONTRACT_UPDATE',
        effectiveDate: dto.hireDate ? new Date(dto.hireDate) : new Date(),
        description: 'Cambio contractual registrado sobre el empleado',
        payload: {
          before: {
            position: (before as any).position,
            contractType: (before as any).contractType,
            baseSalary: Number((before as any).baseSalary),
            branchId: (before as any).branchId ?? null,
          },
          after: {
            position: updated.position,
            contractType: updated.contractType,
            baseSalary: Number(updated.baseSalary),
            branchId: updated.branchId ?? null,
          },
        },
      });
    }
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

  async extendEmployeeContract(companyId: string, id: string, dto: ExtendPayrollContractDto, userId: string) {
    const employee = await this.findEmployee(companyId, id);
    const prismaAny = this.prisma as any;
    const activeContract = await this.getActiveContract(companyId, id);
    if (!activeContract) throw new NotFoundException('El empleado no tiene un contrato activo');
    const updated = await prismaAny.payrollContractHistory.update({
      where: { id: activeContract.id },
      data: {
        endDate: new Date(dto.newEndDate),
        changeReason: 'CONTRACT_EXTENSION',
        notes: dto.notes ?? activeContract.notes,
      },
    });
    await this.createEmploymentEvent(companyId, id, {
      branchId: (employee as any).branchId ?? null,
      eventType: 'CONTRACT_EXTENSION',
      effectiveDate: new Date(dto.newEndDate),
      description: dto.reason ?? 'Prórroga contractual',
      payload: { previousEndDate: activeContract.endDate, newEndDate: dto.newEndDate },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'EXTEND_CONTRACT', resource: 'employee_contract', resourceId: updated.id, after: updated as any },
    });
    return updated;
  }

  async changeEmployeeEmployment(companyId: string, id: string, dto: ChangePayrollEmploymentDto, userId: string) {
    const employee = await this.findEmployee(companyId, id);
    const payload: UpdateEmployeeDto = {
      position: dto.position,
      contractType: dto.contractType,
      baseSalary: dto.baseSalary,
      branchId: dto.branchId,
      hireDate: dto.effectiveDate,
      contractEndDate: dto.contractEndDate,
    };
    const updated = await this.updateEmployee(companyId, id, payload, userId);
    await this.createEmploymentEvent(companyId, id, {
      branchId: dto.branchId ?? (employee as any).branchId ?? null,
      eventType: 'EMPLOYMENT_CHANGE',
      effectiveDate: new Date(dto.effectiveDate),
      description: dto.reason ?? 'Cambio laboral registrado',
      payload: dto,
    });
    return updated;
  }

  async createFinalSettlement(companyId: string, employeeId: string, dto: CreateFinalSettlementDto, userId: string) {
    const employee = await this.findEmployee(companyId, employeeId);
    const terminationDate = dto.terminationDate ? new Date(dto.terminationDate) : new Date(dto.payDate);
    const payroll = await this.createPayroll(companyId, {
      employeeId,
      period: dto.period,
      payDate: dto.payDate,
      baseSalary: Number((employee as any).baseSalary),
      daysWorked: dto.daysWorked ?? 30,
      vacationPay: dto.vacationPay ?? 0,
      bonuses: dto.bonuses ?? 0,
      commissions: dto.commissions ?? 0,
      otherDeductions: dto.otherDeductions ?? 0,
      payrollCategory: 'FINAL_SETTLEMENT',
      notes: dto.notes ?? `Liquidación final del colaborador`,
      branchId: (employee as any).branchId ?? undefined,
      payrollPolicyId: (employee as any).payrollPolicyId ?? undefined,
      payrollTypeConfigId: (employee as any).payrollTypeConfigId ?? undefined,
    }, userId);

    await this.prisma.employees.update({
      where: { id: employeeId },
      data: { isActive: false, terminationDate },
    });
    const prismaAny = this.prisma as any;
    const activeContract = await this.getActiveContract(companyId, employeeId);
    if (activeContract) {
      await prismaAny.payrollContractHistory.update({
        where: { id: activeContract.id },
        data: { status: 'TERMINATED', endDate: terminationDate, changeReason: 'FINAL_SETTLEMENT' },
      });
    }
    await this.createEmploymentEvent(companyId, employeeId, {
      branchId: (employee as any).branchId ?? null,
      payrollRecordId: payroll.id,
      eventType: 'FINAL_SETTLEMENT',
      effectiveDate: terminationDate,
      description: dto.notes ?? 'Liquidación final generada',
      payload: { payrollRecordId: payroll.id, period: dto.period },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE_FINAL_SETTLEMENT', resource: 'employee', resourceId: employeeId, after: payroll as any },
    });
    return payroll;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAYROLL MASTERS
  // ══════════════════════════════════════════════════════════════════════════

  async createPayrollConcept(companyId: string, dto: CreatePayrollConceptDto, userId: string) {
    const prismaAny = this.prisma as any;
    if (dto.accountingAccountId) {
      const account = await (this.prisma as any).accountingAccount.findFirst({
        where: { id: dto.accountingAccountId, companyId, isActive: true },
        select: { id: true },
      });
      if (!account) throw new BadRequestException('La cuenta contable del concepto no pertenece a la empresa');
    }
    const concept = await prismaAny.payrollConcept.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description ?? null,
        nature: dto.nature,
        formulaType: dto.formulaType ?? 'MANUAL',
        formulaExpression: dto.formulaExpression ?? null,
        defaultAmount: dto.defaultAmount ?? null,
        defaultRate: dto.defaultRate ?? null,
        quantityDefault: dto.quantityDefault ?? null,
        accountingAccountId: dto.accountingAccountId ?? null,
        costCenter: dto.costCenter?.trim() || null,
        projectCode: dto.projectCode?.trim() || null,
        affectsSocialSecurity: dto.affectsSocialSecurity ?? false,
        affectsParafiscals: dto.affectsParafiscals ?? false,
        appliesByDefault: dto.appliesByDefault ?? false,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll_concept', resourceId: concept.id, after: concept as any },
    });
    return concept;
  }

  async updatePayrollConcept(companyId: string, id: string, dto: UpdatePayrollConceptDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.payrollConcept.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Concepto de nómina no encontrado');
    if (dto.accountingAccountId) {
      const account = await (this.prisma as any).accountingAccount.findFirst({
        where: { id: dto.accountingAccountId, companyId, isActive: true },
        select: { id: true },
      });
      if (!account) throw new BadRequestException('La cuenta contable del concepto no pertenece a la empresa');
    }
    const updated = await prismaAny.payrollConcept.update({
      where: { id },
      data: {
        branchId: dto.branchId === undefined ? existing.branchId : (dto.branchId ?? null),
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : (dto.description ?? null),
        nature: dto.nature,
        formulaType: dto.formulaType,
        formulaExpression: dto.formulaExpression === undefined ? undefined : (dto.formulaExpression ?? null),
        defaultAmount: dto.defaultAmount === undefined ? undefined : dto.defaultAmount,
        defaultRate: dto.defaultRate === undefined ? undefined : dto.defaultRate,
        quantityDefault: dto.quantityDefault === undefined ? undefined : dto.quantityDefault,
        accountingAccountId: dto.accountingAccountId === undefined ? undefined : (dto.accountingAccountId ?? null),
        costCenter: dto.costCenter === undefined ? undefined : (dto.costCenter?.trim() || null),
        projectCode: dto.projectCode === undefined ? undefined : (dto.projectCode?.trim() || null),
        affectsSocialSecurity: dto.affectsSocialSecurity,
        affectsParafiscals: dto.affectsParafiscals,
        appliesByDefault: dto.appliesByDefault,
        displayOrder: dto.displayOrder,
        isActive: dto.isActive,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'UPDATE', resource: 'payroll_concept', resourceId: id, before: existing as any, after: updated as any },
    });
    return updated;
  }

  async createPayrollCalendar(companyId: string, dto: CreatePayrollCalendarDto, userId: string) {
    const prismaAny = this.prisma as any;
    const calendar = await prismaAny.payrollCalendar.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        frequency: dto.frequency ?? 'MONTHLY',
        cutoffDay: dto.cutoffDay ?? null,
        paymentDay: dto.paymentDay ?? null,
        startDay: dto.startDay ?? null,
        endDay: dto.endDay ?? null,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll_calendar', resourceId: calendar.id, after: calendar as any },
    });
    return calendar;
  }

  async updatePayrollCalendar(companyId: string, id: string, dto: UpdatePayrollCalendarDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.payrollCalendar.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Calendario de nómina no encontrado');
    const updated = await prismaAny.payrollCalendar.update({
      where: { id },
      data: {
        branchId: dto.branchId === undefined ? existing.branchId : (dto.branchId ?? null),
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        name: dto.name?.trim(),
        frequency: dto.frequency,
        cutoffDay: dto.cutoffDay === undefined ? undefined : dto.cutoffDay,
        paymentDay: dto.paymentDay === undefined ? undefined : dto.paymentDay,
        startDay: dto.startDay === undefined ? undefined : dto.startDay,
        endDay: dto.endDay === undefined ? undefined : dto.endDay,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'UPDATE', resource: 'payroll_calendar', resourceId: id, before: existing as any, after: updated as any },
    });
    return updated;
  }

  async createPayrollPolicy(companyId: string, dto: CreatePayrollPolicyDto, userId: string) {
    const prismaAny = this.prisma as any;
    const policy = await prismaAny.payrollPolicy.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        name: dto.name.trim(),
        description: dto.description ?? null,
        applyAutoTransport: dto.applyAutoTransport ?? true,
        transportAllowanceAmount: dto.transportAllowanceAmount ?? 162000,
        transportCapMultiplier: dto.transportCapMultiplier ?? 2,
        minimumWageValue: dto.minimumWageValue ?? 1300000,
        healthEmployeeRate: dto.healthEmployeeRate ?? 0.04,
        pensionEmployeeRate: dto.pensionEmployeeRate ?? 0.04,
        healthEmployerRate: dto.healthEmployerRate ?? 0.085,
        pensionEmployerRate: dto.pensionEmployerRate ?? 0.12,
        arlRate: dto.arlRate ?? 0.00522,
        compensationFundRate: dto.compensationFundRate ?? 0.04,
        senaRate: dto.senaRate ?? 0.02,
        icbfRate: dto.icbfRate ?? 0.03,
        healthCapSmmlv: dto.healthCapSmmlv ?? 25,
        pensionCapSmmlv: dto.pensionCapSmmlv ?? 25,
        parafiscalCapSmmlv: dto.parafiscalCapSmmlv ?? 25,
        applySena: dto.applySena ?? true,
        applyIcbf: dto.applyIcbf ?? true,
        overtimeFactor: dto.overtimeFactor ?? 1.25,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll_policy', resourceId: policy.id, after: policy as any },
    });
    return policy;
  }

  async updatePayrollPolicy(companyId: string, id: string, dto: UpdatePayrollPolicyDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.payrollPolicy.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Política laboral no encontrada');
    const updated = await prismaAny.payrollPolicy.update({
      where: { id },
      data: {
        branchId: dto.branchId === undefined ? existing.branchId : (dto.branchId ?? null),
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : (dto.description ?? null),
        applyAutoTransport: dto.applyAutoTransport,
        transportAllowanceAmount: dto.transportAllowanceAmount === undefined ? undefined : dto.transportAllowanceAmount,
        transportCapMultiplier: dto.transportCapMultiplier === undefined ? undefined : dto.transportCapMultiplier,
        minimumWageValue: dto.minimumWageValue === undefined ? undefined : dto.minimumWageValue,
        healthEmployeeRate: dto.healthEmployeeRate === undefined ? undefined : dto.healthEmployeeRate,
        pensionEmployeeRate: dto.pensionEmployeeRate === undefined ? undefined : dto.pensionEmployeeRate,
        healthEmployerRate: dto.healthEmployerRate === undefined ? undefined : dto.healthEmployerRate,
        pensionEmployerRate: dto.pensionEmployerRate === undefined ? undefined : dto.pensionEmployerRate,
        arlRate: dto.arlRate === undefined ? undefined : dto.arlRate,
        compensationFundRate: dto.compensationFundRate === undefined ? undefined : dto.compensationFundRate,
        senaRate: dto.senaRate === undefined ? undefined : dto.senaRate,
        icbfRate: dto.icbfRate === undefined ? undefined : dto.icbfRate,
        healthCapSmmlv: dto.healthCapSmmlv === undefined ? undefined : dto.healthCapSmmlv,
        pensionCapSmmlv: dto.pensionCapSmmlv === undefined ? undefined : dto.pensionCapSmmlv,
        parafiscalCapSmmlv: dto.parafiscalCapSmmlv === undefined ? undefined : dto.parafiscalCapSmmlv,
        applySena: dto.applySena,
        applyIcbf: dto.applyIcbf,
        overtimeFactor: dto.overtimeFactor === undefined ? undefined : dto.overtimeFactor,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'UPDATE', resource: 'payroll_policy', resourceId: id, before: existing as any, after: updated as any },
    });
    return updated;
  }

  async createPayrollTypeConfig(companyId: string, dto: CreatePayrollTypeConfigDto, userId: string) {
    const prismaAny = this.prisma as any;
    const payrollType = await prismaAny.payrollTypeConfig.create({
      data: {
        companyId,
        branchId: dto.branchId ?? null,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        category: dto.category ?? 'ORDINARIA',
        description: dto.description ?? null,
        calendarId: dto.calendarId ?? null,
        policyId: dto.policyId ?? null,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll_type_config', resourceId: payrollType.id, after: payrollType as any },
    });
    return payrollType;
  }

  async updatePayrollTypeConfig(companyId: string, id: string, dto: UpdatePayrollTypeConfigDto, userId: string) {
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.payrollTypeConfig.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Tipo de nómina no encontrado');
    const updated = await prismaAny.payrollTypeConfig.update({
      where: { id },
      data: {
        branchId: dto.branchId === undefined ? existing.branchId : (dto.branchId ?? null),
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        name: dto.name?.trim(),
        category: dto.category,
        description: dto.description === undefined ? undefined : (dto.description ?? null),
        calendarId: dto.calendarId === undefined ? undefined : (dto.calendarId ?? null),
        policyId: dto.policyId === undefined ? undefined : (dto.policyId ?? null),
        isDefault: dto.isDefault,
        isActive: dto.isActive,
      },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'UPDATE', resource: 'payroll_type_config', resourceId: id, before: existing as any, after: updated as any },
    });
    return updated;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAYROLL RECORDS
  // ══════════════════════════════════════════════════════════════════════════

  async findAllPayroll(
    companyId: string,
    filters: { branchId?: string; period?: string; employeeId?: string; status?: string; page?: number; limit?: number },
  ) {
    const { branchId, period, employeeId, status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId };
    if (branchId)   where.branchId   = branchId;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await (this.prisma.payroll_records as any).findFirst({
      where: { id, companyId },
      include: {
        employees: true,
        invoice: true,
        conceptLines: true,
        novelties: true,
        payrollCalendar: true,
        payrollPolicy: true,
        payrollTypeConfig: true,
      },
    });
    if (!record) throw new NotFoundException('Payroll record not found');
    return record as any;
  }

  async createPayroll(companyId: string, dto: CreatePayrollDto, userId: string) {
    const employee = await this.findEmployee(companyId, dto.employeeId);
    if (!employee.isActive) throw new BadRequestException('Cannot create payroll for an inactive employee');
    const branchId = dto.branchId ?? (employee as any).branchId ?? null;
    await this.ensurePeriodIsOpen(companyId, dto.period, branchId);
    const noveltyImpact = await this.resolvePayrollNoveltyImpacts(companyId, dto.employeeId, dto.period);
    const effectiveDto: CreatePayrollDto = {
      ...dto,
      daysWorked: noveltyImpact.dto.daysWorked ?? dto.daysWorked,
      overtimeHours: this.safeNum((dto.overtimeHours ?? 0) + Number(noveltyImpact.dto.overtimeHours ?? 0), 2),
      vacationPay: this.safeNum((dto.vacationPay ?? 0) + Number(noveltyImpact.dto.vacationPay ?? 0)),
      sickLeave: this.safeNum((dto.sickLeave ?? 0) + Number(noveltyImpact.dto.sickLeave ?? 0)),
      loans: this.safeNum((dto.loans ?? 0) + Number(noveltyImpact.dto.loans ?? 0)),
      otherDeductions: this.safeNum((dto.otherDeductions ?? 0) + Number(noveltyImpact.dto.otherDeductions ?? 0)),
    };
    const payrollTypeConfig = await this.resolvePayrollTypeConfig(
      companyId,
      branchId,
      effectiveDto.payrollTypeConfigId ?? (employee as any).payrollTypeConfigId ?? null,
    );
    const payrollCalendar = await this.resolvePayrollCalendar(
      companyId,
      branchId,
      effectiveDto.payrollCalendarId ?? payrollTypeConfig?.calendarId ?? null,
    );
    const payrollPolicy = await this.resolvePayrollPolicy(
      companyId,
      branchId,
      effectiveDto.payrollPolicyId ?? (employee as any).payrollPolicyId ?? payrollTypeConfig?.policyId ?? null,
    );

    // Validar duplicado según tipo:
    // · NIE  → solo puede existir UNA por (companyId, employeeId, period)
    // · NIAE → puede haber múltiples ajustes en el mismo período (el unique en BD
    //          es por (companyId, employeeId, period, payrollType=NOMINA_AJUSTE),
    //          pero la DIAN permite varias notas siempre que cada una tenga su propio NIAE#)
    const payrollTypeForCheck = dto.cuneRef ? 'NOMINA_AJUSTE' : 'NOMINA_ELECTRONICA';
    if (payrollTypeForCheck === 'NOMINA_ELECTRONICA') {
      const existing = await this.prisma.payroll_records.findFirst({
        where: { companyId, employeeId: dto.employeeId, period: dto.period,
                 payrollType: 'NOMINA_ELECTRONICA' },
      });
      if (existing) {
        throw new ConflictException(
          `Ya existe una Nómina Electrónica (${existing.payrollNumber ?? existing.id}) ` +
          `para el período ${dto.period}. ` +
          `Si necesitas corregirla, crea una Nota de Ajuste (NIAE) desde el botón de la liquidación.`,
        );
      }
    }
    // Para NIAE: NO hay unique en BD por (companyId, employeeId, period) — solo @@index.
    // Múltiples NIAE por período están permitidas por la Resolución 000013 Art.17:
    //   · Reemplazar: encadenados N veces, cada uno referencia al predecesor ACCEPTED.
    //   · Eliminar: solo uno, bloqueado por la validación 3c en createNotaAjuste.
    // La unicidad del NIE se valida arriba (solo para NOMINA_ELECTRONICA).

    const conceptLines = [
      ...(await this.resolvePayrollConceptLines(companyId, effectiveDto, branchId, payrollPolicy)),
      ...noveltyImpact.noveltyLines,
    ];
    const calc = this.calculatePayroll(effectiveDto, payrollPolicy, conceptLines);

    const lastRecord = await this.prisma.payroll_records.findFirst({
      where: { companyId, payrollNumber: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const lastSeq       = lastRecord?.payrollNumber
      ? parseInt(lastRecord.payrollNumber.replace(/\D/g, ''), 10)
      : NOMINA_SEQUENCE_START - 1;
    const nextSeq       = lastSeq + 1;
    // Para NIAE el prefijo es NIAE (Resolución 000013), para NIE es NIE
    const prefijoPay    = dto.cuneRef ? 'NIAE' : 'NIE';
    const payrollNumber = `${prefijoPay}${nextSeq}`;

    let record: any;
    try {
    record = await (this.prisma.payroll_records as any).create({
      data: {
        companyId,
        branchId:           branchId ?? undefined,
        employeeId:         effectiveDto.employeeId,
        period:             effectiveDto.period,
        payDate:            new Date(effectiveDto.payDate),
        status:             'DRAFT',
        payrollNumber,
        payrollCalendarId:  payrollCalendar?.id ?? null,
        payrollPolicyId:    payrollPolicy?.id ?? null,
        payrollTypeConfigId: payrollTypeConfig?.id ?? null,
        payrollCategory:    effectiveDto.payrollCategory ?? payrollTypeConfig?.category ?? 'ORDINARIA',
        configSnapshot: {
          branchId,
          payrollCalendarId: payrollCalendar?.id ?? null,
          payrollCalendarName: payrollCalendar?.name ?? null,
          payrollPolicyId: payrollPolicy?.id ?? null,
          payrollPolicyName: payrollPolicy?.name ?? null,
          payrollTypeConfigId: payrollTypeConfig?.id ?? null,
          payrollTypeName: payrollTypeConfig?.name ?? null,
          payrollCategory: effectiveDto.payrollCategory ?? payrollTypeConfig?.category ?? 'ORDINARIA',
          noveltyIds: noveltyImpact.noveltyIds,
          socialSecurityPolicy: {
            minimumWageValue: payrollPolicy?.minimumWageValue ?? 1300000,
            healthCapSmmlv: payrollPolicy?.healthCapSmmlv ?? 25,
            pensionCapSmmlv: payrollPolicy?.pensionCapSmmlv ?? 25,
            parafiscalCapSmmlv: payrollPolicy?.parafiscalCapSmmlv ?? 25,
          },
        },
        payrollType:        dto.cuneRef ? 'NOMINA_AJUSTE' : 'NOMINA_ELECTRONICA',
        // Campos Nota de Ajuste
        cuneRef:            dto.cuneRef            ?? null,
        payrollNumberRef:   dto.payrollNumberRef   ?? null,
        fechaGenRef:        dto.fechaGenRef         ?? null,
        tipoAjuste:         dto.tipoAjuste          ?? null,
        originalNieId:      dto.originalNieId       ?? null,
        predecessorId:      dto.predecessorId       ?? null,
        // Todos los campos numéricos pasan por safeNum para evitar Decimal(12,2) overflow
        baseSalary:         this.safeNum(effectiveDto.baseSalary),
        daysWorked:         Math.max(0, Math.min(31, Number(effectiveDto.daysWorked) || 0)),
        overtimeHours:      this.safeNum(effectiveDto.overtimeHours      ?? 0),
        bonuses:            this.safeNum(effectiveDto.bonuses            ?? 0),
        commissions:        this.safeNum(effectiveDto.commissions        ?? 0),
        transportAllowance: this.safeNum(calc.autoTransport),
        vacationPay:        this.safeNum(effectiveDto.vacationPay        ?? 0),
        sickLeave:          this.safeNum(effectiveDto.sickLeave          ?? 0),
        loans:              this.safeNum(effectiveDto.loans              ?? 0),
        otherDeductions:    this.safeNum(effectiveDto.otherDeductions    ?? 0),
        healthEmployee:     this.safeNum(calc.healthEmployee),
        pensionEmployee:    this.safeNum(calc.pensionEmployee),
        healthEmployer:     this.safeNum(calc.healthEmployer),
        pensionEmployer:    this.safeNum(calc.pensionEmployer),
        arl:                this.safeNum(calc.arl),
        compensationFund:   this.safeNum(calc.compensationFund),
        senaEmployer:       this.safeNum(calc.senaEmployer),
        icbfEmployer:       this.safeNum(calc.icbfEmployer),
        healthBase:         this.safeNum(calc.healthBase),
        pensionBase:        this.safeNum(calc.pensionBase),
        arlBase:            this.safeNum(calc.arlBase),
        compensationBase:   this.safeNum(calc.compensationBase),
        senaBase:           this.safeNum(calc.senaBase),
        icbfBase:           this.safeNum(calc.icbfBase),
        totalEarnings:      this.safeNum(calc.totalEarnings),
        totalDeductions:    this.safeNum(calc.totalDeductions),
        netPay:             this.safeNum(calc.netPay),
        totalEmployerCost:  this.safeNum(calc.totalEmployerCost),
        socialSecuritySnapshot: {
          warnings: calc.warnings,
          bases: {
            healthBase: this.safeNum(calc.healthBase),
            pensionBase: this.safeNum(calc.pensionBase),
            arlBase: this.safeNum(calc.arlBase),
            compensationBase: this.safeNum(calc.compensationBase),
            senaBase: this.safeNum(calc.senaBase),
            icbfBase: this.safeNum(calc.icbfBase),
          },
        },
        notes:              effectiveDto.notes,
        conceptLines:       conceptLines.length
          ? {
              create: conceptLines.map((line) => ({
                companyId,
                conceptId: line.conceptId ?? null,
                code: line.code,
                name: line.name,
                nature: line.nature,
                formulaType: line.formulaType as any,
                quantity: line.quantity ?? null,
                rate: line.rate ?? null,
                amount: this.safeNum(line.amount),
                source: line.source,
              })),
            }
          : undefined,
      } as any,
      include: {
        employees: { select: { id: true, firstName: true, lastName: true } },
        conceptLines: true,
      },
    });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Con el nuevo unique(companyId, employeeId, period, payrollType) esto solo ocurre
        // si ya existe una NIE o NIAE exactamente igual — no debería pasar con la validación previa
        throw new ConflictException(
          `Ya existe un documento del mismo tipo para ${dto.period}. ` +
          `Verifica que no estés duplicando una transmisión.`,
        );
      }
      throw e;
    }

    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll', resourceId: record.id,
              after: {
                period: effectiveDto.period,
                employeeId: effectiveDto.employeeId,
                netPay: calc.netPay,
                payrollNumber,
                payrollPolicyId: payrollPolicy?.id ?? null,
                payrollCalendarId: payrollCalendar?.id ?? null,
                payrollTypeConfigId: payrollTypeConfig?.id ?? null,
                conceptLines: conceptLines.length,
                noveltiesApplied: noveltyImpact.noveltyIds.length,
              } as any },
    });
    await this.syncAccrualBalanceFromPayroll(companyId, {
      ...record,
      employeeId: effectiveDto.employeeId,
      branchId,
      period: effectiveDto.period,
      baseSalary: effectiveDto.baseSalary,
      bonuses: effectiveDto.bonuses ?? 0,
      commissions: effectiveDto.commissions ?? 0,
      transportAllowance: calc.autoTransport,
    });
    if (noveltyImpact.noveltyIds.length) {
      await (this.prisma as any).payrollNovelty.updateMany({
        where: { id: { in: noveltyImpact.noveltyIds } },
        data: { status: 'APPLIED', payrollRecordId: record.id },
      });
    }
    return record;
  }

  async getPayrollOperationsMonitor(companyId: string, period?: string, branchId?: string) {
    const prismaAny = this.prisma as any;
    const jobWhere: any = { companyId, ...(branchId ? { branchId } : {}) };
    if (period) {
      jobWhere.OR = [
        { payload: { path: ['period'], equals: period } },
        { payrollRecord: { period } },
        { payrollBatch: { period } },
      ];
    }

    const [recent, pending, failed, success, batches] = await Promise.all([
      prismaAny.payrollDianProcessingJob.findMany({
        where: jobWhere,
        include: {
          branch: { select: { id: true, name: true } },
          payrollRecord: { select: { id: true, payrollNumber: true, period: true, status: true } },
          payrollBatch: { select: { id: true, name: true, period: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
      }),
      prismaAny.payrollDianProcessingJob.count({ where: { ...jobWhere, status: 'PENDING' } }),
      prismaAny.payrollDianProcessingJob.count({ where: { ...jobWhere, status: 'FAILED' } }),
      prismaAny.payrollDianProcessingJob.count({ where: { ...jobWhere, status: 'SUCCESS' } }),
      this.listPayrollBatches(companyId, period),
    ]);

    const batchIds = (batches ?? []).map((item: any) => item.id);
    const batchJobs = batchIds.length
      ? await prismaAny.payrollDianProcessingJob.findMany({
          where: { companyId, payrollBatchId: { in: batchIds } },
          orderBy: [{ createdAt: 'desc' }],
        })
      : [];

    return {
      queue: { pending, failed, success, recent },
      batches: (batches ?? []).map((batch: any) => {
        const jobs = batchJobs.filter((item: any) => item.payrollBatchId === batch.id);
        return {
          id: batch.id,
          name: batch.name,
          period: batch.period,
          status: batch.status,
          totalEmployees: batch.totalEmployees,
          generatedRecords: batch.generatedRecords,
          pendingJobs: jobs.filter((item: any) => item.status === 'PENDING').length,
          failedJobs: jobs.filter((item: any) => item.status === 'FAILED').length,
          successJobs: jobs.filter((item: any) => item.status === 'SUCCESS').length,
        };
      }),
    };
  }

  async queuePayrollReprocess(
    companyId: string,
    payrollRecordId: string,
    dto: { actionType: PayrollDianJobAction; notes?: string },
    userId: string,
  ) {
    const record = await this.findPayrollRecord(companyId, payrollRecordId);
    const job = await this.createPayrollDianJob({
      companyId,
      payrollRecordId,
      payrollBatchId: (record as any).payrollBatchId ?? null,
      branchId: (record as any).branchId ?? null,
      actionType: dto.actionType,
      triggeredById: userId,
      payload: { period: record.period, notes: dto.notes ?? null, source: 'manual-record' },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_DIAN_REPROCESS_QUEUED',
        resource: 'payroll',
        resourceId: payrollRecordId,
        after: { jobId: job.id, actionType: dto.actionType } as any,
      },
    });
    return job;
  }

  async bulkPayrollReprocess(
    companyId: string,
    branchId: string | undefined,
    dto: { actionType: PayrollDianJobAction; payrollBatchId?: string; payrollRecordIds?: string[] },
    userId: string,
  ) {
    const prismaAny = this.prisma as any;
    let records: Array<{ id: string; payrollBatchId?: string | null; branchId?: string | null; period: string; status: string; dianZipKey?: string | null; cuneHash?: string | null }> = [];

    if (dto.payrollRecordIds?.length) {
      records = await this.prisma.payroll_records.findMany({
        where: { id: { in: dto.payrollRecordIds }, companyId, ...(branchId ? { branchId } : {}) },
        select: { id: true, payrollBatchId: true, branchId: true, period: true, status: true, dianZipKey: true, cuneHash: true } as any,
      }) as any;
    } else if (dto.payrollBatchId) {
      records = await this.prisma.payroll_records.findMany({
        where: { companyId, payrollBatchId: dto.payrollBatchId, ...(branchId ? { branchId } : {}) },
        select: { id: true, payrollBatchId: true, branchId: true, period: true, status: true, dianZipKey: true, cuneHash: true } as any,
      }) as any;
    } else {
      records = await this.prisma.payroll_records.findMany({
        where: {
          companyId,
          ...(branchId ? { branchId } : {}),
          ...(dto.actionType === 'SUBMIT_DIAN'
            ? { status: 'DRAFT' as any }
            : { OR: [{ dianZipKey: { not: null } }, { cuneHash: { not: null } }] }),
        },
        select: { id: true, payrollBatchId: true, branchId: true, period: true, status: true, dianZipKey: true, cuneHash: true } as any,
        take: 50,
      }) as any;
    }

    const jobs = [];
    for (const record of records) {
      jobs.push(await this.createPayrollDianJob({
        companyId,
        payrollRecordId: record.id,
        payrollBatchId: record.payrollBatchId ?? null,
        branchId: record.branchId ?? branchId ?? null,
        actionType: dto.actionType,
        triggeredById: userId,
        payload: { period: record.period, source: 'bulk' },
      }));
    }

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_DIAN_BULK_REPROCESS_QUEUED',
        resource: 'payroll_batch',
        resourceId: dto.payrollBatchId ?? branchId ?? companyId,
        after: { queued: jobs.length, actionType: dto.actionType } as any,
      },
    });

    return { queued: jobs.length, jobs };
  }

  async processQueuedPayrollOperations(companyId: string, branchId: string | undefined, userId: string) {
    const prismaAny = this.prisma as any;
    const jobs = await prismaAny.payrollDianProcessingJob.findMany({
      where: { companyId, status: 'PENDING', ...(branchId ? { branchId } : {}) },
      orderBy: [{ createdAt: 'asc' }],
      take: 20,
    });

    const results: any[] = [];
    for (const job of jobs) {
      try {
        await prismaAny.payrollDianProcessingJob.update({
          where: { id: job.id },
          data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: new Date() },
        });
        let result: any;
        if (job.actionType === 'SUBMIT_DIAN') {
          result = await this.submitPayroll(companyId, job.payrollRecordId, userId, { skipJobRegistration: true });
          await this.completePayrollDianJob(job.id, {
            status: 'SUCCESS',
            responseCode: result?.record?.dianStatusCode ?? null,
            responseMessage: result?.record?.status ?? 'Envío ejecutado',
            result: { payrollRecordId: job.payrollRecordId, status: result?.record?.status, zipKey: result?.dian?.zipKey ?? null },
          });
        } else {
          result = await this.checkPayrollStatus(companyId, job.payrollRecordId, userId, { skipJobRegistration: true });
          await this.completePayrollDianJob(job.id, {
            status: 'SUCCESS',
            responseCode: result?.dian?.statusCode ?? null,
            responseMessage: result?.dian?.statusMsg ?? result?.dian?.statusDesc ?? 'Consulta ejecutada',
            result: { payrollRecordId: job.payrollRecordId, statusCode: result?.dian?.statusCode, isValid: result?.dian?.isValid },
          });
        }
        results.push({ jobId: job.id, status: 'SUCCESS', payrollRecordId: job.payrollRecordId });
      } catch (error: any) {
        await this.completePayrollDianJob(job.id, {
          status: 'FAILED',
          responseMessage: error?.message ?? 'No fue posible procesar el trabajo DIAN',
        });
        results.push({ jobId: job.id, status: 'FAILED', payrollRecordId: job.payrollRecordId, message: error?.message ?? 'Error' });
      }
    }

    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'PAYROLL_DIAN_QUEUE_PROCESSED',
        resource: 'payroll_batch',
        resourceId: branchId ?? companyId,
        after: { processed: results.length, results } as any,
      },
    });

    return { processed: results.length, results };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSMISIÓN DIAN
  // ══════════════════════════════════════════════════════════════════════════

  async submitPayroll(companyId: string, id: string, userId: string, options?: { skipJobRegistration?: boolean }) {
    const record = await this.findPayrollRecord(companyId, id);
    if (record.status !== 'DRAFT') throw new BadRequestException('Only DRAFT records can be submitted');
    const submitApproval = await this.getLatestApprovalRequest(companyId, { payrollRecordId: id, actionType: 'SUBMIT' });
    if (!submitApproval || submitApproval.status !== 'APPROVED' || submitApproval.consumedAt) {
      throw new BadRequestException('La liquidación requiere aprobación previa antes de enviarse a la DIAN.');
    }
    await this.assertPayrollEnterpriseAction(companyId, userId, (record as any).branchId ?? null, 'SUBMIT_DIAN', {
      requestedById: submitApproval.requestedById ?? null,
      approvedById: submitApproval.approvedById ?? null,
      payrollTypeConfigId: (record as any).payrollTypeConfigId ?? null,
    });
    const periodControl = await this.getPeriodControl(companyId, record.period, (record as any).branchId ?? null);
    if (periodControl?.status !== 'CLOSED') {
      throw new BadRequestException(`Debes cerrar el período ${record.period} antes de enviar la nómina a la DIAN.`);
    }
    const technicalJob = options?.skipJobRegistration ? null : await this.createPayrollDianJob({
      companyId,
      payrollRecordId: id,
      payrollBatchId: (record as any).payrollBatchId ?? null,
      branchId: (record as any).branchId ?? null,
      actionType: 'SUBMIT_DIAN',
      triggeredById: userId,
      status: 'PROCESSING',
      payload: { period: record.period, source: 'direct-submit' },
    });

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        nit: true, razonSocial: true, address: true, city: true,
        dianTestMode: true, dianCertificate: true, dianCertificateKey: true,
        nominaSoftwareId: true, nominaSoftwarePin: true, nominaTestSetId: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    // ── Credenciales DIAN Nómina: valores de la empresa con fallback a constantes ─
    const co = company as typeof company & {
      nominaSoftwareId?: string | null;
      nominaSoftwarePin?: string | null;
      nominaTestSetId?: string | null;
    };
    const nominaSoftwareId  = co.nominaSoftwareId  || NOMINA_SOFTWARE_ID_DEFAULT;
    const nominaSoftwarePin = co.nominaSoftwarePin || NOMINA_SOFTWARE_PIN_DEFAULT;
    const nominaTestSetId   = co.nominaTestSetId   || NOMINA_TEST_SET_ID_DEFAULT;

    const employee   = record.employees as any;
    const isTestMode = company.dianTestMode ?? true;
    const certPem    = this.normalizePem(company.dianCertificate ?? '');
    const keyPem     = this.normalizePem(company.dianCertificateKey ?? '');

    if (!certPem || certPem.length < 100) {
      throw new BadRequestException('La empresa no tiene configurado el certificado digital DIAN.');
    }
    if (!keyPem || keyPem.length < 100) {
      throw new BadRequestException('La empresa no tiene configurada la llave privada DIAN.');
    }
    this.logger.log(`[DIAN-NE] Cert OK (${certPem.length}) | Key OK (${keyPem.length}) | testMode=${isTestMode}`);

    // ── Validar que el período de la nómina no sea futuro ─────────────────────
    // La DIAN rechaza con NIE024 si FechaGen (hoy) es anterior a FechaLiquidacionFin.
    // Ejemplo: enviar en marzo una nómina de junio → rechazo garantizado.
    const [pYearCheck, pMonthCheck] = ((record as any).period as string)
      .split('-')
      .map(Number);

    const today = new Date();

    // Año y mes actual
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // JS: 0-11

    // Validación
    if (
      pYearCheck > currentYear ||
      (pYearCheck === currentYear && pMonthCheck > currentMonth)
    ) {
      throw new BadRequestException(
        `El período de nómina ${(record as any).period} es futuro respecto al mes actual (${currentYear}-${currentMonth}). ` +
        `La DIAN rechaza nóminas con período en el futuro (regla NIE024).`
      );
    }

    // FIX NIE024 (CUNE): FechaGen/HoraGen deben ser la fecha/hora ACTUAL de generacion
    // del documento, NO la fecha de pago (record.payDate).
    // La DIAN valida que el CUNE coincida con los datos del XML (FechaGen/HoraGen).
    // record.payDate se usa UNICAMENTE para el campo <FechaPago> dentro de <FechasPagos>.
    const nowColombia   = new Date(Date.now() - 5 * 60 * 60 * 1000); // UTC-5
    const issueDate     = nowColombia.toISOString().split('T')[0];
    const issueTimeRaw  = nowColombia.toISOString().split('T')[1].split('.')[0];
    const issueTime     = `${issueTimeRaw}-05:00`;

    const payrollNumber = (record as any).payrollNumber ?? `NIE${Date.now()}`;
    const isAjuste      = ((record as any).payrollType ?? 'NOMINA_ELECTRONICA') === 'NOMINA_AJUSTE';
    const isEliminar    = isAjuste && (record as any).tipoAjuste === 'Eliminar';

    // NIAE-Eliminar: según XML de referencia DIAN, el CUNE se calcula con valores en 0
    // (DocEmp=0, ValDev=0.00, ValDed=0.00, ValTol=0.00) — el documento no porta nómina
    const cuneHash = this.calcCune({
      payrollNumber,
      issueDate,
      issueTime,         // con GMT incluido: HH:MM:SS-05:00 (según Resolución 000013 num. 8.1.1.1)
      devengadosTotal:  isEliminar ? 0 : Number(record.totalEarnings),
      deduccionesTotal: isEliminar ? 0 : Number(record.totalDeductions),
      comprobanteTotal: isEliminar ? 0 : Number(record.netPay),
      employerNit:      company.nit,
      workerDoc:        isEliminar ? '0' : (employee as any).documentNumber,
      // IMPORTANTE: SoftwarePin en el CUNE es SIEMPRE el PIN numérico del software
      // registrado en la DIAN, tanto en habilitación como en producción.
      // El NOMINA_TEST_SET_ID (TestSetId UUID) solo se usa como parámetro del WS
      // en el método SendTestSetAsync — NO en la fórmula del CUNE.
      softwarePin:      nominaSoftwarePin,
      tipoXml:          isAjuste ? '103' : '102',
      ambiente:         isTestMode ? '2' : '1',
    });

    let xmlUnsigned: string;
    let xmlSigned:   string;
    let zipBuffer:   Buffer;
    let zipBase64:   string;
    let zipFileName: string;
    let xmlFileName: string;
    let dianResult:  DianNominaResult;

    try {
      const seqNum = payrollNumber.replace(/\D/g, '');

      this.logger.log(`[DIAN-NE] Paso 2: generando XML para ${payrollNumber}...`);
      xmlUnsigned = this.buildNominaXml({
        record: record as any, employee, company: company as any,
        cuneHash, payrollNumber, seqNum, issueDate, issueTime, isTestMode,
        cuneRef:          (record as any).cuneRef          ?? undefined,
        payrollNumberRef: (record as any).payrollNumberRef ?? undefined,
        fechaGenRef:      (record as any).fechaGenRef      ?? undefined,
        tipoAjuste:       (record as any).tipoAjuste       ?? 'Reemplazar',
      });

      this.logger.log(`[DIAN-NE] Paso 3: firmando XML...`);
      // FIX: reusar issueDate e issueTimeRaw ya calculados arriba (mismo instante que el CUNE)
      // No crear un nuevo Date.now() aquí — la SigningTime debe coincidir con FechaGen/HoraGen
      const issueDateTimeForSig = `${issueDate}T${issueTimeRaw}-05:00`;

      xmlSigned = this.signNominaXml(xmlUnsigned, certPem, keyPem, issueDateTimeForSig);
      this.logger.log(`[DIAN-NE] XML firmado: ${xmlSigned.length} chars`);

      this.logger.log(`[DIAN-NE] Paso 4: comprimiendo ZIP...`);
      const zipBase  = `${company.nit}${company.nit}${payrollNumber}`;
      zipFileName    = `${zipBase}.zip`;
      xmlFileName    = `${zipBase}.xml`;
      zipBuffer      = await this.createZip(xmlFileName, xmlSigned);
      zipBase64      = zipBuffer.toString('base64');

      const wsUrl = isTestMode ? NOMINA_WS_HAB : NOMINA_WS_PROD;
      this.logger.log(`[DIAN-NE] Paso 5: enviando → ${wsUrl}`);
      dianResult = await this.soapSendNomina({ zipFileName, zipBase64, wsUrl, certPem, keyPem, isTestMode, testSetId: nominaTestSetId });

    } catch (err: any) {
      const detail = err?.message || err?.code || String(err) || 'Error desconocido';
      this.logger.error(`[DIAN-NE] ❌ ${detail}`);
      this.logger.error(`[DIAN-NE] stack: ${err?.stack?.slice(0, 800)}`);

      await this.prisma.payroll_records.update({
        where: { id },
        data: { dianErrors: JSON.stringify([detail]), dianAttempts: { increment: 1 } } as any,
      }).catch(() => {});
      if (technicalJob) {
        await this.completePayrollDianJob(technicalJob.id, {
          status: 'FAILED',
          responseMessage: detail,
        });
      }

      throw new BadRequestException(`Error en transmisión DIAN: ${detail}`);
    }

    const isDirectResponse = dianResult.raw?.includes('<b:IsValid>true</b:IsValid>');
    const newStatus  = isDirectResponse  ? 'ACCEPTED'
                     : dianResult.zipKey ? 'SUBMITTED'
                     : 'DRAFT';
    const dianErrors = dianResult.errorMessages?.length
      ? JSON.stringify(dianResult.errorMessages)
      : null;

    const updated = await this.prisma.payroll_records.update({
      where: { id },
      data: {
        status:       newStatus,
        submittedAt:  new Date(),
        cune:         cuneHash,
        cuneHash,
        xmlSigned,
        dianZipKey:   dianResult.zipKey ?? null,
        dianErrors,
        dianAttempts: { increment: 1 },
      } as any,
      include: { employees: { select: { id: true, firstName: true, lastName: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId, userId, action: 'SUBMIT_DIAN', resource: 'payroll', resourceId: id,
        after: { cuneHash, zipKey: dianResult.zipKey, isTestMode, payrollNumber } as any,
      },
    });

    this.logger.log(`[DIAN-NE] ${payrollNumber} → status=${newStatus} | zipKey=${dianResult.zipKey}`);
    if (technicalJob) {
      await this.completePayrollDianJob(technicalJob.id, {
        status: 'SUCCESS',
        responseCode: updated.dianStatusCode ?? null,
        responseMessage: updated.dianStatusMsg ?? updated.status,
        result: { payrollRecordId: id, payrollNumber, status: updated.status, zipKey: dianResult.zipKey ?? null },
      });
    }

    // Propagar anulación al NIE raíz si esta NIAE-Eliminar fue aceptada
    await this.propagateAnulado(companyId, { ...updated, status: newStatus });
    await this.consumeApprovalRequest(submitApproval.id);

    const accountingSync = await this.accountingService.syncPayrollEntry(companyId, id);

    return {
      record: updated,
      dian: {
        success:         dianResult.success,
        zipKey:          dianResult.zipKey,
        cuneHash,
        payrollNumber,
        isTestMode,
        errors:          dianResult.errorMessages,
        rawSendResponse: dianResult.raw?.slice(0, 4000),
      },
      accountingSync,
    };
  }

  async checkPayrollStatus(companyId: string, id: string, userId?: string, options?: { skipJobRegistration?: boolean }) {
    const record  = await this.findPayrollRecord(companyId, id);
    const zipKey  = (record as any).dianZipKey;
    const cuneRef = (record as any).cuneHash;
    if (!zipKey && !cuneRef) throw new BadRequestException('Record has no ZipKey or CUNE to query');
    const technicalJob = options?.skipJobRegistration ? null : await this.createPayrollDianJob({
      companyId,
      payrollRecordId: id,
      payrollBatchId: (record as any).payrollBatchId ?? null,
      branchId: (record as any).branchId ?? null,
      actionType: 'QUERY_DIAN_STATUS',
      triggeredById: userId ?? null,
      status: 'PROCESSING',
      payload: { period: record.period, source: 'direct-query' },
    });

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { dianTestMode: true, dianCertificate: true, dianCertificateKey: true },
    });
    const wsUrl   = (company?.dianTestMode ?? true) ? NOMINA_WS_HAB : NOMINA_WS_PROD;
    const certPem = this.normalizePem(company?.dianCertificate ?? '');
    const keyPem  = this.normalizePem(company?.dianCertificateKey ?? '');

    let result: DianStatusResult;
    try {
      if (zipKey) {
        result = await this.soapGetStatusZip({ trackId: zipKey, wsUrl, certPem, keyPem });
      } else {
        result = await this.soapGetStatus({ trackId: cuneRef!, wsUrl, certPem, keyPem });
      }
    } catch (error: any) {
      if (technicalJob) {
        await this.completePayrollDianJob(technicalJob.id, {
          status: 'FAILED',
          responseMessage: error?.message ?? 'No fue posible consultar el estado DIAN',
        });
      }
      throw error;
    }

    this.logger.log(`[CHECK-STATUS] id=${id} statusCode=${result.statusCode} isValid=${result.isValid} errors=${result.errorMessages?.length ?? 0}`);
    if (result.errorMessages?.length) this.logger.warn(`[CHECK-STATUS] Errores DIAN: ${result.errorMessages.join(' | ')}`);

    if (result.statusCode) {
      const newStatus =
        result.isValid             ? 'ACCEPTED'  :
        result.statusCode === '99' ? 'REJECTED'  : undefined;

      const dianErrorsPersist = result.errorMessages?.length
        ? JSON.stringify(result.errorMessages)
        : null;  // null = sin errores → limpia el campo en BD

      const updatedCheck = await this.prisma.payroll_records.update({
        where: { id },
        data: {
          dianStatusCode: result.statusCode,
          dianStatusMsg:  result.statusDescription ?? result.statusMessage,
          dianErrors:     dianErrorsPersist,   // siempre actualiza (null limpia errores previos)
          ...(newStatus ? { status: newStatus } : {}),
        } as any,
      });
      // Propagar anulación si NIAE-Eliminar pasó a ACCEPTED
      if (newStatus === 'ACCEPTED') {
        await this.propagateAnulado(companyId, { ...updatedCheck, status: newStatus });
      }
    }
    if (technicalJob) {
      await this.completePayrollDianJob(technicalJob.id, {
        status: 'SUCCESS',
        responseCode: result.statusCode ?? null,
        responseMessage: result.statusDescription ?? result.statusMessage ?? 'Consulta ejecutada',
        result: { payrollRecordId: id, statusCode: result.statusCode, isValid: result.isValid },
      });
    }

    return {
      record: { id, payrollNumber: (record as any).payrollNumber, status: record.status },
      dian: {
        isValid:    result.isValid,
        statusCode: result.statusCode,
        statusDesc: result.statusDescription,
        statusMsg:  result.statusMessage,
        errors:     result.errorMessages,
      },
    };
  }

  async voidPayroll(companyId: string, id: string, reason: string, userId: string) {
    const record = await this.findPayrollRecord(companyId, id);
    if (record.status === 'VOIDED')   throw new BadRequestException('Record is already voided');
    if (record.status === 'ACCEPTED') throw new BadRequestException('Accepted records cannot be voided — create a Nómina de Ajuste');
    const voidApproval = await this.getLatestApprovalRequest(companyId, { payrollRecordId: id, actionType: 'VOID' });
    if (!voidApproval || voidApproval.status !== 'APPROVED' || voidApproval.consumedAt) {
      throw new BadRequestException('La anulación requiere aprobación previa de control interno.');
    }
    await this.assertPayrollEnterpriseAction(companyId, userId, (record as any).branchId ?? null, 'VOID_PAYROLL', {
      requestedById: voidApproval.requestedById ?? null,
      approvedById: voidApproval.approvedById ?? null,
      payrollTypeConfigId: (record as any).payrollTypeConfigId ?? null,
    });

    const updated = await this.prisma.payroll_records.update({
      where: { id },
      data: { status: 'VOIDED', notes: reason },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'VOID', resource: 'payroll', resourceId: id, after: { reason } as any },
    });
    await this.consumeApprovalRequest(voidApproval.id);
    return updated;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // NOTA DE AJUSTE (NominaIndividualDeAjuste)
  // Resolución 000013 de 2021, Artículo 17
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // NOTA DE AJUSTE (NominaIndividualDeAjuste) — Resolución 000013 Art.17
  //
  // Reglas de cadena:
  //  · Reemplazar: puede aplicarse sobre el NIE o sobre cualquier NIAE-Reemplazar
  //    ACCEPTED. Siempre toma como predecesor el ÚLTIMO documento válido de la cadena.
  //    Pueden existir múltiples NIAE-Reemplazar encadenadas.
  //  · Eliminar: solo puede aplicarse UNA VEZ sobre el último doc válido de la cadena.
  //    Después de un Eliminar ACCEPTED el período queda anulado (isAnulado=true en el NIE)
  //    y no se pueden crear más ajustes sobre él.
  // ══════════════════════════════════════════════════════════════════════════
  async createNotaAjuste(
    companyId: string,
    targetId:  string,   // ID del NIE o NIAE sobre el que se aplica el ajuste
    dto: {
      tipoAjuste: 'Reemplazar' | 'Eliminar';
      payDate?: string;
      baseSalary?: number;
      daysWorked?: number;
      overtimeHours?: number;
      bonuses?: number;
      commissions?: number;
      transportAllowance?: number;
      vacationPay?: number;
      sickLeave?: number;
      loans?: number;
      otherDeductions?: number;
      notes?: string;
    },
    userId: string,
  ) {
    // ── 1. Obtener el documento objetivo ──────────────────────────────────
    const target = await this.findPayrollRecord(companyId, targetId);

    // ── 2. Resolver el NIE raíz y el predecesor directo de la cadena ─────
    // El usuario puede clicar en cualquier doc de la cadena; nosotros
    // siempre tomamos el ÚLTIMO documento válido como predecesor.
    const isTargetNie  = (target as any).payrollType === 'NOMINA_ELECTRONICA';
    const originalNieId = isTargetNie
      ? target.id
      : ((target as any).originalNieId ?? target.id);

    // Buscar el último NIAE-Reemplazar ACCEPTED en la cadena de este NIE,
    // ordenado por createdAt DESC. Si no hay ninguno, el predecesor es el NIE.
    const lastAcceptedNiae = await this.prisma.payroll_records.findFirst({
      where: {
        companyId,
        originalNieId,
        payrollType: 'NOMINA_AJUSTE',
        tipoAjuste:  'Reemplazar',
        status:      'ACCEPTED',
      },
      orderBy: { createdAt: 'desc' },
    });

    // El predecesor directo es el último NIAE-Reemplazar ACCEPTED,
    // o el NIE raíz si no hay ninguno
    const predecessor = lastAcceptedNiae
      ?? await this.findPayrollRecord(companyId, originalNieId);

    // ── 3. Validaciones de cadena ─────────────────────────────────────────

    // 3a. Verificar que el NIE raíz exista y esté ACCEPTED
    const nieRoot = isTargetNie ? target : await this.findPayrollRecord(companyId, originalNieId);
    if (nieRoot.status !== 'ACCEPTED') {
      throw new BadRequestException(
        'Solo se pueden crear Notas de Ajuste sobre nóminas aceptadas por la DIAN.',
      );
    }

    // 3b. Verificar que el período NO esté ya anulado
    if ((nieRoot as any).isAnulado) {
      throw new BadRequestException(
        `El período ${(nieRoot as any).period} ya fue anulado mediante una Nota de Ajuste de tipo Eliminar. ` +
        `No se pueden crear más ajustes sobre un período anulado.`,
      );
    }

    // 3c. Para Eliminar: verificar que no exista ya un Eliminar en proceso (DRAFT/SUBMITTED) o ACCEPTED
    if (dto.tipoAjuste === 'Eliminar') {
      const existingEliminar = await this.prisma.payroll_records.findFirst({
        where: {
          companyId,
          originalNieId,
          payrollType: 'NOMINA_AJUSTE',
          tipoAjuste:  'Eliminar',
          status: { in: ['DRAFT', 'SUBMITTED', 'ACCEPTED'] },
        },
      });
      if (existingEliminar) {
        throw new BadRequestException(
          `Ya existe una Nota de Ajuste de tipo Eliminar ` +
          `(${existingEliminar.payrollNumber ?? existingEliminar.id}, estado: ${existingEliminar.status}) ` +
          `para este período. Solo puede existir un Eliminar por período.`,
        );
      }
    }

    // ── 4. Datos del predecesor para el XML ───────────────────────────────
    const predCune   = (predecessor as any).cuneHash ?? (predecessor as any).cune;
    const predNumber = (predecessor as any).payrollNumber;
    const predDate   = (predecessor as any).submittedAt
      ? new Date((predecessor as any).submittedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    if (!predCune || !predNumber) {
      throw new BadRequestException(
        'El documento predecesor no tiene CUNE o número de nómina. ' +
        'Solo se pueden ajustar documentos transmitidos y aceptados por la DIAN.',
      );
    }

    // ── 5. Construir el DTO de la NIAE ────────────────────────────────────
    const isEliminar = dto.tipoAjuste === 'Eliminar';

    const baseSalary     = this.safeNum(isEliminar ? predecessor.baseSalary : (dto.baseSalary ?? predecessor.baseSalary));
    const daysWorked     = Math.max(0, Math.min(31,
      Number(isEliminar ? (predecessor as any).daysWorked : (dto.daysWorked ?? (predecessor as any).daysWorked)) || 30));
    const overtimeHours  = isEliminar ? 0 : this.safeNum(dto.overtimeHours  ?? (predecessor as any).overtimeHours  ?? 0);
    const bonuses        = isEliminar ? 0 : this.safeNum(dto.bonuses        ?? (predecessor as any).bonuses        ?? 0);
    const commissions    = isEliminar ? 0 : this.safeNum(dto.commissions    ?? (predecessor as any).commissions    ?? 0);
    const transportAllowance = isEliminar ? 0
      : (dto.transportAllowance !== undefined ? this.safeNum(dto.transportAllowance) : undefined);
    const vacationPay    = isEliminar ? 0 : this.safeNum(dto.vacationPay    ?? (predecessor as any).vacationPay    ?? 0);
    const sickLeave      = isEliminar ? 0 : this.safeNum(dto.sickLeave      ?? (predecessor as any).sickLeave      ?? 0);
    const loans          = isEliminar ? 0 : this.safeNum(dto.loans          ?? (predecessor as any).loans          ?? 0);
    const otherDeductions = isEliminar ? 0 : this.safeNum(dto.otherDeductions ?? (predecessor as any).otherDeductions ?? 0);
    const payDate        = dto.payDate
      ?? new Date((predecessor as any).payDate).toISOString().split('T')[0];

    const adjustDto: CreatePayrollDto = {
      employeeId:        (nieRoot as any).employeeId,
      period:            (nieRoot as any).period,
      payDate,
      baseSalary,
      daysWorked,
      overtimeHours,
      bonuses,
      commissions,
      transportAllowance,
      vacationPay,
      sickLeave,
      loans,
      otherDeductions,
      notes: dto.notes ?? (predecessor as any).notes,
      // Campos NIAE — apuntan al PREDECESOR DIRECTO en la cadena
      cuneRef:           predCune,
      payrollNumberRef:  predNumber,
      fechaGenRef:       predDate,
      tipoAjuste:        dto.tipoAjuste,
      // Campos de cadena
      originalNieId,
      predecessorId:     predecessor.id,
    };

    const notaRecord = await this.createPayroll(companyId, adjustDto, userId);

    await this.prisma.auditLog.create({
      data: {
        companyId, userId,
        action:     'CREATE_NOTA_AJUSTE',
        resource:   'payroll',
        resourceId: notaRecord.id,
        after: {
          tipoAjuste:      dto.tipoAjuste,
          originalNieId,
          predecessorId:   predecessor.id,
          predecessorNum:  predNumber,
          predCune,
        } as any,
      },
    });

    return {
      nota:        notaRecord,
      predecessor: { id: predecessor.id, payrollNumber: predNumber, cuneHash: predCune, issueDate: predDate },
      originalNie: { id: originalNieId, period: (nieRoot as any).period },
      message:     `Nota de Ajuste (${dto.tipoAjuste}) creada. Predecesor: ${predNumber}. Revisa y transmite a la DIAN.`,
    };
  }

  // ── Hook post-transmisión: marcar NIE raíz como anulado cuando NIAE-Eliminar es ACCEPTED ─
  // Este método se llama desde submitPayroll después de actualizar el status a ACCEPTED.
  private async propagateAnulado(companyId: string, record: any) {
    if (
      record.payrollType !== 'NOMINA_AJUSTE' ||
      record.tipoAjuste  !== 'Eliminar'      ||
      record.status      !== 'ACCEPTED'
    ) return;

    const originalNieId = record.originalNieId;
    if (!originalNieId) return;

    // Marcar el NIE raíz como anulado
    await this.prisma.payroll_records.update({
      where: { id: originalNieId },
      data:  { isAnulado: true } as any,
    }).catch(() => {}); // silencioso — no romper el flujo principal

    this.logger.log(`[NIAE-Eliminar] NIE ${originalNieId} marcado como isAnulado=true`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESCARGA XML / ZIP
  // ══════════════════════════════════════════════════════════════════════════

  async downloadPayrollFiles(companyId: string, id: string) {
    const record = await this.findPayrollRecord(companyId, id);

    const xmlSigned = (record as any).xmlSigned as string | null;
    if (!xmlSigned) {
      throw new BadRequestException(
        'El XML firmado no está disponible para esta liquidación. ' +
        'Solo las nóminas que han sido transmitidas a la DIAN tienen XML descargable.',
      );
    }

    // Reconstruir el nombre de archivo igual que en submitPayroll:
    // {nit}{nit}{payrollNumber}
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { nit: true },
    });
    const nit           = company?.nit ?? 'SIN_NIT';
    const payrollNumber = (record as any).payrollNumber ?? `NIE${id.slice(0, 8)}`;
    const fileBase      = `${nit}${nit}${payrollNumber}`;
    const xmlFileName   = `${fileBase}.xml`;
    const zipFileName   = `${fileBase}.zip`;

    const zipBuffer = await this.createZip(xmlFileName, xmlSigned);

    return {
      xml: {
        filename:    xmlFileName,
        contentType: 'application/xml',
        base64:      Buffer.from(xmlSigned, 'utf8').toString('base64'),
      },
      zip: {
        filename:    zipFileName,
        contentType: 'application/zip',
        base64:      zipBuffer.toString('base64'),
      },
      payrollNumber,
      period: (record as any).period,
    };
  }

  async getPeriodSummary(companyId: string, period: string, branchId?: string) {
    const summaryWhere: any = { companyId, period, status: { not: 'VOIDED' } };
    if (branchId) summaryWhere.branchId = branchId;
    const records = await this.prisma.payroll_records.findMany({
      where: summaryWhere,
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
      totalHealthEmployer: records.reduce((s, r) => s + Number((r as any).healthEmployer ?? 0), 0),
      totalPensionEmployer: records.reduce((s, r) => s + Number((r as any).pensionEmployer ?? 0), 0),
      totalArl: records.reduce((s, r) => s + Number((r as any).arl ?? 0), 0),
      totalCompensationFund: records.reduce((s, r) => s + Number((r as any).compensationFund ?? 0), 0),
      totalSena: records.reduce((s, r) => s + Number((r as any).senaEmployer ?? 0), 0),
      totalIcbf: records.reduce((s, r) => s + Number((r as any).icbfEmployer ?? 0), 0),
      submitted:         records.filter((r) => r.status === 'SUBMITTED' || r.status === 'ACCEPTED').length,
      drafts:            records.filter((r) => r.status === 'DRAFT').length,
      records,
    };
  }

  async getSocialSecuritySummary(companyId: string, period: string, branchId?: string) {
    const where: any = { companyId, period, status: { not: 'VOIDED' } };
    if (branchId) where.branchId = branchId;
    const records = await this.prisma.payroll_records.findMany({
      where,
      include: {
        employees: { select: { id: true, firstName: true, lastName: true, documentNumber: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }],
    });

    const totals = {
      healthBase: 0,
      pensionBase: 0,
      arlBase: 0,
      compensationBase: 0,
      senaBase: 0,
      icbfBase: 0,
      healthEmployee: 0,
      pensionEmployee: 0,
      healthEmployer: 0,
      pensionEmployer: 0,
      arl: 0,
      compensationFund: 0,
      senaEmployer: 0,
      icbfEmployer: 0,
    };

    const byBranchMap = new Map<string, any>();
    const rows = records.map((record: any) => {
      totals.healthBase += Number(record.healthBase ?? 0);
      totals.pensionBase += Number(record.pensionBase ?? 0);
      totals.arlBase += Number(record.arlBase ?? 0);
      totals.compensationBase += Number(record.compensationBase ?? 0);
      totals.senaBase += Number(record.senaBase ?? 0);
      totals.icbfBase += Number(record.icbfBase ?? 0);
      totals.healthEmployee += Number(record.healthEmployee ?? 0);
      totals.pensionEmployee += Number(record.pensionEmployee ?? 0);
      totals.healthEmployer += Number(record.healthEmployer ?? 0);
      totals.pensionEmployer += Number(record.pensionEmployer ?? 0);
      totals.arl += Number(record.arl ?? 0);
      totals.compensationFund += Number(record.compensationFund ?? 0);
      totals.senaEmployer += Number(record.senaEmployer ?? 0);
      totals.icbfEmployer += Number(record.icbfEmployer ?? 0);

      const branchKey = record.branchId ?? 'company';
      const currentBranch = byBranchMap.get(branchKey) ?? {
        branchId: record.branchId ?? null,
        branchName: record.branch?.name ?? 'General',
        employees: 0,
        totalEmployerContribution: 0,
      };
      currentBranch.employees += 1;
      currentBranch.totalEmployerContribution +=
        Number(record.healthEmployer ?? 0) +
        Number(record.pensionEmployer ?? 0) +
        Number(record.arl ?? 0) +
        Number(record.compensationFund ?? 0) +
        Number(record.senaEmployer ?? 0) +
        Number(record.icbfEmployer ?? 0);
      byBranchMap.set(branchKey, currentBranch);

      return {
        payrollRecordId: record.id,
        payrollNumber: record.payrollNumber,
        employeeId: record.employeeId,
        employeeName: `${record.employees?.firstName ?? ''} ${record.employees?.lastName ?? ''}`.trim(),
        employeeDocument: record.employees?.documentNumber ?? null,
        branchId: record.branchId ?? null,
        branchName: record.branch?.name ?? 'General',
        healthBase: Number(record.healthBase ?? 0),
        pensionBase: Number(record.pensionBase ?? 0),
        arlBase: Number(record.arlBase ?? 0),
        compensationBase: Number(record.compensationBase ?? 0),
        senaBase: Number(record.senaBase ?? 0),
        icbfBase: Number(record.icbfBase ?? 0),
        healthEmployee: Number(record.healthEmployee ?? 0),
        pensionEmployee: Number(record.pensionEmployee ?? 0),
        healthEmployer: Number(record.healthEmployer ?? 0),
        pensionEmployer: Number(record.pensionEmployer ?? 0),
        arl: Number(record.arl ?? 0),
        compensationFund: Number(record.compensationFund ?? 0),
        senaEmployer: Number(record.senaEmployer ?? 0),
        icbfEmployer: Number(record.icbfEmployer ?? 0),
        warnings: Array.isArray(record.socialSecuritySnapshot?.warnings)
          ? record.socialSecuritySnapshot.warnings
          : [],
      };
    });

    return {
      period,
      totals,
      byBranch: Array.from(byBranchMap.values()),
      records: rows,
      pilaReadyRecords: rows.length,
    };
  }

  async getPayrollAccrualSummary(companyId: string, period: string, branchId?: string) {
    const prismaAny = this.prisma as any;
    const where: any = { companyId, period };
    if (branchId) where.branchId = branchId;
    const [balances, runs] = await Promise.all([
      prismaAny.payrollAccrualBalance.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, documentNumber: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }],
      }),
      prismaAny.payrollProvisionRun.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          journalEntry: { select: { id: true, number: true, date: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totals = balances.reduce((acc: any, item: any) => {
      acc.prima += Number(item.primaAccrued ?? 0);
      acc.cesantias += Number(item.cesantiasAccrued ?? 0);
      acc.interests += Number(item.interestsAccrued ?? 0);
      acc.vacations += Number(item.vacationAccrued ?? 0);
      acc.total += Number(item.totalAccrued ?? 0);
      return acc;
    }, { prima: 0, cesantias: 0, interests: 0, vacations: 0, total: 0 });

    return {
      period,
      totals,
      balances: balances.map((item: any) => ({
        id: item.id,
        employeeId: item.employeeId,
        employeeName: `${item.employee?.firstName ?? ''} ${item.employee?.lastName ?? ''}`.trim(),
        employeeDocument: item.employee?.documentNumber ?? null,
        branchName: item.branch?.name ?? 'General',
        primaAccrued: Number(item.primaAccrued ?? 0),
        cesantiasAccrued: Number(item.cesantiasAccrued ?? 0),
        interestsAccrued: Number(item.interestsAccrued ?? 0),
        vacationAccrued: Number(item.vacationAccrued ?? 0),
        totalAccrued: Number(item.totalAccrued ?? 0),
      })),
      runs: runs.map((item: any) => ({
        id: item.id,
        period: item.period,
        branchName: item.branch?.name ?? 'General',
        totalPrima: Number(item.totalPrima ?? 0),
        totalCesantias: Number(item.totalCesantias ?? 0),
        totalInterests: Number(item.totalInterests ?? 0),
        totalVacations: Number(item.totalVacations ?? 0),
        totalAmount: Number(item.totalAmount ?? 0),
        journalEntry: item.journalEntry ?? null,
        createdAt: item.createdAt,
      })),
    };
  }

  async runPayrollProvisions(companyId: string, dto: RunPayrollProvisionDto, userId: string) {
    const prismaAny = this.prisma as any;
    const branchId = dto.branchId ?? null;
    await this.assertPayrollEnterpriseAction(companyId, userId, branchId, 'RUN_PROVISIONS');
    const existing = await prismaAny.payrollProvisionRun.findFirst({
      where: { companyId, branchId, period: dto.period },
    });
    if (existing) {
      throw new ConflictException('Ya existe una corrida de provisiones para este período');
    }

    const balances = await prismaAny.payrollAccrualBalance.findMany({
      where: { companyId, period: dto.period, ...(branchId ? { branchId } : {}) },
    });
    if (!balances.length) {
      throw new BadRequestException('No hay acumulados de nómina para provisionar en este período');
    }

    const totals = balances.reduce((acc: any, item: any) => {
      acc.prima += Number(item.primaAccrued ?? 0);
      acc.cesantias += Number(item.cesantiasAccrued ?? 0);
      acc.interests += Number(item.interestsAccrued ?? 0);
      acc.vacations += Number(item.vacationAccrued ?? 0);
      return acc;
    }, { prima: 0, cesantias: 0, interests: 0, vacations: 0 });
    const totalAmount = totals.prima + totals.cesantias + totals.interests + totals.vacations;

    const accounts = await (this.accountingService as any).resolvePayrollAccounts(companyId);
    const journalEntry = await this.accountingService.createAutoPostedEntry(companyId, {
      date: `${dto.period}-28`,
      description: `Provisión nómina ${dto.period}`,
      reference: `PRV-NOM-${dto.period}`,
      sourceType: 'PAYROLL',
      sourceId: `payroll-provisions:${dto.period}:${branchId ?? 'company'}`,
      lines: [
        {
          accountId: accounts.expense.id,
          description: `Gasto provisiones nómina ${dto.period}`,
          debit: totalAmount,
          credit: 0,
          position: 1,
          branchId: branchId ?? undefined,
        },
        {
          accountId: accounts.contributions.id,
          description: `Pasivo provisiones nómina ${dto.period}`,
          debit: 0,
          credit: totalAmount,
          position: 2,
          branchId: branchId ?? undefined,
        },
      ],
    } as any);

    const run = await prismaAny.payrollProvisionRun.create({
      data: {
        companyId,
        branchId,
        period: dto.period,
        status: 'POSTED',
        totalPrima: this.safeNum(totals.prima),
        totalCesantias: this.safeNum(totals.cesantias),
        totalInterests: this.safeNum(totals.interests),
        totalVacations: this.safeNum(totals.vacations),
        totalAmount: this.safeNum(totalAmount),
        journalEntryId: journalEntry.id,
        notes: dto.notes ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'RUN_PAYROLL_PROVISIONS',
        resource: 'payroll_provisions',
        resourceId: run.id,
        after: run as any,
      },
    });
    return {
      ...run,
      journalEntry: {
        id: journalEntry.id,
        number: (journalEntry as any).number,
        status: (journalEntry as any).status,
      },
    };
  }

  async getSocialSecurityReconciliation(companyId: string, period: string, branchId?: string) {
    const summary = await this.getSocialSecuritySummary(companyId, period, branchId);
    const employerContributions =
      Number(summary.totals.healthEmployer) +
      Number(summary.totals.pensionEmployer) +
      Number(summary.totals.arl) +
      Number(summary.totals.compensationFund) +
      Number(summary.totals.senaEmployer) +
      Number(summary.totals.icbfEmployer);
    return {
      period,
      totals: summary.totals,
      reconciliation: {
        employeeDeductions:
          Number(summary.totals.healthEmployee) + Number(summary.totals.pensionEmployee),
        employerContributions,
        grandTotalToSettle:
          Number(summary.totals.healthEmployee) +
          Number(summary.totals.pensionEmployee) +
          employerContributions,
      },
      warnings: summary.records
        .filter((item) => item.warnings?.length)
        .map((item) => ({
          payrollRecordId: item.payrollRecordId,
          payrollNumber: item.payrollNumber,
          employeeName: item.employeeName,
          warnings: item.warnings,
        })),
    };
  }

  async getPilaExport(companyId: string, period: string, branchId?: string) {
    const summary = await this.getSocialSecuritySummary(companyId, period, branchId);
    const rows = summary.records.map((item: any) => ({
      payrollNumber: item.payrollNumber,
      employeeDocument: item.employeeDocument,
      employeeName: item.employeeName,
      branchName: item.branchName,
      healthBase: item.healthBase,
      pensionBase: item.pensionBase,
      arlBase: item.arlBase,
      compensationBase: item.compensationBase,
      senaBase: item.senaBase,
      icbfBase: item.icbfBase,
      healthEmployee: item.healthEmployee,
      pensionEmployee: item.pensionEmployee,
      healthEmployer: item.healthEmployer,
      pensionEmployer: item.pensionEmployer,
      arl: item.arl,
      compensationFund: item.compensationFund,
      senaEmployer: item.senaEmployer,
      icbfEmployer: item.icbfEmployer,
    }));
    const header = [
      'periodo',
      'nomina',
      'documento',
      'empleado',
      'sucursal',
      'base_salud',
      'base_pension',
      'base_arl',
      'base_caja',
      'base_sena',
      'base_icbf',
      'salud_empleado',
      'pension_empleado',
      'salud_empresa',
      'pension_empresa',
      'arl',
      'caja_compensacion',
      'sena',
      'icbf',
    ];
    const csv = [
      header.join(','),
      ...rows.map((row) => [
        period,
        row.payrollNumber ?? '',
        row.employeeDocument ?? '',
        `"${String(row.employeeName ?? '').replace(/"/g, '""')}"`,
        `"${String(row.branchName ?? '').replace(/"/g, '""')}"`,
        row.healthBase,
        row.pensionBase,
        row.arlBase,
        row.compensationBase,
        row.senaBase,
        row.icbfBase,
        row.healthEmployee,
        row.pensionEmployee,
        row.healthEmployer,
        row.pensionEmployer,
        row.arl,
        row.compensationFund,
        row.senaEmployer,
        row.icbfEmployer,
      ].join(',')),
    ].join('\n');

    return {
      period,
      generatedAt: new Date().toISOString(),
      rows,
      csv,
      filename: `pila_${period}.csv`,
    };
  }

  async getPayrollAnalyticsSummary(companyId: string, period?: string, branchId?: string) {
    const prismaAny = this.prisma as any;
    const currentPeriod = period || new Date().toISOString().slice(0, 7);
    const startDate = new Date(`${currentPeriod}-01T00:00:00.000Z`);
    const endDate = new Date(`${currentPeriod}-31T23:59:59.999Z`);

    const [records, employees, novelties, events, trendRecords, costCenterRows] = await Promise.all([
      this.prisma.payroll_records.findMany({
        where: { companyId, period: currentPeriod, ...(branchId ? { branchId } : {}) },
        include: {
          employees: { select: { id: true, position: true } },
          branch: { select: { id: true, name: true } },
        } as any,
      }),
      this.prisma.employees.findMany({
        where: { companyId, deletedAt: null, ...(branchId ? { branchId } : {}) },
        select: { id: true, isActive: true, branchId: true, branch: { select: { id: true, name: true } } as any },
      }),
      prismaAny.payrollNovelty.findMany({
        where: {
          companyId,
          ...(branchId ? { branchId } : {}),
          OR: [
            { period: currentPeriod },
            { effectiveDate: { gte: startDate, lte: endDate } },
          ],
        },
      }),
      prismaAny.payrollEmploymentEvent.findMany({
        where: {
          companyId,
          ...(branchId ? { branchId } : {}),
          effectiveDate: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.payroll_records.findMany({
        where: {
          companyId,
          period: { gte: this.shiftPeriod(currentPeriod, -5), lte: currentPeriod },
          ...(branchId ? { branchId } : {}),
        },
        select: {
          id: true,
          period: true,
          employeeId: true,
          totalEmployerCost: true,
          netPay: true,
          overtimeHours: true,
        },
      }),
      this.prisma.$queryRawUnsafe<Array<{ payrollRecordId: string; costCenter: string | null }>>(
        `
          SELECT
            pr."id" AS "payrollRecordId",
            COALESCE(ai."payload"->>'costCenter', 'Sin centro') AS "costCenter"
          FROM "payroll_records" pr
          LEFT JOIN LATERAL (
            SELECT "payload"
            FROM "accounting_integrations" ai
            WHERE ai."companyId" = pr."companyId"
              AND ai."resourceType" = 'payroll'
              AND ai."resourceId" = pr."id"
            ORDER BY ai."createdAt" DESC
            LIMIT 1
          ) ai ON TRUE
          WHERE pr."companyId" = $1
            AND pr."period" = $2
            ${branchId ? 'AND pr."branchId" = $3' : ''}
        `,
        ...(branchId ? [companyId, currentPeriod, branchId] : [companyId, currentPeriod]),
      ),
    ]);

    const totalLaborCost = records.reduce((sum, item: any) => sum + this.safeNum(item.totalEmployerCost), 0);
    const totalNetPay = records.reduce((sum, item: any) => sum + this.safeNum(item.netPay), 0);
    const overtimeHours = records.reduce((sum, item: any) => sum + this.safeNum(item.overtimeHours, 2), 0);
    const activeEmployees = employees.filter((item: any) => item.isActive).length;

    const overtimeNovelties = novelties.filter((item: any) => item.type === 'OVERTIME' || item.type === 'SURCHARGE');
    const absenceNovelties = novelties.filter((item: any) => ['SICK_LEAVE', 'LICENSE', 'VACATION'].includes(item.type));
    const absentDays = absenceNovelties.reduce((sum: number, item: any) => sum + this.safeNum(item.days ?? item.quantity, 2), 0);
    const admissions = events.filter((item: any) => item.eventType === 'ADMISSION').length;
    const terminations = events.filter((item: any) => ['TERMINATION', 'FINAL_SETTLEMENT'].includes(item.eventType)).length;
    const turnoverRate = activeEmployees ? (terminations / activeEmployees) * 100 : 0;

    const branchMap = new Map<string, { branchId?: string | null; branchName: string; totalLaborCost: number; totalNetPay: number; employees: Set<string> }>();
    const areaMap = new Map<string, { area: string; totalLaborCost: number; totalNetPay: number; employees: Set<string> }>();
    const centerMap = new Map<string, { costCenter: string; totalLaborCost: number; records: number }>();
    const costCenterByRecord = new Map(costCenterRows.map((item) => [item.payrollRecordId, item.costCenter || 'Sin centro']));

    for (const record of records as any[]) {
      const branchKey = record.branch?.id ?? 'general';
      const branchEntry = branchMap.get(branchKey) ?? {
        branchId: record.branch?.id ?? null,
        branchName: record.branch?.name ?? 'Sin sucursal',
        totalLaborCost: 0,
        totalNetPay: 0,
        employees: new Set<string>(),
      };
      branchEntry.totalLaborCost += this.safeNum(record.totalEmployerCost);
      branchEntry.totalNetPay += this.safeNum(record.netPay);
      branchEntry.employees.add(record.employeeId);
      branchMap.set(branchKey, branchEntry);

      const areaKey = record.employees?.position || 'Sin área';
      const areaEntry = areaMap.get(areaKey) ?? {
        area: areaKey,
        totalLaborCost: 0,
        totalNetPay: 0,
        employees: new Set<string>(),
      };
      areaEntry.totalLaborCost += this.safeNum(record.totalEmployerCost);
      areaEntry.totalNetPay += this.safeNum(record.netPay);
      areaEntry.employees.add(record.employeeId);
      areaMap.set(areaKey, areaEntry);

      const costCenter = costCenterByRecord.get(record.id) || 'Sin centro';
      const centerEntry = centerMap.get(costCenter) ?? { costCenter, totalLaborCost: 0, records: 0 };
      centerEntry.totalLaborCost += this.safeNum(record.totalEmployerCost);
      centerEntry.records += 1;
      centerMap.set(costCenter, centerEntry);
    }

    const trendMap = new Map<string, { period: string; totalLaborCost: number; totalNetPay: number; overtimeHours: number; absentDays: number; headcount: Set<string> }>();
    for (const record of trendRecords as any[]) {
      const trend = trendMap.get(record.period) ?? {
        period: record.period,
        totalLaborCost: 0,
        totalNetPay: 0,
        overtimeHours: 0,
        absentDays: 0,
        headcount: new Set<string>(),
      };
      trend.totalLaborCost += this.safeNum(record.totalEmployerCost);
      trend.totalNetPay += this.safeNum(record.netPay);
      trend.overtimeHours += this.safeNum(record.overtimeHours, 2);
      trend.headcount.add(record.employeeId);
      trendMap.set(record.period, trend);
    }
    for (const novelty of novelties as any[]) {
      const trend = trendMap.get(novelty.period || currentPeriod) ?? {
        period: novelty.period || currentPeriod,
        totalLaborCost: 0,
        totalNetPay: 0,
        overtimeHours: 0,
        absentDays: 0,
        headcount: new Set<string>(),
      };
      if (['SICK_LEAVE', 'LICENSE', 'VACATION'].includes(novelty.type)) {
        trend.absentDays += this.safeNum(novelty.days ?? novelty.quantity, 2);
      }
      trendMap.set(trend.period, trend);
    }

    return {
      period: currentPeriod,
      headline: {
        totalLaborCost: this.safeNum(totalLaborCost),
        totalNetPay: this.safeNum(totalNetPay),
        activeEmployees,
        averageEmployerCost: activeEmployees ? this.safeNum(totalLaborCost / activeEmployees) : 0,
        overtimeHours: this.safeNum(overtimeHours, 2),
        absentDays: this.safeNum(absentDays, 2),
        turnoverRate: this.safeNum(turnoverRate, 2),
        productivityIndex: totalLaborCost ? this.safeNum((totalNetPay / totalLaborCost) * 100, 2) : 0,
      },
      costByBranch: Array.from(branchMap.values()).map((item) => ({
        branchId: item.branchId,
        branchName: item.branchName,
        employees: item.employees.size,
        totalLaborCost: this.safeNum(item.totalLaborCost),
        totalNetPay: this.safeNum(item.totalNetPay),
      })).sort((a, b) => b.totalLaborCost - a.totalLaborCost),
      costByArea: Array.from(areaMap.values()).map((item) => ({
        area: item.area,
        employees: item.employees.size,
        totalLaborCost: this.safeNum(item.totalLaborCost),
        averageNetPay: item.employees.size ? this.safeNum(item.totalNetPay / item.employees.size) : 0,
      })).sort((a, b) => b.totalLaborCost - a.totalLaborCost),
      costByCostCenter: Array.from(centerMap.values()).map((item) => ({
        costCenter: item.costCenter,
        totalLaborCost: this.safeNum(item.totalLaborCost),
        records: item.records,
      })).sort((a, b) => b.totalLaborCost - a.totalLaborCost),
      overtime: {
        hours: this.safeNum(overtimeHours, 2),
        incidents: overtimeNovelties.length,
        employees: new Set(overtimeNovelties.map((item: any) => item.employeeId)).size,
      },
      absenteeism: {
        incidents: absenceNovelties.length,
        days: this.safeNum(absentDays, 2),
        sickLeaves: absenceNovelties.filter((item: any) => item.type === 'SICK_LEAVE').length,
        licenses: absenceNovelties.filter((item: any) => item.type === 'LICENSE').length,
        vacations: absenceNovelties.filter((item: any) => item.type === 'VACATION').length,
      },
      rotation: {
        admissions,
        terminations,
        netChange: admissions - terminations,
        turnoverRate: this.safeNum(turnoverRate, 2),
      },
      trends: Array.from(trendMap.values())
        .map((item) => ({
          period: item.period,
          totalLaborCost: this.safeNum(item.totalLaborCost),
          totalNetPay: this.safeNum(item.totalNetPay),
          overtimeHours: this.safeNum(item.overtimeHours, 2),
          absentDays: this.safeNum(item.absentDays, 2),
          headcount: item.headcount.size,
        }))
        .sort((a, b) => a.period.localeCompare(b.period)),
    };
  }

  private shiftPeriod(period: string, offset: number) {
    const [year, month] = period.split('-').map(Number);
    const shifted = new Date(year, month - 1 + offset, 1);
    return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUNE
  // ══════════════════════════════════════════════════════════════════════════

  calcCune(p: {
    payrollNumber:    string;
    issueDate:        string;
    issueTime:        string;   // debe incluir GMT p.ej. HH:MM:SS-05:00
    devengadosTotal:  number;
    deduccionesTotal: number;
    comprobanteTotal: number;
    employerNit:      string;
    workerDoc:        string;   // NumeroDocumento del TRABAJADOR (antes era softwareNit — bug)
    softwarePin:      string;
    tipoXml:          string;
    ambiente:         string;
  }): string {
    // Fórmula exacta según Resolución DIAN 000013 de 2021, numeral 8.1.1.1:
    // SHA‐384(NumNE + FecNE + HorNE + ValDev + ValDed + ValTolNE +
    //         NitNE + DocEmp + TipoXML + SoftwarePin + TipAmb)
    // Notas:
    //  - HorNE incluye GMT: HH:MM:SS-05:00  (NO se recorta la zona horaria)
    //  - DocEmp = NumeroDocumento del trabajador  (NO el NIT del proveedor de software)
    //  - TipoXML va ANTES que SoftwarePin  (el orden importa para el hash)
    const input =
      p.payrollNumber                       +
      p.issueDate                           +
      p.issueTime                           +   // con GMT incluido: HH:MM:SS-05:00
      Number(p.devengadosTotal).toFixed(2)  +
      Number(p.deduccionesTotal).toFixed(2) +
      Number(p.comprobanteTotal).toFixed(2) +
      p.employerNit                         +
      p.workerDoc                           +   // doc del trabajador, no NIT software
      p.tipoXml                             +   // TipoXML ANTES de SoftwarePin
      p.softwarePin                         +
      p.ambiente;

    return createHash('sha384').update(input, 'utf8').digest('hex');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XML — estructura basada en XML productivo DIAN real (nie0800197268250000001A.xml)
  // ══════════════════════════════════════════════════════════════════════════

  private buildNominaXml(p: {
    record: any; employee: any; company: any;
    cuneHash: string; payrollNumber: string; seqNum: string;
    issueDate: string; issueTime: string; isTestMode: boolean;
    cuneRef?: string;          // CUNE del doc original (NominaIndividual a ajustar)
    payrollNumberRef?: string; // Número del doc original  → NumeroPred
    fechaGenRef?: string;      // Fecha emisión del doc original → FechaGenPred
    tipoAjuste?: 'Reemplazar' | 'Eliminar';
  }): string {
    const { record, employee, company, cuneHash, payrollNumber, seqNum,
            issueDate, issueTime, isTestMode,
            cuneRef, payrollNumberRef, fechaGenRef,
            tipoAjuste = 'Reemplazar' } = p;
    const isAjuste = (record.payrollType ?? 'NOMINA_ELECTRONICA') === 'NOMINA_AJUSTE';

    const empNit    = company.nit ?? '902043550';
    const empDv     = this.calcDv(empNit);
    const empNombre = company.razonSocial ?? 'BECCASOFT SAS';
    const empDir    = company.address ?? 'CR 3A N 17 SUR 99';

    // Empleador: descomponer como XML productivo (Apellido1 Apellido2 Nombre1 OtrosNombres)
    const empParts     = empNombre.trim().split(/\s+/);
    const empApellido1 = empParts[0] ?? empNombre;
    const empApellido2 = empParts[1] ?? '';
    const empNombre1   = empParts[2] ?? empParts[0];
    const empOtros     = empParts.slice(3).join(' ');

    const prefijo   = isAjuste ? 'NIAE' : 'NIE';
    const numeroDoc = `${prefijo}${seqNum}`;
    const rootTag   = isAjuste ? 'NominaIndividualDeAjuste' : 'NominaIndividual';
    const nsMain    = isAjuste
      ? 'dian:gov:co:facturaelectronica:NominaIndividualDeAjuste'
      : 'dian:gov:co:facturaelectronica:NominaIndividual';
    const xsdFile   = isAjuste
      ? 'NominaIndividualDeAjusteElectronicaXSD.xsd'
      : 'NominaIndividualElectronicaXSD.xsd';
    const tipoXml   = isAjuste ? '103' : '102';
    const ambiente  = isTestMode ? '2' : '1';
    const qrBase    = isTestMode
      ? 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey='
      : 'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=';

    const swId  = company.nominaSoftwareId  || NOMINA_SOFTWARE_ID_DEFAULT;
    const swPin = company.nominaSoftwarePin || NOMINA_SOFTWARE_PIN_DEFAULT;
    const softwareSC = this.calcSoftwareSecurityCode(swId, swPin, numeroDoc);

    // Trabajador: PrimerApellido SegundoApellido PrimerNombre OtrosNombres
    const wLast    = employee.lastName.trim().split(/\s+/);
    const wFirst   = employee.firstName.trim().split(/\s+/);
    const wAp1     = wLast[0]  ?? '';
    const wAp2     = wLast[1]  ?? '';
    const wNom1    = wFirst[0] ?? '';
    const wOtros   = wFirst.slice(1).join(' ');
    const workerDocType = this.mapDocType(employee.documentType);
    const workerDoc     = employee.documentNumber;

    const hireDate = employee.hireDate
      ? new Date(employee.hireDate).toISOString().slice(0, 10)
      : issueDate;

    const [pYear, pMonth] = record.period.split('-').map(Number);
    const liquidInicio    = `${record.period}-01`;
    const lastDay         = new Date(pYear, pMonth, 0).getDate();
    const liquidFin       = `${record.period}-${String(lastDay).padStart(2, '0')}`;
    const payDateStr      = new Date(record.payDate).toISOString().slice(0, 10);
    // FIX NIE024 (CUNE): HoraGen debe incluir GMT para coincidir con lo usado en el CUNE.
    // issueTime ya viene con zona: HH:MM:SS-05:00 — la usamos directamente en HoraGen.
    // timeClean (sin zona) se conserva solo para el CodigoQR donde el formato es diferente.
    const timeClean       = issueTime.replace(/-05:00$/, '').replace(/[+-]\d{2}:\d{2}$/, '');

    // FIX NIE024: PeriodoNomina NO es el número del mes sino el código de frecuencia
    // de pago según tabla DIAN (Anexo técnico Nómina Electrónica):
    //   1=Semanal | 2=Decenal | 3=Catorcenal | 4=Quincenal | 5=Mensual | 6=Diario
    // El XML productivo de referencia confirma: liquidación feb-2025 → PeriodoNomina="5".
    // El bug era enviar String(pMonth) → "2" para febrero, violando la regla NIE024.
    const periodoNomina = '5'; // Mensual (código fijo para nóminas de periodicidad mensual)

    const baseSalary  = Number(record.baseSalary).toFixed(2);
    const transport   = Number(record.transportAllowance);
    const bonuses     = Number(record.bonuses);
    const commissions = Number(record.commissions);
    const vacacion    = Number(record.vacationPay);
    const overtime    = Number(record.overtimeHours);
    const sick        = Number(record.sickLeave);
    const loans       = Number(record.loans);
    const otherDed    = Number(record.otherDeductions);
    const healthEmp   = Number(record.healthEmployee);
    const pensionEmp  = Number(record.pensionEmployee);
    const totalEarn   = Number(record.totalEarnings).toFixed(2);
    const totalDed    = Number(record.totalDeductions).toFixed(2);
    const netPay      = Number(record.netPay).toFixed(2);

    // TipoNota: código según tabla 5.5.8 (1=Reemplazar, 2=Eliminar)
    const tipoNotaCod = isAjuste ? (tipoAjuste === 'Eliminar' ? '2' : '1') : '';

    const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                   'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const notas = `NOMINA MES DE ${meses[pMonth - 1]} DE ${pYear}`;

    // Banco del empleado si está configurado
    const bancoAttr = employee.bankName ? ` Banco="${employee.bankName}"` : '';

    // ── Ensamblaje XML correcto según Resolución 000013 ─────────────────────
    // Estructura NominaIndividualDeAjuste (tabla de campos, sección 3.2):
    //   Nivel raíz: UBLExtensions, TipoNota
    //   Dentro de Reemplazar|Eliminar: TODO lo demás (ReemplazandoPredecesor,
    //     Periodo, NumeroSecuenciaXML, LugarGeneracion, Proveedor, QR,
    //     InformacionGeneral, Notas, Empleador, Trabajador, Pago, Devengados...)

    const isEliminar  = isAjuste && tipoAjuste === 'Eliminar';

    // NIAE-Eliminar: DocEmp=0 y valores en cero (confirmado XML de referencia DIAN)
    const qrDocEmp = isEliminar ? '0'    : workerDoc;
    const qrValDev = isEliminar ? '0.00' : totalEarn;
    const qrValDed = isEliminar ? '0.00' : totalDed;
    const qrValTol = isEliminar ? '0.00' : netPay;
    const codigoQR =
      `NumNIE: ${numeroDoc}FecNIE: ${issueDate}HorNIE: ${timeClean}-05:00` +
      (isAjuste ? `TipoNota: ${tipoNotaCod}` : '') +
      `NitNIE: ${empNit}DocEmp: ${qrDocEmp}ValDev: ${qrValDev}ValDed: ${qrValDed}` +
      `ValTol: ${qrValTol}CUNE: ${cuneHash}QRCode: ${qrBase}${cuneHash}`;

    // ── Partes comunes (van dentro de Reemplazar o Eliminar) ──────────────────
    const xmlPeriodo =
      `<Periodo FechaIngreso="${hireDate}" FechaLiquidacionInicio="${liquidInicio}" FechaLiquidacionFin="${liquidFin}" TiempoLaborado="${record.daysWorked}" FechaGen="${issueDate}" />`;

    // CodigoTrabajador según XSD DIAN:
    //   · NIE              → presente (NumeroSecuenciaXML + Trabajador)
    //   · NIAE-Reemplazar  → presente (NumeroSecuenciaXML + Trabajador) — validado en XML productivo
    //   · NIAE-Eliminar    → AUSENTE en NumeroSecuenciaXML (XSD lo prohíbe → NIAE238/ZB01)
    const xmlNumeroSeq = isEliminar
      ? `<NumeroSecuenciaXML Prefijo="${prefijo}" Consecutivo="${seqNum}" Numero="${numeroDoc}" />`
      : `<NumeroSecuenciaXML CodigoTrabajador="${workerDoc}" Prefijo="${prefijo}" Consecutivo="${seqNum}" Numero="${numeroDoc}" />`;

    const xmlLugar =
      `<LugarGeneracionXML Pais="CO" DepartamentoEstado="11" MunicipioCiudad="11001" Idioma="es" />`;

    const xmlProveedor =
      `<ProveedorXML RazonSocial="${empNombre}" NIT="${empNit}" DV="${empDv}" SoftwareID="${swId}" SoftwareSC="${softwareSC}" />`;

    const xmlQR =
      `<CodigoQR>${codigoQR}</CodigoQR>`;

    const versionStr = isAjuste
      ? 'V1.0: Nota de Ajuste de Documento Soporte de Pago de Nómina Electrónica'
      : 'V1.0: Documento Soporte de Pago de Nómina Electrónica';
    // NIAE y NIE: InformacionGeneral requiere PeriodoNomina y TipoMoneda en ambos casos
    // (confirmado por errores DIAN: NIAE029, NIAE030, ZB01 — Attribute 'PeriodoNomina' must appear)
    const xmlInfoGen =
      `<InformacionGeneral Version="${versionStr}" Ambiente="${ambiente}" TipoXML="${tipoXml}" CUNE="${cuneHash}" EncripCUNE="CUNE-SHA384" FechaGen="${issueDate}" HoraGen="${issueTime}" PeriodoNomina="${periodoNomina}" TipoMoneda="COP" />`;

    // <Notas> solo para NIE — el XML productivo NIAE no lo incluye en Reemplazar
    const xmlNotas = isAjuste ? '' : `<Notas>${notas}</Notas>`;

    const xmlEmpleador =
      `<Empleador PrimerApellido="${empApellido1}"${empApellido2 ? ` SegundoApellido="${empApellido2}"` : ''} PrimerNombre="${empNombre1}"${empOtros ? ` OtrosNombres="${empOtros}"` : ''} NIT="${empNit}" DV="${empDv}" Pais="CO" DepartamentoEstado="11" MunicipioCiudad="11001" Direccion="${empDir}" />`;

    // Cuerpo de nómina: solo para NIE y para NIAE Reemplazar (no Eliminar)
    const xmlCuerpoNomina = isEliminar ? '' :
      `<Trabajador TipoTrabajador="01" SubTipoTrabajador="00" AltoRiesgoPension="false"` +
      ` TipoDocumento="${workerDocType}" NumeroDocumento="${workerDoc}"` +
      ` PrimerApellido="${wAp1}"${wAp2 ? ` SegundoApellido="${wAp2}"` : ''}` +
      ` PrimerNombre="${wNom1}"${wOtros ? ` OtrosNombres="${wOtros}"` : ''}` +
      ` LugarTrabajoPais="CO" LugarTrabajoDepartamentoEstado="11" LugarTrabajoMunicipioCiudad="11001"` +
      ` LugarTrabajoDireccion="${empDir}" SalarioIntegral="false"` +
      ` TipoContrato="${this.mapContractType(employee.contractType)}" Sueldo="${baseSalary}" CodigoTrabajador="${workerDoc}" />` +
      `<Pago Forma="1" Metodo="1"${bancoAttr} />` +
      `<FechasPagos><FechaPago>${payDateStr}</FechaPago></FechasPagos>` +
      `<Devengados>` +
        `<Basico DiasTrabajados="${record.daysWorked}" SueldoTrabajado="${baseSalary}" />` +
        (transport > 0   ? `<Transporte AuxilioTransporte="${transport.toFixed(2)}" />` : '') +
        // NIAE XSD no acepta BonificacionSalarial como atributo en Bonificaciones (ZB01)
        // — el XML de referencia DIAN de NIAE no incluye el elemento; solo NIE lo usa
        (bonuses > 0 && !isAjuste ? `<Bonificaciones BonificacionSalarial="${bonuses.toFixed(2)}" />` : '') +
        (commissions > 0 ? `<Comisiones Comision="${commissions.toFixed(2)}" />` : '') +
        (vacacion > 0    ? `<Vacaciones VacacionesComunes="${vacacion.toFixed(2)}" />` : '') +
        (overtime > 0    ? `<HEDs><HED Cantidad="${overtime.toFixed(2)}" Porcentaje="25.00" Pago="${(overtime * Number(record.baseSalary) / 240 * 1.25).toFixed(2)}" /></HEDs>` : '') +
      `</Devengados>` +
      `<Deducciones>` +
        `<Salud Porcentaje="4.00" Deduccion="${healthEmp.toFixed(2)}" />` +
        (pensionEmp > 0  ? `<FondoPension Porcentaje="4.00" Deduccion="${pensionEmp.toFixed(2)}" />` : '') +
        (sick > 0        ? `<Incapacidades><Incapacidad Cantidad="1" TipoIncapacidad="01" ValorIncapacidad="${sick.toFixed(2)}" /></Incapacidades>` : '') +
        (loans > 0       ? `<Embargo ValorEmbargo="${loans.toFixed(2)}" />` : '') +
        (otherDed > 0    ? `<OtraDeduccion NombreDeduccion="Otros descuentos" ValorDeduccion="${otherDed.toFixed(2)}" />` : '') +
      `</Deducciones>` +
      `<DevengadosTotal>${totalEarn}</DevengadosTotal>` +
      `<DeduccionesTotal>${totalDed}</DeduccionesTotal>` +
      `<ComprobanteTotal>${netPay}</ComprobanteTotal>`;

    // ── Ensamblar según tipo ──────────────────────────────────────────────────
    let xmlBody: string;

    if (!isAjuste) {
      // ── NominaIndividual (NIE) ────────────────────────────────────────────
      // Orden XSD: UBLExtensions → Periodo → NumeroSecuenciaXML → Lugar →
      //   Proveedor → QR → InfoGeneral → Notas → Empleador → Trabajador → ...
      xmlBody =
        `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><!-- NOMINA_SIGNATURE_PLACEHOLDER --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>` +
        xmlPeriodo + xmlNumeroSeq + xmlLugar + xmlProveedor + xmlQR +
        xmlInfoGen + xmlNotas + xmlEmpleador + xmlCuerpoNomina;

    } else if (isEliminar) {
      // ── NominaIndividualDeAjuste / Eliminar ───────────────────────────────
      // Resolución Art.17 último párrafo + tabla campos sección 3.2:
      //   UBLExtensions → TipoNota → Eliminar(EliminandoPredecesor, NumeroSeq,
      //     Lugar, Proveedor, QR, InfoGeneral, Notas, Empleador)
      // Sin Periodo ni datos de nómina.
      xmlBody =
        `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><!-- NOMINA_SIGNATURE_PLACEHOLDER --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>` +
        `<TipoNota>${tipoNotaCod}</TipoNota>` +
        `<Eliminar>` +
          `<EliminandoPredecesor NumeroPred="${payrollNumberRef ?? ''}" CUNEPred="${cuneRef ?? ''}" FechaGenPred="${fechaGenRef ?? issueDate}" />` +
          xmlNumeroSeq + xmlLugar + xmlProveedor + xmlQR +
          xmlInfoGen + xmlNotas + xmlEmpleador +
        `</Eliminar>`;

    } else {
      // ── NominaIndividualDeAjuste / Reemplazar ─────────────────────────────
      // Resolución Art.17 párrafos 4-6, 11 + tabla campos sección 3.2:
      //   UBLExtensions → TipoNota → Reemplazar(ReemplazandoPredecesor, Periodo,
      //     NumeroSeq, Lugar, Proveedor, QR, InfoGeneral, Notas, Empleador,
      //     Trabajador, Pago, FechasPagos, Devengados, Deducciones, ComprobanteTotal)
      xmlBody =
        `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><!-- NOMINA_SIGNATURE_PLACEHOLDER --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>` +
        `<TipoNota>${tipoNotaCod}</TipoNota>` +
        `<Reemplazar>` +
          `<ReemplazandoPredecesor NumeroPred="${payrollNumberRef ?? ''}" CUNEPred="${cuneRef ?? ''}" FechaGenPred="${fechaGenRef ?? issueDate}" />` +
          xmlPeriodo + xmlNumeroSeq + xmlLugar + xmlProveedor + xmlQR +
          xmlInfoGen + xmlNotas + xmlEmpleador + xmlCuerpoNomina +
        `</Reemplazar>`;
    }

    return `<?xml version="1.0" encoding="utf-8"?><${rootTag}` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
      ` xmlns="${nsMain}"` +
      ` xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` +
      ` xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"` +
      ` xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` +
      ` xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"` +
      ` xsi:schemaLocation="${nsMain} ${xsdFile}"` +
      ` xmlns:xs="http://www.w3.org/2001/XMLSchema-instance" SchemaLocation="">` +
      xmlBody +
      `</${rootTag}>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FIRMA XAdES-BES — IDs de nodos idénticos al XML productivo DIAN
  // KeyInfo Id="KeyInfo"
  // Reference Id="Reference-{UUID}"
  // Reference Id="ReferenceKeyInfo"
  // SignatureValue Id="sigvalue-xmldsig-{sigId}"
  // SignedProperties Id="SignedProperties-xmldsig-{sigId}"
  // ══════════════════════════════════════════════════════════════════════════

  private signNominaXml(xml: string, certPem: string, keyPem: string, issueDateTime: string): string {
    if (!certPem || !keyPem) {
      return xml.replace('<!-- NOMINA_SIGNATURE_PLACEHOLDER -->', '<!-- NO_CERT_AVAILABLE -->');
    }
    try {
      const { X509Certificate, randomUUID } = require('crypto');

      const keyType       = keyPem.includes('BEGIN RSA PRIVATE KEY') ? 'RSA PRIVATE KEY' : 'PRIVATE KEY';
      const effectiveCert = this.cleanPem(certPem, 'CERTIFICATE');
      const effectiveKey  = this.cleanPem(keyPem, keyType);

      const sigId = randomUUID();
      const refId = randomUUID();

      const certBase64 = effectiveCert
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '');
      const certDer    = Buffer.from(certBase64, 'base64');
      const certDigest = createHash('sha256').update(certDer).digest('base64');
      const cert       = new X509Certificate(effectiveCert);
      const issuerName = cert.issuer
        .split('\n').map((s: string) => s.trim()).filter(Boolean).reverse().join(',');
      const serialDec  = BigInt('0x' + cert.serialNumber).toString();

      const c14nAlgo  = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
      const sha256Uri = 'http://www.w3.org/2001/04/xmlenc#sha256';

      // ── Digest del documento con C14N real ───────────────────────────────
      // Usamos C14nCanonicalization directamente (xml-crypto interno)
      // El enveloped-signature transform equivale a: calcular C14N del XML sin la firma
      // Como aún no hay firma (solo el placeholder vacío), simplemente removemos el placeholder
      const { C14nCanonicalization } = require('xml-crypto');
      const { DOMParser }            = require('@xmldom/xmldom');

      const xmlForDoc = xml.replace('<!-- NOMINA_SIGNATURE_PLACEHOLDER -->', '');
      const docNode   = new DOMParser().parseFromString(xmlForDoc, 'text/xml');
      const c14nProc  = new C14nCanonicalization();
      const docC14n   = c14nProc.process(docNode.documentElement, {
        defaultNsForPrefix: {},
        ancestorNamespaces: [],
      });
      const docDigest = createHash('sha256').update(docC14n).digest('base64');

      const nsRoot = xml.includes('NominaIndividualDeAjuste')
        ? 'dian:gov:co:facturaelectronica:NominaIndividualDeAjuste'
        : 'dian:gov:co:facturaelectronica:NominaIndividual';

      // Namespaces del root NominaIndividual — se pasan como ancestorNamespaces
      // para que C14nCanonicalization los incluya igual que la DIAN al verificar
      const rootAncestorNs = [
        { prefix: '',        namespaceURI: nsRoot },
        { prefix: 'xsi',     namespaceURI: 'http://www.w3.org/2001/XMLSchema-instance' },
        { prefix: 'ds',      namespaceURI: 'http://www.w3.org/2000/09/xmldsig#' },
        { prefix: 'ext',     namespaceURI: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2' },
        { prefix: 'xades',   namespaceURI: 'http://uri.etsi.org/01903/v1.3.2#' },
        { prefix: 'xades141',namespaceURI: 'http://uri.etsi.org/01903/v1.4.1#' },
        { prefix: 'xs',      namespaceURI: 'http://www.w3.org/2001/XMLSchema-instance' },
      ];

      // c14nFragment: parsea el fragmento XML con los ns declarados en el root tag
      // y canonicaliza pasando los ancestorNamespaces del root NominaIndividual.
      // Esto produce exactamente el mismo resultado que la DIAN al canonicalizar
      // ese mismo nodo dentro del documento firmado.
      const c14nFragment = (fragmentXml: string, rootNs: string): string => {
        // Declarar todos los namespaces en el tag raíz para que xmldom pueda parsear
        const nsDecls =
          ` xmlns="${nsRoot}"` +
          ` xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` +
          ` xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"` +
          ` xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` +
          ` xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"` +
          ` xmlns:xs="http://www.w3.org/2001/XMLSchema-instance"` +
          ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;
        // Inyectar ns en el primer tag del fragmento
        const withNs = fragmentXml.replace(/^(<[^\s>]+)/, `$1${nsDecls}`);
        const fragDoc = new DOMParser().parseFromString(withNs, 'text/xml');
        const c14nProc2 = new C14nCanonicalization();
        return c14nProc2.process(fragDoc.documentElement, {
          defaultNsForPrefix: {},
          ancestorNamespaces:  rootAncestorNs,
        });
      };

      // KeyInfo Id="KeyInfo" (igual que XML productivo)
      const keyInfoXml =
        `<ds:KeyInfo Id="KeyInfo">` +
        `<ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data>` +
        `</ds:KeyInfo>`;

      // SignedProperties Id="SignedProperties-xmldsig-{sigId}" (igual que XML productivo)
      const signedPropsId  = `SignedProperties-xmldsig-${sigId}`;
      const signedPropsXml =
        `<xades:SignedProperties Id="${signedPropsId}">` +
        `<xades:SignedSignatureProperties>` +
        `<xades:SigningTime>${issueDateTime}</xades:SigningTime>` +
        `<xades:SigningCertificate><xades:Cert><xades:CertDigest>` +
        `<ds:DigestMethod Algorithm="${sha256Uri}" />` +
        `<ds:DigestValue>${certDigest}</ds:DigestValue>` +
        `</xades:CertDigest><xades:IssuerSerial>` +
        `<ds:X509IssuerName>${issuerName}</ds:X509IssuerName>` +
        `<ds:X509SerialNumber>${serialDec}</ds:X509SerialNumber>` +
        `</xades:IssuerSerial></xades:Cert></xades:SigningCertificate>` +
        `<xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId>` +
        `<xades:Identifier>https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf</xades:Identifier>` +
        `<xades:Description />` +
        `</xades:SigPolicyId><xades:SigPolicyHash>` +
        `<ds:DigestMethod Algorithm="${sha256Uri}" />` +
        `<ds:DigestValue>dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=</ds:DigestValue>` +
        `</xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier>` +
        `<xades:SignerRole><xades:ClaimedRoles>` +
        `<xades:ClaimedRole>supplier</xades:ClaimedRole>` +
        `</xades:ClaimedRoles></xades:SignerRole>` +
        `</xades:SignedSignatureProperties></xades:SignedProperties>`;

      const keyInfoWithNs = c14nFragment(keyInfoXml,     'ds:KeyInfo');
      const propsWithNs   = c14nFragment(signedPropsXml, 'xades:SignedProperties');

      const keyInfoDigest = createHash('sha256').update(Buffer.from(keyInfoWithNs, 'utf8')).digest('base64');
      const propsDigest   = createHash('sha256').update(Buffer.from(propsWithNs,   'utf8')).digest('base64');

      // SignedInfo con IDs del XML productivo
      const signedInfoContent =
        `<ds:CanonicalizationMethod Algorithm="${c14nAlgo}" />` +
        `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" />` +
        `<ds:Reference Id="Reference-${refId}" URI="">` +
        `<ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature" /></ds:Transforms>` +
        `<ds:DigestMethod Algorithm="${sha256Uri}" />` +
        `<ds:DigestValue>${docDigest}</ds:DigestValue></ds:Reference>` +
        `<ds:Reference Id="ReferenceKeyInfo" URI="#KeyInfo">` +
        `<ds:DigestMethod Algorithm="${sha256Uri}" />` +
        `<ds:DigestValue>${keyInfoDigest}</ds:DigestValue></ds:Reference>` +
        `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropsId}">` +
        `<ds:DigestMethod Algorithm="${sha256Uri}" />` +
        `<ds:DigestValue>${propsDigest}</ds:DigestValue></ds:Reference>`;

      const signedInfoXml  = `<ds:SignedInfo>${signedInfoContent}</ds:SignedInfo>`;
      const signedInfoC14n = c14nFragment(signedInfoXml, 'ds:SignedInfo');

      const signer   = createSign('RSA-SHA256');
      signer.update(signedInfoC14n, 'utf8');
      const sigValue = signer.sign(effectiveKey).toString('base64');

      // Bloque Signature con IDs del XML productivo
      const xadesObjId = randomUUID();
      const qpId       = randomUUID();
      const sigBlock =
        `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xmldsig-${sigId}">` +
        `${signedInfoXml}` +
        `<ds:SignatureValue Id="sigvalue-xmldsig-${sigId}">${sigValue}</ds:SignatureValue>` +
        `${keyInfoXml}` +
        `<ds:Object Id="XadesObjectId-${xadesObjId}">` +
        `<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="QualifyingProperties-${qpId}" Target="#xmldsig-${sigId}">` +
        `${signedPropsXml}` +
        `</xades:QualifyingProperties>` +
        `</ds:Object>` +
        `</ds:Signature>`;

      return xml.replace('<!-- NOMINA_SIGNATURE_PLACEHOLDER -->', sigBlock);

    } catch (err: any) {
      this.logger.error(`[SIGN-NE] Error firmando: ${err.message}`);
      throw new Error(`No se pudo firmar el XML de nómina: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOAP
  // ══════════════════════════════════════════════════════════════════════════

  private async soapSendNomina(p: {
    zipFileName: string; zipBase64: string; wsUrl: string;
    certPem: string; keyPem: string; isTestMode: boolean;
    testSetId?: string;
  }): Promise<DianNominaResult> {
    let body: string; let action: string;

    if (p.isTestMode) {
      action = 'SendTestSetAsync';
      const testSetId = p.testSetId || NOMINA_TEST_SET_ID_DEFAULT;
      body = `<wcf:SendTestSetAsync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile><wcf:testSetId>${testSetId}</wcf:testSetId></wcf:SendTestSetAsync>`;
    } else {
      action = 'SendNominaSync';
      body = `<wcf:SendNominaSync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile></wcf:SendNominaSync>`;
    }

    const raw    = await this.soapCall(p.wsUrl, body, action, p.certPem, p.keyPem);
    const zipKey = this.extractTag(raw, 'b:ZipKey') ?? this.extractTag(raw, 'ZipKey');
    const isValidDirect = this.extractTag(raw, 'b:IsValid');
    const statusCode    = this.extractTag(raw, 'b:StatusCode');
    const errors = [
      ...this.extractAllTags(raw, 'b:processedMessage'),
      ...this.extractAllTags(raw, 'b:StatusDescription').filter(s => s && s !== 'Procesado Correctamente'),
    ].filter(Boolean);

    this.logger.log(`[DIAN-NE SOAP] ${action} → zipKey=${zipKey} isValid=${isValidDirect} statusCode=${statusCode} errors=${errors.length}`);
    if (errors.length) this.logger.warn(`[DIAN-NE] Errors: ${errors.join(' | ')}`);

    return { success: (!!zipKey || isValidDirect === 'true') && errors.length === 0, zipKey, errorMessages: errors, raw };
  }

  private async soapGetStatusZip(p: { trackId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    const raw = await this.soapCall(p.wsUrl, `<wcf:GetStatusZip><wcf:trackId>${p.trackId}</wcf:trackId></wcf:GetStatusZip>`, 'GetStatusZip', p.certPem, p.keyPem);
    return this.parseStatusResp(raw);
  }

  private async soapGetStatus(p: { trackId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    const raw = await this.soapCall(p.wsUrl, `<wcf:GetStatus><wcf:trackId>${p.trackId}</wcf:trackId></wcf:GetStatus>`, 'GetStatus', p.certPem, p.keyPem);
    return this.parseStatusResp(raw);
  }

  private parseStatusResp(raw: string): DianStatusResult {
    return {
      isValid:           this.extractTag(raw, 'b:IsValid') === 'true',
      statusCode:        this.extractTag(raw, 'b:StatusCode'),
      statusDescription: this.extractTag(raw, 'b:StatusDescription'),
      statusMessage:     this.extractTag(raw, 'b:StatusMessage'),
      errorMessages:     this.extractAllTags(raw, 'c:string'),
      raw,
    };
  }

  private soapCall(wsUrl: string, soapBody: string, action: string, certPem: string, keyPem: string): Promise<string> {
    const effectiveCert = this.cleanPem(certPem, 'CERTIFICATE');
    const effectiveKey  = this.cleanPem(keyPem, keyPem.includes('BEGIN RSA PRIVATE KEY') ? 'RSA PRIVATE KEY' : 'PRIVATE KEY');
    const actionUri = `http://wcf.dian.colombia/IWcfDianCustomerServices/${action}`;
    const now = new Date();
    const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const expires = new Date(now.getTime() + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rand = () => randomBytes(17).toString('hex').toUpperCase();
    const tsId = `TS-${rand()}`; const bstId = `X509-${rand()}`; const sigId = `SIG-${rand()}`;
    const kiId = `KI-${rand()}`; const strId = `STR-${rand()}`; const toId  = `id-${rand()}`;

    const certBase64 = effectiveCert.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '');
    const SOAP_NS = 'http://www.w3.org/2003/05/soap-envelope';
    const WCF_NS  = 'http://wcf.dian.colombia';
    const WSA_NS  = 'http://www.w3.org/2005/08/addressing';
    const WSU_NS  = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
    const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
    const DS_NS   = 'http://www.w3.org/2000/09/xmldsig#';
    const EC_NS   = 'http://www.w3.org/2001/10/xml-exc-c14n#';

    const toRaw    = `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${wsUrl}</wsa:To>`;
    const toC14n   = this.excC14nElement(toRaw, { soap: SOAP_NS, wcf: WCF_NS, wsa: WSA_NS }, ['soap', 'wcf']);
    const toDigest = createHash('sha256').update(toC14n, 'utf8').digest('base64');

    const signedInfoC14n =
      `<ds:SignedInfo xmlns:ds="${DS_NS}" xmlns:soap="${SOAP_NS}" xmlns:wcf="${WCF_NS}" xmlns:wsa="${WSA_NS}">` +
      `<ds:CanonicalizationMethod Algorithm="${EC_NS}"><ec:InclusiveNamespaces xmlns:ec="${EC_NS}" PrefixList="wsa soap wcf"></ec:InclusiveNamespaces></ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>` +
      `<ds:Reference URI="#${toId}"><ds:Transforms><ds:Transform Algorithm="${EC_NS}"><ec:InclusiveNamespaces xmlns:ec="${EC_NS}" PrefixList="soap wcf"></ec:InclusiveNamespaces></ds:Transform></ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${toDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

    const signedInfoRaw =
      `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${EC_NS}"><ec:InclusiveNamespaces PrefixList="wsa soap wcf" xmlns:ec="${EC_NS}"/></ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${toId}"><ds:Transforms><ds:Transform Algorithm="${EC_NS}"><ec:InclusiveNamespaces PrefixList="soap wcf" xmlns:ec="${EC_NS}"/></ds:Transform></ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${toDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

    const signer   = createSign('RSA-SHA256');
    signer.update(signedInfoC14n, 'utf8');
    const sigValue = signer.sign(effectiveKey, 'base64');

    const envelope =
      `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:wcf="${WCF_NS}"><soap:Header xmlns:wsa="${WSA_NS}">` +
      `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}">` +
      `<wsu:Timestamp wsu:Id="${tsId}"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>` +
      `<wsse:BinarySecurityToken EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" wsu:Id="${bstId}">${certBase64}</wsse:BinarySecurityToken>` +
      `<ds:Signature Id="${sigId}" xmlns:ds="${DS_NS}">${signedInfoRaw}<ds:SignatureValue>${sigValue}</ds:SignatureValue>` +
      `<ds:KeyInfo Id="${kiId}"><wsse:SecurityTokenReference wsu:Id="${strId}"><wsse:Reference URI="#${bstId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/></wsse:SecurityTokenReference></ds:KeyInfo>` +
      `</ds:Signature></wsse:Security><wsa:Action>${actionUri}</wsa:Action>` +
      `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${wsUrl}</wsa:To></soap:Header>` +
      `<soap:Body>${soapBody}</soap:Body></soap:Envelope>`;

    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const lib = u.protocol === 'https:' ? https : http;
      const agent = u.protocol === 'https:'
        ? new (require('https').Agent)({ cert: effectiveCert, key: effectiveKey, rejectUnauthorized: false, keepAlive: false })
        : undefined;
      const bodyBuf = Buffer.from(envelope, 'utf8');
      const req = (lib as any).request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${actionUri}"`, 'Content-Length': bodyBuf.length },
        agent, timeout: 60_000,
      }, (res: any) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { data += c; });
        res.on('end', () => { this.logger.log(`[DIAN-NE SOAP] ${action} HTTP ${res.statusCode} → ${data.slice(0, 1200)}`); resolve(data); });
      });
      req.on('error', (e: any) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error(`DIAN timeout: ${action}`)); });
      req.write(bodyBuf); req.end();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZIP
  // ══════════════════════════════════════════════════════════════════════════

  private createZip(filename: string, content: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const arc = (archiver as any)('zip', { zlib: { level: 9 } });
      arc.on('data', (c: Buffer) => chunks.push(c));
      arc.on('end',  () => resolve(Buffer.concat(chunks)));
      arc.on('error', reject);
      arc.append(Buffer.from(content, 'utf8'), { name: filename });
      arc.finalize();
    });
  }

  private excC14nElement(elementXml: string, inheritedNs: Record<string, string>, inclusiveNsPrefixes: string[]): string {
    const ownNsMatch = elementXml.match(/^<[^>]+>/)?.[0] ?? '';
    const ownNs: Record<string, string> = {};
    for (const m of ownNsMatch.matchAll(/xmlns:(\w+)="([^"]+)"/g)) ownNs[m[1]] = m[2];
    const allNs = { ...inheritedNs, ...ownNs };
    const tagMatch = elementXml.match(/^<(\w+):/);
    const elemPrefix = tagMatch?.[1] ?? '';
    const usedByElem = new Set<string>();
    if (elemPrefix) usedByElem.add(elemPrefix);
    for (const m of ownNsMatch.matchAll(/ (\w+):[\w]+=["'][^"']*["']/g)) { if (m[1] !== 'xmlns') usedByElem.add(m[1]); }
    const allPrefixes = new Set<string>();
    for (const p of inclusiveNsPrefixes) if (allNs[p]) allPrefixes.add(p);
    for (const p of usedByElem) if (allNs[p]) allPrefixes.add(p);
    const nsDecls = [...allPrefixes].sort().map(p => ` xmlns:${p}="${allNs[p]}"`).join('');
    let openTag = ownNsMatch.replace(/ xmlns:\w+="[^"]+"/g, '');
    openTag = openTag.replace(/^(<\S+)/, `$1${nsDecls}`);
    return openTag + elementXml.slice(ownNsMatch.length);
  }

  private cleanPem(raw: string, type: 'CERTIFICATE' | 'PRIVATE KEY' | 'RSA PRIVATE KEY'): string {
    if (!raw) return raw;
    const idx = raw.indexOf(`-----BEGIN ${type}-----`);
    return idx >= 0 ? raw.slice(idx).trim() : raw.trim();
  }

  private normalizePem(pem: string): string {
    return pem.replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const s = xml.indexOf(`<${tag}>`); if (s === -1) return undefined;
    const e = xml.indexOf(`</${tag}>`, s); return e === -1 ? undefined : xml.substring(s + tag.length + 2, e).trim();
  }

  private extractAllTags(xml: string, tag: string): string[] {
    const r: string[] = []; let pos = 0;
    while (true) {
      const s = xml.indexOf(`<${tag}>`, pos); if (s === -1) break;
      const e = xml.indexOf(`</${tag}>`, s);  if (e === -1) break;
      r.push(xml.substring(s + tag.length + 2, e).trim()); pos = e + tag.length + 3;
    }
    return r;
  }

  private toColombiaDate(d: Date): string {
    return new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  private toColombiaTime(d: Date): string {
    const t = new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().split('T')[1].split('.')[0];
    return `${t}-05:00`;
  }

  private calcSoftwareSecurityCode(softwareId: string, pin: string, numero: string): string {
    return createHash('sha384').update(softwareId + pin + numero, 'utf8').digest('hex');
  }

  private calcDv(nit: string): string {
    const clean = nit.replace(/\D/g, '');
    const factors = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let sum = 0;
    for (let i = 0; i < clean.length; i++) sum += parseInt(clean[clean.length - 1 - i]) * factors[i];
    const rem = sum % 11;
    return rem > 1 ? String(11 - rem) : String(rem);
  }

  private mapDocType(t: string): string {
    return ({ CC: '13', CE: '22', PASSPORT: '21', TI: '12', NIT: '31', RC: '11' } as any)[t] ?? '13';
  }

  private mapContractType(t: string): string {
    return ({ INDEFINITE: '1', FIXED: '2', PROJECT: '3', APPRENTICE: '4', INTERNSHIP: '5' } as any)[t] ?? '1';
  }

  calculatePayroll(
    dto: CreatePayrollDto,
    policy?: PayrollPolicyContext | null,
    conceptLines: PayrollConceptResolvedLine[] = [],
  ): PayrollCalcResult & { autoTransport: number; conceptLines: PayrollConceptResolvedLine[] } {
    const SMMLV = Number(policy?.minimumWageValue ?? 1_300_000);
    const AUTO_AUX = Number(policy?.transportAllowanceAmount ?? 162_000);
    const transportCapMultiplier = Number(policy?.transportCapMultiplier ?? 2);
    const dailySalary  = dto.baseSalary / 30;
    const proportional = dailySalary * (dto.daysWorked ?? 30);
    const transport = (dto.transportAllowance !== undefined && dto.transportAllowance !== null)
      ? dto.transportAllowance : (dto.baseSalary <= SMMLV * transportCapMultiplier && (policy?.applyAutoTransport ?? true) ? AUTO_AUX : 0);
    const overtimePay = (dto.overtimeHours ?? 0) * (dto.baseSalary / 240) * Number(policy?.overtimeFactor ?? 1.25);
    const conceptEarnings = conceptLines
      .filter(line => line.nature === 'EARNING')
      .reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
    const conceptDeductions = conceptLines
      .filter(line => line.nature === 'DEDUCTION')
      .reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
    const totalEarnings = proportional + transport + overtimePay + (dto.bonuses ?? 0) + (dto.commissions ?? 0) + (dto.vacationPay ?? 0) + conceptEarnings;
    const contributionBase = proportional + overtimePay + (dto.bonuses ?? 0) + (dto.commissions ?? 0) + conceptEarnings;
    const healthBase = this.applyContributionCap(contributionBase, SMMLV, Number(policy?.healthCapSmmlv ?? 25));
    const pensionBase = this.applyContributionCap(contributionBase, SMMLV, Number(policy?.pensionCapSmmlv ?? 25));
    const parafiscalBase = this.applyContributionCap(contributionBase, SMMLV, Number(policy?.parafiscalCapSmmlv ?? 25));
    const arlBase = contributionBase;
    const healthEmployee = healthBase * Number(policy?.healthEmployeeRate ?? 0.04);
    const pensionEmployee = pensionBase * Number(policy?.pensionEmployeeRate ?? 0.04);
    const healthEmployer = healthBase * Number(policy?.healthEmployerRate ?? 0.085);
    const pensionEmployer = pensionBase * Number(policy?.pensionEmployerRate ?? 0.12);
    const arl = arlBase * Number(policy?.arlRate ?? 0.00522);
    const compensationFund = parafiscalBase * Number(policy?.compensationFundRate ?? 0.04);
    const senaEmployer = (policy?.applySena ?? true)
      ? parafiscalBase * Number(policy?.senaRate ?? 0.02)
      : 0;
    const icbfEmployer = (policy?.applyIcbf ?? true)
      ? parafiscalBase * Number(policy?.icbfRate ?? 0.03)
      : 0;
    const totalDeductions = healthEmployee + pensionEmployee + (dto.sickLeave ?? 0) + (dto.loans ?? 0) + (dto.otherDeductions ?? 0) + conceptDeductions;
    const netPay = totalEarnings - totalDeductions;
    const totalEmployerCost = totalEarnings + healthEmployer + pensionEmployer + arl + compensationFund + senaEmployer + icbfEmployer;
    const warnings: string[] = [];
    if (contributionBase > healthBase) warnings.push('La base de salud fue ajustada por tope legal');
    if (contributionBase > pensionBase) warnings.push('La base de pensión fue ajustada por tope legal');
    if (contributionBase > parafiscalBase) warnings.push('La base parafiscal fue ajustada por tope legal');
    if ((dto.daysWorked ?? 0) > 30) warnings.push('Los días trabajados superan el máximo operativo esperado');
    return {
      autoTransport:    this.safeNum(transport),
      healthEmployee:   this.safeNum(healthEmployee),
      pensionEmployee:  this.safeNum(pensionEmployee),
      healthEmployer:   this.safeNum(healthEmployer),
      pensionEmployer:  this.safeNum(pensionEmployer),
      arl:              this.safeNum(arl),
      compensationFund: this.safeNum(compensationFund),
      senaEmployer:     this.safeNum(senaEmployer),
      icbfEmployer:     this.safeNum(icbfEmployer),
      healthBase:       this.safeNum(healthBase),
      pensionBase:      this.safeNum(pensionBase),
      arlBase:          this.safeNum(arlBase),
      compensationBase: this.safeNum(parafiscalBase),
      senaBase:         this.safeNum(parafiscalBase),
      icbfBase:         this.safeNum(parafiscalBase),
      warnings,
      totalEarnings:    this.safeNum(totalEarnings),
      totalDeductions:  this.safeNum(totalDeductions),
      netPay:           this.safeNum(netPay),
      totalEmployerCost:this.safeNum(totalEmployerCost),
      conceptLines,
    };
  }

  async previewPayroll(companyIdOrDto: string | CreatePayrollDto, maybeDto?: CreatePayrollDto) {
    const dto = typeof companyIdOrDto === 'string' ? maybeDto! : companyIdOrDto;
    const companyId = typeof companyIdOrDto === 'string' ? companyIdOrDto : undefined;
    let previewPolicy: PayrollPolicyContext | null = null;
    let conceptLines: PayrollConceptResolvedLine[] = [];
    let effectiveDto = { ...dto };
    if (companyId) {
      const employee = dto.employeeId ? await this.findEmployee(companyId, dto.employeeId) : null;
      const branchId = dto.branchId ?? (employee as any)?.branchId ?? null;
      const noveltyImpact = dto.employeeId && dto.period
        ? await this.resolvePayrollNoveltyImpacts(companyId, dto.employeeId, dto.period)
        : { dto: {}, noveltyLines: [], noveltyIds: [] };
      effectiveDto = {
        ...dto,
        daysWorked: (noveltyImpact.dto as any).daysWorked ?? dto.daysWorked,
        overtimeHours: this.safeNum((dto.overtimeHours ?? 0) + Number((noveltyImpact.dto as any).overtimeHours ?? 0), 2),
        vacationPay: this.safeNum((dto.vacationPay ?? 0) + Number((noveltyImpact.dto as any).vacationPay ?? 0)),
        sickLeave: this.safeNum((dto.sickLeave ?? 0) + Number((noveltyImpact.dto as any).sickLeave ?? 0)),
        loans: this.safeNum((dto.loans ?? 0) + Number((noveltyImpact.dto as any).loans ?? 0)),
        otherDeductions: this.safeNum((dto.otherDeductions ?? 0) + Number((noveltyImpact.dto as any).otherDeductions ?? 0)),
      };
      const payrollTypeConfig = await this.resolvePayrollTypeConfig(
        companyId,
        branchId,
        effectiveDto.payrollTypeConfigId ?? (employee as any)?.payrollTypeConfigId ?? null,
      );
      previewPolicy = await this.resolvePayrollPolicy(
        companyId,
        branchId,
        effectiveDto.payrollPolicyId ?? (employee as any)?.payrollPolicyId ?? payrollTypeConfig?.policyId ?? null,
      );
      conceptLines = [
        ...(await this.resolvePayrollConceptLines(companyId, effectiveDto, branchId, previewPolicy)),
        ...noveltyImpact.noveltyLines,
      ];
    }
    const { autoTransport, ...preview } = this.calculatePayroll(effectiveDto, previewPolicy, conceptLines);
    return { ...preview, autoTransport };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMPROBANTE DE PAGO (tirilla HTML + QR)
  // ══════════════════════════════════════════════════════════════════════════

  private async qrGenSvg(text: string): Promise<string> {
    return QRCode.toString(text, { type: 'svg', width: 180, margin: 2 });
  }

  async generateEmploymentCertificate(companyId: string, employeeId: string): Promise<Buffer> {
    const employee: any = await (this.prisma.employees as any).findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      include: {
        branch: { select: { id: true, name: true } },
        companies: true,
      },
    });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    const company = employee.companies as any;
    const fmtDate = (value: Date | string) =>
      new Date(value).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });

    const html = `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Certificado laboral</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 42px; color: #0f172a; }
          .wrap { max-width: 760px; margin: 0 auto; }
          .header { border-bottom: 2px solid #dbeafe; padding-bottom: 14px; margin-bottom: 28px; }
          h1 { margin: 0 0 8px; color: #0f3b73; font-size: 28px; }
          .meta { color: #475569; font-size: 13px; }
          .content { line-height: 1.8; font-size: 15px; }
          .signature { margin-top: 58px; width: 300px; border-top: 1px solid #cbd5e1; padding-top: 10px; }
          .footer { margin-top: 20px; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="header">
            <h1>Certificado laboral</h1>
            <div class="meta">${company?.razonSocial ?? 'Empresa'} · NIT ${company?.nit ?? '—'}</div>
          </div>
          <div class="content">
            <p>Por medio de la presente certificamos que <strong>${employee.firstName} ${employee.lastName}</strong>, identificado con <strong>${employee.documentType} ${employee.documentNumber}</strong>, se encuentra vinculado a <strong>${company?.razonSocial ?? 'la empresa'}</strong>.</p>
            <p>Actualmente desempeña el cargo de <strong>${employee.position}</strong>, bajo contrato <strong>${employee.contractType}</strong>, con fecha de ingreso <strong>${fmtDate(employee.hireDate)}</strong>${employee.branch?.name ? ` en la sucursal <strong>${employee.branch.name}</strong>` : ''}.</p>
            <p>Su salario base actual es de <strong>${this.safeNum(employee.baseSalary).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}</strong>.</p>
            <p>Este certificado se expide a solicitud del interesado el día <strong>${fmtDate(new Date())}</strong>.</p>
          </div>
          <div class="signature">
            <strong>${company?.razonSocial ?? 'Empresa'}</strong><br/>
            Área de Nómina y Gestión Humana
          </div>
          <div class="footer">Documento generado desde BeccaFact</div>
        </div>
      </body>
      </html>
    `;

    return Buffer.from(html, 'utf-8');
  }

  async generatePayrollReceipt(companyId: string, id: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record: any = await (this.prisma.payroll_records as any).findFirst({
      where: { id, companyId },
      include: {
        employees: true,
        companies: true,
        invoice: true,
      },
    });
    if (!record) throw new NotFoundException('Payroll record not found');

    const company  = record.companies as any;
    const employee = record.employees as any;
    const inv      = record.invoice   as any;
    const isTestMode = company.dianTestMode ?? true;
    const qrBase     = isTestMode
      ? 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey='
      : 'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=';

    // ── Determinar contenido del QR ─────────────────────────────────────────
    let qrContent: string;
    if (inv?.dianQrCode) {
      qrContent = inv.dianQrCode;
    } else if (inv?.dianCufe) {
      qrContent = `${qrBase}${inv.dianCufe}`;
    } else if (record.cune) {
      qrContent = `${qrBase}${record.cune}`;
    } else {
      qrContent = `BeccaFact:Nomina:${record.payrollNumber ?? record.id}`;
    }

    const svgQR = await this.qrGenSvg(qrContent);

    // ── Formateo de moneda ──────────────────────────────────────────────────
    const fmt = (v: any) =>
      Number(v ?? 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

    const baseSalary         = this.safeNum(record.baseSalary);
    const overtimeHours      = this.safeNum(record.overtimeHours);
    const bonuses            = this.safeNum(record.bonuses);
    const commissions        = this.safeNum(record.commissions);
    const transportAllowance = this.safeNum(record.transportAllowance);
    const vacationPay        = this.safeNum(record.vacationPay);
    const totalEarnings      = this.safeNum(record.totalEarnings);
    const healthEmployee     = this.safeNum(record.healthEmployee);
    const pensionEmployee    = this.safeNum(record.pensionEmployee);
    const sickLeave          = this.safeNum(record.sickLeave);
    const loans              = this.safeNum(record.loans);
    const otherDeductions    = this.safeNum(record.otherDeductions);
    const totalDeductions    = this.safeNum(record.totalDeductions);
    const netPay             = this.safeNum(record.netPay);

    // ── Sección DIAN / factura / fallback ───────────────────────────────────
    let dianSection = '';
    if (record.cune) {
      dianSection = `
        <div class="dian-box">
          <div class="dian-title">Documento Validado DIAN — Nómina Electrónica</div>
          <div class="dian-cune"><strong>CUNE:</strong> <span class="mono">${record.cune}</span></div>
          <div class="qr-wrap">${svgQR}</div>
          <div class="qr-caption">Consulta en el portal DIAN</div>
        </div>`;
    } else if (inv) {
      const invLabel = inv.invoiceNumber ? `Factura ${inv.invoiceNumber}` : `Factura vinculada`;
      dianSection = `
        <div class="dian-box">
          <div class="dian-title">Factura Electrónica Vinculada</div>
          <div class="dian-cune"><strong>${invLabel}</strong>${inv.dianCufe ? ` — CUFE: <span class="mono">${inv.dianCufe}</span>` : ''}</div>
          <div class="qr-wrap">${svgQR}</div>
          <div class="qr-caption">Consulta en el portal DIAN</div>
        </div>`;
    } else {
      dianSection = `
        <div class="dian-box dian-box--soft">
          <div class="dian-title">Comprobante Interno</div>
          <div class="qr-wrap">${svgQR}</div>
          <div class="qr-caption">Escanea para verificar este comprobante</div>
        </div>`;
    }

    const generatedAt = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Comprobante de Pago — ${record.payrollNumber ?? record.id}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #f0f4f8;
      color: #1e293b;
      padding: 24px 12px;
      font-size: 13px;
    }
    .page {
      max-width: 720px;
      margin: 0 auto;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(26,64,126,.13);
      overflow: hidden;
    }
    /* ── Header ── */
    .header {
      background: #1a407e;
      color: #fff;
      padding: 24px 32px 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .header-left h1 { font-size: 18px; font-weight: 700; letter-spacing: -.3px; }
    .header-left .subtitle { font-size: 11px; opacity: .75; margin-top: 3px; }
    .header-right { text-align: right; }
    .header-right .doc-title {
      font-size: 13px; font-weight: 600;
      background: rgba(255,255,255,.15);
      border-radius: 6px; padding: 6px 12px;
      letter-spacing: .3px;
    }
    .header-right .doc-num { font-size: 20px; font-weight: 800; margin-top: 4px; }
    /* ── Meta strip ── */
    .meta-strip {
      background: #f0f4f8;
      border-bottom: 1px solid #e2e8f0;
      display: flex; flex-wrap: wrap; gap: 0;
    }
    .meta-cell {
      flex: 1 1 180px;
      padding: 10px 20px;
      border-right: 1px solid #e2e8f0;
    }
    .meta-cell:last-child { border-right: none; }
    .meta-cell .label { font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: .5px; }
    .meta-cell .value { font-size: 13px; font-weight: 600; color: #1a407e; margin-top: 2px; }
    /* ── Body ── */
    .body { padding: 24px 32px; }
    /* ── Section card ── */
    .section { margin-bottom: 20px; }
    .section-title {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .8px; color: #64748b;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6px; margin-bottom: 12px;
    }
    /* ── Employee card ── */
    .emp-card {
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 8px; padding: 14px 18px;
      display: flex; flex-wrap: wrap; gap: 16px;
    }
    .emp-field { flex: 1 1 160px; }
    .emp-field .lbl { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .4px; }
    .emp-field .val { font-size: 13px; font-weight: 600; margin-top: 2px; }
    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th {
      background: #1a407e; color: #fff;
      padding: 8px 12px; text-align: left;
      font-size: 11px; font-weight: 600; letter-spacing: .3px;
    }
    th:last-child { text-align: right; }
    td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; }
    td:last-child { text-align: right; font-weight: 500; }
    tr:last-child td { border-bottom: none; }
    tr.total-row td {
      background: #f0f4f8; font-weight: 700;
      font-size: 13px; color: #1a407e;
      border-top: 2px solid #cbd5e1;
    }
    /* ── Net pay box ── */
    .net-box {
      background: linear-gradient(135deg, #1a407e 0%, #2563eb 100%);
      color: #fff; border-radius: 10px;
      padding: 20px 28px; margin: 24px 0;
      display: flex; justify-content: space-between; align-items: center;
    }
    .net-box .net-label { font-size: 14px; font-weight: 600; opacity: .9; }
    .net-box .net-amount { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
    .net-box .net-days { font-size: 11px; opacity: .7; margin-top: 3px; }
    /* ── DIAN box ── */
    .dian-box {
      border: 2px solid #1a407e; border-radius: 10px;
      padding: 18px 20px; text-align: center; margin-top: 8px;
    }
    .dian-box--soft { border-color: #cbd5e1; }
    .dian-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .6px; color: #1a407e; margin-bottom: 8px;
    }
    .dian-box--soft .dian-title { color: #64748b; }
    .dian-cune {
      font-size: 11px; color: #475569; word-break: break-all;
      margin-bottom: 12px; line-height: 1.5;
    }
    .mono { font-family: 'Courier New', monospace; font-size: 10px; }
    .qr-wrap { display: inline-block; padding: 6px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; }
    .qr-wrap svg { display: block; }
    .qr-caption { font-size: 10px; color: #94a3b8; margin-top: 6px; }
    /* ── Footer ── */
    .footer {
      background: #f8fafc; border-top: 1px solid #e2e8f0;
      padding: 14px 32px; display: flex;
      justify-content: space-between; align-items: center;
      font-size: 11px; color: #94a3b8;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .page { box-shadow: none; border-radius: 0; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <h1>${company.razonSocial ?? company.name ?? 'Empresa'}</h1>
      <div class="subtitle">NIT ${company.nit ?? ''}${company.address ? ' · ' + company.address : ''}${company.city ? ', ' + company.city : ''}</div>
    </div>
    <div class="header-right">
      <div class="doc-title">COMPROBANTE DE PAGO DE NÓMINA</div>
      <div class="doc-num">${record.payrollNumber ?? record.id.slice(0, 8).toUpperCase()}</div>
    </div>
  </div>

  <!-- Meta strip -->
  <div class="meta-strip">
    <div class="meta-cell">
      <div class="label">Período</div>
      <div class="value">${record.period}</div>
    </div>
    <div class="meta-cell">
      <div class="label">Fecha de pago</div>
      <div class="value">${new Date(record.payDate).toLocaleDateString('es-CO')}</div>
    </div>
    <div class="meta-cell">
      <div class="label">Días trabajados</div>
      <div class="value">${record.daysWorked} días</div>
    </div>
    <div class="meta-cell">
      <div class="label">Estado</div>
      <div class="value">${record.status}</div>
    </div>
  </div>

  <div class="body">

    <!-- Empleado -->
    <div class="section">
      <div class="section-title">Información del Empleado</div>
      <div class="emp-card">
        <div class="emp-field">
          <div class="lbl">Nombre completo</div>
          <div class="val">${employee.firstName ?? ''} ${employee.lastName ?? ''}</div>
        </div>
        <div class="emp-field">
          <div class="lbl">Documento</div>
          <div class="val">${employee.documentType ?? 'CC'} ${employee.documentNumber ?? ''}</div>
        </div>
        <div class="emp-field">
          <div class="lbl">Cargo</div>
          <div class="val">${employee.position ?? '—'}</div>
        </div>
        <div class="emp-field">
          <div class="lbl">Tipo de contrato</div>
          <div class="val">${employee.contractType ?? '—'}</div>
        </div>
      </div>
    </div>

    <!-- Devengados -->
    <div class="section">
      <div class="section-title">Devengados</div>
      <table>
        <thead>
          <tr><th>Concepto</th><th>Valor</th></tr>
        </thead>
        <tbody>
          <tr><td>Salario base (${record.daysWorked} días)</td><td>${fmt(baseSalary)}</td></tr>
          ${overtimeHours > 0 ? `<tr><td>Horas extras (${overtimeHours} h)</td><td>${fmt(overtimeHours * (baseSalary / 240) * 1.25)}</td></tr>` : ''}
          ${transportAllowance > 0 ? `<tr><td>Auxilio de transporte</td><td>${fmt(transportAllowance)}</td></tr>` : ''}
          ${vacationPay > 0 ? `<tr><td>Vacaciones</td><td>${fmt(vacationPay)}</td></tr>` : ''}
          ${bonuses > 0 ? `<tr><td>Bonificaciones</td><td>${fmt(bonuses)}</td></tr>` : ''}
          ${commissions > 0 ? `<tr><td>Comisiones</td><td>${fmt(commissions)}</td></tr>` : ''}
          <tr class="total-row"><td>Total devengado</td><td>${fmt(totalEarnings)}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Deducciones -->
    <div class="section">
      <div class="section-title">Deducciones</div>
      <table>
        <thead>
          <tr><th>Concepto</th><th>Valor</th></tr>
        </thead>
        <tbody>
          <tr><td>Salud empleado (4%)</td><td>${fmt(healthEmployee)}</td></tr>
          <tr><td>Pensión empleado (4%)</td><td>${fmt(pensionEmployee)}</td></tr>
          ${sickLeave > 0 ? `<tr><td>Incapacidades</td><td>${fmt(sickLeave)}</td></tr>` : ''}
          ${loans > 0 ? `<tr><td>Préstamos</td><td>${fmt(loans)}</td></tr>` : ''}
          ${otherDeductions > 0 ? `<tr><td>Otras deducciones</td><td>${fmt(otherDeductions)}</td></tr>` : ''}
          <tr class="total-row"><td>Total deducido</td><td>${fmt(totalDeductions)}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Neto a pagar -->
    <div class="net-box">
      <div>
        <div class="net-label">Neto a Pagar</div>
        <div class="net-days">${record.daysWorked} días trabajados · Período ${record.period}</div>
      </div>
      <div class="net-amount">${fmt(netPay)}</div>
    </div>

    <!-- DIAN / QR -->
    <div class="section">
      <div class="section-title">Validación${record.cune ? ' DIAN' : inv ? ' Factura Electrónica' : ''}</div>
      ${dianSection}
    </div>

  </div><!-- /body -->

  <!-- Footer -->
  <div class="footer">
    <span>Generado por BeccaFact · ${generatedAt}</span>
    <span>${record.payrollNumber ? 'Ref: ' + record.payrollNumber : ''}</span>
  </div>

</div>
</body>
</html>`;

    return Buffer.from(html, 'utf-8');
  }
}
