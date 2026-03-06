import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CarteraService } from './cartera.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/common/constants/pagination.constants';

@ApiTags('cartera')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@PlanFeature('has_cartera')
@Controller({ path: 'cartera', version: '1' })
export class CarteraController {
  constructor(private carteraService: CarteraService) {}

  // ── Dashboard ── ADMIN, MANAGER, OPERATOR (solo lectura para operador)
  @Get('dashboard')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Resumen ejecutivo de cartera' })
  getDashboard(@CurrentUser('companyId') companyId: string) {
    return this.carteraService.getDashboard(companyId);
  }

  // ── Listado ── ADMIN, MANAGER, OPERATOR
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Listar cartera (facturas por cobrar)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    return this.carteraService.findAll(companyId, { search, status, customerId, page:pageNumber, limit:limitNumber });
  }

  // ── Cartera por cliente ── ADMIN, MANAGER, OPERATOR
  @Get('cliente/:customerId')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Ver cartera de un cliente específico' })
  getClienteCartera(
    @CurrentUser('companyId') companyId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.carteraService.getClienteCartera(companyId, customerId);
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
    @Body() dto: {
      monto: number;
      fecha: string;
      medioPago: string;
      referencia?: string;
      notas?: string;
    },
  ) {
    return this.carteraService.registrarPago(companyId, invoiceId, dto, userId);
  }

  // ── Enviar recordatorio ── ADMIN, MANAGER (OPERADOR NO)
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
