import type { IsoDate } from './dates.ts';

export type Nation = 'england' | 'wales' | 'scotland' | 'northern_ireland';

/** Who is signed in. One login screen; the role decides what the person sees. */
export type Role = 'agency_owner' | 'agency_staff' | 'landlord' | 'tenant';

export const STAFF_ROLES: readonly Role[] = ['agency_owner', 'agency_staff'];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

/** What a compliance requirement is attached to. */
export type ComplianceScope = 'property' | 'tenancy' | 'landlord' | 'agency';

export type DocumentType =
  | 'gas_safety_record'
  | 'eicr'
  | 'epc'
  | 'alarm_check'
  | 'legionella_assessment'
  | 'hmo_licence'
  | 'deposit_certificate'
  | 'deposit_prescribed_information'
  | 'right_to_rent_check'
  | 'tenancy_agreement'
  | 'written_statement'
  | 'landlord_registration'
  | 'agent_licence'
  | 'scheme_membership'
  | 'ico_registration'
  | 'inventory'
  | 'id_document'
  | 'income_evidence'
  | 'reference'
  | 'maintenance_photo'
  | 'invoice'
  | 'other';

export type ComplianceStatus = 'missing' | 'valid' | 'due_soon' | 'overdue';

/** Facts about the subject that switch rules on or off. */
export interface SubjectFacts {
  hasGas?: boolean;
  isHmo?: boolean;
  depositTaken?: boolean;
}

export type RentFrequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'quarterly';

export interface RentTerms {
  startDate: IsoDate;
  /** Leave undefined for an open-ended (periodic) tenancy. */
  endDate?: IsoDate;
  amountPence: number;
  frequency: RentFrequency;
}

export interface RentCharge {
  dueDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  amountPence: number;
  proRata: boolean;
}

export interface Payment {
  date: IsoDate;
  amountPence: number;
}

export type MaintenanceCategory =
  | 'plumbing'
  | 'heating'
  | 'electrical'
  | 'appliance'
  | 'damp_mould'
  | 'structural'
  | 'security'
  | 'pest'
  | 'garden_exterior'
  | 'other';

export type MaintenanceUrgency = 'emergency' | 'urgent' | 'routine';

export type MaintenanceStatus =
  | 'reported'
  | 'triaged'
  | 'awaiting_landlord_approval'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'confirmed'
  | 'reopened'
  | 'cancelled';
