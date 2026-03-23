import {
  Controller, Get, Post, Put, Patch, Body, Param,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('roles')
  @ApiOperation({ summary: 'Listar roles disponibles' })
  getRoles() {
    return this.usersService.getRoles();
  }

  /** Perfil propio — para settings/profile */
  @Get('me')
  @ApiOperation({ summary: 'Mi perfil de usuario' })
  getMe(@CurrentUser('sub') userId: string) {
    return this.usersService.getMe(userId);
  }

  /** Actualizar perfil propio */
  @Patch('me')
  @ApiOperation({ summary: 'Actualizar mi perfil' })
  @HttpCode(HttpStatus.OK)
  updateMe(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(userId, dto);
  }

  @Get()
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Listar usuarios de la empresa' })
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.usersService.findAll(companyId);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.findOne(companyId, id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Crear usuario en la empresa' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.create(companyId, dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(companyId, id, dto);
  }

  /**
   * PATCH /:id — actualización parcial incluyendo isActive toggle
   * El frontend de settings-users usa este endpoint para editar usuarios.
   */
  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Actualización parcial de usuario (incluye toggle isActive)' })
  patch(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') requesterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.patch(companyId, id, requesterId, dto);
  }

  @Patch(':id/deactivate')
  @Roles('ADMIN')
  deactivate(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') requesterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.deactivate(companyId, id, requesterId);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Cambiar contraseña propia' })
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.updatePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @Patch('me/tour-seen')
  @ApiOperation({ summary: 'Marcar tour de bienvenida como visto' })
  @HttpCode(HttpStatus.OK)
  markTourSeen(@CurrentUser('sub') userId: string) {
    return this.usersService.markTourSeen(userId);
  }
}
