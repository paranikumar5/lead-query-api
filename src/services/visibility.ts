import { CurrentUser } from '../types/lead-filter';

const PRIVILEGED_ROLES = new Set(['owner', 'admin', 'manager']);

/**
 * Returns a SQL clause (plus its param) enforcing role-based visibility.
 * Privileged roles see all tenant leads; agents see only their own.
 */
export function buildVisibilityClause(
  user: CurrentUser,
  startParamIndex: number
): { clause: string | null; params: unknown[] } {
  if (PRIVILEGED_ROLES.has(user.role)) {
    return { clause: null, params: [] };
  }
  // agent
  return {
    clause: `assigned_to = $${startParamIndex + 1}`,
    params: [user.userId],
  };
}
