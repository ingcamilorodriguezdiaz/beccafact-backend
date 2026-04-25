import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Res,
  StreamableFile,
  Headers,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  CreateInvoiceDocumentConfigDto,
  UpdateInvoiceDocumentConfigDto,
} from './dto/invoice-document-config.dto';
import {
  CreateDeliveryNoteDto,
  CreateSalesOrderDto,
  CreateSourceInvoiceDto,
} from './dto/invoice-commercial-flow.dto';
import { InvoiceRegisterPaymentDto } from './dto/invoice-register-payment.dto';
import { CreateInvoicePaymentAgreementDto } from './dto/invoice-collections.dto';
import {
  AddInvoiceAttachmentDto,
  RejectInvoiceApprovalDto,
  RequestInvoiceApprovalDto,
} from './dto/invoice-governance.dto';
import {
  BulkInvoiceReprocessDto,
  CreateInvoiceExternalIntakeDto,
  QueueInvoiceReprocessDto,
} from './dto/invoice-operations.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ProductsService } from '@/products/products.service';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@/common/constants/pagination.constants';
import { CurrentBranchId } from '@/common/decorators/current-branch-id.decorator';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(private invoicesService: InvoicesService, private productsService: ProductsService) { }

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  findAll(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.invoicesService.findAll(companyId, { search, status, type, branchId, from, to, customerId, page, limit });
  }

  @Get('products')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Listar productos' })
  findAllProducts(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string | undefined,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.findAll(companyId, {
      search,
      categoryId,
      status,
      branchId,
      page: page ? Number(page) : DEFAULT_PAGE,
      limit: limit ? Number(limit) : DEFAULT_LIMIT,
    });
  }

  @Get('summary')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Resumen financiero por período' })
  getSummary(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.invoicesService.getSummary(companyId,branchId, from, to);
  }

  @Get('analytics/summary')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Analítica empresarial y gestión documental de facturación' })
  getAnalyticsSummary(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.invoicesService.getAnalyticsSummary(companyId, branchId, { dateFrom, dateTo });
  }

  @Get('operations/monitor')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Monitor técnico DIAN y cola operativa de facturación' })
  getOperationalMonitor(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.invoicesService.getOperationalMonitor(companyId, branchId);
  }

  @Get('external-intakes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Listar intake de documentos externos para facturación' })
  getExternalIntakes(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.invoicesService.getExternalIntakes(companyId, branchId);
  }

  @Post('external-intakes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Registrar intake externo desde e-commerce u otro canal' })
  createExternalIntake(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Body() dto: CreateInvoiceExternalIntakeDto,
  ) {
    return this.invoicesService.createExternalIntake(companyId, branchId, dto, userId);
  }

  @Patch('external-intakes/:id/process')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Procesar intake externo y convertirlo en factura' })
  processExternalIntake(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.processExternalIntake(companyId, branchId, id, userId);
  }

  @Post('operations/process-queue')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Procesar cola pendiente de reprocesos DIAN' })
  processQueuedOperations(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.invoicesService.processQueuedOperations(companyId, branchId, userId);
  }

  @Post('operations/reprocess')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Programar reenvíos masivos o consultas masivas de DIAN' })
  bulkReprocess(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Body() dto: BulkInvoiceReprocessDto,
  ) {
    return this.invoicesService.bulkReprocess(companyId, branchId, dto, userId);
  }

  @Get('reports/fiscal-summary')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen fiscal documental de facturación por rango de fechas' })
  getFiscalSummaryReport(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.invoicesService.getFiscalSummaryReport(companyId, branchId, { dateFrom, dateTo });
  }

  @Get('reports/vat-sales-book')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Libro fiscal de IVA ventas desde facturación' })
  getVatSalesBookReport(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.invoicesService.getVatSalesBookReport(companyId, branchId, { dateFrom, dateTo });
  }

  @Get('reports/withholdings-book')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Libro documental de retenciones en ventas e ICA' })
  getWithholdingsBookReport(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.invoicesService.getWithholdingsBookReport(companyId, branchId, { dateFrom, dateTo });
  }

  @Get('reports/dian-validation')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Reporte de validaciones fiscales previas y control DIAN' })
  getDianValidationReport(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.invoicesService.getDianValidationReport(companyId, branchId, { dateFrom, dateTo });
  }

  @Get('document-configs')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Listar configuraciones documentales de facturación' })
  getDocumentConfigs(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.invoicesService.getDocumentConfigs(companyId, branchId);
  }

  @Post('document-configs')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear configuración documental de facturación' })
  createDocumentConfig(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateInvoiceDocumentConfigDto,
  ) {
    return this.invoicesService.createDocumentConfig(companyId, dto);
  }

  @Patch('document-configs/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar configuración documental de facturación' })
  updateDocumentConfig(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDocumentConfigDto,
  ) {
    return this.invoicesService.updateDocumentConfig(companyId, id, dto);
  }

  @Delete('document-configs/:id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Eliminar configuración documental de facturación' })
  removeDocumentConfig(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.removeDocumentConfig(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Crear factura' })
  create(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(companyId,branchId, dto);
  }

  @Get('sales-orders')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Listar pedidos comerciales' })
  getSalesOrders(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.invoicesService.getSalesOrders(companyId, branchId);
  }

  @Get('delivery-notes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Listar remisiones comerciales' })
  getDeliveryNotes(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
  ) {
    return this.invoicesService.getDeliveryNotes(companyId, branchId);
  }

  @Post('sales-orders')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Crear pedido comercial desde cotización, POS u origen libre' })
  createSalesOrder(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Body() dto: CreateSalesOrderDto,
  ) {
    return this.invoicesService.createSalesOrder(companyId, branchId, dto);
  }

  @Post('delivery-notes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CONTADOR')
  @ApiOperation({ summary: 'Crear remisión desde pedido comercial o POS' })
  createDeliveryNote(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Body() dto: CreateDeliveryNoteDto,
  ) {
    return this.invoicesService.createDeliveryNote(companyId, branchId, dto);
  }

  @Post('from-source')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Crear factura parcial o total desde pedido, remisión, cotización o POS' })
  createFromSource(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Body() dto: CreateSourceInvoiceDto,
  ) {
    return this.invoicesService.createInvoiceFromSource(companyId, branchId, dto);
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.findOne(companyId,branchId, id);
  }

  // ── DIAN: Enviar factura ────────────────────────────────────────────────

  @Post(':id/issue')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Generar XML UBL 2.1, firmar y enviar a la DIAN (SendTestSetAsync en habilitación)' })
  @HttpCode(HttpStatus.OK)
  issue(
    @CurrentUser('companyId') companyId: string,
    @Headers('x-context-source') source: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.sendToDian(companyId,source, id);
  }

  @Post(':id/queue-reprocess')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR', 'OPERATOR')
  @ApiOperation({ summary: 'Agregar factura a la cola de reproceso DIAN' })
  queueReprocess(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QueueInvoiceReprocessDto,
  ) {
    return this.invoicesService.queueInvoiceReprocess(companyId, branchId, id, dto, userId);
  }

  @Patch(':id/send-dian')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Alias de /issue — envío a DIAN' })
  sendToDian(
    @CurrentUser('companyId') companyId: string,
    @Headers('x-context-source') source: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.sendToDian(companyId,source, id);
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
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason: string,
  ) {
    return this.invoicesService.cancel(companyId, branchId,id, reason);
  }

  @Get(':id/pdf')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Previsualización HTML de la factura (renderizable como PDF)' })
  async getPdf(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.invoicesService.generatePdf(companyId,branchId, id);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="factura-${id}.html"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  @Get(':id/pdf/download')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Descargar factura en PDF' })
  async downloadPdf(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoicesService.generatePdfDocument(companyId, branchId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  @Get(':id/zip')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Descargar ZIP con PDF y XML de la factura electrónica' })
  async downloadZip(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoicesService.generateInvoiceZip(companyId, branchId, id);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  @Patch(':id/paid')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Marcar factura como pagada' })
  @HttpCode(HttpStatus.OK)
  markAsPaid(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.markAsPaid(companyId,branchId, id);
  }

  // ── Notas Crédito / Débito vinculadas a una factura ──────────────────────

  @Get(':id/notes')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Listar notas crédito y débito asociadas a esta factura' })
  getNotes(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getAssociatedNotes(companyId,branchId, id);
  }

  @Get(':id/balance')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Obtener saldo disponible de la factura (total menos notas crédito)' })
  getBalance(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getRemainingBalance(companyId,branchId, id);
  }

  @Get(':id/note-context')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Obtener contexto de notas crédito/débito: saldo exacto, líneas pendientes y reverso guiado' })
  getNoteContext(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getNoteContext(companyId, branchId, id);
  }

  @Get(':id/statement')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Obtener estado de cuenta detallado por factura' })
  getStatement(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getInvoiceStatement(companyId, branchId, id);
  }

  @Get(':id/approval-flow')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Obtener flujo de aprobación para emitir o anular la factura' })
  getApprovalFlow(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getApprovalFlow(companyId, branchId, id);
  }

  @Post(':id/request-approval')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Solicitar aprobación para emitir o anular la factura' })
  requestApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestInvoiceApprovalDto,
  ) {
    return this.invoicesService.requestApproval(companyId, branchId, id, dto, userId);
  }

  @Patch(':id/approve-approval')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Aprobar solicitud pendiente sobre la factura' })
  approveApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.approveApproval(companyId, branchId, id, userId);
  }

  @Patch(':id/reject-approval')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Rechazar solicitud pendiente sobre la factura' })
  rejectApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectInvoiceApprovalDto,
  ) {
    return this.invoicesService.rejectApproval(companyId, branchId, id, dto, userId);
  }

  @Get(':id/attachments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Listar adjuntos y soportes de la factura' })
  getAttachments(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getAttachments(companyId, branchId, id);
  }

  @Post(':id/attachments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Agregar adjunto o soporte documental a la factura' })
  addAttachment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddInvoiceAttachmentDto,
  ) {
    return this.invoicesService.addAttachment(companyId, branchId, id, dto, userId);
  }

  @Get(':id/audit-trail')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Obtener bitácora visible y trazabilidad de usuario de la factura' })
  getAuditTrail(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getAuditTrail(companyId, branchId, id);
  }

  @Get(':id/reconciliation')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Obtener conciliación factura vs recaudo' })
  getReconciliation(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getInvoiceReconciliation(companyId, branchId, id);
  }

  @Post(':id/payments')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Registrar pago parcial o total sobre una factura' })
  registerPartialPayment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceRegisterPaymentDto,
  ) {
    return this.invoicesService.registerPartialPayment(companyId, branchId, id, dto, userId);
  }

  @Post(':id/payment-agreements')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear acuerdo o promesa de pago sobre una factura' })
  createPaymentAgreement(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoicePaymentAgreementDto,
  ) {
    return this.invoicesService.createPaymentAgreement(companyId, branchId, id, dto, userId);
  }

  @Post(':id/credit-note')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear nota crédito referenciando esta factura' })
  createCreditNote(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    dto.type = 'NOTA_CREDITO' as any;
    dto.originalInvoiceId = id;
    return this.invoicesService.create(companyId,branchId, dto);
  }

  @Post(':id/debit-note')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Crear nota débito referenciando esta factura' })
  createDebitNote(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    dto.type = 'NOTA_DEBITO' as any;
    dto.originalInvoiceId = id;
    return this.invoicesService.create(companyId,branchId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Actualizar estado o campos de la factura' })
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser('companyId') companyId: string,
    @CurrentBranchId() branchId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: string; notes?: string },
  ) {
    if (body.status === 'PAID') return this.invoicesService.markAsPaid(companyId,branchId, id);
    return this.invoicesService.findOne(companyId,branchId, id);
  }


}
