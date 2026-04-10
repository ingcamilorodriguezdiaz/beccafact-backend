import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JournalEntryStatus } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { CreateAccountingPeriodDto } from './dto/create-accounting-period.dto';
import { CreateAccountingBankAccountDto } from './dto/create-accounting-bank-account.dto';
import { ImportAccountingBankStatementDto } from './dto/import-accounting-bank-statement.dto';
import { ReconcileAccountingBankMovementDto } from './dto/reconcile-accounting-bank-movement.dto';
import { UpsertAccountingTaxConfigDto } from './dto/accounting-tax-config.dto';
import { UpsertInvoiceAccountingProfileDto } from './dto/invoice-accounting-profile.dto';
import {
  AmortizeAccountingDeferredChargeDto,
  CreateAccountingDeferredChargeDto,
  CreateAccountingFixedAssetDto,
  CreateAccountingProvisionTemplateDto,
  DepreciateAccountingFixedAssetDto,
  RunAccountingProvisionDto,
} from './dto/accounting-assets.dto';
import {
  AddJournalAttachmentDto,
  RejectJournalApprovalDto,
  RequestJournalApprovalDto,
  ReverseJournalEntryDto,
} from './dto/accounting-governance.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { DEFAULT_PAGE, DEFAULT_LIMIT } from '../common/constants/pagination.constants';

@ApiTags('accounting')
@ApiBearerAuth()
@PlanFeature('has_accounting')
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'accounting', version: '1' })
export class AccountingController {
  constructor(private accountingService: AccountingService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // PERÍODOS CONTABLES
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('periods')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar períodos contables configurados' })
  findAllPeriods(
    @CurrentUser('companyId') companyId: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    return this.accountingService.findAllPeriods(companyId, {
      year: year ? Number(year) : undefined,
      status: status?.toUpperCase(),
    });
  }

  @Post('periods')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear período contable mensual' })
  createPeriod(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateAccountingPeriodDto,
  ) {
    return this.accountingService.createPeriod(companyId, dto);
  }

  @Patch('periods/:id/close')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Cerrar período contable y bloquear contabilización' })
  closePeriod(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.closePeriod(companyId, id);
  }

  @Patch('periods/:id/reopen')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Reabrir período contable previamente cerrado' })
  reopenPeriod(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.reopenPeriod(companyId, id);
  }

  @Patch('periods/:id/lock')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Bloquear manualmente un período abierto' })
  lockPeriod(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.lockPeriod(companyId, id);
  }

  @Patch('periods/:id/unlock')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Desbloquear manualmente un período abierto' })
  unlockPeriod(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.unlockPeriod(companyId, id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CUENTAS CONTABLES
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('accounts')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar cuentas contables del PUC con filtros' })
  findAllAccounts(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('level') level?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber   = Number(page)  || DEFAULT_PAGE;
    const limitNumber  = Number(limit) || DEFAULT_LIMIT;
    const levelNumber  = level !== undefined ? Number(level) : undefined;
    const activeFilter = isActive !== undefined ? isActive === 'true' : undefined;

    return this.accountingService.findAllAccounts(companyId, {
      search,
      level:    levelNumber,
      isActive: activeFilter,
      page:     pageNumber,
      limit:    limitNumber,
    });
  }

  @Get('accounts/tree')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Árbol jerárquico completo del PUC de la empresa' })
  getAccountsTree(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.getAccountsTree(companyId);
  }

  @Get('accounts/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Detalle de una cuenta contable' })
  findOneAccount(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.findOneAccount(companyId, id);
  }

  @Post('accounts')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear nueva cuenta en el PUC' })
  createAccount(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountingService.createAccount(companyId, dto);
  }

  @Put('accounts/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar cuenta contable' })
  updateAccount(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountingService.updateAccount(companyId, id, dto);
  }

  @Patch('accounts/:id/toggle')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Activar o desactivar una cuenta contable' })
  toggleAccount(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.toggleAccount(companyId, id);
  }

  @Delete('accounts/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cuenta (soft-delete si tiene líneas, físico si no)' })
  removeAccount(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.removeAccount(companyId, id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COMPROBANTES CONTABLES
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('journal-entries')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar comprobantes contables con filtros' })
  findAllEntries(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber  = Number(page)  || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    const statusFilter = status
      ? (status.toUpperCase() as JournalEntryStatus)
      : undefined;

    return this.accountingService.findAllEntries(companyId, {
      search,
      status:   statusFilter,
      dateFrom,
      dateTo,
      page:     pageNumber,
      limit:    limitNumber,
    });
  }

  @Get('journal-entries/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Detalle de un comprobante con sus líneas y cuentas' })
  findOneEntry(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.findOneEntry(companyId, id);
  }

  @Post('journal-entries')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear comprobante contable (valida partida doble)' })
  createEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.accountingService.createEntry(companyId, dto, userId);
  }

  @Put('journal-entries/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar comprobante (solo si está en DRAFT)' })
  updateEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    return this.accountingService.updateEntry(companyId, id, dto, userId);
  }

  @Patch('journal-entries/:id/post')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Contabilizar comprobante: DRAFT → POSTED' })
  postEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.postEntry(companyId, id, userId);
  }

  @Patch('journal-entries/:id/cancel')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Anular comprobante: POSTED → CANCELLED (solo ADMIN)' })
  cancelEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.cancelEntry(companyId, id, userId);
  }

  @Delete('journal-entries/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar comprobante (soft-delete, solo si está en DRAFT)' })
  removeEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.removeEntry(companyId, id, userId);
  }

  @Get('journal-entries/:id/approval-flow')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Flujo de aprobación del comprobante contable' })
  getEntryApprovalFlow(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.getEntryApprovalFlow(companyId, id);
  }

  @Post('journal-entries/:id/request-approval')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Solicitar aprobación del comprobante contable' })
  requestEntryApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestJournalApprovalDto,
  ) {
    return this.accountingService.requestEntryApproval(companyId, id, dto, userId);
  }

  @Patch('journal-entries/:id/approve')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Aprobar comprobante contable pendiente' })
  approveEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.approveEntry(companyId, id, userId);
  }

  @Patch('journal-entries/:id/reject')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Rechazar comprobante contable pendiente' })
  rejectEntryApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectJournalApprovalDto,
  ) {
    return this.accountingService.rejectEntryApproval(companyId, id, dto, userId);
  }

  @Get('journal-entries/:id/attachments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar adjuntos y soportes del comprobante contable' })
  getEntryAttachments(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.getEntryAttachments(companyId, id);
  }

  @Post('journal-entries/:id/attachments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Registrar soporte documental del comprobante contable' })
  addEntryAttachment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddJournalAttachmentDto,
  ) {
    return this.accountingService.addEntryAttachment(companyId, id, dto, userId);
  }

  @Get('journal-entries/:id/audit-trail')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Consultar bitácora y trazabilidad del comprobante contable' })
  getEntryAuditTrail(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.getEntryAuditTrail(companyId, id);
  }

  @Post('journal-entries/:id/reverse')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Generar reverso controlado del comprobante mediante asiento espejo' })
  reverseEntry(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
  ) {
    return this.accountingService.reverseEntry(companyId, id, dto, userId);
  }

  @Get('integrations/summary')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen de integración automática con otros módulos del ERP' })
  getIntegrationsSummary(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.getIntegrationsSummary(companyId);
  }

  @Get('integrations/activity')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Historial de sincronizaciones automáticas de contabilidad' })
  getIntegrationsActivity(
    @CurrentUser('companyId') companyId: string,
    @Query('module') module?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accountingService.getIntegrationsActivity(companyId, {
      module,
      status,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Post('integrations/sync-pending')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Sincronizar pendientes automáticos de facturación y nómina' })
  syncPendingIntegrations(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.syncPendingIntegrations(companyId);
  }

  @Post('integrations/sync')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Resincronizar manualmente un documento puntual con contabilidad' })
  syncIntegrationResource(
    @CurrentUser('companyId') companyId: string,
    @Body('module') module: string,
    @Body('resourceId') resourceId: string,
  ) {
    return this.accountingService.syncIntegrationResource(companyId, module, resourceId);
  }

  @Get('bank-accounts')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar cuentas bancarias contables configuradas' })
  findAllBankAccounts(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.findAllBankAccounts(companyId);
  }

  @Post('bank-accounts')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear cuenta bancaria para conciliación contable' })
  createBankAccount(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateAccountingBankAccountDto,
  ) {
    return this.accountingService.createBankAccount(companyId, dto);
  }

  @Get('bank-movements')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar movimientos de extractos bancarios contables' })
  findAllBankMovements(
    @CurrentUser('companyId') companyId: string,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accountingService.findAllBankMovements(companyId, {
      bankAccountId,
      status,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Post('bank-movements/import')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Importar extracto bancario contable y sugerir conciliación automática' })
  importBankStatement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ImportAccountingBankStatementDto,
  ) {
    return this.accountingService.importBankStatement(companyId, dto, userId);
  }

  @Patch('bank-movements/:id/reconcile')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Conciliar movimiento bancario contra comprobante contable' })
  reconcileBankMovement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileAccountingBankMovementDto,
  ) {
    return this.accountingService.reconcileBankMovement(companyId, id, dto, userId);
  }

  @Get('bank-reconciliation/pending')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Partidas pendientes entre extracto bancario y contabilidad' })
  getPendingBankReconciliation(
    @CurrentUser('companyId') companyId: string,
    @Query('bankAccountId') bankAccountId: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.accountingService.getPendingBankReconciliation(companyId, {
      bankAccountId,
      dateTo,
    });
  }

  @Get('taxes/config')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar configuración contable de impuestos y retenciones' })
  getTaxConfigs(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.getTaxConfigs(companyId);
  }

  @Post('taxes/config')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear o actualizar configuración de impuestos y retenciones' })
  upsertTaxConfig(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpsertAccountingTaxConfigDto,
  ) {
    return this.accountingService.upsertTaxConfig(companyId, dto);
  }

  @Get('invoice-accounting-profiles')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar perfiles contables para facturación electrónica' })
  getInvoiceAccountingProfiles(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.getInvoiceAccountingProfiles(companyId);
  }

  @Post('invoice-accounting-profiles')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear o actualizar perfil contable de facturación' })
  upsertInvoiceAccountingProfile(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpsertInvoiceAccountingProfileDto,
  ) {
    return this.accountingService.upsertInvoiceAccountingProfile(companyId, dto);
  }

  @Get('reports/fiscal-summary')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen fiscal de IVA, retefuente e ICA por rango de fechas' })
  getFiscalSummary(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.accountingService.getFiscalSummary(companyId, { dateFrom, dateTo });
  }

  @Get('reports/vat-sales-book')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Libro fiscal de IVA ventas' })
  getVatSalesBook(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.accountingService.getVatSalesBook(companyId, { dateFrom, dateTo });
  }

  @Get('reports/vat-purchases-book')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Libro fiscal de IVA compras' })
  getVatPurchasesBook(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.accountingService.getVatPurchasesBook(companyId, { dateFrom, dateTo });
  }

  @Get('reports/withholdings-book')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Libro de retenciones y partidas fiscales contabilizadas' })
  getWithholdingsBook(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.accountingService.getWithholdingsBook(companyId, { dateFrom, dateTo });
  }

  @Get('assets/summary')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen enterprise de activos fijos, diferidos y provisiones' })
  getEnterpriseAssetsSummary(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.getEnterpriseAssetsSummary(companyId);
  }

  @Get('fixed-assets')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar activos fijos contables' })
  findAllFixedAssets(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.findAllFixedAssets(companyId);
  }

  @Post('fixed-assets')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear activo fijo contable' })
  createFixedAsset(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateAccountingFixedAssetDto,
  ) {
    return this.accountingService.createFixedAsset(companyId, dto);
  }

  @Post('fixed-assets/:id/depreciate')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Ejecutar depreciación periódica de un activo fijo' })
  depreciateFixedAsset(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepreciateAccountingFixedAssetDto,
  ) {
    return this.accountingService.depreciateFixedAsset(companyId, id, dto);
  }

  @Get('deferred-charges')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar cargos diferidos y amortizaciones' })
  findAllDeferredCharges(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.findAllDeferredCharges(companyId);
  }

  @Post('deferred-charges')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear cargo diferido contable' })
  createDeferredCharge(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateAccountingDeferredChargeDto,
  ) {
    return this.accountingService.createDeferredCharge(companyId, dto);
  }

  @Post('deferred-charges/:id/amortize')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Ejecutar amortización periódica de un diferido' })
  amortizeDeferredCharge(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmortizeAccountingDeferredChargeDto,
  ) {
    return this.accountingService.amortizeDeferredCharge(companyId, id, dto);
  }

  @Get('provision-templates')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar plantillas de provisiones periódicas' })
  findAllProvisionTemplates(@CurrentUser('companyId') companyId: string) {
    return this.accountingService.findAllProvisionTemplates(companyId);
  }

  @Post('provision-templates')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear plantilla de provisión periódica' })
  createProvisionTemplate(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateAccountingProvisionTemplateDto,
  ) {
    return this.accountingService.createProvisionTemplate(companyId, dto);
  }

  @Post('provision-templates/:id/run')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Ejecutar provisión periódica y generar asiento automático' })
  runProvisionTemplate(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunAccountingProvisionDto,
  ) {
    return this.accountingService.runProvisionTemplate(companyId, id, dto);
  }

  @Get('reports/trial-balance')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Reporte de balance de prueba por rango de fechas' })
  getTrialBalance(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('level') level?: string,
    @Query('search') search?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.accountingService.getTrialBalance(companyId, {
      dateFrom,
      dateTo,
      level: level ? Number(level) : undefined,
      search,
      includeZero: includeZero === 'true',
    });
  }

  @Get('reports/general-ledger')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Libro mayor por cuenta con saldo inicial, movimientos y saldo final' })
  getGeneralLedger(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('level') level?: string,
    @Query('search') search?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.accountingService.getGeneralLedger(companyId, {
      dateFrom,
      dateTo,
      level: level ? Number(level) : undefined,
      search,
      includeZero: includeZero === 'true',
    });
  }

  @Get('reports/account-auxiliary')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Auxiliar contable detallado por cuenta' })
  getAccountAuxiliary(
    @CurrentUser('companyId') companyId: string,
    @Query('accountId') accountId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.accountingService.getAccountAuxiliary(companyId, {
      accountId,
      dateFrom,
      dateTo,
    });
  }

  @Get('reports/financial-statements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Estados financieros base: balance general y estado de resultados' })
  getFinancialStatements(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('level') level?: string,
  ) {
    return this.accountingService.getFinancialStatements(companyId, {
      dateFrom,
      dateTo,
      level: level ? Number(level) : undefined,
    });
  }
}
