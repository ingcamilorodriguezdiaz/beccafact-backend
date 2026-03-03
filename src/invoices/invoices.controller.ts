import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Res, StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.invoicesService.findAll(companyId, { search, status, type, from, to, customerId, page, limit });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen financiero por período' })
  getSummary(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.invoicesService.getSummary(companyId, from, to);
  }

  @Get(':id')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.findOne(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Crear factura' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(companyId, dto);
  }

  // ─── UPDATE DRAFT ─────────────────────────────────────────────────────────

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Editar factura en borrador (DRAFT)' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(companyId, id, dto);
  }

  // ─── PDF PREVIEW ──────────────────────────────────────────────────────────

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Previsualización HTML de la factura (renderizable como PDF)' })
  async getPdf(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.invoicesService.generatePdf(companyId, id);
    res.set({
      'Content-Type':        'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="factura-${id}.html"`,
      'Cache-Control':       'no-cache',
    });
    return new StreamableFile(buffer);
  }

  // ─── DIAN ────────────────────────────────────────────────────────────────────

  /** Frontend llama POST /invoices/:id/send-dian */
  @Post(':id/send-dian')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar factura a la DIAN (POST)' })
  sendToDianPost(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.sendToDian(companyId, id);
  }

  /** También se soporta PATCH por compatibilidad con versiones anteriores */
  @Patch(':id/send-dian')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  sendToDianPatch(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.sendToDian(companyId, id);
  }

  // ─── MARK PAID ───────────────────────────────────────────────────────────────

  /** Frontend llama POST /invoices/:id/mark-paid */
  @Post(':id/mark-paid')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar factura como pagada (POST)' })
  markAsPaidPost(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.markAsPaid(companyId, id);
  }

  /** También se soporta PATCH por compatibilidad */
  @Patch(':id/paid')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  markAsPaidPatch(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.markAsPaid(companyId, id);
  }

  // ─── CANCEL ──────────────────────────────────────────────────────────────────

  @Patch(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Anular factura' })
  cancel(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.invoicesService.cancel(companyId, id, reason);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  cancelPost(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.invoicesService.cancel(companyId, id, reason);
  }
}
