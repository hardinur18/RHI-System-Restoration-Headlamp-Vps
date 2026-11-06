import type { PermissionKey } from '../../data/permissions';
import { isAdvertiserRole, isCsRole, isFinanceRole, isTechnicianRole } from '../../data/roleHelpers';
import { APP_LAYOUT_TAB_PERMISSIONS } from './appLayoutTabPermissions';

export const hasRequiredPermission = (
  requirement: PermissionKey | PermissionKey[] | undefined,
  hasPermission: (permission: PermissionKey) => boolean,
) => {
  if (!requirement) return true;
  return Array.isArray(requirement)
    ? requirement.some(permission => hasPermission(permission))
    : hasPermission(requirement);
};

export const hasTabAccess = (
  tabId: string,
  hasPermission: (permission: PermissionKey) => boolean,
) => hasRequiredPermission(APP_LAYOUT_TAB_PERMISSIONS[tabId], hasPermission);

export const getRoleFallbackCandidates = (role?: string) => {
  if (isTechnicianRole(role)) {
    return ['teknisi-mobile', 'orders', 'dashboard'];
  }

  if (isCsRole(role)) {
    return ['dashboard', 'leads', 'orders', 'schedule'];
  }

  if (isAdvertiserRole(role)) {
    return ['dashboard', 'daily-ads', 'leads', 'orders', 'schedule'];
  }

  if (isFinanceRole(role)) {
    return ['dashboard', 'finance-report', 'daily-report', 'orders', 'cashflow'];
  }

  return ['dashboard', 'leads', 'orders', 'daily-report'];
};
