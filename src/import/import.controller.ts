import {
  Controller, Post, Get, Delete, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile,
  ParseUUIDPipe, HttpCode, HttpStatus, Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { ImportService } from './import.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';
import { DEFAULT_PAGE, DEFAULT_LIMIT } from '../common/constants/pagination.constants';

@ApiTags('import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@Controller({ path: 'import', version: '1' })
export class ImportController {
  constructor(private importService: ImportService) { }

  // ─── EXCEL TEMPLATE ──────────────────────────────────────────────────────────

  /**
   * POST /import/template
   * Genera y descarga una plantilla Excel configurable.
   * No requiere feature de plan — disponible para todos los roles.
   */
  @Post('template')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar y descargar plantilla Excel para importación masiva' })
  async downloadTemplate(
    @Body('columns') columns: string[],
    @Body('customLabels') customLabels: Record<string, { label: string; hint: string; sample?: string }>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.importService.generateTemplate(columns, customLabels);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    });

    return new StreamableFile(buffer);
  }

  // ─── PREVIEW & UPLOAD ────────────────────────────────────────────────────────

  @Post('preview')
  @Roles('ADMIN', 'MANAGER')
  @PlanFeature('bulk_import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Previsualizar importación (sin guardar)' })
  preview(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('companyId') companyId: string,
  ) {
    return this.importService.parsePreview(file, companyId);
  }

  @Post('upload')
  @Roles('ADMIN', 'MANAGER')
  @PlanFeature('bulk_import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Iniciar importación masiva' })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.importService.createImportJob(file, companyId, userId);
  }

  @Get('history')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Historial de importaciones' })
  history(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Number(page) || DEFAULT_PAGE;
    const limitNumber = Number(limit) || DEFAULT_LIMIT;
    return this.importService.getHistory(companyId, pageNumber, limitNumber);
  }

  @Get(':id/status')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Estado de un import job' })
  status(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.importService.getJobStatus(companyId, id);
  }

  @Delete(':id/cancel')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar importación pendiente' })
  cancel(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.importService.cancelJob(companyId, id);
  }

  @Get(':id/error-report')
@Roles('ADMIN', 'MANAGER')
@ApiOperation({ summary: 'Descargar reporte de errores de importación como Excel' })
async downloadErrorReport(
  @CurrentUser('companyId') companyId: string,
  @Param('id', ParseUUIDPipe) id: string,
  @Res({ passthrough: true }) res: Response,
): Promise<StreamableFile> {
  const { buffer, filename } = await this.importService.generateErrorReport(companyId, id);

  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-cache',
  });

  return new StreamableFile(buffer);
}
}
