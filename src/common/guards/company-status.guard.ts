import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class CompanyStatusGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    if (!user.companyId) return false;

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { status: true },
    });

    if (!company) return false;

    switch (company.status) {
      case 'SUSPENDED':
        throw new ForbiddenException('Tu empresa está suspendida. Contacta a soporte para más información.');
      case 'CANCELLED':
        throw new ForbiddenException('Tu empresa ha sido cancelada.');
      case 'ACTIVE':
      case 'TRIAL':
        return true;
      default:
        return false;
    }
  }
}
