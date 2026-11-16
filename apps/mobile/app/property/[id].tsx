import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { formatPence, propertyMoney, yearlyRentPence, type PropertyDto, type TenancyDto } from '@lettly/core';
import { percent, poundsToPence, useAction } from '../../src/hooks';
import { useSession } from '../../src/session';
import { AddDocument, ApplicationCard, ComplianceCard, DocumentRow, RepairCard, TenancyCard, usePortfolioData } from '../../src/portfolio';
import { Button, StatusBadge, colors, styles } from '../../src/ui';

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

          <MoneyCard property={property} tenancy={tenancies.find((t) => t.status === 'active')} onSaved={load} />

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
          {applications.map((a) => <ApplicationCard key={a.id} application={a} showAddress={false} onChanged={load} />)}

          <Text style={[styles.h2, { marginTop: 8 }]}>Compliance</Text>
          {compliance.map((i) => <ComplianceCard key={i.id} item={i} showAddress={false} onChanged={load} />)}

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

/** Value, mortgage, equity, loan to value and yield for one property. */
function MoneyCard({ property, tenancy, onSaved }: { property: PropertyDto; tenancy?: TenancyDto; onSaved: () => void }) {
  const { api } = useSession();
  const save = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(property.valuePence ? String(property.valuePence / 100) : '');
  const [mortgage, setMortgage] = useState(property.mortgagePence ? String(property.mortgagePence / 100) : '');
  const [formError, setFormError] = useState<string | null>(null);

  const money = propertyMoney(property.valuePence ?? null, property.mortgagePence ?? null, tenancy ? yearlyRentPence(tenancy) : 0);

  async function submit() {
    const valuePence = value.trim() ? poundsToPence(value) : null;
    const mortgagePence = mortgage.trim() ? poundsToPence(mortgage) : null;
    if ((value.trim() && valuePence === null) || (mortgage.trim() && mortgagePence === null)) {
      setFormError('Enter amounts in pounds, for example 245000.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.updateProperty(property.id, { valuePence, mortgagePence }))) {
      setEditing(false);
      onSaved();
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Value and borrowing</Text>
      {money.equityPence === null ? (
        <Text style={styles.muted}>Add what the property is worth to see equity, loan to value and yield.</Text>
      ) : (
        <>
          <Text style={styles.body}>
            Worth {formatPence(property.valuePence ?? 0)} · mortgage {formatPence(property.mortgagePence ?? 0)}
          </Text>
          <Text style={styles.body}>Equity {formatPence(money.equityPence)}</Text>
          <Text style={styles.body}>Loan to value {percent(money.loanToValue ?? 0)}</Text>
          <Text style={styles.body}>{tenancy ? `Gross yield ${percent(money.grossYield ?? 0)} a year` : 'No rent at the moment, so no yield'}</Text>
        </>
      )}
      {editing ? (
        <>
          <Text style={styles.label}>Estimated value in pounds</Text>
          <TextInput style={styles.input} value={value} onChangeText={setValue} keyboardType="decimal-pad" />
          <Text style={styles.label}>Mortgage outstanding in pounds</Text>
          <TextInput style={styles.input} value={mortgage} onChangeText={setMortgage} keyboardType="decimal-pad" />
          {formError ?? save.error ? <Text style={styles.error}>{formError ?? save.error}</Text> : null}
          <Button title="Save" onPress={submit} busy={save.busy} />
        </>
      ) : (
        <Button title="Update value or mortgage" kind="secondary" onPress={() => setEditing(true)} />
      )}
    </View>
  );
}
