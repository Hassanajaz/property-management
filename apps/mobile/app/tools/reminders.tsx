import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { reminders, today } from '@lettly/core';
import { useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { StatusBadge, styles } from '../../src/ui';

const STAGE_LABEL = { 0: 'Overdue', 7: 'Due within 7 days', 30: 'Due within 30 days', 60: 'Due within 60 days' } as const;

/** Reminder ladder: what falls due in the next 60 days, with reminders at 60, 30 and 7 days before. */
export default function Reminders() {
  const { api, demo } = useSession();
  const { data, loading, error, reload } = useLoad(() => api.listCompliance());
  const ladder = data ? reminders(data.items, today()) : [];

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>
        Each certificate and deadline gets a reminder 60, 30 and 7 days before it is due.
        {demo ? ' In demo mode reminders are listed here only; emails and notifications need the live service.' : ''}
      </Text>

      {ladder.map((r) => (
        <View key={r.itemId} style={styles.card}>
          <StatusBadge status={r.stage === 0 ? 'overdue' : r.stage === 7 ? 'missing' : 'due_soon'} label={STAGE_LABEL[r.stage]} />
          <Text style={styles.h2}>{r.title}</Text>
          {r.propertyAddress ? <Text style={styles.muted}>{r.propertyAddress}</Text> : null}
          <Text style={styles.body}>{r.daysLeft < 0 ? `Was due ${r.due}, ${-r.daysLeft} days ago` : `Due ${r.due}, in ${r.daysLeft} days`}</Text>
          {r.nextReminderOn ? <Text style={styles.muted}>Next reminder {r.nextReminderOn}</Text> : null}
        </View>
      ))}
      {data && ladder.length === 0 ? <Text style={styles.muted}>Nothing is due in the next 60 days.</Text> : null}
    </ScrollView>
  );
}
