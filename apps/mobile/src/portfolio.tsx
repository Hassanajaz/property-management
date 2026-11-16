import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import {
  APPLICATION_STATUS_LABEL,
  CHECK_LABEL,
  CHECK_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  LANDLORD_UPLOAD_TYPES,
  PHOTO_DOCUMENT_TYPES,
  TENANT_STATUS_LABEL,
  formatPence,
  occupancy,
  portfolioSummary,
  propertiesCsv,
  today,
  type ApplicationDto,
  type ComplianceItemDto,
  type ComplianceStatus,
  type DocumentDto,
  type DocumentType,
  type MaintenanceRequestDto,
  type Nation,
  type PropertyDto,
  type TenancyDto,
} from '@lettly/core';
import { refreshAlerts } from './alerts';
import { percent, useAction } from './hooks';
import { ShareButtons } from './share';
import { useSession } from './session';
import { Button, Chip, StatusBadge, colors, styles } from './ui';

export const COMPLIANCE_LABEL: Record<ComplianceStatus, string> = { valid: 'Valid', due_soon: 'Due soon', overdue: 'Overdue', missing: 'Missing' };

export interface PortfolioData {
  properties: PropertyDto[];
  tenancies: TenancyDto[];
  compliance: ComplianceItemDto[];
  complianceScore: number;
  repairs: MaintenanceRequestDto[];
  documents: DocumentDto[];
  applications: ApplicationDto[];
}

/** Loads everything on the landlord's account, and reloads whenever the screen comes back into view. */
export function usePortfolioData() {
  const { api } = useSession();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [properties, tenancies, compliance, repairs, documents, applications] = await Promise.all([
        api.listProperties(),
        api.listTenancies(),
        api.listCompliance(),
        api.listMaintenance(),
        api.listDocuments(),
        api.listApplications(),
      ]);
      setData({ properties, tenancies, compliance: compliance.items, complianceScore: compliance.score, repairs, documents: documents.filter((d) => !PHOTO_DOCUMENT_TYPES.includes(d.type)), applications });
      setError(null);
      // If alerts are switched on for this phone, keep them in step with the latest dates.
      void refreshAlerts(api);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { data, loading, error, load };
}

// --------------------------------------------------------------- shared cards
export function scoreColor(score: number): string {
  return score >= 90 ? colors.good : score >= 70 ? colors.warn : colors.bad;
}

export function ComplianceCard({ item, showAddress = true, onChanged }: { item: ComplianceItemDto; showAddress?: boolean; onChanged?: () => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const due = item.expiresOn ?? item.dueDate;
  const history = item.history ?? [];

  async function recordDone() {
    setBusy(true);
    setError(null);
    try {
      await api.completeComplianceItem(item.id, { completedOn: today() });
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <StatusBadge status={item.upcoming ? 'confirmed' : item.status} label={item.upcoming ? 'Coming soon' : COMPLIANCE_LABEL[item.status]} />
      <Text style={styles.h2}>{item.title}</Text>
      {showAddress && item.propertyAddress ? <Text style={styles.muted}>{item.propertyAddress}</Text> : null}
      <Text style={styles.muted}>
        {item.completedOn ? `Last done ${item.completedOn}` : 'No record yet'}
        {due ? ` · ${item.status === 'overdue' ? 'Was due' : 'Due'} ${due}` : ''}
        {item.severity === 'best_practice' ? ' · Best practice' : ''}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {history.length > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => setShowHistory((shown) => !shown)}>
          <Text style={[styles.muted, { color: colors.brand }]}>
            {showHistory ? 'Hide earlier records' : `Show ${history.length} earlier record${history.length === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      ) : null}
      {showHistory
        ? history.map((earlier) => (
            <Text key={earlier.completedOn} style={styles.muted}>
              Done {earlier.completedOn}
              {earlier.expiresOn ? ` · ran to ${earlier.expiresOn}` : ''}
            </Text>
          ))
        : null}
      {onChanged && !item.upcoming && item.status !== 'valid' ? <Button title="Record as done today" kind="secondary" onPress={recordDone} busy={busy} /> : null}
    </View>
  );
}

export function RepairCard({ repair, showAddress = true }: { repair: MaintenanceRequestDto; showAddress?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/repair/${repair.id}`)} style={styles.card}>
      <StatusBadge status={repair.status} label={TENANT_STATUS_LABEL[repair.status]} />
      <Text style={styles.h2}>{repair.title}</Text>
      <Text style={styles.muted}>
        {showAddress ? `${repair.propertyAddress} · ` : ''}
        Reported {new Date(repair.reportedAt).toLocaleDateString('en-GB')}
        {repair.urgency === 'emergency' ? ' · Emergency' : ''}
      </Text>
      {repair.status === 'reported' || repair.status === 'reopened' ? <Text style={[styles.body, { color: colors.warn }]}>Waiting for you. Tap to review.</Text> : null}
    </Pressable>
  );
}

export function TenancyCard({ tenancy, showAddress = true }: { tenancy: TenancyDto; showAddress?: boolean }) {
  const owing = tenancy.balancePence > 0;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/tenancy/${tenancy.id}`)} style={styles.card}>
      <StatusBadge
        status={owing ? 'overdue' : 'valid'}
        label={owing ? `${formatPence(tenancy.balancePence)} owed · ${tenancy.daysInArrears} days` : tenancy.balancePence < 0 ? `${formatPence(-tenancy.balancePence)} in credit` : 'Rent up to date'}
      />
      {showAddress ? <Text style={styles.h2}>{tenancy.propertyAddress}</Text> : null}
      <Text style={styles.body}>{tenancy.tenantNames.join(' and ')}</Text>
      <Text style={styles.muted}>
        {formatPence(tenancy.rentAmountPence)} {tenancy.rentFrequency.replace('_', ' ')} · since {tenancy.startDate}
      </Text>
      <Text style={[styles.muted, { color: colors.brand }]}>View rent statement</Text>
    </Pressable>
  );
}

export function DocumentRow({ document, showAddress = true }: { document: DocumentDto; showAddress?: boolean }) {
  const { api, demo } = useSession();
  const [note, setNote] = useState<string | null>(null);

  async function open() {
    setNote(null);
    try {
      const { url } = await api.downloadUrl(document.id);
      await Linking.openURL(url);
    } catch (e) {
      setNote(demo ? 'Files cannot be opened in demo mode.' : e instanceof Error ? e.message : 'Could not open the file');
    }
  }

  return (
    <Pressable accessibilityRole="button" onPress={open} style={styles.card}>
      <Text style={styles.h2}>{DOCUMENT_TYPE_LABEL[document.type]}</Text>
      <Text style={styles.body}>{document.fileName}</Text>
      <Text style={styles.muted}>
        {showAddress && document.propertyAddress ? `${document.propertyAddress} · ` : ''}
        Added {new Date(document.createdAt).toLocaleDateString('en-GB')}
      </Text>
      {note ? <Text style={styles.muted}>{note}</Text> : null}
    </Pressable>
  );
}

const APPLICATION_TONE: Record<ApplicationDto['status'], ComplianceStatus> = {
  invited: 'due_soon',
  submitted: 'due_soon',
  in_review: 'due_soon',
  passed: 'valid',
  failed: 'overdue',
  withdrawn: 'missing',
};
const CHECK_COLOR = { passed: colors.good, failed: colors.bad, pending: colors.warn, not_required: colors.muted } as const;

export function ApplicationCard({ application, showAddress = true, onChanged }: { application: ApplicationDto; showAddress?: boolean; onChanged?: () => void }) {
  const { api } = useSession();
  const save = useAction();
  const [reason, setReason] = useState('');
  const passed = application.checks.filter((c) => c.status === 'passed').length;
  const open = application.status === 'invited' || application.status === 'submitted' || application.status === 'in_review';

  async function decide(status: 'passed' | 'failed') {
    if (await save.run(() => api.decideApplication(application.id, { status, reason }))) {
      setReason('');
      onChanged?.();
    }
  }

  return (
    <View style={styles.card}>
      <StatusBadge status={APPLICATION_TONE[application.status]} label={APPLICATION_STATUS_LABEL[application.status]} />
      <Text style={styles.h2}>{application.applicantName}</Text>
      {showAddress ? <Text style={styles.muted}>{application.propertyAddress}</Text> : null}
      <Text style={styles.body}>
        Rent {formatPence(application.monthlyRentPence)} a month
        {application.annualIncomePence !== null ? ` · income ${formatPence(application.annualIncomePence)} a year` : ''}
      </Text>
      {application.affordable !== null ? (
        <Text style={[styles.body, { color: application.affordable ? colors.good : colors.warn }]}>
          {application.affordable ? 'Income meets the affordability test' : 'Income is below the affordability test; a guarantor may be needed'}
        </Text>
      ) : null}
      <Text style={styles.label}>
        Checks: {passed} of {application.checks.length} passed
      </Text>
      {application.checks.map((check) => (
        <View key={check.kind} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.body}>{CHECK_LABEL[check.kind]}</Text>
          <Text style={[styles.body, { color: CHECK_COLOR[check.status] }]}>{CHECK_STATUS_LABEL[check.status]}</Text>
        </View>
      ))}
      {application.decisionReason ? <Text style={styles.muted}>Decision: {application.decisionReason}</Text> : null}

      {onChanged && open ? (
        <>
          <Text style={styles.label}>Your decision and the reason for it</Text>
          <TextInput style={styles.input} value={reason} onChangeText={setReason} placeholder="e.g. All references satisfactory" maxLength={300} />
          <Text style={styles.muted}>Keep the reason factual. Do not refuse someone because they have children or receive benefits.</Text>
          <Button title="Referencing passed" onPress={() => decide('passed')} busy={save.busy} />
          <Button title="Not passed" kind="secondary" onPress={() => decide('failed')} busy={save.busy} />
        </>
      ) : null}
      {onChanged && application.status === 'passed' ? (
        <Button
          title="Make them the tenant from today"
          busy={save.busy}
          onPress={async () => {
            if (await save.run(() => api.convertApplication(application.id, { startDate: today() }))) onChanged();
          }}
        />
      ) : null}
      {save.error ? <Text style={styles.error}>{save.error}</Text> : null}
    </View>
  );
}

/** Form for adding a new property to the account. */
export function AddProperty({ onAdded }: { onAdded: () => void }) {
  const { api } = useSession();
  const save = useAction();
  const [open, setOpen] = useState(false);
  const [addressLine1, setAddressLine1] = useState('');
  const [town, setTown] = useState('');
  const [postcode, setPostcode] = useState('');
  const [nation, setNation] = useState<Nation>('england');
  const [hasGas, setHasGas] = useState(true);
  const [isHmo, setIsHmo] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function add() {
    if (!addressLine1.trim() || !town.trim() || postcode.trim().length < 5) {
      setFormError('Enter the address, town and postcode.');
      return;
    }
    setFormError(null);
    const ok = await save.run(() =>
      api.createProperty({ addressLine1: addressLine1.trim(), addressLine2: null, town: town.trim(), postcode: postcode.trim().toUpperCase(), nation, hasGas, isHmo }),
    );
    if (ok) {
      setAddressLine1('');
      setTown('');
      setPostcode('');
      setOpen(false);
      onAdded();
    }
  }

  if (!open) return <Button title="Add a property" kind="secondary" onPress={() => setOpen(true)} />;

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Add a property</Text>
      <Text style={styles.label}>Address</Text>
      <TextInput style={styles.input} value={addressLine1} onChangeText={setAddressLine1} />
      <Text style={styles.label}>Town</Text>
      <TextInput style={styles.input} value={town} onChangeText={setTown} />
      <Text style={styles.label}>Postcode</Text>
      <TextInput style={styles.input} value={postcode} onChangeText={setPostcode} autoCapitalize="characters" maxLength={8} />
      <Text style={styles.label}>Nation (decides which rules apply)</Text>
      <View style={styles.row}>
        {(['england', 'wales', 'scotland', 'northern_ireland'] as const).map((n) => (
          <Chip key={n} label={n === 'northern_ireland' ? 'Northern Ireland' : n.charAt(0).toUpperCase() + n.slice(1)} selected={nation === n} onPress={() => setNation(n)} />
        ))}
      </View>
      <View style={styles.row}>
        <Chip label="Has a gas supply" selected={hasGas} onPress={() => setHasGas((v) => !v)} />
        <Chip label="House in multiple occupation" selected={isHmo} onPress={() => setIsHmo((v) => !v)} />
      </View>
      {formError ?? save.error ? <Text style={styles.error}>{formError ?? save.error}</Text> : null}
      <Button title="Add property" onPress={add} busy={save.busy} />
      <Button title="Cancel" kind="secondary" onPress={() => setOpen(false)} />
      <Text style={styles.muted}>The certificates and checks this property needs are added automatically.</Text>
    </View>
  );
}

/** Form for adding a certificate or other document to a property from the phone's photos. */
export function AddDocument({ properties, fixedPropertyId, onAdded }: { properties: PropertyDto[]; fixedPropertyId?: string; onAdded: () => void }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState<string | undefined>(fixedPropertyId ?? properties[0]?.id);
  const [type, setType] = useState<DocumentType>('gas_safety_record');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pick() {
    if (!propertyId) return;
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Allow photo access in Settings to add documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 20 });
    if (result.canceled || result.assets.length === 0) return;

    setBusy(true);
    try {
      // Several photos can be chosen at once; each becomes its own document.
      for (const asset of result.assets) {
        const contentType = asset.mimeType ?? 'image/jpeg';
        const ticket = await api.requestUpload({ fileName: asset.fileName ?? `${type}-${Date.now()}.jpg`, contentType, type, propertyId });
        if (ticket.uploadUrl) {
          const file = await (await fetch(asset.uri)).blob();
          const upload = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
          if (!upload.ok) throw new Error('A file could not be uploaded. Please try again.');
        }
      }
      setOpen(false);
      setMessage(result.assets.length === 1 ? 'Document added.' : `${result.assets.length} documents added.`);
      onAdded();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add the document');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <View style={{ gap: 6 }}>
        <Button title="Add a document" kind="secondary" onPress={() => setOpen(true)} />
        {message ? <Text style={styles.muted}>{message}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Add a document</Text>
      {fixedPropertyId ? null : (
        <>
          <Text style={styles.label}>Property</Text>
          <View style={styles.row}>
            {properties.map((p) => (
              <Chip key={p.id} label={p.addressLine1} selected={propertyId === p.id} onPress={() => setPropertyId(p.id)} />
            ))}
          </View>
        </>
      )}
      <Text style={styles.label}>Type</Text>
      <View style={styles.row}>
        {LANDLORD_UPLOAD_TYPES.map((t) => (
          <Chip key={t} label={DOCUMENT_TYPE_LABEL[t]} selected={type === t} onPress={() => setType(t)} />
        ))}
      </View>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <Button title="Choose photos (one or several)" onPress={pick} busy={busy} />
      <Button title="Cancel" kind="secondary" onPress={() => setOpen(false)} />
    </View>
  );
}

// ------------------------------------------------------------------ dashboard
const SECTIONS = ['Overview', 'Properties', 'Rent', 'Compliance', 'Repairs', 'Documents', 'Applicants', 'Tools'] as const;

const TOOLS: { href: string; title: string; hint: string }[] = [
  { href: '/tools/finance', title: 'Finance and tax year', hint: 'Income, expenses, repeating costs, mileage and profit for your tax return' },
  { href: '/tools/bank-import', title: 'Bank statement import', hint: 'Record rent payments from the file your bank gives you' },
  { href: '/tools/reminders', title: 'Reminders, calendar and alerts', hint: 'What falls due, in your calendar and as alerts on this phone' },
  { href: '/tools/licences', title: 'Licences', hint: 'HMO and selective licences, their conditions and expiry' },
  { href: '/tools/meters', title: 'Meter readings', hint: 'Gas, electricity and water readings with photos' },
  { href: '/tools/rent-reviews', title: 'Rent reviews', hint: 'When each rent can next be increased' },
  { href: '/tools/inspections', title: 'Inspections', hint: 'Plan visits and record notice given' },
  { href: '/tools/contractors', title: 'Contractors', hint: 'Trades you use, their registrations and insurance' },
  { href: '/tools/keys', title: 'Key register', hint: 'Where every key is, with each handover logged' },
  { href: '/tools/deposits', title: 'Deposit register', hint: 'Each deposit, its scheme and whether it is protected' },
  { href: '/tools/right-to-rent', title: 'Right to Rent', hint: 'Checks recorded and follow-ups due (England)' },
  { href: '/tools/lettings', title: 'Adverts and viewings', hint: 'Advert wording for vacant homes and who is viewing' },
  { href: '/tools/notices', title: 'Notices and possession', hint: 'A log of notices served and where any case has reached' },
  { href: '/tools/templates', title: 'Document templates', hint: 'Your own letters and agreements, filled in per tenancy' },
  { href: '/tools/import', title: 'Import properties', hint: 'Add many properties from a spreadsheet' },
  { href: '/tools/backup', title: 'Backup and restore', hint: 'Save a copy of everything, or put a copy back' },
  { href: '/tools/account', title: 'Your account', hint: 'Sign-in details and password' },
];
type Section = (typeof SECTIONS)[number];

function Stat({ label, value, hint, tone, onPress }: { label: string; value: string; hint?: string; tone?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.card, { flexBasis: '47%', flexGrow: 1 }]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '700', color: tone ?? colors.ink }}>{value}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </Pressable>
  );
}

/** The landlord's home screen: the whole portfolio in sections. */
export function Portfolio() {
  const { identity, signOut, demo } = useSession();
  const { data, loading, error, load } = usePortfolioData();
  const [section, setSection] = useState<Section>('Overview');
  const [note, setNote] = useState<string | null>(null);

  const summary = useMemo(() => (data ? portfolioSummary(data) : null), [data]);
  const letTo = useMemo(() => new Map((data?.tenancies ?? []).filter((t) => t.status === 'active').map((t) => [t.propertyId, t])), [data]);

  if (!identity) return null;

  return (
    <View style={styles.page}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {SECTIONS.map((name) => (
            <Chip key={name} label={name} selected={section === name} onPress={() => setSection(name)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {demo ? <Text style={styles.muted}>Demo mode: sample data, nothing is saved. Signed in as the landlord.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {data && summary && section === 'Overview' ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <Stat label="Properties" value={String(summary.properties)} hint={`${summary.let} let · ${summary.vacant} vacant · ${percent(occupancy(data.properties, data.tenancies))} occupied`} onPress={() => setSection('Properties')} />
              <Stat label="Rent per month" value={formatPence(summary.monthlyRentPence)} hint="Across current tenancies" onPress={() => setSection('Rent')} />
              <Stat
                label="Rent arrears"
                value={formatPence(summary.arrearsPence)}
                hint={summary.tenanciesInArrears === 0 ? 'All rent up to date' : `${summary.tenanciesInArrears} tenancy behind`}
                tone={summary.arrearsPence > 0 ? colors.bad : colors.good}
                onPress={() => setSection('Rent')}
              />
              <Stat
                label="Compliance"
                value={`${data.complianceScore} / 100`}
                hint={summary.complianceAttention === 0 ? 'Nothing outstanding' : `${summary.complianceAttention} need attention`}
                tone={scoreColor(data.complianceScore)}
                onPress={() => setSection('Compliance')}
              />
              <Stat
                label="Open repairs"
                value={String(summary.openRepairs)}
                hint={summary.repairsToReview > 0 ? `${summary.repairsToReview} waiting for you` : 'None waiting for you'}
                tone={summary.repairsToReview > 0 ? colors.warn : undefined}
                onPress={() => setSection('Repairs')}
              />
              <Stat label="Applicants" value={String(summary.applicationsInProgress)} hint="Being referenced" onPress={() => setSection('Applicants')} />
            </View>

            <Text style={[styles.h2, { marginTop: 8 }]}>Needs attention</Text>
            {data.repairs.filter((r) => r.status === 'reported' || r.status === 'reopened').map((r) => <RepairCard key={r.id} repair={r} />)}
            {data.tenancies.filter((t) => t.balancePence > 0).map((t) => <TenancyCard key={t.id} tenancy={t} />)}
            {data.compliance
              .filter((i) => !i.upcoming && i.severity === 'statutory' && (i.status === 'overdue' || i.status === 'missing'))
              .slice(0, 6)
              .map((i) => <ComplianceCard key={i.id} item={i} onChanged={load} />)}
            {summary.repairsToReview === 0 && summary.tenanciesInArrears === 0 && summary.complianceAttention === 0 ? <Text style={styles.muted}>Nothing needs attention right now.</Text> : null}
          </>
        ) : null}

        {data && section === 'Properties' ? (
          <>
            <AddProperty onAdded={load} />
            <ShareButtons title="Properties" label="Share the properties table" text={() => propertiesCsv(data.properties, data.tenancies, data.compliance)} />
          </>
        ) : null}

        {data && section === 'Properties'
          ? data.properties.map((property) => {
              const tenancy = letTo.get(property.id);
              const issues = data.compliance.filter((i) => i.propertyId === property.id && !i.upcoming && i.severity === 'statutory' && i.status !== 'valid').length;
              return (
                <Pressable key={property.id} accessibilityRole="button" onPress={() => router.push(`/property/${property.id}`)} style={styles.card}>
                  <StatusBadge status={tenancy ? 'valid' : 'due_soon'} label={tenancy ? 'Let' : 'Vacant'} />
                  <Text style={styles.h2}>{property.addressLine1}</Text>
                  <Text style={styles.muted}>
                    {property.town} {property.postcode} · {property.nation.replace('_', ' ')}
                  </Text>
                  <Text style={styles.body}>{tenancy ? `${tenancy.tenantNames.join(' and ')} · ${formatPence(tenancy.rentAmountPence)} ${tenancy.rentFrequency.replace('_', ' ')}` : 'No current tenancy'}</Text>
                  <Text style={[styles.muted, { color: issues > 0 ? colors.bad : colors.good }]}>{issues > 0 ? `${issues} compliance item${issues === 1 ? '' : 's'} need attention` : 'Compliance up to date'}</Text>
                </Pressable>
              );
            })
          : null}

        {data && summary && section === 'Rent' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.muted}>Rent due per month</Text>
              <Text style={styles.h1}>{formatPence(summary.monthlyRentPence)}</Text>
              <Text style={[styles.body, { color: summary.arrearsPence > 0 ? colors.bad : colors.good }]}>
                {summary.arrearsPence > 0 ? `${formatPence(summary.arrearsPence)} currently owed by tenants` : 'All rent is up to date'}
              </Text>
            </View>
            {data.tenancies.map((t) => <TenancyCard key={t.id} tenancy={t} />)}
            {data.tenancies.length === 0 ? <Text style={styles.muted}>No tenancies yet.</Text> : null}
          </>
        ) : null}

        {data && section === 'Compliance' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.muted}>Compliance score</Text>
              <Text style={[styles.h1, { color: scoreColor(data.complianceScore) }]}>{data.complianceScore} / 100</Text>
              <Text style={styles.muted}>The share of legal requirements currently met across your properties and your own registrations.</Text>
            </View>
            {data.compliance.map((i) => <ComplianceCard key={i.id} item={i} onChanged={load} />)}
          </>
        ) : null}

        {data && section === 'Repairs' ? (
          <>
            <Button title="Log a repair" kind="secondary" onPress={() => router.push('/report')} />
            {data.repairs.map((r) => <RepairCard key={r.id} repair={r} />)}
            {data.repairs.length === 0 ? <Text style={styles.muted}>No repairs reported.</Text> : null}
          </>
        ) : null}

        {data && section === 'Documents' ? (
          <>
            <AddDocument properties={data.properties} onAdded={load} />
            {data.documents.map((d) => <DocumentRow key={d.id} document={d} />)}
            {data.documents.length === 0 ? <Text style={styles.muted}>No documents yet.</Text> : null}
          </>
        ) : null}

        {data && section === 'Applicants' ? (
          <>
            <Text style={styles.muted}>People applying to rent your properties, with the progress of their referencing checks.</Text>
            {data.applications.map((a) => <ApplicationCard key={a.id} application={a} onChanged={load} />)}
            {data.applications.length === 0 ? <Text style={styles.muted}>No applicants at the moment.</Text> : null}
          </>
        ) : null}

        {section === 'Tools'
          ? TOOLS.map((tool) => (
              <Pressable key={tool.href} accessibilityRole="button" onPress={() => router.push(tool.href)} style={styles.card}>
                <Text style={styles.h2}>{tool.title}</Text>
                <Text style={styles.muted}>{tool.hint}</Text>
              </Pressable>
            ))
          : null}

        <View style={{ marginTop: 24, gap: 8 }}>
          <Text style={styles.muted}>Signed in as {identity.email}</Text>
          <Button title={demo ? 'Switch person' : 'Sign out'} kind="secondary" onPress={signOut} />
        </View>
      </ScrollView>
    </View>
  );
}
