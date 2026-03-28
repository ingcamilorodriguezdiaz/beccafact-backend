import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { RolesGuard }         from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser }        from '../common/decorators/current-user.decorator';
import { Roles }              from '../common/decorators/roles.decorator';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('search')     search?:     string,
    @Query('status')     status?:     string,
    @Query('type')       type?:       string,
    @Query('from')       from?:       string,
    @Query('to')         to?:         string,
    @Query('customerId') customerId?: string,
    @Query('page')       page?:       number,
    @Query('limit')      limit?:      number,
  ) {
    return this.invoicesService.findAll(companyId, { search, status, type, from, to, customerId, page, limit });
  }

  @Get('summary')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen financiero por período' })
  getSummary(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    return this.invoicesService.getSummary(companyId, from, to);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.findOne(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Crear factura' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(companyId, dto);
  }

  // ── DIAN: Enviar factura ────────────────────────────────────────────────

  @Post(':id/issue')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Generar XML UBL 2.1, firmar y enviar a la DIAN (SendTestSetAsync en habilitación)' })
  @HttpCode(HttpStatus.OK)
  issue(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.sendToDian(companyId, id);
  }

  @Patch(':id/send-dian')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Alias de /issue — envío a DIAN' })
  sendToDian(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.sendToDian(companyId, id);
  }

  // ── DIAN: Consultar estado ──────────────────────────────────────────────

  @Post(':id/dian-status')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Consultar estado de validación en la DIAN (GetStatusZip / GetStatus)' })
  @HttpCode(HttpStatus.OK)
  queryDianStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.queryDianStatus(companyId, id);
  }

  // ── DIAN: Descargar XML firmado ────────────────────────────────────────

  @Get(':id/xml')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Descargar XML UBL 2.1 firmado generado para la DIAN' })
  async downloadXml(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { xml, filename } = await this.invoicesService.getXml(companyId, id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  }

  // ── Estado / pagos ─────────────────────────────────────────────────────

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

   @Get(':id/pdf')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
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

  @Patch(':id/paid')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Marcar factura como pagada' })
  @HttpCode(HttpStatus.OK)
  markAsPaid(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.markAsPaid(companyId, id);
  }

  // ── Notas Crédito / Débito vinculadas a una factura ──────────────────────

  @Get(':id/notes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar notas crédito y débito asociadas a esta factura' })
  getNotes(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getAssociatedNotes(companyId, id);
  }

  @Get(':id/balance')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Obtener saldo disponible de la factura (total menos notas crédito)' })
  getBalance(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getRemainingBalance(companyId, id);
  }

  @Post(':id/credit-note')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear nota crédito referenciando esta factura' })
  createCreditNote(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    dto.type = 'NOTA_CREDITO' as any;
    dto.originalInvoiceId = id;
    return this.invoicesService.create(companyId, dto);
  }

  @Post(':id/debit-note')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear nota débito referenciando esta factura' })
  createDebitNote(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    dto.type = 'NOTA_DEBITO' as any;
    dto.originalInvoiceId = id;
    return this.invoicesService.create(companyId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar estado o campos de la factura' })
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string; notes?: string },
  ) {
    if (body.status === 'PAID') return this.invoicesService.markAsPaid(companyId, id);
    return this.invoicesService.findOne(companyId, id);
  }
}