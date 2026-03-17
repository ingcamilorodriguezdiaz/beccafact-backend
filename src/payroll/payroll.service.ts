import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { createHash, createSign, randomBytes } from 'crypto';
import * as archiver from 'archiver';
import * as https from 'https';
import * as http from 'http';

// ─── Constantes DIAN Nómina Electrónica ── Ambiente de Habilitación ───────────
const NOMINA_SOFTWARE_ID  = '4f5c23a6-0004-46a1-923f-19f2cb4c36da';
const NOMINA_SOFTWARE_PIN = '123456';
const NOMINA_TEST_SET_ID  = '25e4b1c1-982c-465b-a380-eb1dd4a925ec';
const NOMINA_WS_HAB       = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc';
const NOMINA_WS_PROD      = 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc';
const NOMINA_SEQUENCE_START = 990000001;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

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
  cuneRef?: string;
  payrollNumberRef?: string;
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

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(private prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════════════════════
  // EMPLOYEES
  // ══════════════════════════════════════════════════════════════════════════

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

  // ══════════════════════════════════════════════════════════════════════════
  // PAYROLL RECORDS
  // ══════════════════════════════════════════════════════════════════════════

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

    const lastRecord = await this.prisma.payroll_records.findFirst({
      where: { companyId, payrollNumber: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    const lastSeq       = lastRecord?.payrollNumber
      ? parseInt(lastRecord.payrollNumber.replace(/\D/g, ''), 10)
      : NOMINA_SEQUENCE_START - 1;
    const nextSeq       = lastSeq + 1;
    const payrollNumber = `NIE${nextSeq}`;

    const record = await this.prisma.payroll_records.create({
      data: {
        companyId,
        employeeId:         dto.employeeId,
        period:             dto.period,
        payDate:            new Date(dto.payDate),
        status:             'DRAFT',
        payrollNumber,
        payrollType:        dto.cuneRef ? 'NOMINA_AJUSTE' : 'NOMINA_ELECTRONICA',
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
      } as any,
      include: { employees: { select: { id: true, firstName: true, lastName: true } } },
    });

    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'CREATE', resource: 'payroll', resourceId: record.id,
              after: { period: dto.period, employeeId: dto.employeeId, netPay: calc.netPay, payrollNumber } as any },
    });
    return record;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSMISIÓN DIAN
  // ══════════════════════════════════════════════════════════════════════════

  async submitPayroll(companyId: string, id: string, userId: string) {
    const record = await this.findPayrollRecord(companyId, id);
    if (record.status !== 'DRAFT') throw new BadRequestException('Only DRAFT records can be submitted');

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        nit: true, razonSocial: true, address: true, city: true,
        dianTestMode: true, dianCertificate: true, dianCertificateKey: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');

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
    const [pYearCheck, pMonthCheck] = ((record as any).period as string).split('-').map(Number);
    const liquidFinCheck = new Date(pYearCheck, pMonthCheck, 0); // último día del mes
    const todayCheck     = new Date();
    todayCheck.setHours(0,0,0,0);
    if (liquidFinCheck > todayCheck) {
      throw new BadRequestException(
        `El período de nómina ${(record as any).period} (${liquidFinCheck.toISOString().slice(0,10)}) ` +
        `es futuro respecto a la fecha actual (${todayCheck.toISOString().slice(0,10)}). ` +
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

    const cuneHash = this.calcCune({
      payrollNumber,
      issueDate,
      issueTime,         // con GMT incluido: HH:MM:SS-05:00 (según Resolución 000013 num. 8.1.1.1)
      devengadosTotal:  Number(record.totalEarnings),
      deduccionesTotal: Number(record.totalDeductions),
      comprobanteTotal: Number(record.netPay),
      employerNit:      company.nit,
      workerDoc:        (employee as any).documentNumber,  // FIX: DocEmp = doc del trabajador
      // IMPORTANTE: SoftwarePin en el CUNE es SIEMPRE el PIN numérico del software
      // registrado en la DIAN, tanto en habilitación como en producción.
      // El NOMINA_TEST_SET_ID (TestSetId UUID) solo se usa como parámetro del WS
      // en el método SendTestSetAsync — NO en la fórmula del CUNE.
      softwarePin:      NOMINA_SOFTWARE_PIN,
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
      dianResult = await this.soapSendNomina({ zipFileName, zipBase64, wsUrl, certPem, keyPem, isTestMode });

    } catch (err: any) {
      const detail = err?.message || err?.code || String(err) || 'Error desconocido';
      this.logger.error(`[DIAN-NE] ❌ ${detail}`);
      this.logger.error(`[DIAN-NE] stack: ${err?.stack?.slice(0, 800)}`);

      await this.prisma.payroll_records.update({
        where: { id },
        data: { dianErrors: JSON.stringify([detail]), dianAttempts: { increment: 1 } } as any,
      }).catch(() => {});

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
    };
  }

  async checkPayrollStatus(companyId: string, id: string) {
    const record  = await this.findPayrollRecord(companyId, id);
    const zipKey  = (record as any).dianZipKey;
    const cuneRef = (record as any).cuneHash;
    if (!zipKey && !cuneRef) throw new BadRequestException('Record has no ZipKey or CUNE to query');

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { dianTestMode: true, dianCertificate: true, dianCertificateKey: true },
    });
    const wsUrl   = (company?.dianTestMode ?? true) ? NOMINA_WS_HAB : NOMINA_WS_PROD;
    const certPem = this.normalizePem(company?.dianCertificate ?? '');
    const keyPem  = this.normalizePem(company?.dianCertificateKey ?? '');

    let result: DianStatusResult;
    if (zipKey) {
      result = await this.soapGetStatusZip({ trackId: zipKey, wsUrl, certPem, keyPem });
    } else {
      result = await this.soapGetStatus({ trackId: cuneRef!, wsUrl, certPem, keyPem });
    }

    if (result.statusCode) {
      const newStatus =
        result.isValid             ? 'ACCEPTED'  :
        result.statusCode === '99' ? 'REJECTED'  : undefined;

      await this.prisma.payroll_records.update({
        where: { id },
        data: {
          dianStatusCode: result.statusCode,
          dianStatusMsg:  result.statusDescription ?? result.statusMessage,
          ...(newStatus ? { status: newStatus } : {}),
        } as any,
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

    const updated = await this.prisma.payroll_records.update({
      where: { id },
      data: { status: 'VOIDED', notes: reason },
    });
    await this.prisma.auditLog.create({
      data: { companyId, userId, action: 'VOID', resource: 'payroll', resourceId: id, after: { reason } as any },
    });
    return updated;
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
  }): string {
    const { record, employee, company, cuneHash, payrollNumber, seqNum, issueDate, issueTime, isTestMode } = p;
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

    const softwareSC = this.calcSoftwareSecurityCode(NOMINA_SOFTWARE_ID, NOMINA_SOFTWARE_PIN, numeroDoc);

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

    const codigoQR =
      `NumNIE: ${numeroDoc}FecNIE: ${issueDate}HorNIE: ${timeClean}-05:00` +
      `NitNIE: ${empNit}DocEmp: ${workerDoc}ValDev: ${totalEarn}ValDed: ${totalDed}` +
      `ValTol: ${netPay}CUNE: ${cuneHash}QRCode: ${qrBase}${cuneHash}`;

    const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                   'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const notas = `NOMINA MES DE ${meses[pMonth - 1]} DE ${pYear}`;

    // Banco del empleado si está configurado
    const bancoAttr = employee.bankName ? ` Banco="${employee.bankName}"` : '';

    return `<?xml version="1.0" encoding="utf-8"?><${rootTag} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${nsMain}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#" xsi:schemaLocation="${nsMain} ${xsdFile}" xmlns:xs="http://www.w3.org/2001/XMLSchema-instance" SchemaLocation=""><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><!-- NOMINA_SIGNATURE_PLACEHOLDER --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><Periodo FechaIngreso="${hireDate}" FechaLiquidacionInicio="${liquidInicio}" FechaLiquidacionFin="${liquidFin}" TiempoLaborado="${record.daysWorked}" FechaGen="${issueDate}" /><NumeroSecuenciaXML CodigoTrabajador="${workerDoc}" Prefijo="${prefijo}" Consecutivo="${seqNum}" Numero="${numeroDoc}" /><LugarGeneracionXML Pais="CO" DepartamentoEstado="11" MunicipioCiudad="11001" Idioma="es" /><ProveedorXML RazonSocial="${empNombre}" NIT="${empNit}" DV="${empDv}" SoftwareID="${NOMINA_SOFTWARE_ID}" SoftwareSC="${softwareSC}" /><CodigoQR>${codigoQR}</CodigoQR><InformacionGeneral Version="V1.0: Documento Soporte de Pago de Nómina Electrónica" Ambiente="${ambiente}" TipoXML="${tipoXml}" CUNE="${cuneHash}" EncripCUNE="CUNE-SHA384" FechaGen="${issueDate}" HoraGen="${issueTime}" PeriodoNomina="${periodoNomina}" TipoMoneda="COP" /><Notas>${notas}</Notas><Empleador PrimerApellido="${empApellido1}"${empApellido2 ? ` SegundoApellido="${empApellido2}"` : ''} PrimerNombre="${empNombre1}"${empOtros ? ` OtrosNombres="${empOtros}"` : ''} NIT="${empNit}" DV="${empDv}" Pais="CO" DepartamentoEstado="11" MunicipioCiudad="11001" Direccion="${empDir}" /><Trabajador TipoTrabajador="01" SubTipoTrabajador="00" AltoRiesgoPension="false" TipoDocumento="${workerDocType}" NumeroDocumento="${workerDoc}" PrimerApellido="${wAp1}"${wAp2 ? ` SegundoApellido="${wAp2}"` : ''} PrimerNombre="${wNom1}"${wOtros ? ` OtrosNombres="${wOtros}"` : ''} LugarTrabajoPais="CO" LugarTrabajoDepartamentoEstado="11" LugarTrabajoMunicipioCiudad="11001" LugarTrabajoDireccion="${empDir}" SalarioIntegral="false" TipoContrato="${this.mapContractType(employee.contractType)}" Sueldo="${baseSalary}" CodigoTrabajador="${workerDoc}" /><Pago Forma="1" Metodo="1"${bancoAttr} /><FechasPagos><FechaPago>${payDateStr}</FechaPago></FechasPagos><Devengados><Basico DiasTrabajados="${record.daysWorked}" SueldoTrabajado="${baseSalary}" />${
    // FIX ZB01: Transporte solo lleva AuxilioTransporte, sin campos Viatico*
    transport > 0 ? `<Transporte AuxilioTransporte="${transport.toFixed(2)}" />` : ''}${
    bonuses > 0 ? `<Bonificaciones BonificacionSalarial="${bonuses.toFixed(2)}" BonificacionNoSalarial="0.00" />` : ''}${
    commissions > 0 ? `<Comisiones Comision="${commissions.toFixed(2)}" />` : ''}${
    vacacion > 0 ? `<Vacaciones VacacionesComunes="${vacacion.toFixed(2)}" />` : ''}${
    overtime > 0 ? `<HEDs><HED Cantidad="${overtime.toFixed(2)}" Porcentaje="25.00" Pago="${(overtime * Number(record.baseSalary) / 240 * 1.25).toFixed(2)}" /></HEDs>` : ''}</Devengados><Deducciones><Salud Porcentaje="4.00" Deduccion="${healthEmp.toFixed(2)}" />${
    pensionEmp > 0 ? `<FondoPension Porcentaje="4.00" Deduccion="${pensionEmp.toFixed(2)}" />` : ''}${
    sick > 0 ? `<Incapacidades><Incapacidad Cantidad="1" TipoIncapacidad="01" ValorIncapacidad="${sick.toFixed(2)}" /></Incapacidades>` : ''}${
    loans > 0 ? `<Embargo ValorEmbargo="${loans.toFixed(2)}" />` : ''}${
    otherDed > 0 ? `<OtraDeduccion NombreDeduccion="Otros descuentos" ValorDeduccion="${otherDed.toFixed(2)}" />` : ''}</Deducciones><DevengadosTotal>${totalEarn}</DevengadosTotal><DeduccionesTotal>${totalDed}</DeduccionesTotal><ComprobanteTotal>${netPay}</ComprobanteTotal></${rootTag}>`;
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
  }): Promise<DianNominaResult> {
    let body: string; let action: string;

    if (p.isTestMode) {
      action = 'SendTestSetAsync';
      body = `<wcf:SendTestSetAsync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile><wcf:testSetId>${NOMINA_TEST_SET_ID}</wcf:testSetId></wcf:SendTestSetAsync>`;
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

  calculatePayroll(dto: CreatePayrollDto): PayrollCalcResult & { autoTransport: number } {
    const SMMLV = 1_300_000; const AUTO_AUX = 162_000;
    const dailySalary  = dto.baseSalary / 30;
    const proportional = dailySalary * (dto.daysWorked ?? 30);
    const transport = (dto.transportAllowance !== undefined && dto.transportAllowance !== null)
      ? dto.transportAllowance : (dto.baseSalary <= SMMLV * 2 ? AUTO_AUX : 0);
    const overtimePay = (dto.overtimeHours ?? 0) * (dto.baseSalary / 240) * 1.25;
    const totalEarnings = proportional + transport + overtimePay + (dto.bonuses ?? 0) + (dto.commissions ?? 0) + (dto.vacationPay ?? 0);
    const base = proportional + overtimePay + (dto.bonuses ?? 0);
    const healthEmployee = base * 0.04; const pensionEmployee = base * 0.04;
    const healthEmployer = base * 0.085; const pensionEmployer = base * 0.12;
    const arl = base * 0.00522; const compensationFund = base * 0.04;
    const totalDeductions = healthEmployee + pensionEmployee + (dto.sickLeave ?? 0) + (dto.loans ?? 0) + (dto.otherDeductions ?? 0);
    const netPay = totalEarnings - totalDeductions;
    const totalEmployerCost = totalEarnings + healthEmployer + pensionEmployer + arl + compensationFund;
    return {
      autoTransport: Math.round(transport), healthEmployee: Math.round(healthEmployee),
      pensionEmployee: Math.round(pensionEmployee), healthEmployer: Math.round(healthEmployer),
      pensionEmployer: Math.round(pensionEmployer), arl: Math.round(arl),
      compensationFund: Math.round(compensationFund), totalEarnings: Math.round(totalEarnings),
      totalDeductions: Math.round(totalDeductions), netPay: Math.round(netPay),
      totalEmployerCost: Math.round(totalEmployerCost),
    };
  }

  previewPayroll(dto: CreatePayrollDto) {
    const { autoTransport, ...preview } = this.calculatePayroll(dto);
    return preview;
  }
}