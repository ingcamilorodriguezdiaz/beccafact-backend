import {
  Controller, Get, Post, Put, Delete, Patch, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { UsageLimitGuard } from '../common/guards/usage-limit.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { UsageMetric } from '../common/decorators/usage-metric.decorator';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER')
  @PlanFeature('has_inventory')
  @ApiOperation({ summary: 'Listar productos' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.productsService.findAll(companyId, { search, categoryId, status, page, limit });
  }

  @Get('low-stock')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER')
  @PlanFeature('has_inventory')
  @ApiOperation({ summary: 'Productos con stock bajo o agotado' })
  getLowStock(@CurrentUser('companyId') companyId: string) {
    return this.productsService.getLowStock(companyId);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER')
  @PlanFeature('has_inventory')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.findOne(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @PlanFeature('has_inventory')
  @UseGuards(UsageLimitGuard)
  @UsageMetric('max_products')
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(companyId, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @PlanFeature('has_inventory')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(companyId, id, dto);
  }

  /** PATCH para actualizaciones parciales (usado por el frontend) */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @PlanFeature('has_inventory')
  @ApiOperation({ summary: 'Actualización parcial del producto' })
  patch(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(companyId, id, dto);
  }

  /** Ajuste rápido de stock (suma o resta) */
  @Patch(':id/stock')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @PlanFeature('has_inventory')
  @ApiOperation({ summary: 'Ajuste de stock (+/-)' })
  adjustStock(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('delta') delta: number,
    @Body('reason') reason?: string,
  ) {
    return this.productsService.adjustStock(companyId, id, delta);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @PlanFeature('has_inventory')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.remove(companyId, id);
  }
}
