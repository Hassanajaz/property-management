import { ApiError, type ApiClient, type ComplianceItemDto, type MaintenanceRequestDto, type MaintenanceUpdateDto, type PropertyDto } from './client.ts';
import { complianceScore, generateRequirements, nextDue, statusOf, type RequirementState } from './compliance/engine.ts';
import { COMPLIANCE_RULES } from './compliance/rules.ts';
import { addDays, addMonths, today, type IsoDate } from './dates.ts';
import { canTransition } from './maintenance.ts';
import { isStaff, type Role } from './types.ts';

/**
 * Demo mode: an in-memory stand-in for the API with sample data, so the apps
 * can be tried on a phone before the AWS backend is deployed.
 *
 * The data lives in memory for as long as the app stays open and is shared
 * between the demo roles, so you can report a repair as the tenant, sign out,
 * and handle it as agency staff. Nothing is saved or sent anywhere.
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

interface DemoStore {
  properties: PropertyDto[];
  items: DemoItem[];
  repairs: (MaintenanceRequestDto & { updates: MaintenanceUpdateDto[] })[];
  nextId: number;
}

const LANDLORD_ID = 'demo-landlord';
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
    { id: TENANT_PROPERTY_ID, addressLine1: '14 Maple Road', addressLine2: null, town: 'Leeds', postcode: 'LS6 2AB', nation: 'england', landlordId: LANDLORD_ID, hasGas: true, isHmo: false },
    { id: 'demo-property-2', addressLine1: 'Flat 3, 22 Harbour Street', addressLine2: null, town: 'Cardiff', postcode: 'CF10 5AA', nation: 'wales', landlordId: LANDLORD_ID, hasGas: true, isHmo: false },
    { id: 'demo-property-3', addressLine1: '8 Glen View', addressLine2: null, town: 'Edinburgh', postcode: 'EH6 4QQ', nation: 'scotland', landlordId: null, hasGas: false, isHmo: true },
  ];

  // Months since each certificate was last done, chosen to show every status.
  const monthsAgo: Record<string, (number | null)[]> = {
    gas_safety: [11, 13, null],
    eicr: [24, 59, 30],
    epc: [40, 12, 130],
    alarms: [20, 20, null],
    legionella: [null, 6, 30],
    hmo_licence: [null, null, 10],
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
        { id: 'demo-update-2', createdAt: hoursAgo(46), authorRole: 'agency_staff', status: 'triaged', message: 'Thanks for reporting this. We are arranging a heating engineer.' },
        { id: 'demo-update-3', createdAt: hoursAgo(30), authorRole: 'agency_staff', status: 'scheduled', message: 'An engineer is booked. Please make sure someone is home.' },
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
        { id: 'demo-update-5', createdAt: hoursAgo(24 * 8), authorRole: 'agency_staff', status: 'triaged', message: null },
        { id: 'demo-update-6', createdAt: hoursAgo(20), authorRole: 'agency_staff', status: 'completed', message: 'The electrician replaced the fan today. Please confirm it is working.' },
      ],
    },
    {
      id: 'demo-repair-3',
      propertyId: second.id,
      propertyAddress: address(second),
      title: 'Back fence panel blown down',
      description: 'One fence panel came down in the wind. Quote received for replacement.',
      category: 'garden_exterior',
      urgency: 'routine',
      status: 'awaiting_landlord_approval',
      reportedAt: hoursAgo(24 * 4),
      appointmentAt: null,
      photoDocumentIds: [],
      updates: [
        { id: 'demo-update-7', createdAt: hoursAgo(24 * 4), authorRole: 'agency_staff', status: 'reported', message: null },
        { id: 'demo-update-8', createdAt: hoursAgo(24 * 2), authorRole: 'agency_staff', status: 'awaiting_landlord_approval', message: 'Quote received: £180 to supply and fit one panel. Awaiting landlord approval.' },
      ],
    },
  ];

  return { properties, items, repairs, nextId: 100 };
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
  const staff = isStaff(role);

  const visibleProperties = (): PropertyDto[] => {
    if (staff) return s.properties;
    if (role === 'landlord') return s.properties.filter((p) => p.landlordId === LANDLORD_ID);
    return s.properties.filter((p) => p.id === TENANT_PROPERTY_ID);
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
    if (!repair || !canSee(repair.propertyId)) throw new ApiError(404, 'Request not found');
    return repair;
  };

  const withoutUpdates = ({ updates: _updates, ...repair }: DemoStore['repairs'][number]): MaintenanceRequestDto => repair;

  return {
    listProperties: async () => visibleProperties(),

    createProperty: async (input) => {
      if (!staff) throw new ApiError(403, 'Only agency staff can do this');
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
      if (!staff) throw new ApiError(403, 'Only agency staff can do this');
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
      if (role === 'landlord') throw new ApiError(403, 'Landlords cannot report repairs here; contact the agency');
      const property = s.properties.find((p) => p.id === TENANT_PROPERTY_ID)!;
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
      if (input.appointmentAt && !staff) throw new ApiError(403, 'Only agency staff can do this');
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

    // Demo mode has no file storage: an empty uploadUrl tells the app to skip the upload.
    requestUpload: async () => ({ documentId: `demo-document-${(s.nextId += 1)}`, uploadUrl: '' }),
    downloadUrl: async () => {
      throw new ApiError(404, 'Documents are not available in demo mode');
    },
    registerPushToken: async () => undefined,
  };
}
