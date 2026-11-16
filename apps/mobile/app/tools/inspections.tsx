import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { inspectionNotice, today } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, Chip, StatusBadge, colors, styles } from '../../src/ui';

/** Planned property inspections, with a warning when written notice has not been given in time. */
export default function Inspections() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [inspections, properties] = await Promise.all([api.listInspections(), api.listProperties()]);
    return { inspections, properties };
  });
  const save = useAction();
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const now = today();

  async function plan() {
    if (!propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < now) {
      setFormError('Choose a property and a date from today onwards, as YYYY-MM-DD.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.planInspection({ propertyId, date }))) {
      setDate('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      <Text style={styles.muted}>Tenants must have at least 24 hours' written notice of a visit.</Text>

      {(data?.inspections ?? []).map((inspection) => {
        const notice = inspection.status === 'planned' ? inspectionNotice(inspection.date, inspection.noticeGivenOn, now) : 'ok';
        return (
          <View key={inspection.id} style={styles.card}>
            <StatusBadge
              status={inspection.status === 'done' ? 'valid' : inspection.status === 'cancelled' ? 'cancelled' : notice === 'ok' ? 'scheduled' : notice === 'too_late' ? 'overdue' : 'due_soon'}
              label={inspection.status === 'done' ? 'Done' : inspection.status === 'cancelled' ? 'Cancelled' : `Planned for ${inspection.date}`}
            />
            <Text style={styles.h2}>{inspection.propertyAddress}</Text>
            {inspection.status === 'done' ? <Text style={styles.muted}>Visited {inspection.date}</Text> : null}
            {inspection.notes ? <Text style={styles.body}>{inspection.notes}</Text> : null}

            {inspection.status === 'planned' ? (
              <>
                <Text style={[styles.body, { color: notice === 'ok' ? colors.good : notice === 'too_late' ? colors.bad : colors.warn }]}>
                  {notice === 'ok'
                    ? `Notice given ${inspection.noticeGivenOn}`
                    : notice === 'too_late'
                      ? 'This visit is under 24 hours away and no notice has been recorded. Move it, or get the tenant to agree in writing.'
                      : 'Notice has not been given yet.'}
                </Text>
                {notice === 'give_notice_now' ? (
                  <Button title="I gave written notice today" kind="secondary" busy={save.busy} onPress={async () => (await save.run(() => api.updateInspection(inspection.id, { noticeGivenOn: now }))) && reload()} />
                ) : null}
                <TextInput
                  style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  value={notes[inspection.id] ?? ''}
                  onChangeText={(text: string) => setNotes((n) => ({ ...n, [inspection.id]: text }))}
                  placeholder="Notes from the visit"
                  multiline
                />
                <Button title="Mark as done" busy={save.busy} onPress={async () => (await save.run(() => api.updateInspection(inspection.id, { status: 'done', notes: notes[inspection.id] ?? '' }))) && reload()} />
                <Button title="Cancel visit" kind="secondary" busy={save.busy} onPress={async () => (await save.run(() => api.updateInspection(inspection.id, { status: 'cancelled' }))) && reload()} />
              </>
            ) : null}
          </View>
        );
      })}

      <View style={styles.card}>
        <Text style={styles.h2}>Plan an inspection</Text>
        <Text style={styles.label}>Property</Text>
        <View style={styles.row}>
          {(data?.properties ?? []).map((p) => (
            <Chip key={p.id} label={p.addressLine1} selected={propertyId === p.id} onPress={() => setPropertyId(p.id)} />
          ))}
        </View>
        <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder={now} autoCapitalize="none" />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Button title="Plan inspection" onPress={plan} busy={save.busy} />
      </View>
    </ScrollView>
  );
}
