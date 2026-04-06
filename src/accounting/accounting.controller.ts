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
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.accountingService.createEntry(companyId, dto);
  }

  @Put('journal-entries/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar comprobante (solo si está en DRAFT)' })
  updateEntry(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    return this.accountingService.updateEntry(companyId, id, dto);
  }

  @Patch('journal-entries/:id/post')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Contabilizar comprobante: DRAFT → POSTED' })
  postEntry(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.postEntry(companyId, id);
  }

  @Patch('journal-entries/:id/cancel')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Anular comprobante: POSTED → CANCELLED (solo ADMIN)' })
  cancelEntry(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.cancelEntry(companyId, id);
  }

  @Delete('journal-entries/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar comprobante (soft-delete, solo si está en DRAFT)' })
  removeEntry(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accountingService.removeEntry(companyId, id);
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
