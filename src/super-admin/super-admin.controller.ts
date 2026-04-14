import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param,
  Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SuperAdminService } from './super-admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/common/constants/pagination.constants';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller({ path: 'super-admin', version: '1' })
export class SuperAdminController {
  constructor(private superAdminService: SuperAdminService) {}

  // ─── METRICS ─────────────────────────────────────────────────────────────────

  @Get('metrics')
  @ApiOperation({ summary: 'Métricas globales del sistema' })
  getMetrics() {
    return this.superAdminService.getGlobalMetrics();
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Logs de auditoría' })
  getAuditLogs(
    @Query('companyId') companyId?: string,
    @Query('resource') resource?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superAdminService.getAuditLogs({ companyId, resource, page, limit });
  }

  // ─── ROLES ───────────────────────────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({ summary: 'Listar roles disponibles (excluye SUPER_ADMIN)' })
  getRoles() {
    return this.superAdminService.getRoles();
  }

  // ─── COMPANIES ───────────────────────────────────────────────────────────────

  @Get('companies')
  @ApiOperation({ summary: 'Listar todas las empresas' })
  getCompanies(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superAdminService.getCompanies({ search, status,     
        page:  Number(page)  || DEFAULT_PAGE,
          limit: Number(limit) || DEFAULT_LIMIT});
  }

  @Get('companies/:id')
  @ApiOperation({ summary: 'Obtener detalle de una empresa' })
  getCompany(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getCompany(id);
  }

  @Post('companies')
  @ApiOperation({ summary: 'Crear empresa con plan inicial' })
  createCompany(@Body() data: any) {
    return this.superAdminService.createCompany(data);
  }

  @Patch('companies/:id')
  @ApiOperation({ summary: 'Actualizar datos de empresa' })
  updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.superAdminService.updateCompany(id, data);
  }

  @Patch('companies/:id/suspend')
  @ApiOperation({ summary: 'Suspender empresa' })
  suspendCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.superAdminService.suspendCompany(id, reason);
  }

  @Patch('companies/:id/activate')
  @ApiOperation({ summary: 'Activar empresa' })
  activateCompany(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.activateCompany(id);
  }

  @Post('companies/:id/change-plan')
  @ApiOperation({ summary: 'Cambiar plan de una empresa' })
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('planId') planId: string,
    @Body('customLimits') customLimits?: Record<string, string>,
  ) {
    return this.superAdminService.changePlan(id, planId, customLimits);
  }

  // ─── USERS PER COMPANY ───────────────────────────────────────────────────────

  @Get('companies/:id/users')
  @ApiOperation({ summary: 'Listar usuarios de una empresa' })
  getCompanyUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getCompanyUsers(id);
  }

  @Post('companies/:id/users')
  @ApiOperation({ summary: 'Crear e invitar usuario a una empresa' })
  createCompanyUser(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Body() data: any,
  ) {
    return this.superAdminService.createCompanyUser(companyId, data);
  }

  @Patch('companies/:id/users/:userId')
  @ApiOperation({ summary: 'Actualizar usuario de una empresa (nombre, rol, estado)' })
  updateCompanyUser(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() data: any,
  ) {
    return this.superAdminService.updateCompanyUser(companyId, userId, data);
  }

  @Patch('companies/:id/users/:userId/toggle-active')
  @ApiOperation({ summary: 'Activar o desactivar usuario de una empresa' })
  @HttpCode(HttpStatus.OK)
  toggleCompanyUserActive(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.superAdminService.toggleCompanyUserActive(companyId, userId);
  }

  // ─── INTEGRATIONS COMPANIES LIST ─────────────────────────────────────────

  @Get('integrations/companies')
  @ApiOperation({ summary: 'Listar empresas con sus features DIAN y nómina habilitadas' })
  getIntegrationsCompanies() {
    return this.superAdminService.getIntegrationsCompanies();
  }

  // ─── DIAN INTEGRATIONS PER COMPANY ────────────────────────────────────────

  @Get('companies/:id/integrations/dian')
  @ApiOperation({ summary: 'Obtener configuración DIAN facturación de una empresa' })
  getCompanyDianFacturacion(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getCompanyDianFacturacion(id);
  }

  @Put('companies/:id/integrations/dian')
  @ApiOperation({ summary: 'Actualizar configuración DIAN facturación de una empresa' })
  updateCompanyDianFacturacion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.superAdminService.updateCompanyDianFacturacion(id, data);
  }

  @Post('companies/:id/integrations/dian/numbering-range')
  @ApiOperation({ summary: 'Consultar numeración DIAN productiva y clave técnica de una empresa' })
  getCompanyDianNumberingRange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.superAdminService.getCompanyDianNumberingRange(id, data);
  }

  @Get('companies/:id/integrations/dian/nomina')
  @ApiOperation({ summary: 'Obtener configuración DIAN nómina de una empresa' })
  getCompanyDianNomina(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getCompanyDianNomina(id);
  }

  @Put('companies/:id/integrations/dian/nomina')
  @ApiOperation({ summary: 'Actualizar configuración DIAN nómina de una empresa' })
  updateCompanyDianNomina(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.superAdminService.updateCompanyDianNomina(id, data);
  }

  @Get('companies/:id/integrations/dian/certificate')
  @ApiOperation({ summary: 'Obtener certificado digital DIAN compartido de una empresa' })
  getCompanyDianCertificate(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getCompanyDianCertificate(id);
  }

  @Put('companies/:id/integrations/dian/certificate')
  @ApiOperation({ summary: 'Actualizar certificado digital DIAN compartido de una empresa' })
  updateCompanyDianCertificate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: any,
  ) {
    return this.superAdminService.updateCompanyDianCertificate(id, data);
  }

  // ─── PLANS ───────────────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'Listar todos los planes' })
  getPlans() {
    return this.superAdminService.getPlans();
  }

  @Post('plans')
  @ApiOperation({ summary: 'Crear plan' })
  createPlan(@Body() data: any) {
    return this.superAdminService.createPlan(data);
  }

  @Put('plans/:id')
  @ApiOperation({ summary: 'Actualizar plan' })
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() data: any) {
    return this.superAdminService.updatePlan(id, data);
  }

  // ─── GLOBAL USERS ────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'Listar todos los usuarios de la plataforma' })
  getGlobalUsers(
    @Query('search')    search?:    string,
    @Query('companyId') companyId?: string,
    @Query('isActive')  isActive?:  string,
    @Query('page')      page?:      number,
    @Query('limit')     limit?:     number,
  ) {
    return this.superAdminService.getGlobalUsers({ search, companyId, isActive, page, limit });
  }

  @Patch('users/:userId/toggle-active')
  @ApiOperation({ summary: 'Activar/desactivar usuario global' })
  @HttpCode(HttpStatus.OK)
  toggleGlobalUserActive(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.superAdminService.toggleGlobalUserActive(userId);
  }

  // ─── BANKS ───────────────────────────────────────────────────────────────────

  @Get('banks')
  @ApiOperation({ summary: 'Listar bancos (con filtros)' })
  getBanks(@Query('search') search?: string, @Query('isActive') isActive?: string) {
    return this.superAdminService.getBanks({ search, isActive });
  }

  @Post('banks')
  @ApiOperation({ summary: 'Crear banco' })
  createBank(@Body() data: any) {
    return this.superAdminService.createBank(data);
  }

  @Patch('banks/:code')
  @ApiOperation({ summary: 'Actualizar banco por código' })
  updateBank(@Param('code') code: string, @Body() data: any) {
    return this.superAdminService.updateBank(code, data);
  }

  @Delete('banks/:code')
  @ApiOperation({ summary: 'Eliminar banco por código' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBank(@Param('code') code: string) {
    return this.superAdminService.deleteBank(code);
  }

  // ─── PARAMETERS ──────────────────────────────────────────────────────────────

  @Get('parameters')
  @ApiOperation({ summary: 'Listar parámetros globales' })
  getParameters(@Query('category') category?: string, @Query('search') search?: string) {
    return this.superAdminService.getParameters({ category, search });
  }

  @Post('parameters')
  @ApiOperation({ summary: 'Crear parámetro' })
  createParameter(@Body() data: any) {
    return this.superAdminService.createParameter(data);
  }

  @Patch('parameters/:id')
  @ApiOperation({ summary: 'Actualizar parámetro' })
  updateParameter(@Param('id', ParseUUIDPipe) id: string, @Body() data: any) {
    return this.superAdminService.updateParameter(id, data);
  }

  @Delete('parameters/:id')
  @ApiOperation({ summary: 'Eliminar parámetro' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteParameter(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.deleteParameter(id);
  }
}
