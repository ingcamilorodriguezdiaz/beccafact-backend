import {
  Controller,
  Get,
  Post,
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
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { UpdateBranchStockDto } from './dto/update-branch-stock.dto';
import { AssignUserBranchDto } from './dto/assign-user-branch.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyStatusGuard, RolesGuard)
@Controller({ path: 'branches', version: '1' })
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  // ─── Branch CRUD ─────────────────────────────────────────────────────────────

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Listar sucursales de la empresa' })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.branchesService.findAll(companyId);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Obtener sucursal por ID' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branchesService.findOne(companyId, id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Crear sucursal' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchesService.create(companyId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar sucursal' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar sucursal (soft delete)' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branchesService.remove(companyId, id);
  }

  @Patch(':id/toggle-active')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Activar / desactivar sucursal' })
  toggleActive(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branchesService.toggleActive(companyId, id);
  }

  // ─── Stock Management ─────────────────────────────────────────────────────────

  @Get(':id/stocks')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Obtener stocks de la sucursal' })
  getStocks(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('search') search?: string,
    @Query('lowStock') lowStock?: string,
  ) {
    return this.branchesService.getStocks(companyId, id, {
      search,
      lowStock: lowStock === 'true',
    });
  }

  @Patch(':id/stocks')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar stock de un producto en la sucursal' })
  updateStock(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchStockDto,
  ) {
    return this.branchesService.updateStock(companyId, id, dto);
  }

  @Post(':id/stocks/transfer')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Transferir stock entre sucursales' })
  transferStock(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferStockDto,
  ) {
    return this.branchesService.transferStock(
      companyId,
      id,
      dto.toBranchId,
      dto.productId,
      dto.quantity,
    );
  }

  @Post(':id/stocks/initialize')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Inicializar stocks de la sucursal desde los productos de la empresa' })
  initializeStocks(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branchesService.initializeStocks(companyId, id);
  }

  // ─── User Assignment ──────────────────────────────────────────────────────────

  @Get(':id/users')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Listar usuarios asignados a la sucursal' })
  getBranchUsers(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branchesService.getBranchUsers(companyId, id);
  }

  @Post(':id/users')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Asignar usuario a la sucursal' })
  assignUser(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignUserBranchDto,
  ) {
    return this.branchesService.assignUser(companyId, id, dto);
  }

  @Delete(':id/users/:userId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover usuario de la sucursal' })
  removeUser(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.branchesService.removeUser(companyId, id, userId);
  }
}
