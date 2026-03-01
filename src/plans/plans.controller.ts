import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class PlansController {
  constructor(private plansService: PlansService) {}

  @Get('public')
  @ApiOperation({ summary: 'Obtener lista pública de planes (pricing page)' })
  findPublic() {
    return this.plansService.findPublic();
  }

  @Get('my-plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener plan activo de mi empresa' })
  getMyPlan(@CurrentUser('companyId') companyId: string) {
    return this.plansService.getCompanyPlan(companyId);
  }
}
