import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PosService } from './pos.service';
import { CreatePosSessionDto } from './dto/create-pos-session.dto';
import { ClosePosSessionDto } from './dto/close-pos-session.dto';
import { ApproveClosePosSessionDto } from './dto/approve-close-pos-session.dto';
import { ReopenPosSessionDto } from './dto/reopen-pos-session.dto';
import { CreatePosSaleDto } from './dto/create-pos-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { DeliverSaleDto } from './dto/deliver-sale.dto';
import { DispatchSaleDto } from './dto/dispatch-sale.dto';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { CancelPosSaleDto } from './dto/cancel-pos-sale.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import {
  CreatePosPostSaleRequestDto,
  ResolvePosPostSaleRequestDto,
} from './dto/create-pos-post-sale-request.dto';
import { CreatePosTerminalDto } from './dto/create-pos-terminal.dto';
import { UpdatePosTerminalDto } from './dto/update-pos-terminal.dto';
import { CreatePosShiftTemplateDto } from './dto/create-pos-shift-template.dto';
import { UpdatePosShiftTemplateDto } from './dto/update-pos-shift-template.dto';
import {
  CreatePosComboDto,
  CreatePosPriceListDto,
  CreatePosPromotionDto,
  PreviewPosPricingDto,
  UpdatePosComboDto,
  UpdatePosPriceListDto,
  UpdatePosPromotionDto,
} from './dto/pos-pricing.dto';
import { CurrentBranchId } from '@/common/decorators/current-branch-id.decorator';
import {
  CreatePosLoyaltyCampaignDto,
  UpdatePosLoyaltyCampaignDto,
} from './dto/pos-loyalty.dto';
import {
  CreatePosCouponDto,
  CreatePosExternalOrderDto,
  CreatePosReplenishmentRequestDto,
  ReconcilePosElectronicPaymentsDto,
  UpdatePosCouponDto,
  UpdatePosExternalOrderStatusDto,
} from './dto/pos-enterprise-integrations.dto';
import {
  CreatePosInventoryLocationDto,
  CreatePosInventoryTransferDto,
  UpdatePosInventoryLocationDto,
  UpsertPosInventoryStockDto,
} from './dto/pos-inventory.dto';
import {
  CreatePosSupervisorOverrideDto,
  ResolvePosSupervisorOverrideDto,
  SavePosGovernanceRuleDto,
} from './dto/pos-governance.dto';
import { HeartbeatPosTerminalDto } from './dto/heartbeat-pos-terminal.dto';
import {
  CreatePosConfigDeploymentDto,
  ResolvePosOperationalIncidentDto,
} from './dto/pos-resilience.dto';

@ApiTags('pos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@PlanFeature('has_pos')
@Controller({ path: 'pos', version: '1' })
export class PosController {
  constructor(private readonly posService: PosService) {}

  // ── Operating config ──────────────────────────────────────────────────────

  @Get('config/operating')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getOperatingConfig(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.getOperatingConfig(user.companyId, branchId);
  }

  @Get('multi-branch/overview')
  @Roles('ADMIN', 'MANAGER')
  getMultiBranchOverview(@CurrentUser() user: any) {
    return this.posService.getMultiBranchOverview(user.companyId);
  }

  @Get('operations/incidents')
  @Roles('ADMIN', 'MANAGER')
  getOperationalIncidents(@CurrentUser() user: any) {
    return this.posService.getOperationalIncidents(user.companyId);
  }

  @Patch('operations/incidents/:id/resolve')
  @Roles('ADMIN', 'MANAGER')
  resolveOperationalIncident(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ResolvePosOperationalIncidentDto,
  ) {
    return this.posService.resolveOperationalIncident(user.companyId, user.sub, id, dto);
  }

  @Get('operations/config-deployments')
  @Roles('ADMIN', 'MANAGER')
  getConfigDeployments(@CurrentUser() user: any) {
    return this.posService.getConfigDeployments(user.companyId);
  }

  @Post('operations/config-deployments')
  @Roles('ADMIN', 'MANAGER')
  createConfigDeployment(@CurrentUser() user: any, @Body() dto: CreatePosConfigDeploymentDto) {
    return this.posService.createConfigDeployment(user.companyId, user.sub, dto);
  }

  @Get('governance/audit')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getGovernanceAudit(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Query('limit') limit?: string,
  ) {
    return this.posService.getGovernanceAudit(user.companyId, branchId, limit ? +limit : 40);
  }

  @Post('governance/rules')
  @Roles('ADMIN', 'MANAGER')
  saveGovernanceRule(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: SavePosGovernanceRuleDto,
  ) {
    return this.posService.saveGovernanceRule(user.companyId, branchId, dto);
  }

  @Post('governance/overrides')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  requestSupervisorOverride(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: CreatePosSupervisorOverrideDto,
  ) {
    return this.posService.requestSupervisorOverride(user.companyId, user.sub, branchId, dto);
  }

  @Patch('governance/overrides/:id/approve')
  @Roles('ADMIN', 'MANAGER')
  approveSupervisorOverride(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ResolvePosSupervisorOverrideDto,
  ) {
    return this.posService.approveSupervisorOverride(user.companyId, user.sub, id, dto);
  }

  @Patch('governance/overrides/:id/reject')
  @Roles('ADMIN', 'MANAGER')
  rejectSupervisorOverride(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ResolvePosSupervisorOverrideDto,
  ) {
    return this.posService.rejectSupervisorOverride(user.companyId, user.sub, id, dto);
  }

  @Post('pricing/preview')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  previewPricing(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: PreviewPosPricingDto) {
    return this.posService.previewPricing(user.companyId, branchId, dto);
  }

  @Get('price-lists')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getPriceLists(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findPriceLists(user.companyId, branchId);
  }

  @Post('price-lists')
  @Roles('ADMIN', 'MANAGER')
  createPriceList(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: CreatePosPriceListDto) {
    return this.posService.createPriceList(user.companyId, branchId, dto);
  }

  @Patch('price-lists/:id')
  @Roles('ADMIN', 'MANAGER')
  updatePriceList(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePosPriceListDto) {
    return this.posService.updatePriceList(user.companyId, id, dto);
  }

  @Get('promotions')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getPromotions(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findPromotions(user.companyId, branchId);
  }

  @Post('promotions')
  @Roles('ADMIN', 'MANAGER')
  createPromotion(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: CreatePosPromotionDto) {
    return this.posService.createPromotion(user.companyId, branchId, dto);
  }

  @Patch('promotions/:id')
  @Roles('ADMIN', 'MANAGER')
  updatePromotion(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePosPromotionDto) {
    return this.posService.updatePromotion(user.companyId, id, dto);
  }

  @Get('combos')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getCombos(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findCombos(user.companyId, branchId);
  }

  @Post('combos')
  @Roles('ADMIN', 'MANAGER')
  createCombo(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: CreatePosComboDto) {
    return this.posService.createCombo(user.companyId, branchId, dto);
  }

  @Patch('combos/:id')
  @Roles('ADMIN', 'MANAGER')
  updateCombo(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePosComboDto) {
    return this.posService.updateCombo(user.companyId, id, dto);
  }

  @Get('loyalty-campaigns')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getLoyaltyCampaigns(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findLoyaltyCampaigns(user.companyId, branchId);
  }

  @Post('loyalty-campaigns')
  @Roles('ADMIN', 'MANAGER')
  createLoyaltyCampaign(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: CreatePosLoyaltyCampaignDto,
  ) {
    return this.posService.createLoyaltyCampaign(user.companyId, branchId, dto);
  }

  @Patch('loyalty-campaigns/:id')
  @Roles('ADMIN', 'MANAGER')
  updateLoyaltyCampaign(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdatePosLoyaltyCampaignDto,
  ) {
    return this.posService.updateLoyaltyCampaign(user.companyId, id, dto);
  }

  @Get('customers/:customerId/loyalty-profile')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getCustomerLoyaltyProfile(@CurrentUser() user: any, @Param('customerId') customerId: string) {
    return this.posService.getCustomerLoyaltyProfile(user.companyId, customerId);
  }

  @Get('customers/:customerId/account-statement')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getCustomerAccountStatement(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Param('customerId') customerId: string,
  ) {
    return this.posService.getCustomerAccountStatement(user.companyId, customerId, branchId);
  }

  @Get('coupons')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getCoupons(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findCoupons(user.companyId, branchId);
  }

  @Post('coupons')
  @Roles('ADMIN', 'MANAGER')
  createCoupon(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: CreatePosCouponDto,
  ) {
    return this.posService.createCoupon(user.companyId, branchId, dto);
  }

  @Patch('coupons/:id')
  @Roles('ADMIN', 'MANAGER')
  updateCoupon(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePosCouponDto) {
    return this.posService.updateCoupon(user.companyId, id, dto);
  }

  @Get('external-orders')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getExternalOrders(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findExternalOrders(user.companyId, branchId);
  }

  @Post('external-orders')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  createExternalOrder(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: CreatePosExternalOrderDto,
  ) {
    return this.posService.createExternalOrder(user.companyId, branchId, dto);
  }

  @Patch('external-orders/:id/status')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  updateExternalOrderStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdatePosExternalOrderStatusDto,
  ) {
    return this.posService.updateExternalOrderStatus(user.companyId, id, dto);
  }

  @Get('catalog/products')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getCatalogProducts(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Query('search') search?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.posService.getCatalogProducts(user.companyId, branchId, { search, locationId });
  }

  @Get('inventory/locations')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getInventoryLocations(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findInventoryLocations(user.companyId, branchId);
  }

  @Post('inventory/locations')
  @Roles('ADMIN', 'MANAGER')
  createInventoryLocation(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: CreatePosInventoryLocationDto,
  ) {
    return this.posService.createInventoryLocation(user.companyId, branchId, dto);
  }

  @Patch('inventory/locations/:id')
  @Roles('ADMIN', 'MANAGER')
  updateInventoryLocation(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdatePosInventoryLocationDto,
  ) {
    return this.posService.updateInventoryLocation(user.companyId, id, dto);
  }

  @Get('inventory/stocks')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getInventoryStocks(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Query('search') search?: string,
  ) {
    return this.posService.getInventoryStocks(user.companyId, branchId, search);
  }

  @Post('inventory/stocks')
  @Roles('ADMIN', 'MANAGER')
  upsertInventoryStock(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: UpsertPosInventoryStockDto,
  ) {
    return this.posService.upsertInventoryStock(user.companyId, branchId, dto);
  }

  @Get('inventory/transfers')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getInventoryTransfers(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findInventoryTransfers(user.companyId, branchId);
  }

  @Post('inventory/transfers')
  @Roles('ADMIN', 'MANAGER')
  createInventoryTransfer(@CurrentUser() user: any, @Body() dto: CreatePosInventoryTransferDto) {
    return this.posService.createInventoryTransfer(user.companyId, user.sub, dto);
  }

  @Patch('inventory/transfers/:id/post')
  @Roles('ADMIN', 'MANAGER')
  postInventoryTransfer(@CurrentUser() user: any, @Param('id') id: string) {
    return this.posService.postInventoryTransfer(user.companyId, id);
  }

  @Get('terminals')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  findTerminals(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findTerminals(user.companyId, branchId);
  }

  @Post('terminals')
  @Roles('ADMIN', 'MANAGER')
  createTerminal(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: CreatePosTerminalDto) {
    return this.posService.createTerminal(user.companyId, branchId, dto);
  }

  @Patch('terminals/:id')
  @Roles('ADMIN', 'MANAGER')
  updateTerminal(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePosTerminalDto) {
    return this.posService.updateTerminal(user.companyId, id, dto);
  }

  @Post('terminals/:id/heartbeat')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  @HttpCode(HttpStatus.OK)
  heartbeatTerminal(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: HeartbeatPosTerminalDto,
  ) {
    return this.posService.registerTerminalHeartbeat(user.companyId, user.sub, id, dto);
  }

  @Get('shifts')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  findShiftTemplates(@CurrentUser() user: any, @CurrentBranchId() branchId?: string) {
    return this.posService.findShiftTemplates(user.companyId, branchId);
  }

  @Post('shifts')
  @Roles('ADMIN', 'MANAGER')
  createShiftTemplate(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: CreatePosShiftTemplateDto) {
    return this.posService.createShiftTemplate(user.companyId, branchId, dto);
  }

  @Patch('shifts/:id')
  @Roles('ADMIN', 'MANAGER')
  updateShiftTemplate(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePosShiftTemplateDto) {
    return this.posService.updateShiftTemplate(user.companyId, id, dto);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  @Post('sessions')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  openSession(@CurrentUser() user: any, @CurrentBranchId() branchId: string | undefined, @Body() dto: CreatePosSessionDto) {
    return this.posService.openSession(user.companyId, user.sub, branchId, dto);
  }

  @Get('sessions/active')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getActiveSession(@CurrentUser() user: any) {
    return this.posService.getActiveSession(user.companyId, user.sub);
  }

  @Get('sessions')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  findSessions(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.posService.findSessions(user.companyId, {
      status, userId, from, to,
      page: page ? +page : 1,
      limit: limit ? +limit : 20,
    });
  }

  @Get('sessions/:id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  findOneSession(@CurrentUser() user: any, @Param('id') id: string) {
    return this.posService.findOneSession(user.companyId, id);
  }

  @Patch('sessions/:id/close')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  closeSession(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ClosePosSessionDto,
  ) {
    return this.posService.closeSession(user.companyId, user.sub, user.roles ?? [], id, dto);
  }

  @Patch('sessions/:id/approve-close')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  approveCloseSession(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ApproveClosePosSessionDto,
  ) {
    return this.posService.approveCloseSession(user.companyId, user.sub, id, dto);
  }

  @Post('sessions/:id/reopen')
  @Roles('ADMIN', 'MANAGER')
  reopenSession(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ReopenPosSessionDto,
  ) {
    return this.posService.reopenSession(user.companyId, user.sub, user.roles ?? [], branchId, id, dto);
  }

  // ── Sales ─────────────────────────────────────────────────────────────────

  @Post('sales')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  @HttpCode(HttpStatus.CREATED)
  createSale(@CurrentUser() user: any, @CurrentBranchId() branchId: string, @Body() dto: CreatePosSaleDto) {
    return this.posService.createSale(user.companyId, user.sub, user.roles ?? [], branchId, dto);
  }

  // IMPORTANT: literal routes before /:id to avoid route conflicts
  @Get('sales/summary')
  @Roles('ADMIN', 'MANAGER')
  getSalesSummary(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.posService.getSalesSummary(user.companyId, from, to, sessionId);
  }

  @Get('sales/analytics')
  @Roles('ADMIN', 'MANAGER')
  getSalesAnalytics(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.posService.getSalesAnalytics(user.companyId, branchId, from, to);
  }

  @Get('integrations/summary')
  @Roles('ADMIN', 'MANAGER')
  getIntegrationsSummary(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
  ) {
    return this.posService.getIntegrationsSummary(user.companyId, branchId);
  }

  @Post('integrations/sync-accounting')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  syncAccountingIntegrations(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
  ) {
    return this.posService.syncAccountingIntegrations(user.companyId, branchId, user.sub);
  }

  @Post('integrations/replenishment-request')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.CREATED)
  createReplenishmentRequest(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: CreatePosReplenishmentRequestDto,
  ) {
    return this.posService.createReplenishmentRequest(user.companyId, user.sub, branchId, dto);
  }

  @Post('integrations/reconcile-electronic-payments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @HttpCode(HttpStatus.OK)
  reconcileElectronicPayments(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Body() dto: ReconcilePosElectronicPaymentsDto,
  ) {
    return this.posService.reconcileElectronicPayments(user.companyId, user.sub, branchId, dto);
  }

  @Get('sales')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  findSales(
    @CurrentUser() user: any,
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.posService.findSales(user.companyId, {
      sessionId, status, from, to, search,
      page: page ? +page : 1,
      limit: limit ? +limit : 20,
    });
  }

  @Get('sales/:id/receipt')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getReceipt(@CurrentUser() user: any, @Param('id') id: string) {
    return this.posService.getReceipt(user.companyId, id);
  }

  @Post('sales/:id/invoice')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  @HttpCode(HttpStatus.CREATED)
  generateInvoice(@CurrentUser() user: any,@CurrentBranchId() branchId: string, @Param('id') id: string) {
    return this.posService.generateInvoiceFromSale(user.companyId, branchId, id);
  }

  @Patch('sales/:id/pay')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  addPayment(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string,
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
  ) {
    return this.posService.addPayment(user.companyId, branchId, id, dto);
  }

  @Patch('sales/:id/deliver')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  markDelivered(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string,
    @Param('id') id: string,
    @Body() dto: DeliverSaleDto,
  ) {
    return this.posService.markDelivered(user.companyId, branchId, id, dto);
  }

  @Patch('sales/:id/dispatch')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  dispatchSale(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: DispatchSaleDto,
  ) {
    return this.posService.dispatchSale(user.companyId, id, dto);
  }

  @Patch('sales/:id/cancel')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  cancelSale(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CancelPosSaleDto,
  ) {
    return this.posService.cancelSale(user.companyId, user.sub, user.roles ?? [], id, dto);
  }

  @Patch('sales/:id/refund')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  refundSale(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RefundSaleDto,
  ) {
    return this.posService.refundSale(user.companyId, user.sub, user.roles ?? [], id, dto);
  }

  @Get('post-sale-requests')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getPostSaleRequests(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Query('status') status?: string,
    @Query('saleId') saleId?: string,
  ) {
    return this.posService.findPostSaleRequests(user.companyId, branchId, { status, saleId });
  }

  @Post('sales/:id/post-sale')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  @HttpCode(HttpStatus.CREATED)
  createPostSaleRequest(
    @CurrentUser() user: any,
    @CurrentBranchId() branchId: string | undefined,
    @Param('id') id: string,
    @Body() dto: CreatePosPostSaleRequestDto,
  ) {
    return this.posService.createPostSaleRequest(user.companyId, user.sub, branchId, id, dto);
  }

  @Patch('post-sale-requests/:id/approve')
  @Roles('ADMIN', 'MANAGER')
  approvePostSaleRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ResolvePosPostSaleRequestDto,
  ) {
    return this.posService.approvePostSaleRequest(user.companyId, user.sub, id, dto);
  }

  @Patch('post-sale-requests/:id/reject')
  @Roles('ADMIN', 'MANAGER')
  rejectPostSaleRequest(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ResolvePosPostSaleRequestDto,
  ) {
    return this.posService.rejectPostSaleRequest(user.companyId, user.sub, id, dto);
  }

  // ── Cash movements ────────────────────────────────────────────────────────

  @Post('sessions/:id/cash-movements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  @HttpCode(HttpStatus.CREATED)
  createCashMovement(
    @CurrentUser() user: any,
    @Param('id') sessionId: string,
    @Body() dto: CreateCashMovementDto,
  ) {
    return this.posService.createCashMovement(user.companyId, sessionId, user.sub, user.roles ?? [], dto);
  }

  @Get('sessions/:id/cash-movements')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  getCashMovements(
    @CurrentUser() user: any,
    @Param('id') sessionId: string,
  ) {
    return this.posService.getCashMovements(user.companyId, sessionId);
  }
}
