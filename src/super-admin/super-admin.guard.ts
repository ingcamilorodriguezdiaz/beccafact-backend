import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Acceso exclusivo para administradores del sistema');
    }
    return true;
  }
}
