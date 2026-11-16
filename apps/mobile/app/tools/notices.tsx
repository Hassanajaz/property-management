import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { POSSESSION_STAGES, POSSESSION_STAGE_LABEL, canAdvancePossession, today, type NoticeDto, type NoticeKind } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, Chip, StatusBadge, styles } from '../../src/ui';

const KIND_LABEL: Record<NoticeKind, string> = { rent_increase: 'Rent increase', possession: 'Seeking possession', access: 'Access or inspection', other: 'Other' };
const METHOD_LABEL: Record<NoticeDto['method'], string> = { post: 'By post', hand: 'By hand', email: 'By email' };

/** A log of notices served on tenants, and a tracker for any possession case. */
export default function Notices() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [notices, cases, tenancies] = await Promise.all([api.listNotices(), api.listPossessionCases(), api.listTenancies()]);
    return { notices, cases, tenancies: tenancies.filter((t) => t.status === 'active') };
  });
  const save = useAction();
  const [tenancyId, setTenancyId] = useState<string | null>(null);
  const [kind, setKind] = useState<NoticeKind>('access');
  const [method, setMethod] = useState<NoticeDto['method']>('email');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [notes, setNotes] = useState('');
  const [ground, setGround] = useState('');
  const [caseNotes, setCaseNotes] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const now = today();

  async function addNotice() {
    if (!tenancyId || (effectiveOn && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn))) {
      setFormError('Choose the tenancy. If the notice has an effective date, enter it as YYYY-MM-DD.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.addNotice({ tenancyId, kind, servedOn: now, method, effectiveOn: effectiveOn || null, notes: notes.trim() || null }))) {
      setNotes('');
      setEffectiveOn('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      <Text style={styles.muted}>
        This records what you have served and where a case has reached. It does not write legal notices: use the official forms for your nation and take advice before seeking possession.
      </Text>

      <Text style={styles.h2}>Possession cases</Text>
      {data && data.cases.length === 0 ? <Text style={styles.muted}>No possession cases.</Text> : null}
      {(data?.cases ?? []).map((possessionCase) => {
        const closed = possessionCase.stage === 'withdrawn' || possessionCase.stage === 'possession_recovered';
        return (
          <View key={possessionCase.id} style={styles.card}>
            <StatusBadge status={closed ? 'confirmed' : 'due_soon'} label={POSSESSION_STAGE_LABEL[possessionCase.stage]} />
            <Text style={styles.h2}>{possessionCase.propertyAddress}</Text>
            <Text style={styles.body}>
              {possessionCase.tenantNames.join(' and ')} · {possessionCase.ground}
            </Text>
            {possessionCase.events.map((event, n) => (
              <Text key={n} style={styles.muted}>
                {event.date}: {POSSESSION_STAGE_LABEL[event.stage]}
                {event.note ? ` (${event.note})` : ''}
              </Text>
            ))}
            {closed ? null : (
              <>
                <TextInput style={styles.input} value={caseNotes[possessionCase.id] ?? ''} onChangeText={(text: string) => setCaseNotes((n) => ({ ...n, [possessionCase.id]: text }))} placeholder="Note for the next step (optional)" />
                <View style={styles.row}>
                  {[...POSSESSION_STAGES, 'withdrawn' as const]
                    .filter((stage) => canAdvancePossession(possessionCase.stage, stage))
                    .map((stage) => (
                      <Chip key={stage} label={POSSESSION_STAGE_LABEL[stage]} selected={false} onPress={async () => (await save.run(() => api.advancePossessionCase(possessionCase.id, { stage, note: caseNotes[possessionCase.id] }))) && reload()} />
                    ))}
                </View>
              </>
            )}
          </View>
        );
      })}

      <Text style={[styles.h2, { marginTop: 8 }]}>Notices served</Text>
      {(data?.notices ?? []).map((notice) => (
        <View key={notice.id} style={styles.card}>
          <Text style={styles.h2}>{KIND_LABEL[notice.kind]}</Text>
          <Text style={styles.body}>
            {notice.propertyAddress} · {notice.tenantNames.join(' and ')}
          </Text>
          <Text style={styles.muted}>
            Served {notice.servedOn} · {METHOD_LABEL[notice.method].toLowerCase()}
            {notice.effectiveOn ? ` · takes effect ${notice.effectiveOn}` : ''}
          </Text>
          {notice.notes ? <Text style={styles.muted}>{notice.notes}</Text> : null}
        </View>
      ))}
      {data && data.notices.length === 0 ? <Text style={styles.muted}>No notices recorded.</Text> : null}

      <View style={styles.card}>
        <Text style={styles.h2}>Record a notice served today</Text>
        <Text style={styles.label}>Tenancy</Text>
        <View style={styles.row}>
          {(data?.tenancies ?? []).map((t) => (
            <Chip key={t.id} label={t.propertyAddress.split(',')[0] ?? t.propertyAddress} selected={tenancyId === t.id} onPress={() => setTenancyId(t.id)} />
          ))}
        </View>
        <Text style={styles.label}>Type</Text>
        <View style={styles.row}>
          {(Object.keys(KIND_LABEL) as NoticeKind[]).map((k) => (
            <Chip key={k} label={KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <Text style={styles.label}>How was it served?</Text>
        <View style={styles.row}>
          {(Object.keys(METHOD_LABEL) as NoticeDto['method'][]).map((m) => (
            <Chip key={m} label={METHOD_LABEL[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
        <Text style={styles.label}>Takes effect on (YYYY-MM-DD, optional)</Text>
        <TextInput style={styles.input} value={effectiveOn} onChangeText={setEffectiveOn} autoCapitalize="none" />
        <Text style={styles.label}>Notes</Text>
        <TextInput style={styles.input} value={notes} onChangeText={setNotes} />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Button title="Record notice" onPress={addNotice} busy={save.busy} />
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Start tracking a possession case</Text>
        <Text style={styles.muted}>Uses the tenancy chosen above. Start this once the notice has been served.</Text>
        <Text style={styles.label}>Reason relied on</Text>
        <TextInput style={styles.input} value={ground} onChangeText={setGround} placeholder="e.g. Rent arrears" />
        <Button
          title="Start tracking"
          kind="secondary"
          busy={save.busy}
          onPress={async () => {
            if (!tenancyId) {
              setFormError('Choose the tenancy first.');
              return;
            }
            if (await save.run(() => api.openPossessionCase({ tenancyId, ground }))) {
              setGround('');
              await reload();
            }
          }}
        />
      </View>
    </ScrollView>
  );
}
