import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../config/prisma.service';

export const AUDIT_KEY = 'audit';
export interface AuditMeta {
  action: string;
  resource: string;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const audit = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!audit) return next.handle();

    const req = context.switchToHttp().getRequest();
    const { user, ip, headers } = req;

    return next.handle().pipe(
      tap(async (response) => {
        if (user) {
          await this.prisma.auditLog.create({
            data: {
              companyId: user.companyId,
              userId: user.sub,
              action: audit.action,
              resource: audit.resource,
              resourceId: response?.data?.id ?? req.params?.id,
              after: response?.data,
              ip: ip,
              userAgent: headers['user-agent'],
            },
          });
        }
      }),
    );
  }
}
