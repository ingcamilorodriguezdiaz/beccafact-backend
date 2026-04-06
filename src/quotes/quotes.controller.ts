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
    @Body() dto: CreateQuoteDto,
  ) {
    return this.quotesService.create(companyId, dto);
  }

  // ─── Actualizar cotización (solo DRAFT o SENT) ────────────────────────────
  @Put(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Actualizar cotización (solo DRAFT o SENT)' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteDto,
  ) {
    return this.quotesService.update(companyId, id, dto);
  }

  // ─── Cambiar estado de cotización (no permite CONVERTED manualmente) ──────
  @Patch(':id/status')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @ApiOperation({ summary: 'Cambiar estado de la cotización (excepto CONVERTED)' })
  updateStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteStatusDto,
  ) {
    return this.quotesService.updateStatus(companyId, id, dto.status);
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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.convertToInvoice(companyId, id);
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

  // ─── Eliminar cotización (soft-delete, solo DRAFT) ────────────────────────
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cotización (soft-delete, solo en estado DRAFT)' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.remove(companyId, id);
  }
}
