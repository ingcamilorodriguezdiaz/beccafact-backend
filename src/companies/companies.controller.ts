import { Controller, Get, Put, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard)
@Controller({ path: 'companies', version: '1' })
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Obtener datos de mi empresa' })
  getMyCompany(@CurrentUser('companyId') companyId: string) {
    return this.companiesService.getMyCompany(companyId);
  }

  @Put('me')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Actualizar datos de mi empresa (PUT)' })
  updateMyCompany(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.updateMyCompany(companyId, dto);
  }

  /** PATCH para actualizaciones parciales (settings-company usa esto) */
  @Patch('me')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Actualizar datos de mi empresa (PATCH)' })
  patchMyCompany(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.updateMyCompany(companyId, dto);
  }

  @Get('me/usage')
  @ApiOperation({ summary: 'Consultar consumo mensual actual' })
  getUsage(@CurrentUser('companyId') companyId: string) {
    return this.companiesService.getUsage(companyId);
  }

  @Get('me/billing')
  @ApiOperation({ summary: 'Información de facturación y suscripción activa' })
  getBilling(@CurrentUser('companyId') companyId: string) {
    return this.companiesService.getBilling(companyId);
  }

  @Get('me/users')
  @Roles('ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Listar usuarios de la empresa' })
  getUsers(@CurrentUser('companyId') companyId: string) {
    return this.companiesService.getUsers(companyId);
  }
}
