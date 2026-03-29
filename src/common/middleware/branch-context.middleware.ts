import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export const BRANCH_ID_HEADER = 'x-branch-id';

/** Reads X-Branch-Id header and attaches it to req.branchId when present. */
@Injectable()
export class BranchContextMiddleware implements NestMiddleware {
  use(req: Request & { branchId?: string }, _res: Response, next: NextFunction) {
    const raw = req.headers[BRANCH_ID_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (value && /^[\w-]{1,100}$/.test(value)) {
      req.branchId = value;
    }

    next();
  }
}
