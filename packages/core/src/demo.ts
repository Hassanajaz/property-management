import {
  ApiError,
  type ApiClient,
  type ApplicationDto,
  type ComplianceItemDto,
  type ContractorDto,
  type DocumentDto,
  type ExpenseDto,
  type InspectionDto,
  type InventoryDto,
  type InventoryItemDto,
  type KeyDto,
  type LedgerPaymentDto,
  type MaintenanceRequestDto,
  type MaintenanceUpdateDto,
  type MileageDto,
  type NoticeDto,
  type PossessionCaseDto,
  type PropertyDto,
  type RightToRentDto,
  type TemplateDto,
  type TenancyDto,
  type ViewingDto,
} from './client.ts';
import { complianceScore, generateRequirements, nextDue, statusOf, type RequirementState } from './compliance/engine.ts';
import { COMPLIANCE_RULES } from './compliance/rules.ts';
import { addDays, addMonths, today, type IsoDate } from './dates.ts';
import { canTransition } from './maintenance.ts';
import { TENANT_DOCUMENT_TYPES } from './portfolio.ts';
import { affordability } from './referencing/affordability.ts';
import { arrears } from './rent/ledger.ts';
import { generateSchedule, rentOn } from './rent/schedule.ts';
import { canAdvancePossession, parsePropertiesCsv } from './tools.ts';
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

/** `rentAmountPence` is the rent at the start; later changes are listed in `rentChanges`. */
type DemoTenancy = Omit<TenancyDto, 'propertyAddress' | 'balancePence' | 'daysInArrears' | 'rentLastChangedOn'> & {
  payments: LedgerPaymentDto[];
  rentChanges?: { effectiveFrom: IsoDate; amountPence: number }[];
};

/** Everything held for one landlord's account. Plain data, so it can be saved as JSON. */
export interface DemoStore {
  properties: PropertyDto[];
  tenancies: DemoTenancy[];
  documents: DocumentDto[];
  applications: ApplicationDto[];
  contractors: ContractorDto[];
  keys: KeyDto[];
  inspections: InspectionDto[];
  expenses: ExpenseDto[];
  mileage: MileageDto[];
  inventories: Record<string, InventoryItemDto[]>;
  rightToRent: RightToRentDto[];
  viewings: ViewingDto[];
  notices: NoticeDto[];
  possessionCases: PossessionCaseDto[];
  templates: TemplateDto[];
  items: DemoItem[];
  repairs: (MaintenanceRequestDto & { updates: MaintenanceUpdateDto[]; tenancyId: string })[];
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

/** The sample portfolio used by demo mode, and offered when a new local account is created. */
export function seedSampleStore(): DemoStore {
  const now = today();
  const properties: PropertyDto[] = [
    { id: TENANT_PROPERTY_ID, addressLine1: '14 Maple Road', addressLine2: null, town: 'Leeds', postcode: 'LS6 2AB', nation: 'england', hasGas: true, isHmo: false, valuePence: 24500000, mortgagePence: 14200000 },
    { id: 'demo-property-2', addressLine1: 'Flat 3, 22 Harbour Street', addressLine2: null, town: 'Cardiff', postcode: 'CF10 5AA', nation: 'wales', hasGas: true, isHmo: false, valuePence: 18000000, mortgagePence: 9900000 },
    { id: 'demo-property-3', addressLine1: '8 Glen View', addressLine2: null, town: 'Edinburgh', postcode: 'EH6 4QQ', nation: 'scotland', hasGas: false, isHmo: true, valuePence: 16500000, mortgagePence: null },
    { id: 'demo-property-4', addressLine1: '5 Orchard Close', addressLine2: null, town: 'Bristol', postcode: 'BS7 8QT', nation: 'england', hasGas: true, isHmo: false, valuePence: 31000000, mortgagePence: 20150000 },
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
      tenancyId: TENANT_TENANCY_ID,
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
      contractorId: 'demo-contractor-1',
      contractorName: 'Northside Heating',
      quotePence: 9500,
      costPence: null,
      updates: [
        { id: 'demo-update-1', createdAt: hoursAgo(50), authorRole: 'tenant', status: 'reported', message: null },
        { id: 'demo-update-2', createdAt: hoursAgo(46), authorRole: 'landlord', status: 'triaged', message: 'Thanks for reporting this. I am arranging a heating engineer.' },
        { id: 'demo-update-3', createdAt: hoursAgo(30), authorRole: 'landlord', status: 'scheduled', message: 'An engineer is booked. Please make sure someone is home.' },
      ],
    },
    {
      id: 'demo-repair-2',
      tenancyId: TENANT_TENANCY_ID,
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
      tenancyId: 'demo-tenancy-2',
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

  const contractors: ContractorDto[] = [
    { id: 'demo-contractor-1', name: 'Northside Heating', trade: 'Gas and heating', phone: '0113 496 0101', gasSafeNumber: '512345', electricalScheme: null, insuranceExpiry: addMonths(now, 7), rating: 5 },
    { id: 'demo-contractor-2', name: 'Brightwire Electrical', trade: 'Electrician', phone: '029 2018 0144', gasSafeNumber: null, electricalScheme: 'NICEIC', insuranceExpiry: addDays(now, -12), rating: 4 },
    { id: 'demo-contractor-3', name: 'Harper Property Care', trade: 'General repairs and fencing', phone: '0117 496 0177', gasSafeNumber: null, electricalScheme: null, insuranceExpiry: addMonths(now, 3), rating: 4 },
  ];

  const keys: KeyDto[] = [
    { id: 'demo-key-1', propertyId: first.id, propertyAddress: address(first), label: 'Front door, set 1', holder: 'Priya Shah', movements: [{ date: tenancyStart, action: 'issued', person: 'Priya Shah' }] },
    { id: 'demo-key-2', propertyId: first.id, propertyAddress: address(first), label: 'Front door, set 2', holder: 'Tom Reed', movements: [{ date: tenancyStart, action: 'issued', person: 'Tom Reed' }] },
    { id: 'demo-key-3', propertyId: first.id, propertyAddress: address(first), label: 'Spare set', holder: 'Northside Heating', movements: [{ date: addDays(now, -1), action: 'issued', person: 'Northside Heating' }] },
    { id: 'demo-key-4', propertyId: fourth.id, propertyAddress: address(fourth), label: 'Front door and garage', holder: null, movements: [
      { date: addDays(now, -9), action: 'issued', person: 'Viewing agent' },
      { date: addDays(now, -8), action: 'returned', person: 'Viewing agent' },
    ] },
  ];

  const inspections: InspectionDto[] = [
    { id: 'demo-inspection-1', propertyId: second.id, propertyAddress: address(second), date: addDays(now, 5), status: 'planned', noticeGivenOn: null, notes: null },
    { id: 'demo-inspection-2', propertyId: first.id, propertyAddress: address(first), date: addDays(now, 70), status: 'planned', noticeGivenOn: null, notes: null },
    { id: 'demo-inspection-3', propertyId: third.id, propertyAddress: address(third), date: addDays(now, -45), status: 'done', noticeGivenOn: addDays(now, -52), notes: 'Good condition. Minor mould on bathroom sealant; tenant to clean, re-check next visit.' },
  ];

  let expenseNo = 0;
  const spent = (property: PropertyDto | null, daysAgo: number, category: ExpenseDto['category'], description: string, amountPence: number): ExpenseDto => ({
    id: `demo-expense-${(expenseNo += 1)}`,
    propertyId: property?.id ?? null,
    propertyAddress: property ? address(property) : null,
    date: addDays(now, -daysAgo),
    category,
    description,
    amountPence,
  });
  const expenses: ExpenseDto[] = [
    spent(first, 20, 'repairs', 'Replacement extractor fan, fitted', 14500),
    spent(first, 35, 'insurance', 'Landlord buildings insurance, annual', 28900),
    spent(first, 15, 'mortgage_interest', 'Mortgage interest, month', 47300),
    spent(second, 15, 'mortgage_interest', 'Mortgage interest, month', 33000),
    spent(second, 60, 'repairs', 'Boiler service', 8500),
    spent(third, 45, 'services', 'Communal cleaning, quarter', 12000),
    spent(fourth, 12, 'letting_fees', 'Online advert listing', 9900),
    spent(null, 28, 'legal_professional', 'Accountant, bookkeeping', 18000),
  ];

  const mileage: MileageDto[] = [
    { id: 'demo-mileage-1', date: addDays(now, -45), miles: 38, purpose: 'Inspection at 8 Glen View' },
    { id: 'demo-mileage-2', date: addDays(now, -20), miles: 12, purpose: 'Meet electrician at 14 Maple Road' },
    { id: 'demo-mileage-3', date: addDays(now, -9), miles: 46, purpose: 'Viewings at 5 Orchard Close' },
  ];

  const inventories: Record<string, InventoryItemDto[]> = {
    [TENANT_TENANCY_ID]: [
      { id: 'demo-inv-1', room: 'Kitchen', item: 'Oven and hob', checkIn: 'good', checkInNote: 'Clean, all rings working', checkOut: null, checkOutNote: null },
      { id: 'demo-inv-2', room: 'Kitchen', item: 'Worktops', checkIn: 'good', checkInNote: 'Small chip by the sink', checkOut: null, checkOutNote: null },
      { id: 'demo-inv-3', room: 'Living room', item: 'Carpet', checkIn: 'new', checkInNote: 'Fitted before move-in', checkOut: null, checkOutNote: null },
      { id: 'demo-inv-4', room: 'Living room', item: 'Walls and paintwork', checkIn: 'good', checkInNote: null, checkOut: null, checkOutNote: null },
      { id: 'demo-inv-5', room: 'Bedroom 1', item: 'Wardrobe', checkIn: 'fair', checkInNote: 'Door hinge loose', checkOut: null, checkOutNote: null },
    ],
    'demo-tenancy-2': [
      { id: 'demo-inv-6', room: 'Kitchen', item: 'Fridge freezer', checkIn: 'good', checkInNote: null, checkOut: null, checkOutNote: null },
      { id: 'demo-inv-7', room: 'Bathroom', item: 'Bath and sealant', checkIn: 'good', checkInNote: null, checkOut: null, checkOutNote: null },
    ],
  };

  const rightToRent: RightToRentDto[] = [
    { id: 'demo-rtr-1', tenancyId: TENANT_TENANCY_ID, tenantName: 'Priya Shah', propertyAddress: address(first), method: 'share_code', checkedOn: addDays(tenancyStart, -5), expiresOn: addDays(now, 20) },
    { id: 'demo-rtr-2', tenancyId: TENANT_TENANCY_ID, tenantName: 'Tom Reed', propertyAddress: address(first), method: 'documents', checkedOn: addDays(tenancyStart, -5), expiresOn: null },
  ];

  fourth.advert = {
    headline: 'Three-bedroom house with garage, close to schools',
    description: 'Recently redecorated family home with a private garden, gas central heating and off-street parking. Unfurnished. Pets considered.',
    rentPence: 130000,
    availableFrom: addDays(now, 14),
  };
  const viewings: ViewingDto[] = [
    { id: 'demo-viewing-1', propertyId: fourth.id, propertyAddress: address(fourth), name: 'Daniel Okafor', contact: '07700 900123', at: `${addDays(now, -9)}T17:30`, outcome: 'attended', notes: 'Keen. Applied the same evening.' },
    { id: 'demo-viewing-2', propertyId: fourth.id, propertyAddress: address(fourth), name: 'Hannah Price', contact: 'hannah@example.com', at: `${addDays(now, -8)}T12:00`, outcome: 'attended', notes: null },
    { id: 'demo-viewing-3', propertyId: fourth.id, propertyAddress: address(fourth), name: 'Mo Karim', contact: '07700 900456', at: `${addDays(now, 2)}T18:00`, outcome: 'booked', notes: null },
  ];
  const notices: NoticeDto[] = [
    { id: 'demo-notice-1', tenancyId: 'demo-tenancy-2', propertyAddress: address(second), tenantNames: ['Megan Lloyd'], kind: 'access', servedOn: addDays(now, -1), method: 'email', effectiveOn: addDays(now, 5), notes: 'Notice of inspection visit.' },
  ];
  const templates: TemplateDto[] = [
    {
      id: 'demo-template-1',
      name: 'Inspection visit letter',
      body: 'Dear {{tenant_names}},\n\nI would like to visit {{property_address}} to carry out a routine inspection. I will confirm the date and time with you at least 24 hours beforehand.\n\nPlease let me know if there is anything you would like me to look at while I am there.\n\nKind regards,\n{{landlord_name}}\n{{today}}',
    },
  ];

  return { properties, tenancies, documents, applications, contractors, keys, inspections, expenses, mileage, inventories, rightToRent, viewings, notices, possessionCases: [], templates, items, repairs, nextId: 100 };
}

function demoStore(): DemoStore {
  store ??= seedSampleStore();
  return store;
}

/** Clears demo data back to the starting sample. */
export function resetDemo(): void {
  store = null;
}

/** A new account with nothing in it. */
export function emptyStore(): DemoStore {
  return {
    properties: [], tenancies: [], documents: [], applications: [], contractors: [], keys: [], inspections: [],
    expenses: [], mileage: [], inventories: {}, rightToRent: [], viewings: [], notices: [], possessionCases: [], templates: [], items: [], repairs: [], nextId: 100,
  };
}

/** Who is using the account: the landlord, or a tenant limited to the tenancies they are on. */
export type Viewer = { role: 'landlord' } | { role: 'tenant'; tenancyIds: readonly string[] };

/** Demo mode: the sample account, as the landlord or as the sample tenant. */
export function createDemoApi(role: Role): ApiClient {
  return createStoreApi(demoStore(), role === 'landlord' ? { role } : { role, tenancyIds: [TENANT_TENANCY_ID] });
}

/**
 * The whole application API working directly on one account's data. Demo mode
 * uses it in memory; the local server uses it with the data saved to a
 * database file after every change.
 */
export function createStoreApi(s: DemoStore, viewer: Viewer): ApiClient {
  // Accounts saved before a feature existed will not have its list yet.
  s.viewings ??= [];
  s.notices ??= [];
  s.possessionCases ??= [];
  s.templates ??= [];

  const role: Role = viewer.role;
  const landlord = isLandlord(role);
  const ownTenancyIds: readonly string[] = viewer.role === 'tenant' ? viewer.tenancyIds : [];

  // The landlord sees the whole account; a tenant sees only the homes and tenancies they are on.
  const canSeeTenancy = (tenancyId: string | null) => landlord || (tenancyId !== null && ownTenancyIds.includes(tenancyId));
  const visibleProperties = (): PropertyDto[] => {
    if (landlord) return s.properties;
    const propertyIds = new Set(s.tenancies.filter((t) => ownTenancyIds.includes(t.id)).map((t) => t.propertyId));
    return s.properties.filter((p) => propertyIds.has(p.id));
  };
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
    if (!repair || !canSeeTenancy(repair.tenancyId)) throw new ApiError(404, 'Request not found');
    return repair;
  };

  const ledgerCharges = (tenancy: Pick<DemoTenancy, 'startDate' | 'endDate' | 'rentAmountPence' | 'rentFrequency' | 'rentChanges'>, onDate: IsoDate) =>
    generateSchedule(
      { startDate: tenancy.startDate, endDate: tenancy.endDate ?? undefined, amountPence: tenancy.rentAmountPence, frequency: tenancy.rentFrequency, changes: tenancy.rentChanges },
      onDate,
    );

  const tenancyDto = ({ payments, ...tenancy }: DemoTenancy): TenancyDto => {
    const onDate = today();
    const summary = arrears(ledgerCharges(tenancy, onDate), payments, onDate);
    const property = s.properties.find((p) => p.id === tenancy.propertyId)!;
    const { rentChanges = [], ...rest } = tenancy;
    const applied = rentChanges.filter((c) => c.effectiveFrom <= onDate).map((c) => c.effectiveFrom).sort();
    return {
      ...rest,
      // A tenancy whose end date has passed is over, even if nobody has marked it.
      status: rest.endDate !== null && rest.endDate < onDate ? 'ended' : rest.status,
      rentAmountPence: rentOn({ amountPence: tenancy.rentAmountPence, changes: rentChanges }, onDate),
      rentLastChangedOn: applied.at(-1) ?? tenancy.startDate,
      propertyAddress: address(property),
      balancePence: summary.balancePence,
      daysInArrears: summary.daysInArrears,
    };
  };

  const tenancyFor = (tenancyId: string) => {
    const tenancy = s.tenancies.find((t) => t.id === tenancyId);
    const property = s.properties.find((p) => p.id === tenancy?.propertyId);
    if (!tenancy || !property) throw new ApiError(404, 'Tenancy not found');
    return { tenancy, property };
  };

  const addProperty = (input: Omit<PropertyDto, 'id'>): PropertyDto => {
    const property: PropertyDto = { ...input, id: `demo-property-${(s.nextId += 1)}` };
    s.properties.push(property);
    for (const requirement of generateRequirements(
      { nation: property.nation, scope: 'property', facts: { hasGas: property.hasGas, isHmo: property.isHmo } },
      today(),
    )) {
      s.items.push({ id: `demo-item-${(s.nextId += 1)}`, ruleId: requirement.ruleId, propertyId: property.id, tenancyId: null, completedOn: null, expiresOn: null, dueDate: null });
    }
    return property;
  };

  const inventoryDto = (tenancyId: string): InventoryDto => {
    const tenancy = s.tenancies.find((t) => t.id === tenancyId);
    const property = s.properties.find((p) => p.id === tenancy?.propertyId);
    if (!tenancy || !property || !canSeeTenancy(tenancy.id)) throw new ApiError(404, 'Tenancy not found');
    return { tenancyId, propertyAddress: address(property), tenantNames: tenancy.tenantNames, items: [...(s.inventories[tenancyId] ?? [])] };
  };

  const onlyLandlord = (): void => {
    if (!landlord) throw new ApiError(403, 'Only the landlord can do this');
  };

  const withoutUpdates = ({ updates: _updates, ...repair }: DemoStore['repairs'][number]): MaintenanceRequestDto => repair;

  return {
    listProperties: async () => visibleProperties(),

    createProperty: async (input) => {
      if (!landlord) throw new ApiError(403, 'Only the landlord can do this');
      return addProperty(input);
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
        .filter((repair) => canSeeTenancy(repair.tenancyId))
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
        .map(withoutUpdates),

    getMaintenance: async (id) => {
      const repair = findRepair(id);
      return { ...repair, updates: [...repair.updates] };
    },

    reportMaintenance: async (input) => {
      // The landlord can log a repair for any tenancy; a tenant's goes against their own home.
      const tenancy = landlord
        ? s.tenancies.find((t) => t.id === input.tenancyId)
        : s.tenancies.find((t) => ownTenancyIds.includes(t.id) && t.status === 'active' && (!input.tenancyId || t.id === input.tenancyId));
      if (!tenancy) throw new ApiError(400, 'Choose the tenancy this repair is for');
      const property = s.properties.find((p) => p.id === tenancy.propertyId)!;
      const now = new Date().toISOString();
      const repair: DemoStore['repairs'][number] = {
        id: `demo-repair-${(s.nextId += 1)}`,
        tenancyId: tenancy.id,
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
      if ((input.contractorId !== undefined || input.quotePence !== undefined || input.costPence !== undefined) && !landlord) {
        throw new ApiError(403, 'Only the landlord can do this');
      }
      if (input.status) repair.status = input.status;
      if (input.appointmentAt) repair.appointmentAt = input.appointmentAt;
      if (input.contractorId !== undefined) {
        const contractor = s.contractors.find((c) => c.id === input.contractorId);
        repair.contractorId = contractor?.id ?? null;
        repair.contractorName = contractor?.name ?? null;
      }
      if (input.quotePence !== undefined) repair.quotePence = input.quotePence;
      if (input.costPence !== undefined) repair.costPence = input.costPence;
      repair.updates.push({
        id: `demo-update-${(s.nextId += 1)}`,
        createdAt: new Date().toISOString(),
        authorRole: role,
        status: input.status ?? null,
        message: input.message ?? null,
      });
      return withoutUpdates(repair);
    },

    listTenancies: async () => s.tenancies.filter((tenancy) => canSeeTenancy(tenancy.id)).map(tenancyDto),

    recordRentChange: async (tenancyId, input) => {
      onlyLandlord();
      const { tenancy } = tenancyFor(tenancyId);
      if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new ApiError(400, 'Enter the new rent');
      if (input.effectiveFrom <= tenancy.startDate) throw new ApiError(400, 'The new rent must start after the tenancy began');
      (tenancy.rentChanges ??= []).push({ effectiveFrom: input.effectiveFrom, amountPence: input.amountPence });
      return tenancyDto(tenancy);
    },

    endTenancy: async (tenancyId, input) => {
      onlyLandlord();
      const { tenancy } = tenancyFor(tenancyId);
      if (input.endDate < tenancy.startDate) throw new ApiError(400, 'The end date is before the tenancy began');
      tenancy.endDate = input.endDate;
      if (input.endDate <= today()) tenancy.status = 'ended';
      return tenancyDto(tenancy);
    },

    saveAdvert: async (propertyId, advert) => {
      onlyLandlord();
      const property = s.properties.find((p) => p.id === propertyId);
      if (!property) throw new ApiError(404, 'Property not found');
      if (advert && (!advert.headline.trim() || !Number.isInteger(advert.rentPence) || advert.rentPence <= 0)) throw new ApiError(400, 'Enter a headline and the rent');
      property.advert = advert;
      return property;
    },

    importProperties: async (csv) => {
      onlyLandlord();
      const { rows, errors } = parsePropertiesCsv(csv);
      for (const row of rows) addProperty(row);
      return { created: rows.length, errors };
    },

    listViewings: async () => (onlyLandlord(), [...s.viewings].sort((a, b) => a.at.localeCompare(b.at))),
    addViewing: async (input) => {
      onlyLandlord();
      const property = s.properties.find((p) => p.id === input.propertyId);
      if (!property) throw new ApiError(404, 'Property not found');
      if (!input.name.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.at)) throw new ApiError(400, 'Enter who is viewing, and the date and time');
      const viewing: ViewingDto = { id: `demo-viewing-${(s.nextId += 1)}`, propertyId: property.id, propertyAddress: address(property), name: input.name.trim(), contact: input.contact, at: input.at, outcome: 'booked', notes: null };
      s.viewings.push(viewing);
      return viewing;
    },
    updateViewing: async (id, input) => {
      onlyLandlord();
      const viewing = s.viewings.find((v) => v.id === id);
      if (!viewing) throw new ApiError(404, 'Viewing not found');
      if (input.outcome) viewing.outcome = input.outcome;
      if (input.notes !== undefined) viewing.notes = input.notes.trim() || null;
      return viewing;
    },

    listNotices: async () => (onlyLandlord(), [...s.notices].sort((a, b) => b.servedOn.localeCompare(a.servedOn))),
    addNotice: async (input) => {
      onlyLandlord();
      const { tenancy, property } = tenancyFor(input.tenancyId);
      const notice: NoticeDto = { ...input, id: `demo-notice-${(s.nextId += 1)}`, propertyAddress: address(property), tenantNames: tenancy.tenantNames };
      s.notices.push(notice);
      return notice;
    },
    listPossessionCases: async () => (onlyLandlord(), [...s.possessionCases]),
    openPossessionCase: async (input) => {
      onlyLandlord();
      const { tenancy, property } = tenancyFor(input.tenancyId);
      if (!input.ground.trim()) throw new ApiError(400, 'Say what the reason for seeking possession is');
      if (s.possessionCases.some((c) => c.tenancyId === tenancy.id && c.stage !== 'withdrawn' && c.stage !== 'possession_recovered')) {
        throw new ApiError(409, 'There is already an open case for this tenancy');
      }
      const possessionCase: PossessionCaseDto = {
        id: `demo-case-${(s.nextId += 1)}`, tenancyId: tenancy.id, propertyAddress: address(property), tenantNames: tenancy.tenantNames,
        ground: input.ground.trim(), stage: 'notice_served', events: [{ date: today(), stage: 'notice_served', note: input.note?.trim() || null }],
      };
      s.possessionCases.push(possessionCase);
      return possessionCase;
    },
    advancePossessionCase: async (id, input) => {
      onlyLandlord();
      const possessionCase = s.possessionCases.find((c) => c.id === id);
      if (!possessionCase) throw new ApiError(404, 'Case not found');
      if (!canAdvancePossession(possessionCase.stage, input.stage)) throw new ApiError(409, 'A case can only move forward to a later stage, or be withdrawn');
      possessionCase.stage = input.stage;
      possessionCase.events.push({ date: today(), stage: input.stage, note: input.note?.trim() || null });
      return possessionCase;
    },

    listTemplates: async () => (onlyLandlord(), [...s.templates]),
    saveTemplate: async (input) => {
      onlyLandlord();
      if (!input.name.trim() || !input.body.trim()) throw new ApiError(400, 'Give the template a name and some text');
      const existing = input.id ? s.templates.find((t) => t.id === input.id) : undefined;
      if (existing) {
        existing.name = input.name.trim();
        existing.body = input.body;
        return existing;
      }
      const template: TemplateDto = { id: `demo-template-${(s.nextId += 1)}`, name: input.name.trim(), body: input.body };
      s.templates.push(template);
      return template;
    },

    getLedger: async (tenancyId) => {
      const tenancy = s.tenancies.find((t) => t.id === tenancyId);
      if (!tenancy || !canSeeTenancy(tenancy.id)) throw new ApiError(404, 'Tenancy not found');
      const onDate = today();
      const charges = ledgerCharges(tenancy, onDate);
      return { charges, payments: [...tenancy.payments], summary: arrears(charges, tenancy.payments, onDate) };
    },

    listDocuments: async () =>
      s.documents
        .filter((d) => d.propertyId !== null && canSee(d.propertyId) && (d.tenancyId === null || canSeeTenancy(d.tenancyId)))
        .filter((d) => landlord || TENANT_DOCUMENT_TYPES.includes(d.type))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

    listApplications: async () => {
      if (role === 'tenant') throw new ApiError(403, 'Not available for tenant accounts');
      return s.applications.filter((a) => canSee(a.propertyId));
    },

    decideApplication: async (id, input) => {
      onlyLandlord();
      const application = s.applications.find((a) => a.id === id);
      if (!application) throw new ApiError(404, 'Application not found');
      if (!input.reason.trim()) throw new ApiError(400, 'Give a reason for the decision');
      application.status = input.status;
      application.decisionReason = input.reason;
      return application;
    },

    convertApplication: async (id, input) => {
      onlyLandlord();
      const application = s.applications.find((a) => a.id === id);
      if (!application) throw new ApiError(404, 'Application not found');
      if (application.status !== 'passed') throw new ApiError(409, 'Only an applicant who has passed referencing can be made the tenant');
      if (s.tenancies.some((t) => t.propertyId === application.propertyId && t.status === 'active')) {
        throw new ApiError(409, 'This property already has a current tenancy');
      }
      const tenancy: DemoTenancy = {
        id: `demo-tenancy-${(s.nextId += 1)}`, propertyId: application.propertyId, tenantNames: [application.applicantName],
        startDate: input.startDate, endDate: null, rentAmountPence: application.monthlyRentPence, rentFrequency: 'monthly',
        depositPence: 0, depositScheme: null, status: 'active', payments: [],
      };
      s.tenancies.push(tenancy);
      // Other applicants for the same property are closed.
      for (const other of s.applications) {
        if (other.propertyId === application.propertyId && other.id !== id && other.status !== 'failed' && other.status !== 'passed') other.status = 'withdrawn';
      }
      const { payments, ...rest } = tenancy;
      return { ...rest, propertyAddress: application.propertyAddress, balancePence: 0, daysInArrears: 0 };
    },

    updateProperty: async (id, input) => {
      onlyLandlord();
      const property = s.properties.find((p) => p.id === id);
      if (!property) throw new ApiError(404, 'Property not found');
      if (input.valuePence !== undefined) property.valuePence = input.valuePence;
      if (input.mortgagePence !== undefined) property.mortgagePence = input.mortgagePence;
      return property;
    },

    recordPayment: async (tenancyId, input) => {
      onlyLandlord();
      const tenancy = s.tenancies.find((t) => t.id === tenancyId);
      if (!tenancy) throw new ApiError(404, 'Tenancy not found');
      if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new ApiError(400, 'Enter an amount above zero');
      const payment: LedgerPaymentDto = { id: `demo-payment-new-${(s.nextId += 1)}`, date: input.date, amountPence: input.amountPence, method: input.method, status: 'confirmed' };
      tenancy.payments.push(payment);
      return payment;
    },

    listPayments: async () => {
      onlyLandlord();
      return s.tenancies.flatMap((t) => t.payments.filter((p) => p.status === 'confirmed').map((p) => ({ id: p.id, tenancyId: t.id, date: p.date, amountPence: p.amountPence })));
    },

    createTenancy: async (input) => {
      onlyLandlord();
      const property = s.properties.find((p) => p.id === input.propertyId);
      if (!property) throw new ApiError(404, 'Property not found');
      if (s.tenancies.some((t) => t.propertyId === property.id && t.status === 'active')) throw new ApiError(409, 'This property already has a current tenancy');
      if (input.tenants.length === 0 || input.tenants.some((t) => !t.name.trim())) throw new ApiError(400, 'Add at least one tenant with a name');
      if (!Number.isInteger(input.rentAmountPence) || input.rentAmountPence <= 0) throw new ApiError(400, 'Enter the rent');
      const tenancy: DemoTenancy = {
        id: `demo-tenancy-${(s.nextId += 1)}`, propertyId: property.id, tenantNames: input.tenants.map((t) => t.name.trim()),
        startDate: input.startDate, endDate: null, rentAmountPence: input.rentAmountPence, rentFrequency: input.rentFrequency,
        depositPence: input.depositPence, depositScheme: null, status: 'active', payments: [],
      };
      s.tenancies.push(tenancy);
      // The tenancy's own legal steps (deposit, documents to serve) are added from the rules.
      for (const requirement of generateRequirements(
        { nation: property.nation, scope: 'tenancy', facts: { depositTaken: input.depositPence > 0 }, tenancyStart: input.startDate, depositReceived: input.startDate },
        input.startDate,
      )) {
        s.items.push({ id: `demo-item-${(s.nextId += 1)}`, ruleId: requirement.ruleId, propertyId: property.id, tenancyId: tenancy.id, completedOn: null, expiresOn: null, dueDate: requirement.dueDate ?? null });
      }
      return tenancyDto(tenancy);
    },

    updateTenancy: async (id, input) => {
      onlyLandlord();
      const tenancy = s.tenancies.find((t) => t.id === id);
      if (!tenancy) throw new ApiError(404, 'Tenancy not found');
      if (input.depositScheme !== undefined) tenancy.depositScheme = input.depositScheme;
      return tenancyDto(tenancy);
    },

    getInventory: async (tenancyId) => inventoryDto(tenancyId),
    addInventoryItem: async (tenancyId, input) => {
      onlyLandlord();
      if (!input.room.trim() || !input.item.trim()) throw new ApiError(400, 'Enter the room and the item');
      inventoryDto(tenancyId); // checks the tenancy exists
      (s.inventories[tenancyId] ??= []).push({
        id: `demo-inv-${(s.nextId += 1)}`, room: input.room.trim(), item: input.item.trim(),
        checkIn: input.condition, checkInNote: input.note?.trim() || null, checkOut: null, checkOutNote: null,
      });
      return inventoryDto(tenancyId);
    },
    recordCheckOut: async (tenancyId, itemId, input) => {
      onlyLandlord();
      const item = (s.inventories[tenancyId] ?? []).find((i) => i.id === itemId);
      if (!item) throw new ApiError(404, 'Inventory item not found');
      item.checkOut = input.condition;
      item.checkOutNote = input.note?.trim() || null;
      return inventoryDto(tenancyId);
    },

    listRightToRent: async () => (onlyLandlord(), [...s.rightToRent]),
    recordRightToRent: async (input) => {
      onlyLandlord();
      const tenancy = s.tenancies.find((t) => t.id === input.tenancyId);
      const property = s.properties.find((p) => p.id === tenancy?.propertyId);
      if (!tenancy || !property) throw new ApiError(404, 'Tenancy not found');
      if (!input.tenantName.trim()) throw new ApiError(400, 'Enter the tenant\'s name');
      // A new check for the same person replaces the old one.
      s.rightToRent = s.rightToRent.filter((c) => !(c.tenancyId === input.tenancyId && c.tenantName === input.tenantName.trim()));
      const check: RightToRentDto = { ...input, tenantName: input.tenantName.trim(), id: `demo-rtr-${(s.nextId += 1)}`, propertyAddress: address(property) };
      s.rightToRent.push(check);
      return check;
    },

    listContractors: async () => (onlyLandlord(), [...s.contractors]),
    addContractor: async (input) => {
      onlyLandlord();
      if (!input.name.trim()) throw new ApiError(400, 'Enter the contractor\'s name');
      const contractor: ContractorDto = { ...input, id: `demo-contractor-${(s.nextId += 1)}` };
      s.contractors.push(contractor);
      return contractor;
    },

    listKeys: async () => (onlyLandlord(), [...s.keys]),
    addKey: async (input) => {
      onlyLandlord();
      const property = s.properties.find((p) => p.id === input.propertyId);
      if (!property) throw new ApiError(404, 'Property not found');
      const key: KeyDto = { id: `demo-key-${(s.nextId += 1)}`, propertyId: property.id, propertyAddress: address(property), label: input.label, holder: null, movements: [] };
      s.keys.push(key);
      return key;
    },
    moveKey: async (id, input) => {
      onlyLandlord();
      const key = s.keys.find((k) => k.id === id);
      if (!key) throw new ApiError(404, 'Key not found');
      if (input.action === 'issued' && key.holder) throw new ApiError(409, `This key is already out with ${key.holder}`);
      if (input.action === 'returned' && !key.holder) throw new ApiError(409, 'This key is already with you');
      const person = input.action === 'returned' ? key.holder! : input.person.trim();
      if (!person) throw new ApiError(400, 'Say who is taking the key');
      key.movements.push({ date: today(), action: input.action, person });
      key.holder = input.action === 'issued' ? person : null;
      return key;
    },

    listInspections: async () => (onlyLandlord(), [...s.inspections].sort((a, b) => a.date.localeCompare(b.date))),
    planInspection: async (input) => {
      onlyLandlord();
      const property = s.properties.find((p) => p.id === input.propertyId);
      if (!property) throw new ApiError(404, 'Property not found');
      const inspection: InspectionDto = { id: `demo-inspection-${(s.nextId += 1)}`, propertyId: property.id, propertyAddress: address(property), date: input.date, status: 'planned', noticeGivenOn: null, notes: null };
      s.inspections.push(inspection);
      return inspection;
    },
    updateInspection: async (id, input) => {
      onlyLandlord();
      const inspection = s.inspections.find((i) => i.id === id);
      if (!inspection) throw new ApiError(404, 'Inspection not found');
      if (input.status) inspection.status = input.status;
      if (input.noticeGivenOn) inspection.noticeGivenOn = input.noticeGivenOn;
      if (input.notes !== undefined) inspection.notes = input.notes;
      return inspection;
    },

    listExpenses: async () => (onlyLandlord(), [...s.expenses].sort((a, b) => b.date.localeCompare(a.date))),
    addExpense: async (input) => {
      onlyLandlord();
      if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) throw new ApiError(400, 'Enter an amount above zero');
      const property = input.propertyId ? s.properties.find((p) => p.id === input.propertyId) : undefined;
      const expense: ExpenseDto = { ...input, id: `demo-expense-new-${(s.nextId += 1)}`, propertyId: property?.id ?? null, propertyAddress: property ? address(property) : null };
      s.expenses.push(expense);
      return expense;
    },
    listMileage: async () => (onlyLandlord(), [...s.mileage].sort((a, b) => b.date.localeCompare(a.date))),
    addMileage: async (input) => {
      onlyLandlord();
      if (!(input.miles > 0)) throw new ApiError(400, 'Enter the miles travelled');
      const trip: MileageDto = { ...input, id: `demo-mileage-new-${(s.nextId += 1)}` };
      s.mileage.push(trip);
      return trip;
    },

    // Demo mode has no file storage: an empty uploadUrl tells the app to skip the upload.
    requestUpload: async (input) => {
      const documentId = `demo-document-${(s.nextId += 1)}`;
      const property = s.properties.find((p) => p.id === (input.propertyId ?? s.tenancies.find((t) => t.id === (input.tenancyId ?? ownTenancyIds[0]))?.propertyId));
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
