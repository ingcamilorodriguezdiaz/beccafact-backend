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

  // ─────────────────────────────────────────────────────────────────────────────
  // PURCHASE ORDERS
  // ─────────────────────────────────────────────────────────────────────────────

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
