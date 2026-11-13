import type { IsoDate } from './dates.ts';
import type {
  ComplianceStatus,
  DocumentType,
  MaintenanceCategory,
  MaintenanceStatus,
  MaintenanceUrgency,
  Nation,
} from './types.ts';

/** Shapes returned by the API. Shared by the web and mobile apps. */
export interface PropertyDto {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  postcode: string;
  nation: Nation;
  landlordId: string | null;
  hasGas: boolean;
  isHmo: boolean;
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
  updates?: MaintenanceUpdateDto[];
}

export interface NewMaintenanceRequest {
  /** Staff must say which tenancy; a tenant's own tenancy is used automatically. */
  tenancyId?: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  urgency: MaintenanceUrgency;
  photoDocumentIds?: string[];
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
    updateMaintenance: (id: string, input: { status?: MaintenanceStatus; message?: string; appointmentAt?: string }) =>
      request<MaintenanceRequestDto>('POST', `/maintenance/${id}/updates`, input),

    requestUpload: (input: { fileName: string; contentType: string; type: DocumentType; propertyId?: string; tenancyId?: string }) =>
      request<UploadTicket>('POST', '/documents/upload-url', input),
    downloadUrl: (documentId: string) => request<{ url: string }>('GET', `/documents/${documentId}/download-url`),

    registerPushToken: (token: string) => request<void>('POST', '/me/push-token', { token }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
