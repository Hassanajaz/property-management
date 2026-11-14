import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { TENANT_STATUS_LABEL, isStaff, type ComplianceItemDto, type MaintenanceRequestDto } from '@lettly/core';
import { useSession } from '../src/session';
import { Button, StatusBadge, colors, styles } from '../src/ui';

const COMPLIANCE_LABEL = { valid: 'Valid', due_soon: 'Due soon', overdue: 'Overdue', missing: 'Missing' } as const;

/**
 * Home screen. Tenants see their repairs and a button to report a new one.
 * Staff and landlords also see the compliance score and what needs attention.
 */
export default function Home() {
  const { identity, api, signOut, demo } = useSession();
  const [repairs, setRepairs] = useState<MaintenanceRequestDto[]>([]);
  const [compliance, setCompliance] = useState<{ score: number; items: ComplianceItemDto[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = identity?.role;
  const tenant = role === 'tenant';

  const load = useCallback(async () => {
    if (!role) return;
    setLoading(true);
    setError(null);
    try {
      setRepairs(await api.listMaintenance());
      if (!tenant) setCompliance(await api.listCompliance());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [api, role, tenant]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!identity || !role) return null;
  const attention = compliance?.items.filter((i) => !i.upcoming && i.status !== 'valid') ?? [];
  const open = repairs.filter((r) => r.status !== 'confirmed' && r.status !== 'cancelled');

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {demo ? <Text style={styles.muted}>Demo mode: sample data, nothing is saved. Signed in as {role.replace('_', ' ')}.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tenant ? <Button title="Report a repair" onPress={() => router.push('/report')} /> : null}

      {compliance ? (
        <View style={styles.card}>
          <Text style={styles.muted}>Compliance score</Text>
          <Text style={[styles.h1, { color: compliance.score >= 90 ? colors.good : compliance.score >= 70 ? colors.warn : colors.bad }]}>{compliance.score} / 100</Text>
          <Text style={styles.muted}>{attention.length === 0 ? 'Nothing needs attention.' : `${attention.length} item${attention.length === 1 ? '' : 's'} need attention`}</Text>
        </View>
      ) : null}

      {attention.slice(0, 10).map((item) => (
        <View key={item.id} style={styles.card}>
          <StatusBadge status={item.status} label={COMPLIANCE_LABEL[item.status]} />
          <Text style={styles.h2}>{item.title}</Text>
          {item.propertyAddress ? <Text style={styles.muted}>{item.propertyAddress}</Text> : null}
          {item.expiresOn ?? item.dueDate ? <Text style={styles.muted}>Due {item.expiresOn ?? item.dueDate}</Text> : null}
        </View>
      ))}

      <Text style={[styles.h2, { marginTop: 8 }]}>{tenant ? 'Your repairs' : 'Open repairs'}</Text>
      {open.length === 0 && !loading ? <Text style={styles.muted}>No open repairs.</Text> : null}
      {open.map((repair) => (
        <Pressable key={repair.id} accessibilityRole="button" onPress={() => router.push(`/repair/${repair.id}`)} style={styles.card}>
          <StatusBadge status={repair.status} label={TENANT_STATUS_LABEL[repair.status]} />
          <Text style={styles.h2}>{repair.title}</Text>
          <Text style={styles.muted}>
            {isStaff(role) || role === 'landlord' ? `${repair.propertyAddress} · ` : ''}
            Reported {new Date(repair.reportedAt).toLocaleDateString('en-GB')}
            {repair.urgency === 'emergency' ? ' · Emergency' : ''}
          </Text>
        </Pressable>
      ))}

      <View style={{ marginTop: 24, gap: 8 }}>
        <Text style={styles.muted}>Signed in as {identity.email}</Text>
        <Button title={demo ? 'Switch person' : 'Sign out'} kind="secondary" onPress={signOut} />
      </View>
    </ScrollView>
  );
}
