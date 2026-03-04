import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private rolesService: RolesService) {}

  /** Listar todos los roles disponibles (excluye SUPER_ADMIN).
   *  Accesible por cualquier usuario autenticado para poblar selectores. */
  @Get()
  @ApiOperation({ summary: 'Listar roles disponibles' })
  findAll() {
    return this.rolesService.findAll();
  }

  /** Obtener detalle de un rol con sus permisos */
  @Get(':id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Obtener rol por ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  /** Crear rol personalizado (solo ADMIN) */
  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Crear rol' })
  create(@Body() data: any) {
    return this.rolesService.create(data);
  }

  /** Actualizar rol (solo ADMIN) */
  // @Put(':id')
  // @Roles('ADMIN')
  // @ApiOperation({ summary: 'Actualizar rol' })
  // update(@Param('id', ParseUUIDPipe) id: string, @Body() data: any) {
  //   return this.rolesService.update(id, data);
  // }

  /** Eliminar rol (solo ADMIN, no se pueden eliminar roles del sistema) */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar rol personalizado' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.remove(id);
  }
}
