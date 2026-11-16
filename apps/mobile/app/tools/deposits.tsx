import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { formatPence } from '@lettly/core';
import { COMPLIANCE_LABEL } from '../../src/portfolio';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, StatusBadge, styles } from '../../src/ui';

/** Deposit register: each tenancy's deposit, the scheme holding it, and the protection deadlines. */
export default function Deposits() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [tenancies, compliance] = await Promise.all([api.listTenancies(), api.listCompliance()]);
    return { tenancies, compliance: compliance.items };
  });
  const save = useAction();
  const [scheme, setScheme] = useState<Record<string, string>>({});

  const total = (data?.tenancies ?? []).reduce((sum, t) => sum + t.depositPence, 0);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      {data ? (
        <View style={styles.card}>
          <Text style={styles.muted}>Deposits held across {data.tenancies.length} tenancies</Text>
          <Text style={styles.h1}>{formatPence(total)}</Text>
        </View>
      ) : null}

      {(data?.tenancies ?? []).map((tenancy) => {
        const steps = data!.compliance.filter((i) => i.tenancyId === tenancy.id && i.ruleId.startsWith('deposit'));
        return (
          <View key={tenancy.id} style={styles.card}>
            <Text style={styles.h2}>{tenancy.propertyAddress}</Text>
            <Text style={styles.body}>
              {tenancy.tenantNames.join(' and ')} · deposit {formatPence(tenancy.depositPence)}
            </Text>
            <Text style={styles.muted}>{tenancy.depositScheme ? `Held with ${tenancy.depositScheme}` : tenancy.depositPence > 0 ? 'No scheme recorded yet' : 'No deposit taken'}</Text>
            {steps.map((step) => (
              <View key={step.id} style={{ gap: 4 }}>
                <StatusBadge status={step.status} label={COMPLIANCE_LABEL[step.status]} />
                <Text style={styles.body}>
                  {step.title}
                  {step.dueDate && step.status !== 'valid' ? ` (by ${step.dueDate})` : ''}
                </Text>
              </View>
            ))}
            {tenancy.depositPence > 0 ? (
              <>
                <TextInput style={styles.input} value={scheme[tenancy.id] ?? ''} onChangeText={(text: string) => setScheme((s) => ({ ...s, [tenancy.id]: text }))} placeholder="Scheme name, e.g. Deposit Protection Service" />
                <Button
                  title="Save scheme"
                  kind="secondary"
                  busy={save.busy}
                  onPress={async () => {
                    const name = (scheme[tenancy.id] ?? '').trim();
                    if (name && (await save.run(() => api.updateTenancy(tenancy.id, { depositScheme: name })))) await reload();
                  }}
                />
              </>
            ) : null}
          </View>
        );
      })}
      <Text style={styles.muted}>Mark the protection steps as done from the Compliance section once the scheme confirms them.</Text>
    </ScrollView>
  );
}
