import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, ParseUUIDPipe,
  HttpCode, HttpStatus, Res, StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PurchasingService } from './purchasing.service';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { UpdateCustomerDto } from '../customers/dto/update-customer.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './dto/update-purchase-order.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { DEFAULT_PAGE, DEFAULT_LIMIT } from '../common/constants/pagination.constants';
import { PurchaseOrderStatus } from '@prisma/client';
import {
  ConvertPurchaseRequestToOrderDto,
  CreatePurchaseRequestDto,
  DecidePurchaseApprovalDto,
  RequestPurchaseApprovalDto,
} from './dto/create-purchase-request.dto';
import { PurchaseRequestStatusValue, UpdatePurchaseRequestDto, UpdatePurchaseRequestStatusDto } from './dto/update-purchase-request.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { RegisterPayablePaymentDto } from './dto/register-payable-payment.dto';
import { CreatePurchaseAdjustmentDto, DecidePurchaseAdjustmentDto } from './dto/create-purchase-adjustment.dto';
import { AwardPurchaseSupplierQuoteDto, CreatePurchaseSupplierQuoteDto } from './dto/create-purchase-supplier-quote.dto';
import { CreatePurchaseFrameworkAgreementDto } from './dto/create-purchase-framework-agreement.dto';
import { CreatePurchaseBudgetDto, PurchaseBudgetStatusValue, UpdatePurchaseBudgetDto } from './dto/create-purchase-budget.dto';
import { ApplyPurchaseAdvanceDto, CreatePurchaseAdvanceDto } from './dto/create-purchase-advance.dto';
import { CreatePayableScheduleDto } from './dto/create-payable-schedule.dto';

const PURCHASE_REQUEST_STATUSES: PurchaseRequestStatusValue[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED'];
const PURCHASE_BUDGET_STATUSES: PurchaseBudgetStatusValue[] = ['DRAFT', 'ACTIVE', 'CLOSED'];

@ApiTags('purchasing')
@ApiBearerAuth()
@PlanFeature('has_purchasing')
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'purchasing', version: '1' })
export class PurchasingController {
  constructor(private purchasingService: PurchasingService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CUSTOMERS USADOS EN COMPRAS
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('customers')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar clientes disponibles para compras' })
  findAllCustomers(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    const activeFilter = isActive !== undefined ? isActive === 'true' : undefined;

    return this.purchasingService.findAllCustomers(companyId, {
      search,
      isActive: activeFilter,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @Get('customers/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Detalle de cliente con sus últimas 5 órdenes de compra' })
  findOneCustomer(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneCustomer(companyId, id);
  }

  @Post('customers')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Crear cliente para ser usado en compras' })
  createCustomer(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.purchasingService.createCustomer(companyId, dto);
  }

  @Put('customers/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Actualizar cliente usado en compras' })
  updateCustomer(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.purchasingService.updateCustomer(companyId, id, dto);
  }

  @Patch('customers/:id/toggle')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Activar o desactivar cliente usado en compras' })
  toggleCustomer(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.toggleCustomer(companyId, id);
  }

  @Delete('customers/:id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cliente usado en compras (soft-delete)' })
  removeCustomer(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.removeCustomer(companyId, id);
  }

  // Compatibilidad con integraciones o frontend antiguo
  @Get('suppliers')
  findAllSuppliers(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.findAllCustomers(companyId, search, isActive, page, limit);
  }

  @Get('suppliers/:id')
  findOneSupplier(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.findOneCustomer(companyId, id);
  }

  @Post('suppliers')
  createSupplier(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.createCustomer(companyId, dto);
  }

  @Put('suppliers/:id')
  updateSupplier(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.updateCustomer(companyId, id, dto);
  }

  @Patch('suppliers/:id/toggle')
  toggleSupplier(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.toggleCustomer(companyId, id);
  }

  @Delete('suppliers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSupplier(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.removeCustomer(companyId, id);
  }

  @Get('purchase-budgets')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar presupuestos de compras' })
  findAllPurchaseBudgets(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const statusFilter = status && PURCHASE_BUDGET_STATUSES.includes(status as PurchaseBudgetStatusValue)
      ? (status as PurchaseBudgetStatusValue)
      : undefined;
    return this.purchasingService.findAllPurchaseBudgets(companyId, {
      search,
      status: statusFilter,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('purchase-budgets/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOnePurchaseBudget(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOnePurchaseBudget(companyId, id);
  }

  @Post('purchase-budgets')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  createPurchaseBudget(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseBudgetDto,
  ) {
    return this.purchasingService.createPurchaseBudget(companyId, dto, userId);
  }

  @Put('purchase-budgets/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  updatePurchaseBudget(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseBudgetDto,
  ) {
    return this.purchasingService.updatePurchaseBudget(companyId, id, dto);
  }

  @Get('reports/analytics')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'KPIs y analítica del módulo de compras' })
  getAnalyticsReport(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.purchasingService.getAnalyticsReport(companyId, { dateFrom, dateTo });
  }

  @Get('reports/traceability')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Trazabilidad completa del proceso de compras' })
  getTraceabilityReport(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.getTraceabilityReport(companyId, {
      search,
      dateFrom,
      dateTo,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PURCHASE ORDERS
  // ─────────────────────────────────────────────────────────────────────────────

  @Get('purchase-requests')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar solicitudes de compra' })
  findAllRequests(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    const statusFilter = status && PURCHASE_REQUEST_STATUSES.includes(status as PurchaseRequestStatusValue)
      ? (status as PurchaseRequestStatusValue)
      : undefined;
    return this.purchasingService.findAllRequests(companyId, {
      search,
      status: statusFilter,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @Get('purchase-requests/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOneRequest(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneRequest(companyId, id);
  }

  @Post('purchase-requests')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createRequest(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseRequestDto,
  ) {
    return this.purchasingService.createRequest(companyId, dto, userId);
  }

  @Put('purchase-requests/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  updateRequest(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseRequestDto,
  ) {
    return this.purchasingService.updateRequest(companyId, id, dto);
  }

  @Patch('purchase-requests/:id/status')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  updateRequestStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseRequestStatusDto,
  ) {
    return this.purchasingService.updateRequestStatus(companyId, id, dto);
  }

  @Post('purchase-requests/:id/request-approval')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  requestApproval(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPurchaseApprovalDto,
  ) {
    return this.purchasingService.requestApproval(companyId, id, dto);
  }

  @Patch('purchase-requests/:id/approve')
  @Roles('ADMIN', 'MANAGER')
  approveRequest(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidePurchaseApprovalDto,
  ) {
    return this.purchasingService.approveRequest(companyId, id, dto, userId);
  }

  @Patch('purchase-requests/:id/reject')
  @Roles('ADMIN', 'MANAGER')
  rejectRequest(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidePurchaseApprovalDto,
  ) {
    return this.purchasingService.rejectRequest(companyId, id, dto, userId);
  }

  @Post('purchase-requests/:id/convert-to-order')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  convertRequestToOrder(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertPurchaseRequestToOrderDto,
  ) {
    return this.purchasingService.convertRequestToOrder(companyId, id, dto);
  }

  @Delete('purchase-requests/:id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRequest(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.removeRequest(companyId, id);
  }

  @Get('purchase-receipts')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllReceipts(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('orderId') orderId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    return this.purchasingService.findAllReceipts(companyId, {
      search,
      status,
      orderId,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @Get('purchase-receipts/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOneReceipt(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneReceipt(companyId, id);
  }

  @Post('purchase-receipts')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createReceipt(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseReceiptDto,
  ) {
    return this.purchasingService.createReceipt(companyId, dto, userId);
  }

  @Get('purchase-invoices')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllPurchaseInvoices(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.findAllPurchaseInvoices(companyId, {
      search,
      status,
      customerId,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('purchase-invoices/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOnePurchaseInvoice(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOnePurchaseInvoice(companyId, id);
  }

  @Post('purchase-invoices')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  createPurchaseInvoice(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.purchasingService.createPurchaseInvoice(companyId, dto, userId);
  }

  @Patch('purchase-invoices/:id/post')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  postPurchaseInvoice(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.postPurchaseInvoice(companyId, id);
  }

  @Get('accounts-payable')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllAccountsPayable(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.findAllAccountsPayable(companyId, {
      search,
      status,
      customerId,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('accounts-payable/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOneAccountPayable(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneAccountPayable(companyId, id);
  }

  @Post('accounts-payable/:id/payments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  registerAccountPayablePayment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterPayablePaymentDto,
  ) {
    return this.purchasingService.registerAccountPayablePayment(companyId, id, dto, userId);
  }

  @Post('accounts-payable/:id/schedules')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  setAccountPayableSchedule(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePayableScheduleDto,
  ) {
    return this.purchasingService.setAccountPayableSchedule(companyId, id, dto);
  }

  @Get('purchase-advances')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllPurchaseAdvances(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.findAllPurchaseAdvances(companyId, {
      search,
      status,
      customerId,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('purchase-advances/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOnePurchaseAdvance(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOnePurchaseAdvance(companyId, id);
  }

  @Post('purchase-advances')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  createPurchaseAdvance(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseAdvanceDto,
  ) {
    return this.purchasingService.createPurchaseAdvance(companyId, dto, userId);
  }

  @Post('purchase-advances/:id/apply')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  applyPurchaseAdvance(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyPurchaseAdvanceDto,
  ) {
    return this.purchasingService.applyPurchaseAdvance(companyId, id, dto, userId);
  }

  @Get('purchase-adjustments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllPurchaseAdjustments(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.findAllPurchaseAdjustments(companyId, {
      search,
      status,
      type,
      customerId,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('purchase-adjustments/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOnePurchaseAdjustment(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOnePurchaseAdjustment(companyId, id);
  }

  @Post('purchase-adjustments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  createPurchaseAdjustment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseAdjustmentDto,
  ) {
    return this.purchasingService.createPurchaseAdjustment(companyId, dto, userId);
  }

  @Patch('purchase-adjustments/:id/approve')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  approvePurchaseAdjustment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidePurchaseAdjustmentDto,
  ) {
    return this.purchasingService.approvePurchaseAdjustment(companyId, id, dto, userId);
  }

  @Patch('purchase-adjustments/:id/reject')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  rejectPurchaseAdjustment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidePurchaseAdjustmentDto,
  ) {
    return this.purchasingService.rejectPurchaseAdjustment(companyId, id, dto, userId);
  }

  @Get('supplier-quotes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllSupplierQuotes(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('purchaseRequestId') purchaseRequestId?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.findAllSupplierQuotes(companyId, {
      search,
      status,
      purchaseRequestId,
      customerId,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('supplier-quotes/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOneSupplierQuote(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneSupplierQuote(companyId, id);
  }

  @Post('supplier-quotes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  createSupplierQuote(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseSupplierQuoteDto,
  ) {
    return this.purchasingService.createSupplierQuote(companyId, dto, userId);
  }

  @Get('supplier-quote-comparisons/:requestId')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  compareSupplierQuotes(
    @CurrentUser('companyId') companyId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.purchasingService.compareSupplierQuotes(companyId, requestId);
  }

  @Post('supplier-quotes/:id/award')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  awardSupplierQuote(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AwardPurchaseSupplierQuoteDto,
  ) {
    return this.purchasingService.awardSupplierQuote(companyId, id, dto);
  }

  @Get('framework-agreements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findAllFrameworkAgreements(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasingService.findAllFrameworkAgreements(companyId, {
      search,
      status,
      customerId,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  @Get('framework-agreements/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  findOneFrameworkAgreement(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneFrameworkAgreement(companyId, id);
  }

  @Post('framework-agreements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  createFrameworkAgreement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePurchaseFrameworkAgreementDto,
  ) {
    return this.purchasingService.createFrameworkAgreement(companyId, dto, userId);
  }

  @Get('purchase-orders')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar órdenes de compra con filtros' })
  findAllOrders(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;

    // Validar que el status sea un valor válido del enum antes de pasar al servicio
    const statusFilter = status && Object.values(PurchaseOrderStatus).includes(status as PurchaseOrderStatus)
      ? (status as PurchaseOrderStatus)
      : undefined;

    return this.purchasingService.findAllOrders(companyId, {
      search,
      status: statusFilter,
      customerId: customerId ?? supplierId,
      dateFrom,
      dateTo,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @Get('purchase-orders/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Detalle de orden de compra con ítems y cliente asociado' })
  findOneOrder(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.findOneOrder(companyId, id);
  }

  @Get('purchase-orders/:id/pdf')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Previsualización HTML de la orden de compra' })
  async getOrderPdfPreview(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.purchasingService.generateOrderPreview(companyId, id);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="orden-compra-${id}.html"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  @Get('purchase-orders/:id/pdf/download')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Descargar orden de compra en PDF' })
  async downloadOrderPdf(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.purchasingService.generateOrderPdfDocument(companyId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  @Post('purchase-orders/:id/email')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar por correo la orden de compra con PDF adjunto' })
  sendOrderEmail(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('to') to?: string,
  ) {
    return this.purchasingService.sendOrderEmail(companyId, id, to);
  }

  @Post('purchase-orders')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Crear orden de compra (calcula totales automáticamente)' })
  createOrder(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchasingService.createOrder(companyId, dto);
  }

  @Put('purchase-orders/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Actualizar orden de compra (solo en estado DRAFT)' })
  updateOrder(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchasingService.updateOrder(companyId, id, dto);
  }

  @Patch('purchase-orders/:id/status')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Cambiar estado de una orden de compra' })
  updateOrderStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderStatusDto,
  ) {
    return this.purchasingService.updateOrderStatus(companyId, id, dto);
  }

  @Delete('purchase-orders/:id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar orden de compra (soft-delete, solo DRAFT o CANCELLED)' })
  removeOrder(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchasingService.removeOrder(companyId, id);
  }
}
