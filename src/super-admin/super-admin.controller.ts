import {
  Controller, Get, Post, Put, Patch, Body, Param,
  Query, UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SuperAdminService } from './super-admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';

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

  // ─── AUDIT LOGS ──────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary: 'Logs de auditoría con filtros avanzados' })
  getAuditLogs(
    @Query('companyId') companyId?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superAdminService.getAuditLogs({ companyId, resource, action, from, to, page, limit });
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
    return this.superAdminService.getCompanies({ search, status, page, limit });
  }

  @Get('companies/:id')
  @ApiOperation({ summary: 'Detalle de empresa' })
  getCompany(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getCompanyDetail(id);
  }

  @Patch('companies/:id/suspend')
  suspendCompanyPatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.superAdminService.suspendCompany(id, reason);
  }

  @Post('companies/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspender empresa' })
  suspendCompanyPost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    return this.superAdminService.suspendCompany(id, reason);
  }

  @Patch('companies/:id/activate')
  activateCompanyPatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.activateCompany(id);
  }

  @Post('companies/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivar empresa' })
  activateCompanyPost(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.activateCompany(id);
  }

  @Post('companies/:id/change-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar plan de empresa' })
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('planId') planId: string,
    @Body('customLimits') customLimits?: Record<string, string>,
  ) {
    return this.superAdminService.changePlan(id, planId, customLimits);
  }

  // ─── PLANS ───────────────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'Listar planes con conteo de suscripciones' })
  getPlans() {
    return this.superAdminService.getPlans();
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Detalle de plan con suscripciones activas' })
  getPlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.getPlan(id);
  }

  @Post('plans')
  @ApiOperation({ summary: 'Crear nuevo plan' })
  createPlan(@Body() data: any) {
    return this.superAdminService.createPlan(data);
  }

  @Put('plans/:id')
  @ApiOperation({ summary: 'Actualizar plan y sus features' })
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() data: any) {
    return this.superAdminService.updatePlan(id, data);
  }

  @Patch('plans/:id/toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar/desactivar plan' })
  togglePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdminService.togglePlan(id);
  }

  // ─── USERS ───────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'Todos los usuarios del sistema' })
  getAllUsers(
    @Query('search') search?: string,
    @Query('companyId') companyId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superAdminService.getAllUsers({ search, companyId, page, limit });
  }
}
