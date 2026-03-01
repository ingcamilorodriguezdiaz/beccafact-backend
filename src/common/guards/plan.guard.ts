import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../config/prisma.service';
import { PLAN_FEATURE_KEY } from '../decorators/plan-feature.decorator';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(PLAN_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredFeature) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    if (!user.companyId) return false;

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId: user.companyId,
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      include: {
        plan: { include: { features: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    if (!subscription) {
      throw new ForbiddenException('No tienes una suscripción activa');
    }

    // Check custom overrides first
    const customLimits = subscription.customLimits as Record<string, string> | null;
    if (customLimits && customLimits[requiredFeature] !== undefined) {
      return customLimits[requiredFeature] !== 'false' && customLimits[requiredFeature] !== '0';
    }

    const feature = subscription.plan.features.find((f) => f.key === requiredFeature);
    if (!feature) {
      throw new ForbiddenException(
        `La función "${requiredFeature}" no está disponible en tu plan actual. Considera actualizar tu plan.`,
      );
    }

    if (feature.value === 'false' || feature.value === '0') {
      throw new ForbiddenException(
        `Tu plan ${subscription.plan.displayName} no incluye esta funcionalidad. Actualiza tu plan para acceder.`,
      );
    }

    return true;
  }
}
