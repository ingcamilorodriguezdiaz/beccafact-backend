import {
  Controller, Get, Post, Put, Delete, Patch, Body, Param, UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlanGuard } from '../common/guards/plan.guard';
import { CompanyStatusGuard } from '../common/guards/company-status.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanFeature } from '../common/decorators/plan-feature.decorator';

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, CompanyStatusGuard, PlanGuard)
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsController {
  constructor(private integrationsService: IntegrationsService) {}

  @Get()
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.integrationsService.findAll(companyId);
  }

  @Post()
  @Roles('ADMIN')
  @PlanFeature('has_integrations')
  create(@CurrentUser('companyId') companyId: string, @Body() dto: any) {
    return this.integrationsService.create(companyId, dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  @PlanFeature('has_integrations')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.integrationsService.update(companyId, id, dto);
  }

  @Patch(':id/toggle')
  @Roles('ADMIN')
  toggle(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.integrationsService.toggle(companyId, id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.integrationsService.remove(companyId, id);
  }
}
