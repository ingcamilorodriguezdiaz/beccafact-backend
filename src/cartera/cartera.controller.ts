import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CarteraService } from './cartera.service';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { CreateReceiptDto } from './dto/create-receipt.dto';
import { ApplyReceiptDto } from './dto/apply-receipt.dto';
import { CreatePaymentPromiseDto } from './dto/create-promise.dto';
import { UpdatePaymentPromiseStatusDto } from './dto/update-promise-status.dto';
import { CreateCollectionFollowUpDto } from './dto/create-follow-up.dto';
import { CreateCarteraAdjustmentDto } from './dto/create-adjustment.dto';
import { RejectCarteraAdjustmentDto } from './dto/reject-adjustment.dto';
import { ImportReceiptsBatchDto } from './dto/import-receipts-batch.dto';
import { ImportBankStatementDto } from './dto/import-bank-statement.dto';
import { ReconcileBankMovementDto } from './dto/reconcile-bank-movement.dto';
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

  @Get('workbench')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Bandeja de cobranza: promesas, seguimientos y prioridades' })
  getCollectionWorkbench(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.carteraService.getCollectionWorkbench(companyId, branchId || undefined);
  }

  @Get('receipts')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar recaudos / recibos de caja de cartera' })
  findAllReceipts(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    return this.carteraService.findAllReceipts(companyId, {
      search,
      status,
      customerId,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @Get('receipts/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Ver detalle de un recaudo / recibo de caja' })
  findOneReceipt(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.carteraService.findOneReceipt(companyId, id);
  }

  @Post('receipts')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear un recaudo independiente y aplicarlo opcionalmente a facturas' })
  createReceipt(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateReceiptDto,
  ) {
    return this.carteraService.createReceipt(companyId, dto, userId);
  }

  @Post('receipts/import-batch')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Importar recaudos masivos desde CSV y aplicarlos opcionalmente por número de factura' })
  importReceiptsBatch(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ImportReceiptsBatchDto,
  ) {
    return this.carteraService.importReceiptsBatch(companyId, dto, userId);
  }

  @Post('receipts/:id/applications')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Aplicar un recaudo existente a una o varias facturas' })
  applyReceipt(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ApplyReceiptDto,
  ) {
    return this.carteraService.applyReceipt(companyId, id, dto, userId);
  }

  @Post('promises')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear promesa de pago' })
  createPromise(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePaymentPromiseDto,
  ) {
    return this.carteraService.createPaymentPromise(companyId, dto, userId);
  }

  @Patch('promises/:id/status')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar estado de promesa de pago' })
  updatePromiseStatus(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentPromiseStatusDto,
  ) {
    return this.carteraService.updatePaymentPromiseStatus(companyId, id, dto, userId);
  }

  @Post('follow-ups')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Registrar gestión de cobranza' })
  createFollowUp(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCollectionFollowUpDto,
  ) {
    return this.carteraService.createCollectionFollowUp(companyId, dto, userId);
  }

  @Get('adjustments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar ajustes financieros y solicitudes de control de cartera' })
  findAllAdjustments(
    @CurrentUser('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.carteraService.findAllAdjustments(companyId, { status, type, customerId });
  }

  @Post('adjustments')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear ajuste financiero o solicitud de control de cartera' })
  createAdjustment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateCarteraAdjustmentDto,
  ) {
    return this.carteraService.createAdjustment(companyId, dto, userId);
  }

  @Patch('adjustments/:id/approve')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Aprobar y aplicar un ajuste de cartera' })
  approveAdjustment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.carteraService.approveAdjustment(companyId, id, userId);
  }

  @Patch('adjustments/:id/reject')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Rechazar un ajuste de cartera' })
  rejectAdjustment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: RejectCarteraAdjustmentDto,
  ) {
    return this.carteraService.rejectAdjustment(companyId, id, dto, userId);
  }

  @Get('bank-movements')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar movimientos de extractos bancarios para conciliación' })
  findAllBankMovements(
    @CurrentUser('companyId') companyId: string,
    @Query('status') status?: string,
  ) {
    return this.carteraService.findAllBankMovements(companyId, { status });
  }

  @Post('bank-movements/import')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Importar extracto bancario en CSV y conciliar automáticamente por referencia' })
  importBankStatement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ImportBankStatementDto,
  ) {
    return this.carteraService.importBankStatement(companyId, dto, userId);
  }

  @Patch('bank-movements/:id/reconcile')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Conciliar un movimiento bancario con un recaudo de cartera' })
  reconcileBankMovement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ReconcileBankMovementDto,
  ) {
    return this.carteraService.reconcileBankMovement(companyId, id, dto, userId);
  }

  @Get('reconciliation/accounting')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Conciliación cartera vs contabilidad para movimientos integrados' })
  getAccountingReconciliation(
    @CurrentUser('companyId') companyId: string,
  ) {
    return this.carteraService.getAccountingReconciliation(companyId);
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
  @Get('cliente/:customerId/estado-cuenta')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Ver estado de cuenta detallado de un cliente' })
  getCustomerStatement(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.carteraService.getCustomerStatement(companyId, customerId, branchId || undefined);
  }

  @Get('cliente/:customerId')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Ver cartera de un cliente específico' })
  getClienteCartera(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.carteraService.getClienteCartera(companyId, branchId || undefined, customerId);
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
