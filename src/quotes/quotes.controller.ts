import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto, UpdateQuoteStatusDto } from './dto/update-quote.dto';
import { RequestQuoteApprovalDto } from './dto/request-quote-approval.dto';
import { RejectQuoteApprovalDto } from './dto/reject-quote-approval.dto';
import { CreateQuoteFollowUpDto } from './dto/create-quote-followup.dto';
import { CreateQuoteApprovalPolicyDto, UpdateQuoteApprovalPolicyDto } from './dto/quote-approval-policy.dto';
import { CreateQuoteAttachmentDto, CreateQuoteCommentDto } from './dto/quote-document-governance.dto';
import {
  CreateCommercialMasterDto,
  CreateQuotePriceListDto,
  CreateQuoteTemplateDto,
  UpdateCommercialMasterDto,
  UpdateQuotePriceListDto,
  UpdateQuoteTemplateDto,
} from './dto/commercial-masters.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DEFAULT_PAGE, DEFAULT_LIMIT } from '../common/constants/pagination.constants';

@ApiTags('quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'quotes', version: '1' })
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get('masters')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Obtener catálogo de maestros comerciales de cotizaciones' })
  getCommercialMasters(@CurrentUser('companyId') companyId: string) {
    return this.quotesService.getCommercialMasters(companyId);
  }

  @Post('masters/sales-owners')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear responsable comercial' })
  createSalesOwner(@CurrentUser('companyId') companyId: string, @Body() dto: CreateCommercialMasterDto) {
    return this.quotesService.createCommercialMaster(companyId, 'salesOwner', dto);
  }

  @Put('masters/sales-owners/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar responsable comercial' })
  updateSalesOwner(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommercialMasterDto,
  ) {
    return this.quotesService.updateCommercialMaster(companyId, 'salesOwner', id, dto);
  }

  @Delete('masters/sales-owners/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar responsable comercial' })
  removeSalesOwner(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removeCommercialMaster(companyId, 'salesOwner', id);
  }

  @Post('masters/source-channels')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear canal comercial' })
  createSourceChannel(@CurrentUser('companyId') companyId: string, @Body() dto: CreateCommercialMasterDto) {
    return this.quotesService.createCommercialMaster(companyId, 'sourceChannel', dto);
  }

  @Put('masters/source-channels/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar canal comercial' })
  updateSourceChannel(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommercialMasterDto,
  ) {
    return this.quotesService.updateCommercialMaster(companyId, 'sourceChannel', id, dto);
  }

  @Delete('masters/source-channels/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar canal comercial' })
  removeSourceChannel(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removeCommercialMaster(companyId, 'sourceChannel', id);
  }

  @Post('masters/lost-reasons')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear motivo de pérdida' })
  createLostReason(@CurrentUser('companyId') companyId: string, @Body() dto: CreateCommercialMasterDto) {
    return this.quotesService.createCommercialMaster(companyId, 'lostReason', dto);
  }

  @Put('masters/lost-reasons/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar motivo de pérdida' })
  updateLostReason(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommercialMasterDto,
  ) {
    return this.quotesService.updateCommercialMaster(companyId, 'lostReason', id, dto);
  }

  @Delete('masters/lost-reasons/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar motivo de pérdida' })
  removeLostReason(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removeCommercialMaster(companyId, 'lostReason', id);
  }

  @Post('masters/stages')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear etapa comercial' })
  createStage(@CurrentUser('companyId') companyId: string, @Body() dto: CreateCommercialMasterDto) {
    return this.quotesService.createCommercialMaster(companyId, 'stage', dto);
  }

  @Put('masters/stages/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar etapa comercial' })
  updateStage(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommercialMasterDto,
  ) {
    return this.quotesService.updateCommercialMaster(companyId, 'stage', id, dto);
  }

  @Delete('masters/stages/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar etapa comercial' })
  removeStage(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removeCommercialMaster(companyId, 'stage', id);
  }

  @Post('masters/price-lists')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear lista de precios comercial' })
  createPriceList(@CurrentUser('companyId') companyId: string, @Body() dto: CreateQuotePriceListDto) {
    return this.quotesService.createPriceList(companyId, dto);
  }

  @Put('masters/price-lists/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar lista de precios comercial' })
  updatePriceList(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuotePriceListDto,
  ) {
    return this.quotesService.updatePriceList(companyId, id, dto);
  }

  @Delete('masters/price-lists/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar lista de precios comercial' })
  removePriceList(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removePriceList(companyId, id);
  }

  @Post('masters/templates')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear plantilla de cotización' })
  createTemplate(@CurrentUser('companyId') companyId: string, @Body() dto: CreateQuoteTemplateDto) {
    return this.quotesService.createTemplate(companyId, dto);
  }

  @Put('masters/templates/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar plantilla de cotización' })
  updateTemplate(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteTemplateDto,
  ) {
    return this.quotesService.updateTemplate(companyId, id, dto);
  }

  @Delete('masters/templates/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar plantilla de cotización' })
  removeTemplate(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removeTemplate(companyId, id);
  }

  @Get('approval-policies')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar políticas de aprobación empresarial de cotizaciones' })
  getApprovalPolicies(@CurrentUser('companyId') companyId: string) {
    return this.quotesService.getApprovalPolicies(companyId);
  }

  @Post('approval-policies')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Crear política de aprobación empresarial' })
  createApprovalPolicy(@CurrentUser('companyId') companyId: string, @Body() dto: CreateQuoteApprovalPolicyDto) {
    return this.quotesService.createApprovalPolicy(companyId, dto);
  }

  @Put('approval-policies/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Actualizar política de aprobación empresarial' })
  updateApprovalPolicy(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteApprovalPolicyDto,
  ) {
    return this.quotesService.updateApprovalPolicy(companyId, id, dto);
  }

  @Delete('approval-policies/:id')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Desactivar política de aprobación empresarial' })
  removeApprovalPolicy(@CurrentUser('companyId') companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotesService.removeApprovalPolicy(companyId, id);
  }

  @Get('analytics/summary')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen analítico comercial de cotizaciones' })
  getAnalyticsSummary(
    @CurrentUser('companyId') companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('salesOwnerName') salesOwnerName?: string,
    @Query('sourceChannel') sourceChannel?: string,
  ) {
    return this.quotesService.getAnalyticsSummary(companyId, {
      dateFrom,
      dateTo,
      salesOwnerName,
      sourceChannel,
    });
  }

  // ─── Listar cotizaciones con filtros y paginación ─────────────────────────
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar cotizaciones de la empresa con filtros' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.quotesService.findAll(companyId, {
      search,
      status,
      customerId,
      dateFrom,
      dateTo,
      page: Number(page) || DEFAULT_PAGE,
      limit: Number(limit) || DEFAULT_LIMIT,
    });
  }

  // ─── Detalle de cotización con ítems, cliente e invoice ──────────────────
  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Obtener detalle de una cotización' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.findOne(companyId, id);
  }

  // ─── Crear cotización ─────────────────────────────────────────────────────
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Crear nueva cotización' })
  create(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.create(companyId, dto, userId);
  }

  // ─── Actualizar cotización (solo DRAFT o SENT) ────────────────────────────
  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Actualizar cotización (solo DRAFT o SENT)' })
  update(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.update(companyId, id, dto, userId);
  }

  // ─── Cambiar estado de cotización (no permite CONVERTED manualmente) ──────
  @Patch(':id/status')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Cambiar estado de la cotización (excepto CONVERTED)' })
  updateStatus(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteStatusDto,
  ) {
    return this.quotesService.updateStatus(companyId, id, dto.status, userId, dto.lostReason);
  }

  // ─── Convertir cotización a factura ──────────────────────────────────────
  @Patch(':id/convert')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({
    summary: 'Convertir cotización a factura de venta (DRAFT)',
    description:
      'Crea una Invoice tipo VENTA con los mismos ítems. ' +
      'Marca la cotización como CONVERTED y guarda el invoiceId. ' +
      'Si ya fue convertida lanza ConflictException.',
  })
  convertToInvoice(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.convertToInvoice(companyId, id, userId);
  }

  @Post(':id/duplicate')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Duplicar cotización existente en un nuevo borrador' })
  duplicate(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.duplicate(companyId, id, userId);
  }

  @Post(':id/renew')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Renovar cotización vencida o reenviarla con nueva vigencia' })
  renew(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.renew(companyId, id, userId);
  }

  @Get(':id/follow-ups')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar seguimientos comerciales de la cotización' })
  getFollowUps(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.getFollowUps(companyId, id);
  }

  @Post(':id/follow-ups')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Registrar seguimiento comercial de la cotización' })
  createFollowUp(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuoteFollowUpDto,
  ) {
    return this.quotesService.createFollowUp(companyId, id, dto, userId);
  }

  @Get(':id/attachments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar adjuntos documentales de la cotización' })
  getAttachments(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.getAttachments(companyId, id);
  }

  @Post(':id/attachments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Registrar adjunto documental de la cotización' })
  createAttachment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuoteAttachmentDto,
  ) {
    return this.quotesService.createAttachment(companyId, id, dto, userId);
  }

  @Get(':id/comments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Listar comentarios internos de la cotización' })
  getComments(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.getComments(companyId, id);
  }

  @Post(':id/comments')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Registrar comentario interno de la cotización' })
  createComment(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuoteCommentDto,
  ) {
    return this.quotesService.createComment(companyId, id, dto, userId);
  }

  @Get(':id/audit-trail')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Obtener bitácora de auditoría visible de la cotización' })
  getAuditTrail(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.getAuditTrail(companyId, id);
  }

  @Get(':id/integration-summary')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Resumen de integraciones empresariales de la cotización' })
  getIntegrationSummary(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.getIntegrationSummary(companyId, id);
  }

  @Post(':id/send-to-dian')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR')
  @ApiOperation({ summary: 'Convertir la cotización a factura si hace falta y enviarla a DIAN' })
  sendToDian(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.sendToDian(companyId, id, userId);
  }

  @Get(':id/versions')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Historial de versiones de la cotización' })
  getVersions(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.getVersions(companyId, id);
  }

  @Post(':id/request-approval')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Solicitar aprobación comercial de la cotización' })
  requestApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestQuoteApprovalDto,
  ) {
    return this.quotesService.requestApproval(companyId, id, dto, userId);
  }

  @Patch(':id/approve')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Aprobar cotización para envío/conversión' })
  approve(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.approve(companyId, id, userId);
  }

  @Patch(':id/reject-approval')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Rechazar solicitud de aprobación de cotización' })
  rejectApproval(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectQuoteApprovalDto,
  ) {
    return this.quotesService.rejectApproval(companyId, id, dto, userId);
  }

  @Patch('expire-due')
  @Roles('ADMIN', 'MANAGER', 'CONTADOR')
  @ApiOperation({ summary: 'Vencer automáticamente cotizaciones cuya vigencia ya expiró' })
  expireDue(
    @CurrentUser('companyId') companyId: string,
  ) {
    return this.quotesService.expireDueQuotes(companyId);
  }

  // ─── Vista previa PDF de cotización ──────────────────────────────────────
  @Get(':id/pdf')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Vista previa PDF de la cotización (inline)' })
  async getPdf(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.quotesService.generatePdf(companyId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="cotizacion-${id}.pdf"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  // ─── Descargar PDF de cotización ──────────────────────────────────────────
  @Get(':id/pdf/download')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Descargar cotización en PDF' })
  async downloadPdf(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.quotesService.generatePdf(companyId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cotizacion-${id}.pdf"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  // ─── Vista previa DOCX de cotización ─────────────────────────────────────
  @Get(':id/docx')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'CAJERO', 'CONTADOR', 'VIEWER')
  @ApiOperation({ summary: 'Descargar cotización en formato Word (.docx)' })
  async getDocx(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.quotesService.generateDocx(companyId, id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="cotizacion-${id}.docx"`,
      'Cache-Control': 'no-cache',
    });
    return new StreamableFile(buffer);
  }

  // ─── Eliminar cotización (soft-delete, solo DRAFT) ────────────────────────
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cotización (soft-delete, solo en estado DRAFT)' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.remove(companyId, id, userId);
  }
}
