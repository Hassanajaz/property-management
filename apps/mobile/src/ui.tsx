import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComplianceStatus, MaintenanceStatus } from '@lettly/core';

export const colors = {
  ink: '#16212e',
  muted: '#5c6b7a',
  line: '#dfe4ea',
  surface: '#ffffff',
  page: '#f4f6f8',
  brand: '#0f5c4c',
  good: '#1f7a4d',
  warn: '#a86400',
  bad: '#b3261e',
};

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  // Centred with a maximum width so the browser version stays readable on a wide screen.
  content: { padding: 16, gap: 12, width: '100%', maxWidth: 880, alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.line, gap: 6 },
  h1: { fontSize: 24, fontWeight: '700', color: colors.ink },
  h2: { fontSize: 17, fontWeight: '600', color: colors.ink },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 16, color: colors.ink },
  error: { color: colors.bad, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
});

export function Button({ title, onPress, busy, kind = 'primary' }: { title: string; onPress: () => void; busy?: boolean; kind?: 'primary' | 'secondary' }) {
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: primary ? colors.brand : colors.surface,
        borderWidth: 1,
        borderColor: primary ? colors.brand : colors.line,
        borderRadius: 10,
        padding: 14,
        alignItems: 'center',
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={primary ? '#fff' : colors.brand} /> : <Text style={{ color: primary ? '#fff' : colors.ink, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={{ color: selected ? '#fff' : colors.ink, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const STATUS_TONE: Record<ComplianceStatus | MaintenanceStatus, string> = {
  valid: colors.good,
  due_soon: colors.warn,
  overdue: colors.bad,
  missing: colors.bad,
  reported: colors.warn,
  triaged: colors.warn,
  scheduled: colors.brand,
  in_progress: colors.brand,
  completed: colors.good,
  confirmed: colors.muted,
  reopened: colors.bad,
  cancelled: colors.muted,
};

export function StatusBadge({ status, label }: { status: ComplianceStatus | MaintenanceStatus; label: string }) {
  const tone = STATUS_TONE[status];
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: tone, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color: tone, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
