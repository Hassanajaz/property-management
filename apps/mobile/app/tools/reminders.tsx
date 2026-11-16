import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { calendarIcs, diffDays, reminders, today } from '@lettly/core';
import { alertsEnabled, alertsSupported, disableAlerts, enableAlerts, loadCalendarEntries } from '../../src/alerts';
import { useAction, useLoad } from '../../src/hooks';
import { shareFile } from '../../src/platform';
import { useSession } from '../../src/session';
import { Button, StatusBadge, styles } from '../../src/ui';

const STAGE_LABEL = { 0: 'Overdue', 7: 'Due within 7 days', 30: 'Due within 30 days', 60: 'Due within 60 days' } as const;

/**
 * What falls due and when: the reminder ladder for certificates, every other
 * date to remember, a calendar file of them all, and alerts on this phone.
 */
export default function Reminders() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [compliance, entries] = await Promise.all([api.listCompliance(), loadCalendarEntries(api)]);
    return { compliance, entries };
  });
  const action = useAction();
  const [alertsOn, setAlertsOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const now = today();
  const ladder = data ? reminders(data.compliance.items, now) : [];
  const others = (data?.entries ?? []).filter((e) => !e.id.startsWith('compliance-') && diffDays(now, e.date) <= 90);

  useEffect(() => {
    void alertsEnabled().then(setAlertsOn);
  }, []);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      {error ?? action.error ? <Text style={styles.error}>{error ?? action.error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.h2}>Add to your calendar</Text>
        <Text style={styles.muted}>
          Makes a calendar file of every date ahead: certificates, inspections, licences, Right to Rent follow-ups and contractors' insurance. Open it to add them to Apple Calendar, Google Calendar or Outlook, each with an alert a week before.
        </Text>
        <Button
          title={`Make calendar file (${data?.entries.length ?? 0} dates)`}
          busy={action.busy}
          onPress={() =>
            void action.run(async () => {
              if (!data || data.entries.length === 0) throw new Error('There are no dates ahead to add yet.');
              setNote(await shareFile('lettly-reminders.ics', 'text/calendar', calendarIcs(data.entries, new Date().toISOString()), 'com.apple.ical.ics'));
            })
          }
        />
        <Text style={styles.muted}>The file is a snapshot. Make a new one after you renew a certificate or add a date; entries already in your calendar are updated, not doubled.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Alerts on this phone</Text>
        {alertsSupported ? (
          <>
            <Text style={styles.muted}>
              An alert at 9am 30 days before, 7 days before and on the day for each date. They are set on this phone only and are refreshed each time you open the app.
            </Text>
            {alertsOn ? (
              <>
                <Text style={styles.body}>Alerts are on.</Text>
                <Button
                  title="Turn alerts off"
                  kind="secondary"
                  busy={action.busy}
                  onPress={() =>
                    void action.run(async () => {
                      await disableAlerts();
                      setAlertsOn(false);
                      setNote(null);
                    })
                  }
                />
              </>
            ) : (
              <Button
                title="Turn alerts on"
                busy={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    const count = await enableAlerts(data?.entries ?? []);
                    if (count === null) throw new Error('Alerts are not allowed for this app. Turn on notifications for Lettly in the Settings app, then try again.');
                    setAlertsOn(true);
                    setNote(`${count} alert${count === 1 ? '' : 's'} set.`);
                  })
                }
              />
            )}
          </>
        ) : (
          <Text style={styles.muted}>Alerts work in the phone app. In a browser, use the calendar file above instead.</Text>
        )}
      </View>
      {note ? <Text style={styles.muted}>{note}</Text> : null}

      <Text style={[styles.h2, { marginTop: 8 }]}>Certificates and deadlines</Text>
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

      <Text style={[styles.h2, { marginTop: 8 }]}>Other dates in the next 90 days</Text>
      {others.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <Text style={styles.h2}>{entry.title}</Text>
          <Text style={styles.muted}>{entry.detail}</Text>
          <Text style={styles.body}>
            {entry.date}, {diffDays(now, entry.date) === 0 ? 'today' : `in ${diffDays(now, entry.date)} days`}
          </Text>
        </View>
      ))}
      {data && others.length === 0 ? <Text style={styles.muted}>No inspections, licences or other dates in the next 90 days.</Text> : null}
    </ScrollView>
  );
}
