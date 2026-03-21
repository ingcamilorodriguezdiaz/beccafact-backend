import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DEFAULT_PAGE, DEFAULT_LIMIT } from '../common/constants/pagination.constants';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private customersService: CustomersService) { }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar clientes de la empresa' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    const activeFilter =
      isActive !== undefined ? isActive === 'true' : undefined;

    return this.customersService.findAll(companyId, {
      search,
      isActive: activeFilter,
      page: pageNumber,
      limit: limitNumber,
    });
  }

  @Get(':id')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.findOne(companyId, id);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Cartera del cliente' })
  getBalance(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.getBalance(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(companyId, dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(companyId, id, dto);
  }

  /** PATCH para actualizaciones parciales (usado por el frontend) */
  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Actualización parcial de cliente' })
  patch(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customersService.remove(companyId, id);
  }
}
