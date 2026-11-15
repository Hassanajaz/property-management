import type { ApplicationDto, ApplicationStatus, CheckKind, CheckStatus, ComplianceItemDto, MaintenanceRequestDto, PropertyDto, TenancyDto } from './client.ts';
import { monthlyEquivalentPence } from './rent/schedule.ts';
import type { DocumentType } from './types.ts';

/** Headline figures for a landlord's or agency's portfolio, worked out from the lists the API returns. */
export interface PortfolioSummary {
  properties: number;
  let: number;
  vacant: number;
  /** Rent due per calendar month across active tenancies. */
  monthlyRentPence: number;
  arrearsPence: number;
  tenanciesInArrears: number;
  complianceAttention: number;
  openRepairs: number;
  approvalsNeeded: number;
  applicationsInProgress: number;
}

export function portfolioSummary(input: {
  properties: readonly PropertyDto[];
  tenancies: readonly TenancyDto[];
  compliance: readonly ComplianceItemDto[];
  repairs: readonly MaintenanceRequestDto[];
  applications: readonly ApplicationDto[];
}): PortfolioSummary {
  const active = input.tenancies.filter((t) => t.status === 'active');
  const letIds = new Set(active.map((t) => t.propertyId));
  const owing = active.filter((t) => t.balancePence > 0);
  return {
    properties: input.properties.length,
    let: input.properties.filter((p) => letIds.has(p.id)).length,
    vacant: input.properties.filter((p) => !letIds.has(p.id)).length,
    monthlyRentPence: active.reduce((sum, t) => sum + monthlyEquivalentPence(t.rentAmountPence, t.rentFrequency), 0),
    arrearsPence: owing.reduce((sum, t) => sum + t.balancePence, 0),
    tenanciesInArrears: owing.length,
    complianceAttention: input.compliance.filter((i) => !i.upcoming && i.severity === 'statutory' && i.status !== 'valid').length,
    openRepairs: input.repairs.filter((r) => r.status !== 'confirmed' && r.status !== 'cancelled').length,
    approvalsNeeded: input.repairs.filter((r) => r.status === 'awaiting_landlord_approval').length,
    applicationsInProgress: input.applications.filter((a) => a.status === 'invited' || a.status === 'submitted' || a.status === 'in_review').length,
  };
}

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  gas_safety_record: 'Gas safety record',
  eicr: 'Electrical report (EICR)',
  epc: 'Energy certificate (EPC)',
  alarm_check: 'Alarm check',
  legionella_assessment: 'Legionella assessment',
  hmo_licence: 'HMO licence',
  deposit_certificate: 'Deposit certificate',
  deposit_prescribed_information: 'Deposit prescribed information',
  right_to_rent_check: 'Right to Rent check',
  tenancy_agreement: 'Tenancy agreement',
  written_statement: 'Written statement',
  landlord_registration: 'Landlord registration',
  agent_licence: 'Agent licence',
  scheme_membership: 'Scheme membership',
  ico_registration: 'ICO registration',
  inventory: 'Inventory',
  id_document: 'ID document',
  income_evidence: 'Income evidence',
  reference: 'Reference',
  maintenance_photo: 'Repair photo',
  invoice: 'Invoice',
  other: 'Other document',
};

/** Document types a landlord may add for their own property. */
export const LANDLORD_UPLOAD_TYPES: readonly DocumentType[] = ['gas_safety_record', 'eicr', 'epc', 'alarm_check', 'legionella_assessment', 'hmo_licence', 'landlord_registration', 'invoice', 'other'];

/** Personal documents about applicants and tenants that landlords never see. */
export const STAFF_ONLY_DOCUMENT_TYPES: readonly DocumentType[] = ['id_document', 'income_evidence', 'reference', 'right_to_rent_check'];

/** Document types a tenant may open for their own home. */
export const TENANT_DOCUMENT_TYPES: readonly DocumentType[] = [
  'tenancy_agreement', 'written_statement', 'deposit_certificate', 'deposit_prescribed_information',
  'gas_safety_record', 'eicr', 'epc', 'inventory', 'maintenance_photo',
];

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  invited: 'Invited',
  submitted: 'Submitted',
  in_review: 'Checks under way',
  passed: 'Passed',
  failed: 'Not passed',
  withdrawn: 'Withdrawn',
};

export const CHECK_LABEL: Record<CheckKind, string> = {
  identity: 'Identity',
  right_to_rent: 'Right to Rent',
  income: 'Income',
  employer: 'Employer reference',
  landlord: 'Previous landlord reference',
  credit: 'Credit check',
  guarantor: 'Guarantor',
};

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  not_required: 'Not required',
};
