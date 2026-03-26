import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
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

  private sendXlsxResponse(res: Response, buffer: Buffer, filename: string): void {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'KPIs del dashboard' })
  getDashboard(
    @CurrentUser('companyId') companyId: string,
    @Query('year') year: number = new Date().getFullYear(),
    @Query('month') month: number = new Date().getMonth() + 1,
  ) {
    return this.reportsService.getDashboardKpis(companyId, +year, +month);
  }

  @Get('collections')
  @PlanFeature('has_cartera')
  @ApiOperation({ summary: 'Reporte de cartera por vencimiento' })
  getCollections(
    @CurrentUser('companyId') companyId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.reportsService.getCollections(companyId, asOf);
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

  // ── Facturación ─────────────────────────────────────────────────────────────

  @Get('invoice')
  @PlanFeature('has_invoices')
  @ApiOperation({ summary: 'Reporte de facturas electrónicas' })
  getInvoices(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.reportsService.getInvoicesReport(companyId, from, to, status);
  }

  @Get('invoice/xlsx')
  @PlanFeature('has_invoices')
  @ApiOperation({ summary: 'Descargar reporte de facturas en Excel' })
  async downloadInvoicesXlsx(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('status') status: string,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getInvoicesReport(companyId, from, to, status);
    const buffer = this.reportsService.downloadExcel('invoices', data);
    this.sendXlsxResponse(res, buffer, 'report-invoices.xlsx');
  }

  @Get('invoice/by-status')
  @PlanFeature('has_invoices')
  @ApiOperation({ summary: 'Facturas agrupadas por estado (para gráfico)' })
  getInvoicesByStatus(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getInvoicesByStatus(companyId, from, to);
  }

  // ── Nómina ──────────────────────────────────────────────────────────────────

  @Get('payroll')
  @PlanFeature('has_payroll')
  @ApiOperation({ summary: 'Reporte de nómina electrónica' })
  getPayroll(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getPayrollReport(companyId, from, to);
  }

  @Get('payroll/xlsx')
  @PlanFeature('has_payroll')
  @ApiOperation({ summary: 'Descargar reporte de nómina en Excel' })
  async downloadPayrollXlsx(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getPayrollReport(companyId, from, to);
    const buffer = this.reportsService.downloadExcel('payroll', data);
    this.sendXlsxResponse(res, buffer, 'report-payroll.xlsx');
  }

  @Get('payroll/monthly-trend')
  @PlanFeature('has_payroll')
  @ApiOperation({ summary: 'Tendencia mensual de nómina (para gráfico)' })
  getPayrollMonthlyTrend(
    @CurrentUser('companyId') companyId: string,
    @Query('fromPeriod') fromPeriod?: string,
    @Query('toPeriod') toPeriod?: string,
  ) {
    return this.reportsService.getPayrollMonthlyTrend(companyId, fromPeriod, toPeriod);
  }

  // ── POS ─────────────────────────────────────────────────────────────────────

  @Get('pos')
  @PlanFeature('has_pos')
  @ApiOperation({ summary: 'Reporte de ventas POS' })
  getPos(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getPosReport(companyId, from, to);
  }

  @Get('pos/xlsx')
  @PlanFeature('has_pos')
  @ApiOperation({ summary: 'Descargar reporte POS en Excel' })
  async downloadPosXlsx(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getPosReport(companyId, from, to);
    const buffer = this.reportsService.downloadExcel('pos', data);
    this.sendXlsxResponse(res, buffer, 'report-pos.xlsx');
  }

  @Get('pos/payment-breakdown')
  @PlanFeature('has_pos')
  @ApiOperation({ summary: 'Desglose de ventas POS por método de pago' })
  getPosPaymentBreakdown(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getPosPaymentBreakdown(companyId, from, to);
  }

  // ── Cartera ──────────────────────────────────────────────────────────────────

  @Get('collections/detail')
  @PlanFeature('has_cartera')
  @ApiOperation({ summary: 'Reporte detallado de cartera' })
  getCollectionsDetail(
    @CurrentUser('companyId') companyId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.reportsService.getCollectionsReport(companyId, asOf);
  }

  @Get('collections/detail/xlsx')
  @PlanFeature('has_cartera')
  @ApiOperation({ summary: 'Descargar reporte de cartera en Excel' })
  async downloadCollectionsXlsx(
    @CurrentUser('companyId') companyId: string,
    @Query('asOf') asOf: string,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getCollectionsReport(companyId, asOf);
    const buffer = this.reportsService.downloadExcel('collections', data);
    this.sendXlsxResponse(res, buffer, 'report-collections.xlsx');
  }

  // ── Dashboard Excel ──────────────────────────────────────────────────────────

  @Get('dashboard/xlsx')
  @ApiOperation({ summary: 'Descargar resumen del dashboard en Excel' })
  async downloadDashboardXlsx(
    @CurrentUser('companyId') companyId: string,
    @Query('year') year: number = new Date().getFullYear(),
    @Query('month') month: number = new Date().getMonth() + 1,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.getDashboardXlsx(companyId, +year, +month);
    this.sendXlsxResponse(res, buffer, 'report-dashboard.xlsx');
  }
}
