import * as Notifications from 'expo-notifications';
import { calendarEntries, phoneAlerts, today, type ApiClient, type CalendarEntry } from '@lettly/core';
import { isWeb, sessionStore } from './platform';

/**
 * Alerts on this phone for dates the landlord must not miss. They are set on
 * the phone itself (no messages are sent from a server), so they work without
 * an Apple Developer account. Each phone is switched on separately.
 */
const KEY = 'lettly.phone-alerts';

export const alertsSupported = !isWeb;

if (alertsSupported) {
  // Show the alert even when the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function alertsEnabled(): Promise<boolean> {
  return alertsSupported && (await sessionStore.get(KEY)) === 'on';
}

/** Every date worth an alert or a calendar entry, gathered from across the account. */
export async function loadCalendarEntries(api: ApiClient): Promise<CalendarEntry[]> {
  const [compliance, inspections, licences, rightToRent, contractors] = await Promise.all([
    api.listCompliance(),
    api.listInspections(),
    api.listLicences(),
    api.listRightToRent(),
    api.listContractors(),
  ]);
  return calendarEntries({ compliance: compliance.items, inspections, licences, rightToRent, contractors }, today());
}

function localNow(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`;
}

/** Reads "2026-12-01T09:00" as a time on this phone's clock. */
function localDate(at: string): Date {
  const [year, month, day, hour, minute] = at.split(/[-T:]/).map(Number);
  return new Date(year!, month! - 1, day!, hour!, minute!);
}

/** Replaces the alerts waiting on this phone with a fresh set. Returns how many were set. */
async function schedule(entries: readonly CalendarEntry[]): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const alerts = phoneAlerts(entries, localNow());
  for (const alert of alerts) {
    await Notifications.scheduleNotificationAsync({
      content: { title: alert.title, body: alert.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: localDate(alert.at) },
    });
  }
  return alerts.length;
}

/** Asks permission and sets the alerts. Returns how many were set, or null if permission was refused. */
export async function enableAlerts(entries: readonly CalendarEntry[]): Promise<number | null> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;
  await sessionStore.set(KEY, 'on');
  return schedule(entries);
}

export async function disableAlerts(): Promise<void> {
  await sessionStore.remove(KEY);
  if (alertsSupported) await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Keeps the alerts in step with the account. Called when the landlord's dashboard loads. */
export async function refreshAlerts(api: ApiClient): Promise<void> {
  try {
    if (await alertsEnabled()) await schedule(await loadCalendarEntries(api));
  } catch {
    // Alerts are a convenience: a failure here must never stop the dashboard loading.
  }
}
