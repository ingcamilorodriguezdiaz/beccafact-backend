import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CarteraService } from './cartera.service';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/common/constants/pagination.constants';
import { CurrentBranchId } from '@/common/decorators/current-branch-id.decorator';

@ApiTags('cartera')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@PlanFeature('has_cartera')
@Controller({ path: 'cartera', version: '1' })
export class CarteraController {
  constructor(private carteraService: CarteraService) {}

  // ── Dashboard ── ADMIN, MANAGER, OPERATOR
  @Get('dashboard')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Resumen ejecutivo y aging de cartera' })
  getDashboard(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.carteraService.getDashboard(companyId, branchId || undefined);
  }

  // ── Aging report ── ADMIN, MANAGER, OPERATOR
  @Get('aging')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Informe de antigüedad de saldos por cliente' })
  getAgingReport(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.carteraService.getAgingReport(companyId, branchId || undefined);
  }

  // ── Listado ── ADMIN, MANAGER, OPERATOR
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Listar cartera (facturas por cobrar)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    return this.carteraService.findAll(companyId, { branchId,search, status, customerId, page: pageNumber, limit: limitNumber });
  }

  // ── Cartera por cliente ── ADMIN, MANAGER, OPERATOR
  @Get('cliente/:customerId')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Ver cartera de un cliente específico' })
  getClienteCartera(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.carteraService.getClienteCartera(companyId,branchId, customerId);
  }

  // ── Historial de pagos de una factura ── ADMIN, MANAGER, OPERATOR
  @Get(':invoiceId/pagos')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Ver historial de pagos de una factura' })
  getPaymentHistory(
    @CurrentUser('companyId') companyId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    return this.carteraService.getPaymentHistory(companyId, invoiceId);
  }

  // ── Registrar pago ── ADMIN, MANAGER (OPERADOR NO puede registrar pagos)
  @Post(':invoiceId/pago')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar pago de una factura (solo ADMIN/MANAGER)' })
  registrarPago(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: RegisterPaymentDto,
  ) {
    return this.carteraService.registrarPago(companyId, invoiceId, dto, userId);
  }

  // ── Enviar recordatorio ── ADMIN, MANAGER
  @Post(':invoiceId/recordatorio')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar recordatorio de pago (solo ADMIN/MANAGER)' })
  sendReminder(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    return this.carteraService.sendReminder(companyId, invoiceId, userId);
  }
}
