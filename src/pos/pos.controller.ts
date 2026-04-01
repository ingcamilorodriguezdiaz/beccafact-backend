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
import { CreatePosSaleDto } from './dto/create-pos-sale.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { DeliverSaleDto } from './dto/deliver-sale.dto';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CurrentBranchId } from '@/common/decorators/current-branch-id.decorator';

@ApiTags('pos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@PlanFeature('has_pos')
@Controller({ path: 'pos', version: '1' })
export class PosController {
  constructor(private readonly posService: PosService) {}

  // ── Sessions ──────────────────────────────────────────────────────────────

  @Post('sessions')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  openSession(@CurrentUser() user: any, @Body() dto: CreatePosSessionDto) {
    return this.posService.openSession(user.companyId, user.sub, dto);
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
    return this.posService.closeSession(user.companyId, id, dto);
  }

  // ── Sales ─────────────────────────────────────────────────────────────────

  @Post('sales')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO')
  @HttpCode(HttpStatus.CREATED)
  createSale(@CurrentUser() user: any, @CurrentBranchId() branchId: string, @Body() dto: CreatePosSaleDto) {
    return this.posService.createSale(user.companyId,branchId, dto);
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

  @Patch('sales/:id/cancel')
  @Roles('ADMIN', 'MANAGER')
  cancelSale(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { notes?: string },
  ) {
    return this.posService.cancelSale(user.companyId, id, body.notes);
  }

  @Patch('sales/:id/refund')
  @Roles('ADMIN', 'MANAGER')
  refundSale(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RefundSaleDto,
  ) {
    return this.posService.refundSale(user.companyId, id, dto);
  }

  // ── Cash movements ────────────────────────────────────────────────────────

  @Post('sessions/:id/cash-movements')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  createCashMovement(
    @CurrentUser() user: any,
    @Param('id') sessionId: string,
    @Body() dto: CreateCashMovementDto,
  ) {
    return this.posService.createCashMovement(user.companyId, sessionId, user.sub, dto);
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
