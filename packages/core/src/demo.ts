import {
  ApiError,
  type ApiClient,
  type ApplicationDto,
  type ComplianceItemDto,
  type DocumentDto,
  type LedgerPaymentDto,
  type MaintenanceRequestDto,
  type MaintenanceUpdateDto,
  type PropertyDto,
  type TenancyDto,
} from './client.ts';
import { complianceScore, generateRequirements, nextDue, statusOf, type RequirementState } from './compliance/engine.ts';
import { COMPLIANCE_RULES } from './compliance/rules.ts';
import { addDays, addMonths, today, type IsoDate } from './dates.ts';
import { canTransition } from './maintenance.ts';
import { TENANT_DOCUMENT_TYPES } from './portfolio.ts';
import { affordability } from './referencing/affordability.ts';
import { arrears } from './rent/ledger.ts';
import { generateSchedule } from './rent/schedule.ts';
import { isLandlord, type DocumentType, type Role } from './types.ts';

/**
 * Demo mode: an in-memory stand-in for the API with sample data, so the apps
 * can be tried on a phone before the AWS backend is deployed.
 *
 * The data lives in memory for as long as the app stays open and is shared
 * between the two demo people, so you can report a repair as the tenant, switch
 * person, and handle it as the landlord. Nothing is saved or sent anywhere.
 */
interface DemoItem {
  id: string;
  ruleId: string;
  propertyId: string;
  tenancyId: string | null;
  completedOn: IsoDate | null;
  expiresOn: IsoDate | null;
  dueDate: IsoDate | null;
}

type DemoTenancy = Omit<TenancyDto, 'propertyAddress' | 'balancePence' | 'daysInArrears'> & { payments: LedgerPaymentDto[] };

interface DemoStore {
  properties: PropertyDto[];
  tenancies: DemoTenancy[];
  documents: DocumentDto[];
  applications: ApplicationDto[];
  items: DemoItem[];
  repairs: (MaintenanceRequestDto & { updates: MaintenanceUpdateDto[] })[];
  nextId: number;
}

const TENANT_PROPERTY_ID = 'demo-property-1';
const TENANT_TENANCY_ID = 'demo-tenancy-1';

const rulesById = new Map(COMPLIANCE_RULES.map((rule) => [rule.id, rule]));
let store: DemoStore | null = null;

function address(p: PropertyDto): string {
  return `${p.addressLine1}, ${p.town} ${p.postcode}`;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function seed(): DemoStore {
  const now = today();
  const properties: PropertyDto[] = [
    { id: TENANT_PROPERTY_ID, addressLine1: '14 Maple Road', addressLine2: null, town: 'Leeds', postcode: 'LS6 2AB', nation: 'england', hasGas: true, isHmo: false },
    { id: 'demo-property-2', addressLine1: 'Flat 3, 22 Harbour Street', addressLine2: null, town: 'Cardiff', postcode: 'CF10 5AA', nation: 'wales', hasGas: true, isHmo: false },
    { id: 'demo-property-3', addressLine1: '8 Glen View', addressLine2: null, town: 'Edinburgh', postcode: 'EH6 4QQ', nation: 'scotland', hasGas: false, isHmo: true },
    { id: 'demo-property-4', addressLine1: '5 Orchard Close', addressLine2: null, town: 'Bristol', postcode: 'BS7 8QT', nation: 'england', hasGas: true, isHmo: false },
  ];

  // Months since each certificate was last done, chosen to show every status.
  const monthsAgo: Record<string, (number | null)[]> = {
    gas_safety: [11, 13, null, 2],
    eicr: [24, 59, 30, 10],
    epc: [40, 12, 130, 20],
    alarms: [20, 20, null, 5],
    legionella: [null, 6, 30, 5],
    hmo_licence: [null, null, 10, null],
  };

  const items: DemoItem[] = [];
  let n = 0;
  properties.forEach((property, index) => {
    const requirements = generateRequirements(
      { nation: property.nation, scope: 'property', facts: { hasGas: property.hasGas, isHmo: property.isHmo } },
      now,
    );
    for (const requirement of requirements) {
      const family = Object.keys(monthsAgo).find((key) => requirement.ruleId.startsWith(key));
      const months = family ? (monthsAgo[family]?.[index] ?? null) : null;
      items.push({
        id: `demo-item-${(n += 1)}`,
        ruleId: requirement.ruleId,
        propertyId: property.id,
        tenancyId: null,
        completedOn: months === null ? null : addMonths(now, -months),
        expiresOn: null,
        dueDate: null,
      });
    }
  });

  // The tenant's tenancy started three weeks ago; the deposit paperwork is still outstanding.
  const tenancyStart = addDays(now, -21);
  for (const requirement of generateRequirements(
    { nation: 'england', scope: 'tenancy', facts: { depositTaken: true }, tenancyStart, depositReceived: tenancyStart },
    tenancyStart,
  )) {
    const done = requirement.ruleId === 'right_to_rent' || requirement.ruleId === 'written_statement.england';
    items.push({
      id: `demo-item-${(n += 1)}`,
      ruleId: requirement.ruleId,
      propertyId: TENANT_PROPERTY_ID,
      tenancyId: TENANT_TENANCY_ID,
      completedOn: done ? tenancyStart : null,
      expiresOn: null,
      dueDate: requirement.dueDate ?? null,
    });
  }

  const first = properties[0]!;
  const second = properties[1]!;
  const third = properties[2]!;
  const fourth = properties[3]!;

  // Rent accounts. Payments are listed against the dates rent fell due.
  let paymentNo = 0;
  const paid = (date: IsoDate, amountPence: number): LedgerPaymentDto => ({
    id: `demo-payment-${(paymentNo += 1)}`,
    date,
    amountPence,
    method: 'direct_debit',
    status: 'confirmed',
  });
  const secondStart = addDays(addMonths(now, -14), -10);
  const thirdStart = addDays(addMonths(now, -8), -3);
  const tenancies: DemoTenancy[] = [
    {
      id: TENANT_TENANCY_ID, propertyId: first.id, tenantNames: ['Priya Shah', 'Tom Reed'], startDate: tenancyStart, endDate: null,
      rentAmountPence: 115000, rentFrequency: 'monthly', depositPence: 132500, depositScheme: null, status: 'active',
      payments: [paid(tenancyStart, 115000)],
    },
    {
      // Paid in full for 14 months, then a part payment 10 days ago: in arrears.
      id: 'demo-tenancy-2', propertyId: second.id, tenantNames: ['Megan Lloyd'], startDate: secondStart, endDate: null,
      rentAmountPence: 89500, rentFrequency: 'monthly', depositPence: 103000, depositScheme: 'Deposit Protection Service', status: 'active',
      payments: [...Array.from({ length: 14 }, (_, k) => paid(addMonths(secondStart, k), 89500)), paid(addMonths(secondStart, 14), 50000)],
    },
    {
      id: 'demo-tenancy-3', propertyId: third.id, tenantNames: ['Callum Fraser'], startDate: thirdStart, endDate: null,
      rentAmountPence: 72000, rentFrequency: 'monthly', depositPence: 72000, depositScheme: 'SafeDeposits Scotland', status: 'active',
      payments: Array.from({ length: 9 }, (_, k) => paid(addMonths(thirdStart, k), 72000)),
    },
  ];

  let documentNo = 0;
  const doc = (property: PropertyDto, type: DocumentType, fileName: string, monthsOld: number, tenancyId: string | null = null): DocumentDto => ({
    id: `demo-document-${(documentNo += 1)}`,
    type,
    fileName,
    propertyId: property.id,
    tenancyId,
    propertyAddress: address(property),
    createdAt: `${addMonths(now, -monthsOld)}T09:00:00.000Z`,
  });
  const documents: DocumentDto[] = [
    doc(first, 'gas_safety_record', 'Gas safety record.pdf', 11),
    doc(first, 'eicr', 'Electrical report.pdf', 24),
    doc(first, 'epc', 'Energy certificate.pdf', 40),
    doc(first, 'tenancy_agreement', 'Tenancy agreement - Shah and Reed.pdf', 0, TENANT_TENANCY_ID),
    doc(first, 'inventory', 'Check-in inventory.pdf', 0, TENANT_TENANCY_ID),
    doc(first, 'right_to_rent_check', 'Right to Rent - Shah.pdf', 1, TENANT_TENANCY_ID),
    doc(second, 'gas_safety_record', 'Gas safety record.pdf', 13),
    doc(second, 'epc', 'Energy certificate.pdf', 12),
    doc(second, 'tenancy_agreement', 'Occupation contract - Lloyd.pdf', 14, 'demo-tenancy-2'),
    doc(second, 'deposit_certificate', 'Deposit certificate.pdf', 14, 'demo-tenancy-2'),
    doc(third, 'eicr', 'Electrical report.pdf', 30),
    doc(fourth, 'gas_safety_record', 'Gas safety record.pdf', 2),
    doc(fourth, 'epc', 'Energy certificate.pdf', 20),
  ];

  const applications: ApplicationDto[] = [
    {
      id: 'demo-application-1', propertyId: fourth.id, propertyAddress: address(fourth), applicantName: 'Daniel Okafor', status: 'in_review',
      monthlyRentPence: 130000, annualIncomePence: 5200000,
      affordable: affordability({ monthlyRentPence: 130000, annualIncomePence: 5200000 }).passes,
      checks: [
        { kind: 'identity', status: 'passed' }, { kind: 'right_to_rent', status: 'passed' }, { kind: 'income', status: 'passed' },
        { kind: 'credit', status: 'passed' }, { kind: 'employer', status: 'pending' }, { kind: 'landlord', status: 'pending' },
      ],
      decisionReason: null, createdAt: hoursAgo(24 * 3),
    },
    {
      id: 'demo-application-2', propertyId: fourth.id, propertyAddress: address(fourth), applicantName: 'Hannah Price', status: 'submitted',
      monthlyRentPence: 130000, annualIncomePence: 3600000,
      affordable: affordability({ monthlyRentPence: 130000, annualIncomePence: 3600000 }).passes,
      checks: [
        { kind: 'identity', status: 'passed' }, { kind: 'right_to_rent', status: 'pending' }, { kind: 'income', status: 'pending' },
        { kind: 'credit', status: 'pending' }, { kind: 'employer', status: 'pending' }, { kind: 'landlord', status: 'pending' },
        { kind: 'guarantor', status: 'pending' },
      ],
      decisionReason: null, createdAt: hoursAgo(20),
    },
  ];
  const repairs: DemoStore['repairs'] = [
    {
      id: 'demo-repair-1',
      propertyId: first.id,
      propertyAddress: address(first),
      title: 'Boiler keeps losing pressure',
      description: 'The pressure drops to zero every couple of days and the heating stops. I top it up but it happens again.',
      category: 'heating',
      urgency: 'urgent',
      status: 'scheduled',
      reportedAt: hoursAgo(50),
      appointmentAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      photoDocumentIds: [],
      updates: [
        { id: 'demo-update-1', createdAt: hoursAgo(50), authorRole: 'tenant', status: 'reported', message: null },
        { id: 'demo-update-2', createdAt: hoursAgo(46), authorRole: 'landlord', status: 'triaged', message: 'Thanks for reporting this. I am arranging a heating engineer.' },
        { id: 'demo-update-3', createdAt: hoursAgo(30), authorRole: 'landlord', status: 'scheduled', message: 'An engineer is booked. Please make sure someone is home.' },
      ],
    },
    {
      id: 'demo-repair-2',
      propertyId: first.id,
      propertyAddress: address(first),
      title: 'Bathroom extractor fan very noisy',
      description: 'The fan rattles loudly whenever the light is on.',
      category: 'electrical',
      urgency: 'routine',
      status: 'completed',
      reportedAt: hoursAgo(24 * 9),
      appointmentAt: null,
      photoDocumentIds: [],
      updates: [
        { id: 'demo-update-4', createdAt: hoursAgo(24 * 9), authorRole: 'tenant', status: 'reported', message: null },
        { id: 'demo-update-5', createdAt: hoursAgo(24 * 8), authorRole: 'landlord', status: 'triaged', message: null },
        { id: 'demo-update-6', createdAt: hoursAgo(20), authorRole: 'landlord', status: 'completed', message: 'The electrician replaced the fan today. Please confirm it is working.' },
      ],
    },
    {
      id: 'demo-repair-3',
      propertyId: second.id,
      propertyAddress: address(second),
      title: 'Back fence panel blown down',
      description: 'One fence panel came down in the wind and is leaning into the neighbouring garden.',
      category: 'garden_exterior',
      urgency: 'routine',
      status: 'reported',
      reportedAt: hoursAgo(24 * 4),
      appointmentAt: null,
      photoDocumentIds: [],
      updates: [
        { id: 'demo-update-7', createdAt: hoursAgo(24 * 4), authorRole: 'tenant', status: 'reported', message: null },
      ],
    },
  ];

  return { properties, tenancies, documents, applications, items, repairs, nextId: 100 };
}

function demoStore(): DemoStore {
  store ??= seed();
  return store;
}

/** Clears demo data back to the starting sample. */
export function resetDemo(): void {
  store = null;
}

export function createDemoApi(role: Role): ApiClient {
  const s = demoStore();
  const landlord = isLandlord(role);

  // The landlord sees the whole account; the tenant sees only their own home.
  const visibleProperties = (): PropertyDto[] => (landlord ? s.properties : s.properties.filter((p) => p.id === TENANT_PROPERTY_ID));
  const canSee = (propertyId: string) => visibleProperties().some((p) => p.id === propertyId);

  const present = (item: DemoItem, onDate: IsoDate): { dto: ComplianceItemDto; state: RequirementState } | null => {
    const rule = rulesById.get(item.ruleId);
    const property = s.properties.find((p) => p.id === item.propertyId);
    if (!rule || !property) return null;
    const state: RequirementState = {
      rule,
      completedOn: item.completedOn ?? undefined,
      expiresOn: item.expiresOn ?? undefined,
      dueDate: item.dueDate ?? undefined,
    };
    return {
      state,
      dto: {
        id: item.id,
        ruleId: item.ruleId,
        title: rule.title,
        severity: rule.severity,
        upcoming: rule.status === 'upcoming',
        status: statusOf(state, onDate),
        propertyId: item.propertyId,
        tenancyId: item.tenancyId,
        propertyAddress: address(property),
        completedOn: item.completedOn,
        expiresOn: item.expiresOn ?? (item.completedOn ? (nextDue(rule, item.completedOn) ?? null) : null),
        dueDate: item.dueDate,
        documentId: null,
      },
    };
  };

  const findRepair = (id: string) => {
    const repair = s.repairs.find((r) => r.id === id);
    if (!repair || !canSee(repair.propertyId)) throw new ApiError(404, 'Request not found');
    return repair;
  };

  const ledgerCharges = (tenancy: Pick<DemoTenancy, 'startDate' | 'endDate' | 'rentAmountPence' | 'rentFrequency'>, onDate: IsoDate) =>
    generateSchedule(
      { startDate: tenancy.startDate, endDate: tenancy.endDate ?? undefined, amountPence: tenancy.rentAmountPence, frequency: tenancy.rentFrequency },
      onDate,
    );

  const withoutUpdates = ({ updates: _updates, ...repair }: DemoStore['repairs'][number]): MaintenanceRequestDto => repair;

  return {
    listProperties: async () => visibleProperties(),

    createProperty: async (input) => {
      if (!landlord) throw new ApiError(403, 'Only the landlord can do this');
      const property: PropertyDto = { ...input, id: `demo-property-${(s.nextId += 1)}` };
      s.properties.push(property);
      for (const requirement of generateRequirements(
        { nation: property.nation, scope: 'property', facts: { hasGas: property.hasGas, isHmo: property.isHmo } },
        today(),
      )) {
        s.items.push({ id: `demo-item-${(s.nextId += 1)}`, ruleId: requirement.ruleId, propertyId: property.id, tenancyId: null, completedOn: null, expiresOn: null, dueDate: null });
      }
      return property;
    },

    listCompliance: async () => {
      if (role === 'tenant') throw new ApiError(403, 'Not available for tenant accounts');
      const onDate = today();
      const rows = s.items.filter((item) => canSee(item.propertyId)).map((item) => present(item, onDate)).filter((row) => row !== null);
      const order = { overdue: 0, missing: 1, due_soon: 2, valid: 3 } as const;
      return {
        score: complianceScore(rows.map((row) => row.state), onDate),
        items: rows.map((row) => row.dto).sort((a, b) => order[a.status] - order[b.status]),
      };
    },

    completeComplianceItem: async (id, input) => {
      if (!landlord) throw new ApiError(403, 'Only the landlord can do this');
      const item = s.items.find((i) => i.id === id);
      if (!item) throw new ApiError(404, 'Compliance item not found');
      item.completedOn = input.completedOn;
      item.expiresOn = input.expiresOn ?? null;
      return present(item, today())!.dto;
    },

    listMaintenance: async () =>
      s.repairs
        .filter((repair) => canSee(repair.propertyId))
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
        .map(withoutUpdates),

    getMaintenance: async (id) => {
      const repair = findRepair(id);
      return { ...repair, updates: [...repair.updates] };
    },

    reportMaintenance: async (input) => {
      // The landlord can log a repair for any tenancy; a tenant's goes against their own home.
      const tenancy = landlord ? s.tenancies.find((t) => t.id === input.tenancyId) : s.tenancies.find((t) => t.id === TENANT_TENANCY_ID);
      if (!tenancy) throw new ApiError(400, 'Choose the tenancy this repair is for');
      const property = s.properties.find((p) => p.id === tenancy.propertyId)!;
      const now = new Date().toISOString();
      const repair: DemoStore['repairs'][number] = {
        id: `demo-repair-${(s.nextId += 1)}`,
        propertyId: property.id,
        propertyAddress: address(property),
        title: input.title,
        description: input.description,
        category: input.category,
        urgency: input.urgency,
        status: 'reported',
        reportedAt: now,
        appointmentAt: null,
        photoDocumentIds: input.photoDocumentIds ?? [],
        updates: [{ id: `demo-update-${(s.nextId += 1)}`, createdAt: now, authorRole: role, status: 'reported', message: null }],
      };
      s.repairs.push(repair);
      return withoutUpdates(repair);
    },

    updateMaintenance: async (id, input) => {
      const repair = findRepair(id);
      if (input.status && !canTransition(role, repair.status, input.status)) {
        throw new ApiError(409, `This request cannot be moved from "${repair.status}" to "${input.status}" by your account`);
      }
      if (input.appointmentAt && !landlord) throw new ApiError(403, 'Only the landlord can do this');
      if (input.status) repair.status = input.status;
      if (input.appointmentAt) repair.appointmentAt = input.appointmentAt;
      repair.updates.push({
        id: `demo-update-${(s.nextId += 1)}`,
        createdAt: new Date().toISOString(),
        authorRole: role,
        status: input.status ?? null,
        message: input.message ?? null,
      });
      return withoutUpdates(repair);
    },

    listTenancies: async () => {
      const onDate = today();
      return s.tenancies
        .filter((tenancy) => canSee(tenancy.propertyId))
        .map(({ payments, ...tenancy }) => {
          const summary = arrears(ledgerCharges(tenancy, onDate), payments, onDate);
          const property = s.properties.find((p) => p.id === tenancy.propertyId)!;
          return { ...tenancy, propertyAddress: address(property), balancePence: summary.balancePence, daysInArrears: summary.daysInArrears };
        });
    },

    getLedger: async (tenancyId) => {
      const tenancy = s.tenancies.find((t) => t.id === tenancyId);
      if (!tenancy || !canSee(tenancy.propertyId)) throw new ApiError(404, 'Tenancy not found');
      const onDate = today();
      const charges = ledgerCharges(tenancy, onDate);
      return { charges, payments: [...tenancy.payments], summary: arrears(charges, tenancy.payments, onDate) };
    },

    listDocuments: async () =>
      s.documents
        .filter((d) => d.propertyId !== null && canSee(d.propertyId))
        .filter((d) => landlord || TENANT_DOCUMENT_TYPES.includes(d.type))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

    listApplications: async () => {
      if (role === 'tenant') throw new ApiError(403, 'Not available for tenant accounts');
      return s.applications.filter((a) => canSee(a.propertyId));
    },

    // Demo mode has no file storage: an empty uploadUrl tells the app to skip the upload.
    requestUpload: async (input) => {
      const documentId = `demo-document-${(s.nextId += 1)}`;
      const property = s.properties.find((p) => p.id === (input.propertyId ?? TENANT_PROPERTY_ID));
      if (input.propertyId && !canSee(input.propertyId)) throw new ApiError(403, 'Not your property');
      s.documents.push({
        id: documentId,
        type: input.type,
        fileName: input.fileName,
        propertyId: property?.id ?? null,
        tenancyId: input.tenancyId ?? null,
        propertyAddress: property ? address(property) : null,
        createdAt: new Date().toISOString(),
      });
      return { documentId, uploadUrl: '' };
    },
    downloadUrl: async () => {
      throw new ApiError(404, 'Documents are not available in demo mode');
    },
    registerPushToken: async () => undefined,
  };
}
