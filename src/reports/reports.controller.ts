import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyStatusGuard, PlanGuard)
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'KPIs del dashboard' })
  getDashboard(
    @CurrentUser('companyId') companyId: string,
    @Query('year') year: number = new Date().getFullYear(),
    @Query('month') month: number = new Date().getMonth() + 1,
  ) {
    return this.reportsService.getDashboardKpis(companyId, +year, +month);
  }

  @Get('cartera')
  @PlanFeature('has_cartera')
  @ApiOperation({ summary: 'Reporte de cartera por vencimiento' })
  getCartera(
    @CurrentUser('companyId') companyId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.reportsService.getCartera(companyId, asOf);
  }

  @Get('revenue/monthly')
  @ApiOperation({ summary: 'Ventas mensuales del año' })
  getMonthlyRevenue(
    @CurrentUser('companyId') companyId: string,
    @Query('year') year: number = new Date().getFullYear(),
  ) {
    return this.reportsService.getMonthlyRevenue(companyId, +year);
  }

  @Get('usage-summary')
  @ApiOperation({ summary: 'Resumen de uso mensual para barra del sidebar' })
  getUsageSummary(@CurrentUser('companyId') companyId: string) {
    return this.reportsService.getUsageSummary(companyId);
  }
}
