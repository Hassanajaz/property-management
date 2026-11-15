import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { DocumentDto, MaintenanceRequestDto, TenancyDto } from '@lettly/core';
import { DocumentRow, Portfolio, RepairCard, TenancyCard } from '../src/portfolio';
import { useSession } from '../src/session';
import { Button, styles } from '../src/ui';

/** The landlord gets the portfolio dashboard; a tenant gets their own home screen. */
export default function Home() {
  const { identity } = useSession();
  if (!identity) return null;
  return identity.role === 'tenant' ? <TenantHome /> : <Portfolio />;
}

function TenantHome() {
  const { identity, api, signOut, demo } = useSession();
  const [repairs, setRepairs] = useState<MaintenanceRequestDto[]>([]);
  const [tenancies, setTenancies] = useState<TenancyDto[]>([]);
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, t, d] = await Promise.all([api.listMaintenance(), api.listTenancies(), api.listDocuments()]);
      setRepairs(r);
      setTenancies(t);
      setDocuments(d);
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

  const open = repairs.filter((r) => r.status !== 'confirmed' && r.status !== 'cancelled');

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {demo ? <Text style={styles.muted}>Demo mode: sample data, nothing is saved. Signed in as tenant.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button title="Report a repair" onPress={() => router.push('/report')} />

      <Text style={[styles.h2, { marginTop: 8 }]}>Your rent</Text>
      {tenancies.map((t) => <TenancyCard key={t.id} tenancy={t} />)}

      <Text style={[styles.h2, { marginTop: 8 }]}>Your repairs</Text>
      {open.length === 0 && !loading ? <Text style={styles.muted}>No open repairs.</Text> : null}
      {open.map((repair) => <RepairCard key={repair.id} repair={repair} showAddress={false} />)}

      <Text style={[styles.h2, { marginTop: 8 }]}>Your documents</Text>
      {documents.length === 0 && !loading ? <Text style={styles.muted}>No documents yet.</Text> : null}
      {documents.map((d) => <DocumentRow key={d.id} document={d} showAddress={false} />)}

      <View style={{ marginTop: 24, gap: 8 }}>
        <Text style={styles.muted}>Signed in as {identity?.email}</Text>
        <Button title={demo ? 'Switch person' : 'Sign out'} kind="secondary" onPress={signOut} />
      </View>
    </ScrollView>
  );
}
