import type { IsoDate } from './dates.ts';
import type { ArrearsSummary } from './rent/ledger.ts';
import type { ExpenseCategory } from './tools.ts';
import type {
  ComplianceStatus,
  DocumentType,
  MaintenanceCategory,
  MaintenanceStatus,
  MaintenanceUrgency,
  Nation,
  RentCharge,
  RentFrequency,
} from './types.ts';

/** Shapes returned by the API. Shared by the web and mobile apps. */
export interface PropertyDto {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  postcode: string;
  nation: Nation;
  hasGas: boolean;
  isHmo: boolean;
  /** Landlord's estimate of what the property is worth, for equity and yield. */
  valuePence?: number | null;
  mortgagePence?: number | null;
}

export interface ComplianceItemDto {
  id: string;
  ruleId: string;
  title: string;
  severity: 'statutory' | 'best_practice';
  upcoming: boolean;
  status: ComplianceStatus;
  propertyId: string | null;
  tenancyId: string | null;
  propertyAddress: string | null;
  completedOn: IsoDate | null;
  expiresOn: IsoDate | null;
  dueDate: IsoDate | null;
  documentId: string | null;
}

export interface MaintenanceUpdateDto {
  id: string;
  createdAt: string;
  authorRole: string;
  status: MaintenanceStatus | null;
  message: string | null;
}

export interface MaintenanceRequestDto {
  id: string;
  propertyId: string;
  propertyAddress: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  urgency: MaintenanceUrgency;
  status: MaintenanceStatus;
  reportedAt: string;
  appointmentAt: string | null;
  photoDocumentIds: string[];
  /** Work order: who is doing the job, what was quoted and what it finally cost. */
  contractorId?: string | null;
  contractorName?: string | null;
  quotePence?: number | null;
  costPence?: number | null;
  updates?: MaintenanceUpdateDto[];
}

export interface NewMaintenanceRequest {
  /** The landlord must say which tenancy; a tenant's own tenancy is used automatically. */
  tenancyId?: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  urgency: MaintenanceUrgency;
  photoDocumentIds?: string[];
}

export interface TenancyDto {
  id: string;
  propertyId: string;
  propertyAddress: string;
  tenantNames: string[];
  startDate: IsoDate;
  endDate: IsoDate | null;
  rentAmountPence: number;
  rentFrequency: RentFrequency;
  depositPence: number;
  depositScheme: string | null;
  status: 'draft' | 'active' | 'ended';
  /** Positive: rent owed. Negative: in credit. */
  balancePence: number;
  daysInArrears: number;
}

export interface LedgerPaymentDto {
  id: string;
  date: IsoDate;
  amountPence: number;
  method: string;
  status: string;
}

export interface LedgerDto {
  charges: RentCharge[];
  payments: LedgerPaymentDto[];
  summary: ArrearsSummary;
}

export interface DocumentDto {
  id: string;
  type: DocumentType;
  fileName: string;
  propertyId: string | null;
  tenancyId: string | null;
  propertyAddress: string | null;
  createdAt: string;
}

export type ApplicationStatus = 'invited' | 'submitted' | 'in_review' | 'passed' | 'failed' | 'withdrawn';
export type CheckKind = 'identity' | 'right_to_rent' | 'income' | 'employer' | 'landlord' | 'credit' | 'guarantor';
export type CheckStatus = 'pending' | 'passed' | 'failed' | 'not_required';

export interface ApplicationDto {
  id: string;
  propertyId: string;
  propertyAddress: string;
  applicantName: string;
  status: ApplicationStatus;
  monthlyRentPence: number;
  annualIncomePence: number | null;
  /** Whether stated income meets the affordability threshold; null until income is known. */
  affordable: boolean | null;
  checks: { kind: CheckKind; status: CheckStatus }[];
  decisionReason: string | null;
  createdAt: string;
}

export interface ContractorDto {
  id: string;
  name: string;
  trade: string;
  phone: string | null;
  gasSafeNumber: string | null;
  electricalScheme: string | null;
  insuranceExpiry: IsoDate | null;
  /** 1 to 5. */
  rating: number | null;
}

export interface KeyMovementDto {
  date: IsoDate;
  action: 'issued' | 'returned';
  person: string;
}

export interface KeyDto {
  id: string;
  propertyId: string;
  propertyAddress: string;
  label: string;
  /** Who has the key now; null means the landlord holds it. */
  holder: string | null;
  movements: KeyMovementDto[];
}

export interface InspectionDto {
  id: string;
  propertyId: string;
  propertyAddress: string;
  date: IsoDate;
  status: 'planned' | 'done' | 'cancelled';
  /** Date written notice of the visit was given to the tenant. */
  noticeGivenOn: IsoDate | null;
  notes: string | null;
}

export interface ExpenseDto {
  id: string;
  propertyId: string | null;
  propertyAddress: string | null;
  date: IsoDate;
  category: ExpenseCategory;
  description: string;
  amountPence: number;
}

export interface MileageDto {
  id: string;
  date: IsoDate;
  miles: number;
  purpose: string;
}

export interface IncomePaymentDto {
  id: string;
  tenancyId: string;
  date: IsoDate;
  amountPence: number;
}

export interface UploadTicket {
  documentId: string;
  uploadUrl: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApiClient(baseUrl: string, getIdToken: () => Promise<string>) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await getIdToken()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new ApiError(response.status, detail.error ?? `Request failed (${response.status})`);
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  return {
    listProperties: () => request<PropertyDto[]>('GET', '/properties'),
    createProperty: (input: Omit<PropertyDto, 'id'>) => request<PropertyDto>('POST', '/properties', input),

    listCompliance: () => request<{ score: number; items: ComplianceItemDto[] }>('GET', '/compliance'),
    completeComplianceItem: (id: string, input: { completedOn: IsoDate; expiresOn?: IsoDate; documentId?: string }) =>
      request<ComplianceItemDto>('POST', `/compliance/${id}/complete`, input),

    listMaintenance: () => request<MaintenanceRequestDto[]>('GET', '/maintenance'),
    getMaintenance: (id: string) => request<MaintenanceRequestDto>('GET', `/maintenance/${id}`),
    reportMaintenance: (input: NewMaintenanceRequest) => request<MaintenanceRequestDto>('POST', '/maintenance', input),
    updateMaintenance: (
      id: string,
      input: { status?: MaintenanceStatus; message?: string; appointmentAt?: string; contractorId?: string | null; quotePence?: number | null; costPence?: number | null },
    ) =>
      request<MaintenanceRequestDto>('POST', `/maintenance/${id}/updates`, input),

    listTenancies: () => request<TenancyDto[]>('GET', '/tenancies'),
    getLedger: (tenancyId: string) => request<LedgerDto>('GET', `/tenancies/${tenancyId}/ledger`),
    listDocuments: () => request<DocumentDto[]>('GET', '/documents'),
    listApplications: () => request<ApplicationDto[]>('GET', '/referencing/applications'),
    decideApplication: (id: string, input: { status: 'passed' | 'failed'; reason: string }) =>
      request<ApplicationDto>('POST', `/referencing/applications/${id}/decision`, input),
    /** Turns a passed applicant into the tenant of the property, starting on the given date. */
    convertApplication: (id: string, input: { startDate: IsoDate }) => request<TenancyDto>('POST', `/referencing/applications/${id}/convert`, input),

    updateProperty: (id: string, input: { valuePence?: number | null; mortgagePence?: number | null }) => request<PropertyDto>('PATCH', `/properties/${id}`, input),
    recordPayment: (tenancyId: string, input: { date: IsoDate; amountPence: number; method: 'bank_transfer' | 'cash' | 'benefit' | 'other' }) =>
      request<LedgerPaymentDto>('POST', `/tenancies/${tenancyId}/payments`, input),
    listPayments: () => request<IncomePaymentDto[]>('GET', '/payments'),

    listContractors: () => request<ContractorDto[]>('GET', '/contractors'),
    addContractor: (input: Omit<ContractorDto, 'id'>) => request<ContractorDto>('POST', '/contractors', input),

    listKeys: () => request<KeyDto[]>('GET', '/keys'),
    addKey: (input: { propertyId: string; label: string }) => request<KeyDto>('POST', '/keys', input),
    moveKey: (id: string, input: { action: 'issued' | 'returned'; person: string }) => request<KeyDto>('POST', `/keys/${id}/movements`, input),

    listInspections: () => request<InspectionDto[]>('GET', '/inspections'),
    planInspection: (input: { propertyId: string; date: IsoDate }) => request<InspectionDto>('POST', '/inspections', input),
    updateInspection: (id: string, input: { status?: InspectionDto['status']; noticeGivenOn?: IsoDate; notes?: string }) =>
      request<InspectionDto>('POST', `/inspections/${id}`, input),

    listExpenses: () => request<ExpenseDto[]>('GET', '/expenses'),
    addExpense: (input: { propertyId: string | null; date: IsoDate; category: ExpenseCategory; description: string; amountPence: number }) =>
      request<ExpenseDto>('POST', '/expenses', input),
    listMileage: () => request<MileageDto[]>('GET', '/mileage'),
    addMileage: (input: { date: IsoDate; miles: number; purpose: string }) => request<MileageDto>('POST', '/mileage', input),

    requestUpload: (input: { fileName: string; contentType: string; type: DocumentType; propertyId?: string; tenancyId?: string }) =>
      request<UploadTicket>('POST', '/documents/upload-url', input),
    downloadUrl: (documentId: string) => request<{ url: string }>('GET', `/documents/${documentId}/download-url`),

    registerPushToken: (token: string) => request<void>('POST', '/me/push-token', { token }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
