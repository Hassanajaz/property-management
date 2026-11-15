import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { AddDocument, ApplicationCard, ComplianceCard, DocumentRow, RepairCard, TenancyCard, usePortfolioData } from '../../src/portfolio';
import { StatusBadge, colors, styles } from '../../src/ui';

/** Everything about one property: who lives there, rent, compliance, repairs, documents and applicants. */
export default function Property() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, load } = usePortfolioData();

  const property = data?.properties.find((p) => p.id === id);
  const tenancies = data?.tenancies.filter((t) => t.propertyId === id) ?? [];
  const compliance = data?.compliance.filter((i) => i.propertyId === id) ?? [];
  const repairs = data?.repairs.filter((r) => r.propertyId === id) ?? [];
  const documents = data?.documents.filter((d) => d.propertyId === id) ?? [];
  const applications = data?.applications.filter((a) => a.propertyId === id) ?? [];
  const outstanding = compliance.filter((i) => !i.upcoming && i.severity === 'statutory' && i.status !== 'valid').length;
  const current = tenancies.some((t) => t.status === 'active');

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Stack.Screen options={{ title: property?.addressLine1 ?? 'Property' }} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data && !property ? <Text style={styles.muted}>Property not found.</Text> : null}

      {property ? (
        <>
          <View style={styles.card}>
            <StatusBadge status={current ? 'valid' : 'due_soon'} label={current ? 'Let' : 'Vacant'} />
            <Text style={styles.h1}>{property.addressLine1}</Text>
            <Text style={styles.muted}>
              {property.town} {property.postcode} · {property.nation.replace('_', ' ')}
            </Text>
            <Text style={styles.muted}>
              {property.hasGas ? 'Gas supply' : 'No gas'}
              {property.isHmo ? ' · House in multiple occupation' : ''}
            </Text>
            <Text style={[styles.body, { color: outstanding > 0 ? colors.bad : colors.good }]}>
              {outstanding > 0 ? `${outstanding} compliance item${outstanding === 1 ? '' : 's'} need attention` : 'Compliance up to date'}
            </Text>
          </View>

          <Text style={[styles.h2, { marginTop: 8 }]}>Tenancy and rent</Text>
          {tenancies.length === 0 ? <Text style={styles.muted}>No tenancy at the moment.</Text> : null}
          {tenancies.map((t) => (
            <View key={t.id} style={{ gap: 6 }}>
              <TenancyCard tenancy={t} showAddress={false} />
              <Text style={styles.muted}>
                Deposit £{(t.depositPence / 100).toFixed(2)} · {t.depositScheme ? `held with ${t.depositScheme}` : 'not yet protected in a scheme'}
              </Text>
            </View>
          ))}

          {applications.length > 0 ? <Text style={[styles.h2, { marginTop: 8 }]}>Applicants</Text> : null}
          {applications.map((a) => <ApplicationCard key={a.id} application={a} showAddress={false} />)}

          <Text style={[styles.h2, { marginTop: 8 }]}>Compliance</Text>
          {compliance.map((i) => <ComplianceCard key={i.id} item={i} showAddress={false} />)}

          <Text style={[styles.h2, { marginTop: 8 }]}>Repairs</Text>
          {repairs.length === 0 ? <Text style={styles.muted}>No repairs reported.</Text> : null}
          {repairs.map((r) => <RepairCard key={r.id} repair={r} showAddress={false} />)}

          <Text style={[styles.h2, { marginTop: 8 }]}>Documents</Text>
          <AddDocument properties={[property]} fixedPropertyId={property.id} onAdded={load} />
          {documents.length === 0 ? <Text style={styles.muted}>No documents yet.</Text> : null}
          {documents.map((d) => <DocumentRow key={d.id} document={d} showAddress={false} />)}
        </>
      ) : null}
    </ScrollView>
  );
}
