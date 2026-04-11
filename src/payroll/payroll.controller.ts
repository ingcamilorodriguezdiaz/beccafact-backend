import {
  Controller, Get, Post, Put, Patch, Body,
  Param, Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PayrollService, CreatePayrollDto } from './payroll.service';
import { JwtAuthGuard }        from '../common/guards/jwt-auth.guard';
import { RolesGuard }          from '../common/guards/roles.guard';
import { PlanGuard }           from '../common/guards/plan.guard';
import { CompanyStatusGuard }  from '../common/guards/company-status.guard';
import { CurrentUser }         from '../common/decorators/current-user.decorator';
import { Roles }               from '../common/decorators/roles.decorator';
import { PlanFeature }         from '../common/decorators/plan-feature.decorator';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/common/constants/pagination.constants';
import { CurrentBranchId } from '@/common/decorators/current-branch-id.decorator';
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
import { BranchesService } from '@/branches/branches.service';
import { CreatePayrollEmployeeRequestDto } from './dto/payroll-portal.dto';
import { BulkPayrollReprocessDto, QueuePayrollReprocessDto } from './dto/payroll-operations.dto';
import { CreatePayrollEnterpriseRuleDto, UpdatePayrollEnterpriseRuleDto } from './dto/payroll-enterprise.dto';

@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@PlanFeature('has_payroll')
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private payrollService: PayrollService,private branchesService: BranchesService) {}

  @Get('branches')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR','CONTADOR')
  @ApiOperation({ summary: 'Listar sucursales de la empresa' })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.branchesService.findAll(companyId);
  }

  @Get('masters')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Resumen de maestros de nómina' })
  getMasters(
    @CurrentUser('companyId') companyId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.payrollService.getPayrollMasters(companyId, branchId);
  }

  @Get('enterprise/overview')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Resumen enterprise de operación compartida de nómina' })
  getEnterpriseOverview(
    @CurrentUser('companyId') companyId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.payrollService.getPayrollEnterpriseOverview(companyId, branchId);
  }

  @Post('enterprise/rules')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear regla enterprise de nómina' })
  createEnterpriseRule(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollEnterpriseRuleDto,
  ) {
    return this.payrollService.createPayrollEnterpriseRule(companyId, dto, userId);
  }

  @Put('enterprise/rules/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar regla enterprise de nómina' })
  updateEnterpriseRule(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollEnterpriseRuleDto,
  ) {
    return this.payrollService.updatePayrollEnterpriseRule(companyId, id, dto, userId);
  }

  @Post('concepts')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear concepto de nómina' })
  createConcept(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollConceptDto,
  ) {
    return this.payrollService.createPayrollConcept(companyId, dto, userId);
  }

  @Put('concepts/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar concepto de nómina' })
  updateConcept(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollConceptDto,
  ) {
    return this.payrollService.updatePayrollConcept(companyId, id, dto, userId);
  }

  @Post('calendars')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear calendario de nómina' })
  createCalendar(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollCalendarDto,
  ) {
    return this.payrollService.createPayrollCalendar(companyId, dto, userId);
  }

  @Put('calendars/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar calendario de nómina' })
  updateCalendar(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollCalendarDto,
  ) {
    return this.payrollService.updatePayrollCalendar(companyId, id, dto, userId);
  }

  @Post('policies')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear política laboral de nómina' })
  createPolicy(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollPolicyDto,
  ) {
    return this.payrollService.createPayrollPolicy(companyId, dto, userId);
  }

  @Put('policies/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar política laboral de nómina' })
  updatePolicy(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollPolicyDto,
  ) {
    return this.payrollService.updatePayrollPolicy(companyId, id, dto, userId);
  }

  @Post('types')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear tipo de nómina operativo' })
  createType(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollTypeConfigDto,
  ) {
    return this.payrollService.createPayrollTypeConfig(companyId, dto, userId);
  }

  @Put('types/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar tipo de nómina operativo' })
  updateType(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollTypeConfigDto,
  ) {
    return this.payrollService.updatePayrollTypeConfig(companyId, id, dto, userId);
  }

  @Get('novelties')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar novedades e incidencias de nómina' })
  findAllNovelties(
    @CurrentUser('companyId') companyId: string,
    @Query('period') period?: string,
    @Query('employeeId') employeeId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payrollService.findAllPayrollNovelties(companyId, {
      period,
      employeeId,
      type,
      status,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Post('novelties')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear novedad o incidencia de nómina' })
  createNovelty(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollNoveltyDto,
  ) {
    return this.payrollService.createPayrollNovelty(companyId, dto, userId);
  }

  @Put('novelties/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar novedad o incidencia de nómina' })
  updateNovelty(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollNoveltyDto,
  ) {
    return this.payrollService.updatePayrollNovelty(companyId, id, dto, userId);
  }

  @Get('batches')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar lotes de pre-nómina' })
  findAllBatches(
    @CurrentUser('companyId') companyId: string,
    @Query('period') period?: string,
  ) {
    return this.payrollService.listPayrollBatches(companyId, period);
  }

  @Get('period-dashboard/:period')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Panel del período de nómina' })
  getPeriodDashboard(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getPayrollPeriodDashboard(companyId, period, branchId || undefined);
  }

  @Post('batches/preview')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Previsualizar generación masiva de nómina' })
  previewBatch(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreatePayrollBatchDto,
  ) {
    return this.payrollService.previewPayrollBatch(companyId, dto);
  }

  @Post('batches')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Generar lote de pre-nómina' })
  createBatch(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePayrollBatchDto,
  ) {
    return this.payrollService.generatePayrollBatch(companyId, dto, userId);
  }

  @Get('batches/:id/approvals')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Flujo de aprobación de pre-nómina' })
  getBatchApprovalFlow(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.getBatchApprovalFlow(companyId, id);
  }

  @Post('batches/:id/approvals')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Solicitar aprobación de pre-nómina' })
  requestBatchApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPayrollApprovalDto,
  ) {
    return this.payrollService.requestBatchApproval(companyId, id, dto, userId);
  }

  @Post('batches/:id/approvals/approve')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Aprobar pre-nómina' })
  approveBatchApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.approveBatchApproval(companyId, id, userId);
  }

  @Post('batches/:id/approvals/reject')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Rechazar pre-nómina' })
  rejectBatchApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayrollApprovalDto,
  ) {
    return this.payrollService.rejectBatchApproval(companyId, id, dto, userId);
  }

  @Post('periods/close')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Cerrar período de nómina' })
  closePeriod(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: PayrollPeriodControlDto,
  ) {
    return this.payrollService.closePayrollPeriod(companyId, dto, userId);
  }

  @Post('periods/reopen')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Reabrir período de nómina' })
  reopenPeriod(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: PayrollPeriodControlDto,
  ) {
    return this.payrollService.reopenPayrollPeriod(companyId, dto, userId);
  }

  // ── EMPLOYEES ─────────────────────────────────────────────────────────────

  @Get('employees')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'List employees' })
  findAllEmployees(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() _currentBranchId: string,
    @Query('branchId') branchId?: string,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('page')   page?:   string,
    @Query('limit')  limit?:  string,
  ) {
    const activeBool = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.payrollService.findAllEmployees(companyId, {
      branchId: branchId  ? undefined : (branchId || undefined),
      search, active: activeBool,
      page:  Number(page)  || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('employees/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Get employee detail' })
  findEmployee(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.findEmployee(companyId, id);
  }

  @Get('portal/employee/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Resumen de portal y autoservicio del empleado' })
  getEmployeePortalSummary(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('period') period?: string,
  ) {
    return this.payrollService.getEmployeePortalSummary(companyId, id, period);
  }

  @Post('portal/employee/:id/requests')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Registrar solicitud de vacaciones o licencia del empleado' })
  createEmployeePortalRequest(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePayrollEmployeeRequestDto,
  ) {
    return this.payrollService.createEmployeePortalRequest(companyId, id, dto, userId);
  }

  @Get('portal/employee/:id/certificate')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Generar certificado laboral HTML' })
  async getEmploymentCertificate(
    @Res() res: Response,
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const buffer = await this.payrollService.generateEmploymentCertificate(companyId, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buffer);
  }

  @Post('employees')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Create employee' })
  createEmployee(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.payrollService.createEmployee(companyId, dto, userId);
  }

  @Put('employees/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Update employee' })
  updateEmployee(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.payrollService.updateEmployee(companyId, id, dto, userId);
  }

  @Post('employees/:id/contracts/extension')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Registrar prórroga contractual' })
  extendContract(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendPayrollContractDto,
  ) {
    return this.payrollService.extendEmployeeContract(companyId, id, dto, userId);
  }

  @Post('employees/:id/contracts/change')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Registrar cambio contractual o laboral' })
  changeEmployment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePayrollEmploymentDto,
  ) {
    return this.payrollService.changeEmployeeEmployment(companyId, id, dto, userId);
  }

  @Post('employees/:id/final-settlement')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Generar liquidación final del empleado' })
  createFinalSettlement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFinalSettlementDto,
  ) {
    return this.payrollService.createFinalSettlement(companyId, id, dto, userId);
  }

  @Patch('employees/:id/deactivate')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate employee (ADMIN only)' })
  deactivateEmployee(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.deactivateEmployee(companyId, id, userId);
  }

  // ── PAYROLL RECORDS ────────────────────────────────────────────────────────

  @Get('records')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'List payroll records' })
  findAllPayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('period')     period?:     string,
    @Query('employeeId') employeeId?: string,
    @Query('status')     status?:     string,
    @Query('page')       page?:       string,
    @Query('limit')      limit?:      string,
  ) {
    return this.payrollService.findAllPayroll(companyId, {
      branchId: branchId || undefined,
      period, employeeId, status,
      page:  Number(page)  || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('records/summary/:period')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Period summary (YYYY-MM)' })
  getPeriodSummary(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getPeriodSummary(companyId, period, branchId || undefined);
  }

  @Get('analytics/summary')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Tablero gerencial de nómina' })
  getPayrollAnalyticsSummary(
    @CurrentUser('companyId') companyId: string,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.payrollService.getPayrollAnalyticsSummary(companyId, period, branchId || undefined);
  }

  @Get('accruals/:period')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Resumen de acumulados y provisiones laborales por período' })
  getAccruals(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getPayrollAccrualSummary(companyId, period, branchId || undefined);
  }

  @Post('provisions/run')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Ejecutar provisiones periódicas de nómina' })
  runProvisions(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: RunPayrollProvisionDto,
  ) {
    return this.payrollService.runPayrollProvisions(companyId, dto, userId);
  }

  @Get('social-security/summary/:period')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Resumen de seguridad social y parafiscales por período' })
  getSocialSecuritySummary(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getSocialSecuritySummary(companyId, period, branchId || undefined);
  }

  @Get('social-security/reconciliation/:period')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Conciliación de seguridad social y parafiscales' })
  getSocialSecurityReconciliation(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getSocialSecurityReconciliation(companyId, period, branchId || undefined);
  }

  @Get('social-security/pila-export/:period')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Exportación operativa tipo PILA por período' })
  getPilaExport(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getPilaExport(companyId, period, branchId || undefined);
  }

  @Get('records/:id/receipt')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Generar comprobante de pago HTML' })
  async getPayrollReceipt(
    @Res() res: Response,
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const buffer = await this.payrollService.generatePayrollReceipt(companyId, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buffer);
  }

  @Get('records/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Get payroll record detail' })
  findPayrollRecord(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.findPayrollRecord(companyId, id);
  }

  @Get('records/:id/approvals')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Flujo de aprobación de la liquidación' })
  getRecordApprovalFlow(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.getRecordApprovalFlow(companyId, id);
  }

  @Post('records/:id/approvals')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Solicitar aprobación antes de enviar o anular' })
  requestRecordApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPayrollApprovalDto,
  ) {
    return this.payrollService.requestRecordApproval(companyId, id, dto, userId);
  }

  @Post('records/:id/approvals/approve')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Aprobar liquidación' })
  approveRecordApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.approveRecordApproval(companyId, id, userId);
  }

  @Post('records/:id/approvals/reject')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Rechazar liquidación' })
  rejectRecordApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPayrollApprovalDto,
  ) {
    return this.payrollService.rejectRecordApproval(companyId, id, dto, userId);
  }

  @Get('records/:id/attachments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar soportes de la liquidación' })
  getRecordAttachments(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.getRecordAttachments(companyId, id);
  }

  @Post('records/:id/attachments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Agregar soporte a la liquidación' })
  addRecordAttachment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPayrollAttachmentDto,
  ) {
    return this.payrollService.addRecordAttachment(companyId, id, dto, userId);
  }

  @Get('records/:id/audit-trail')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Bitácora visible de la liquidación' })
  getRecordAuditTrail(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.getRecordAuditTrail(companyId, id);
  }

  @Post('records')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Create payroll draft record' })
  createPayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Body() dto: CreatePayrollDto,
  ) {
    return this.payrollService.createPayroll(companyId, dto, userId);
  }

  @Post('preview')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview payroll calculation without saving' })
  previewPayroll(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreatePayrollDto,
  ): Promise<any> {
    return this.payrollService.previewPayroll(companyId, dto);
  }

  /**
   * POST /payroll/records/:id/submit
   * Genera XML UBL NominaIndividual, lo firma con XAdES-BES,
   * lo empaqueta en ZIP y lo envía a la DIAN vía SendTestSetAsync (HAB) o SendBillAsync (PROD).
   * Devuelve el ZipKey, CUNE y estado DIAN.
   */
  @Post('records/:id/submit')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit payroll to DIAN — generates XML+CUNE, signs, ZIPs and sends (ADMIN/MANAGER/CONTADOR only)' })
  submitPayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.submitPayroll(companyId, id, userId);
  }

  /**
   * POST /payroll/records/:id/check-status
   * Consulta el estado del documento en la DIAN por ZipKey o CUNE.
   */
  @Post('records/:id/check-status')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Query DIAN status of a submitted payroll record' })
  checkPayrollStatus(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.checkPayrollStatus(companyId, id, userId);
  }

  @Get('operations/monitor')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Monitor técnico de resiliencia DIAN para nómina' })
  getOperationsMonitor(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('period') period?: string,
  ) {
    return this.payrollService.getPayrollOperationsMonitor(companyId, period, branchId || undefined);
  }

  @Post('records/:id/queue-reprocess')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Encolar reproceso DIAN por documento de nómina' })
  queueRecordReprocess(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QueuePayrollReprocessDto,
  ) {
    return this.payrollService.queuePayrollReprocess(companyId, id, dto, userId);
  }

  @Post('operations/reprocess')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Encolar reproceso masivo DIAN para nómina' })
  bulkReprocess(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: BulkPayrollReprocessDto,
  ) {
    return this.payrollService.bulkPayrollReprocess(companyId, branchId || undefined, dto, userId);
  }

  @Post('operations/process-queue')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Procesar la cola técnica DIAN de nómina' })
  processQueuedOperations(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.payrollService.processQueuedPayrollOperations(companyId, branchId || undefined, userId);
  }

  /**
   * POST /payroll/records/:id/nota-ajuste
   * Crea una Nota de Ajuste (NominaIndividualDeAjuste) a partir de un NIE ya transmitido.
   * - tipoAjuste='Reemplazar': corrige errores aritméticos o de contenido (Artículo 17 párrafos 4-6, 11)
   * - tipoAjuste='Eliminar':   anula el documento sin contenido de nómina (Artículo 17 último párrafo)
   * El resultado es un borrador NIAE que puede revisarse antes de transmitir a la DIAN.
   */
  @Post('records/:id/nota-ajuste')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear Nota de Ajuste (NIAE) sobre un NIE transmitido — Res. 000013 Art.17' })
  createNotaAjuste(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: {
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
  ) {
    return this.payrollService.createNotaAjuste(companyId, id, dto, userId);
  }

  /**
   * GET /payroll/records/:id/download
   * Devuelve el XML firmado y el ZIP (base64) para descargar desde el frontend.
   * Solo disponible para registros que hayan sido transmitidos (tienen xmlSigned en BD).
   */
  @Get('records/:id/download')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Get signed XML + ZIP as base64 for download' })
  downloadPayrollFiles(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.downloadPayrollFiles(companyId, id);
  }

  @Patch('records/:id/void')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void payroll record (ADMIN only)' })
  voidPayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.payrollService.voidPayroll(companyId, id, reason, userId);
  }

  @Post('records/:id/reverse')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Reverso controlado de nómina mediante nota de ajuste' })
  reversePayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePayrollDto,
  ) {
    return this.payrollService.reversePayroll(companyId, id, dto, userId);
  }
}
