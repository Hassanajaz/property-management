import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { LICENCE_KINDS, LICENCE_KIND_LABEL, diffDays, licenceState, today, type LicenceDto, type LicenceKind } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, Chip, StatusBadge, styles } from '../../src/ui';

const STATE_BADGE = { valid: { status: 'valid', label: 'In force' }, renew_soon: { status: 'due_soon', label: 'Renew soon' }, expired: { status: 'overdue', label: 'Expired' } } as const;
const isDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text);

interface Draft {
  id?: string;
  propertyId: string | null;
  kind: LicenceKind;
  authority: string;
  reference: string;
  issuedOn: string;
  expiresOn: string;
  maxOccupants: string;
  conditions: string;
}
const blank: Draft = { propertyId: null, kind: 'selective', authority: '', reference: '', issuedOn: '', expiresOn: '', maxOccupants: '', conditions: '' };

/** HMO and selective licences and landlord registrations: who issued each, its conditions and when it runs out. */
export default function Licences() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [licences, properties] = await Promise.all([api.listLicences(), api.listProperties()]);
    return { licences, properties };
  });
  const save = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const now = today();
  const set = (changes: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...changes } : current));

  function edit(licence: LicenceDto) {
    setFormError(null);
    setDraft({
      id: licence.id, propertyId: licence.propertyId, kind: licence.kind, authority: licence.authority, reference: licence.reference ?? '',
      issuedOn: licence.issuedOn ?? '', expiresOn: licence.expiresOn, maxOccupants: licence.maxOccupants ? String(licence.maxOccupants) : '', conditions: licence.conditions ?? '',
    });
  }

  async function submit() {
    if (!draft) return;
    const { propertyId } = draft;
    const occupants = draft.maxOccupants.trim() === '' ? null : Number(draft.maxOccupants);
    if (!propertyId || !draft.authority.trim() || !isDate(draft.expiresOn) || (draft.issuedOn !== '' && !isDate(draft.issuedOn)) || (occupants !== null && !(Number.isInteger(occupants) && occupants > 0))) {
      setFormError('Choose the property, say who issued it, and enter dates as YYYY-MM-DD. The expiry date is needed.');
      return;
    }
    setFormError(null);
    const saved = await save.run(() =>
      api.saveLicence({
        id: draft.id, propertyId, kind: draft.kind, authority: draft.authority.trim(), reference: draft.reference.trim() || null,
        issuedOn: draft.issuedOn || null, expiresOn: draft.expiresOn, maxOccupants: occupants, conditions: draft.conditions.trim() || null,
      }),
    );
    if (saved) {
      setDraft(null);
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      <Text style={styles.muted}>
        Whether a home needs a licence depends on the council and how it is let. Check the council's website for each property; letting without a licence that is required can mean a large fine and repaying rent. Renewals can take months, so the warning starts 90 days ahead.
      </Text>

      {(data?.licences ?? []).map((licence) => {
        const badge = STATE_BADGE[licenceState(licence, now)];
        const daysLeft = diffDays(now, licence.expiresOn);
        return (
          <View key={licence.id} style={styles.card}>
            <StatusBadge status={badge.status} label={badge.label} />
            <Text style={styles.h2}>{LICENCE_KIND_LABEL[licence.kind]}</Text>
            <Text style={styles.muted}>{licence.propertyAddress}</Text>
            <Text style={styles.body}>
              {licence.authority}
              {licence.reference ? ` · ref ${licence.reference}` : ''}
            </Text>
            <Text style={styles.body}>{daysLeft < 0 ? `Expired ${licence.expiresOn}, ${-daysLeft} days ago` : `Expires ${licence.expiresOn}, in ${daysLeft} days`}</Text>
            {licence.maxOccupants ? <Text style={styles.body}>Most people allowed to live there: {licence.maxOccupants}</Text> : null}
            {licence.conditions ? <Text style={styles.muted}>Conditions: {licence.conditions}</Text> : null}
            <Button title="Edit or renew" kind="secondary" onPress={() => edit(licence)} />
          </View>
        );
      })}
      {data && data.licences.length === 0 ? <Text style={styles.muted}>No licences recorded yet.</Text> : null}

      {draft ? (
        <View style={styles.card}>
          <Text style={styles.h2}>{draft.id ? 'Edit licence' : 'Add a licence'}</Text>
          <Text style={styles.label}>Property</Text>
          <View style={styles.row}>
            {(data?.properties ?? []).map((p) => (
              <Chip key={p.id} label={p.addressLine1} selected={draft.propertyId === p.id} onPress={() => set({ propertyId: p.id })} />
            ))}
          </View>
          <Text style={styles.label}>Kind</Text>
          <View style={styles.row}>
            {LICENCE_KINDS.map((kind) => (
              <Chip key={kind} label={LICENCE_KIND_LABEL[kind]} selected={draft.kind === kind} onPress={() => set({ kind })} />
            ))}
          </View>
          <Text style={styles.label}>Issued by (council or register)</Text>
          <TextInput style={styles.input} value={draft.authority} onChangeText={(authority: string) => set({ authority })} />
          <Text style={styles.label}>Reference number</Text>
          <TextInput style={styles.input} value={draft.reference} onChangeText={(reference: string) => set({ reference })} autoCapitalize="characters" />
          <Text style={styles.label}>Issued on (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={draft.issuedOn} onChangeText={(issuedOn: string) => set({ issuedOn })} autoCapitalize="none" />
          <Text style={styles.label}>Expires on (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={draft.expiresOn} onChangeText={(expiresOn: string) => set({ expiresOn })} autoCapitalize="none" placeholder={now} />
          <Text style={styles.label}>Most occupants allowed (if the licence sets one)</Text>
          <TextInput style={styles.input} value={draft.maxOccupants} onChangeText={(maxOccupants: string) => set({ maxOccupants })} keyboardType="number-pad" />
          <Text style={styles.label}>Conditions to remember</Text>
          <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} value={draft.conditions} onChangeText={(conditions: string) => set({ conditions })} multiline />
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <Button title="Save licence" onPress={submit} busy={save.busy} />
          <Button title="Cancel" kind="secondary" onPress={() => setDraft(null)} />
        </View>
      ) : (
        <Button
          title="Add a licence"
          onPress={() => {
            setFormError(null);
            setDraft(blank);
          }}
        />
      )}
    </ScrollView>
  );
}
