import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the active branch ID from the request (set by BranchContextMiddleware).
 * Returns `undefined` when the header was not sent or was invalid.
 *
 * Usage: @CurrentBranchId() branchId: string | undefined
 */
export const CurrentBranchId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<{ branchId?: string }>();
    return req.branchId;
  },
);
