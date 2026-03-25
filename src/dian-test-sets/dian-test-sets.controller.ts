import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DianTestSetsService } from './dian-test-sets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../super-admin/super-admin.guard';

@ApiTags('super-admin/dian-test-sets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller({ path: 'super-admin/dian-test-sets', version: '1' })
export class DianTestSetsController {
  constructor(private readonly service: DianTestSetsService) {}

  @Get('company/:companyId')
  @ApiOperation({ summary: 'Listar test sets de una empresa' })
  findByCompany(@Param('companyId') companyId: string) {
    return this.service.findByCompany(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un test set con sus documentos' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('company/:companyId/facturacion')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Iniciar set de pruebas de facturación electrónica (50 docs)' })
  startFacturacion(@Param('companyId') companyId: string) {
    return this.service.startFacturacion(companyId);
  }

  @Post('company/:companyId/nomina')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Iniciar set de pruebas de nómina electrónica (20 docs)' })
  startNomina(@Param('companyId') companyId: string) {
    return this.service.startNomina(companyId);
  }

  @Post(':id/check-status')
  @ApiOperation({ summary: 'Verificar/refrescar estado DIAN de documentos pendientes' })
  checkStatuses(@Param('id') id: string) {
    return this.service.checkStatuses(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancelar y eliminar un test set' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
