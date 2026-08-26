import { Request, Response, NextFunction } from 'express';
import { UnauthenticatedError } from '../errors';
import { CurrentUser } from '../types/lead-filter';

const VALID_ROLES = ['owner', 'admin', 'manager', 'agent'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auth(req: Request, _res: Response, next: NextFunction) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id');
  const role = req.header('x-user-role');

  if (!tenantId || !userId || !role) {
    return next(
      new UnauthenticatedError(
        'Missing required auth headers: x-tenant-id, x-user-id, x-user-role'
      )
    );
  }

  if (!UUID_RE.test(tenantId) || !UUID_RE.test(userId)) {
    return next(new UnauthenticatedError('x-tenant-id and x-user-id must be valid UUIDs'));
  }

  if (!VALID_ROLES.includes(role)) {
    return next(
      new UnauthenticatedError(`x-user-role must be one of: ${VALID_ROLES.join(', ')}`)
    );
  }

  const currentUser: CurrentUser = {
    tenantId,
    userId,
    role: role as CurrentUser['role'],
  };

  req.currentUser = currentUser;
  next();
}
