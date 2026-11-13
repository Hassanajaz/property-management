import type { MaintenanceStatus, MaintenanceUrgency, Role } from './types.ts';
import { isStaff } from './types.ts';

/**
 * Default response targets in hours, by urgency. These are service levels the
 * agency can change, not statutory deadlines.
 */
export const RESPONSE_TARGET_HOURS: Record<MaintenanceUrgency, number> = {
  emergency: 24,
  urgent: 72,
  routine: 24 * 28,
};

/** Which statuses a request can move to from each status. */
const TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  reported: ['triaged', 'cancelled'],
  triaged: ['awaiting_landlord_approval', 'scheduled', 'in_progress', 'cancelled'],
  awaiting_landlord_approval: ['scheduled', 'triaged', 'cancelled'],
  scheduled: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['confirmed', 'reopened'],
  confirmed: [],
  reopened: ['triaged', 'scheduled', 'in_progress', 'cancelled'],
  cancelled: [],
};

/**
 * Whether a person in `role` may move a request from one status to another.
 * Staff run the workflow. Tenants can cancel their own new report and confirm
 * or reopen a completed repair. Landlords approve or send back quoted works.
 */
export function canTransition(role: Role, from: MaintenanceStatus, to: MaintenanceStatus): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (isStaff(role)) return true;
  if (role === 'tenant') {
    return (from === 'reported' && to === 'cancelled') || (from === 'completed' && (to === 'confirmed' || to === 'reopened'));
  }
  if (role === 'landlord') {
    return from === 'awaiting_landlord_approval' && (to === 'scheduled' || to === 'triaged');
  }
  return false;
}

/** Wording shown to tenants for each status. */
export const TENANT_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  reported: 'Reported',
  triaged: 'Being reviewed',
  awaiting_landlord_approval: 'Waiting for approval',
  scheduled: 'Visit booked',
  in_progress: 'Work under way',
  completed: 'Repair done - please confirm',
  confirmed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

/** Hours left before the response target is missed (negative when already missed). */
export function hoursToTarget(reportedAt: Date, urgency: MaintenanceUrgency, now: Date): number {
  const elapsed = (now.getTime() - reportedAt.getTime()) / 3_600_000;
  return RESPONSE_TARGET_HOURS[urgency] - elapsed;
}
