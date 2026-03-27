import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../config/prisma.service';
import { USAGE_METRIC_KEY } from '../decorators/usage-metric.decorator';

@Injectable()
export class UsageLimitGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metric = this.reflector.getAllAndOverride<string>(USAGE_METRIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metric) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || user.isSuperAdmin) return true;
    if (!user.companyId) return false;

    const period = this.getCurrentPeriod();

    const [usageRecord, subscription] = await Promise.all([
      this.prisma.usageTracking.findUnique({
        where: {
          companyId_metric_period: {
            companyId: user.companyId,
            metric,
            period,
          },
        },
      }),
      this.prisma.subscription.findFirst({
        where: {
          companyId: user.companyId,
          status: { in: ['ACTIVE', 'TRIAL'] },
        },
        include: { plan: { include: { features: true } } },
        orderBy: { startDate: 'desc' },
      }),
    ]);

    if (!subscription) throw new ForbiddenException('No tienes suscripción activa');

    // Get limit from plan or custom override
    const customLimits = subscription.customLimits as Record<string, string> | null;
    let limitStr = customLimits?.[metric];

    if (!limitStr) {
      const feature = subscription.plan.features.find((f) => f.key === metric);
      limitStr = feature?.value;
    }
    
    const unlimitedValues = ['unlimited', 'true', '-1', undefined, null, ''];

    if (unlimitedValues.includes(limitStr)) {
      return true; // ilimitado
    }

    const limit = parseInt(String(limitStr), 10);
    const current = usageRecord?.value ?? 0;

    if (current >= limit) {
      throw new ForbiddenException(
        `Has alcanzado el límite mensual de ${limit} ${metric.replace(/_/g, ' ')}. Actualiza tu plan para continuar.`,
      );
    }

    return true;
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
