import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { TENANT_STATUS_LABEL, canTransition, isLandlord, type MaintenanceRequestDto, type MaintenanceStatus } from '@lettly/core';
import { useSession } from '../../src/session';
import { Button, StatusBadge, styles } from '../../src/ui';

/** Steps the landlord can take, in workflow order. Only the ones allowed from the current status are shown. */
const LANDLORD_STEPS: { to: MaintenanceStatus; label: string }[] = [
  { to: 'triaged', label: 'Mark as reviewed' },
  { to: 'scheduled', label: 'Book visit for tomorrow, 10am' },
  { to: 'in_progress', label: 'Work has started' },
  { to: 'completed', label: 'Mark repair as done' },
  { to: 'reopened', label: 'Reopen this repair' },
  { to: 'cancelled', label: 'Cancel request' },
];

function tomorrowAtTen(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

const ROLE_LABEL: Record<string, string> = { tenant: 'Tenant', landlord: 'Landlord' };

/** A repair and its timeline. The landlord moves it along; the tenant confirms the fix or reopens it. */
export default function Repair() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, identity } = useSession();
  const [repair, setRepair] = useState<MaintenanceRequestDto | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRepair(await api.getMaintenance(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(update: { status?: MaintenanceStatus; message?: string; appointmentAt?: string }) {
    setBusy(true);
    setError(null);
    try {
      await api.updateMaintenance(id, update);
      setMessage('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  const role = identity?.role;
  const can = (to: MaintenanceStatus) => Boolean(role && repair && canTransition(role, repair.status, to));

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {repair ? (
        <>
          <View style={styles.card}>
            <StatusBadge status={repair.status} label={TENANT_STATUS_LABEL[repair.status]} />
            <Text style={styles.h1}>{repair.title}</Text>
            <Text style={styles.muted}>{repair.propertyAddress}</Text>
            <Text style={styles.body}>{repair.description}</Text>
            {repair.appointmentAt ? (
              <Text style={styles.h2}>Visit booked: {new Date(repair.appointmentAt).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}</Text>
            ) : null}
            {repair.photoDocumentIds.length > 0 ? <Text style={styles.muted}>{repair.photoDocumentIds.length} photo(s) attached</Text> : null}
          </View>

          {role === 'tenant' && (can('confirmed') || can('reopened')) ? (
            <View style={styles.card}>
              <Text style={styles.h2}>Has this been fixed?</Text>
              <Button title="Yes, it is fixed" onPress={() => send({ status: 'confirmed' })} busy={busy} />
              <Button title="No, there is still a problem" kind="secondary" onPress={() => send({ status: 'reopened', message: message || undefined })} busy={busy} />
            </View>
          ) : null}

          {role && isLandlord(role) && LANDLORD_STEPS.some((step) => can(step.to)) ? (
            <View style={styles.card}>
              <Text style={styles.h2}>Next step</Text>
              {LANDLORD_STEPS.filter((step) => can(step.to)).map((step) => (
                <Button
                  key={step.to}
                  title={step.label}
                  kind={step.to === 'cancelled' || step.to === 'reopened' ? 'secondary' : 'primary'}
                  busy={busy}
                  onPress={() => send({ status: step.to, message: message.trim() || undefined, appointmentAt: step.to === 'scheduled' ? tomorrowAtTen() : undefined })}
                />
              ))}
              <Text style={styles.muted}>Anything typed in the message box below is sent with the update.</Text>
            </View>
          ) : null}

          <Text style={styles.h2}>Updates</Text>
          {(repair.updates ?? []).map((update) => (
            <View key={update.id} style={styles.card}>
              <Text style={styles.muted}>
                {ROLE_LABEL[update.authorRole] ?? update.authorRole} · {new Date(update.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
              {update.status ? <Text style={styles.h2}>{TENANT_STATUS_LABEL[update.status]}</Text> : null}
              {update.message ? <Text style={styles.body}>{update.message}</Text> : null}
            </View>
          ))}

          <Text style={styles.label}>Add a message</Text>
          <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} value={message} onChangeText={setMessage} multiline maxLength={4000} />
          <Button title="Send message" kind="secondary" onPress={() => message.trim() && send({ message: message.trim() })} busy={busy} />

          {can('cancelled') && role === 'tenant' ? <Button title="Cancel this report" kind="secondary" onPress={() => send({ status: 'cancelled' })} busy={busy} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}
