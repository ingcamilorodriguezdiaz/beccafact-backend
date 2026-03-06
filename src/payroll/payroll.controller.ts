import {
  Controller, Get, Post, Put, Patch, Body,
  Param, Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PayrollService, CreateEmployeeDto, UpdateEmployeeDto, CreatePayrollDto } from './payroll.service';
import { JwtAuthGuard }        from '../common/guards/jwt-auth.guard';
import { RolesGuard }          from '../common/guards/roles.guard';
import { PlanGuard }           from '../common/guards/plan.guard';
import { CompanyStatusGuard }  from '../common/guards/company-status.guard';
import { CurrentUser }         from '../common/decorators/current-user.decorator';
import { Roles }               from '../common/decorators/roles.decorator';
import { PlanFeature }         from '../common/decorators/plan-feature.decorator';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/common/constants/pagination.constants';

@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@PlanFeature('has_payroll')
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private payrollService: PayrollService) {}

  // ── EMPLOYEES ────────────────────────────────────────────────────────────

  @Get('employees')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'List employees' })
  findAllEmployees(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    const activeBool = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.payrollService.findAllEmployees(companyId, { search, active: activeBool, page:pageNumber, limit:limitNumber });
  }

  @Get('employees/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Get employee detail' })
  findEmployee(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.findEmployee(companyId, id);
  }

  /** OPERATOR cannot create or edit employees */
  @Post('employees')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Create employee (ADMIN/MANAGER only)' })
  createEmployee(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.payrollService.createEmployee(companyId, dto, userId);
  }

  @Put('employees/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Update employee (ADMIN/MANAGER only)' })
  updateEmployee(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.payrollService.updateEmployee(companyId, id, dto, userId);
  }

  /** Only ADMIN can deactivate employees */
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

  // ── PAYROLL RECORDS ──────────────────────────────────────────────────────

  @Get('records')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'List payroll records' })
  findAllPayroll(
    @CurrentUser('companyId') companyId: string,
    @Query('period')     period?:     string,
    @Query('employeeId') employeeId?: string,
    @Query('status')     status?:     string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    return this.payrollService.findAllPayroll(companyId, { period, employeeId, status, page:pageNumber, limit:limitNumber });
  }

  @Get('records/summary/:period')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Period summary (YYYY-MM)' })
  getPeriodSummary(
    @CurrentUser('companyId') companyId: string,
    @Param('period') period: string,
  ) {
    return this.payrollService.getPeriodSummary(companyId, period);
  }

  @Get('records/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Get payroll record detail' })
  findPayrollRecord(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.findPayrollRecord(companyId, id);
  }

  /** OPERATOR can create DRAFT records but cannot submit or void */
  @Post('records')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Create payroll draft record' })
  createPayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Body() dto: CreatePayrollDto,
  ) {
    return this.payrollService.createPayroll(companyId, dto, userId);
  }

  @Post('preview')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview payroll calculation without saving' })
  previewPayroll(@Body() dto: CreatePayrollDto) {
    return this.payrollService.previewPayroll(dto);
  }

  /** OPERATOR cannot submit records to DIAN */
  @Post('records/:id/submit')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit payroll to DIAN (ADMIN/MANAGER only)' })
  submitPayroll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub')       userId:    string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payrollService.submitPayroll(companyId, id, userId);
  }

  /** Only ADMIN can void payroll records */
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
}