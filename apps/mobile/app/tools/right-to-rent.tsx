import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { rightToRentState, today, type RightToRentDto } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, Chip, StatusBadge, styles } from '../../src/ui';

const STATE_LABEL = { valid: 'Check valid', follow_up_due: 'Follow-up check due', expired: 'Permission expired: check again' } as const;
const STATE_TONE = { valid: 'valid', follow_up_due: 'due_soon', expired: 'overdue' } as const;

/** Right to Rent checks (England): who was checked, how, and when a follow-up is due. */
export default function RightToRent() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [checks, tenancies, properties] = await Promise.all([api.listRightToRent(), api.listTenancies(), api.listProperties()]);
    const english = new Set(properties.filter((p) => p.nation === 'england').map((p) => p.id));
    return { checks, tenancies: tenancies.filter((t) => t.status === 'active' && english.has(t.propertyId)) };
  });
  const save = useAction();
  const [tenancyId, setTenancyId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState('');
  const [method, setMethod] = useState<RightToRentDto['method']>('documents');
  const [expiresOn, setExpiresOn] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const now = today();

  const tenancy = data?.tenancies.find((t) => t.id === tenancyId);
  const unchecked = (data?.tenancies ?? []).flatMap((t) => t.tenantNames.filter((name) => !data!.checks.some((c) => c.tenancyId === t.id && c.tenantName === name)).map((name) => `${name} (${t.propertyAddress.split(',')[0]})`));

  async function record() {
    if (!tenancyId || !tenantName.trim()) {
      setFormError('Choose the tenancy and the tenant.');
      return;
    }
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      setFormError('Enter the expiry as YYYY-MM-DD, or leave it empty.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.recordRightToRent({ tenancyId, tenantName: tenantName.trim(), method, checkedOn: now, expiresOn: expiresOn || null }))) {
      setTenantName('');
      setExpiresOn('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>
        Every adult living in a rented home in England must be checked before the tenancy starts. Keep a dated copy of what you saw, and delete it one year after the tenancy ends.
      </Text>
      {unchecked.length > 0 ? <Text style={styles.error}>No check recorded for: {unchecked.join(', ')}</Text> : null}

      {(data?.checks ?? []).map((check) => {
        const state = rightToRentState(check, now);
        return (
          <View key={check.id} style={styles.card}>
            <StatusBadge status={STATE_TONE[state]} label={STATE_LABEL[state]} />
            <Text style={styles.h2}>{check.tenantName}</Text>
            <Text style={styles.muted}>{check.propertyAddress}</Text>
            <Text style={styles.body}>
              Checked {check.checkedOn} using {check.method === 'share_code' ? 'a Home Office share code' : 'original documents'}
            </Text>
            <Text style={styles.muted}>{check.expiresOn ? `Permission runs to ${check.expiresOn}. Do a follow-up check before then.` : 'No time limit: no follow-up needed.'}</Text>
          </View>
        );
      })}

      <View style={styles.card}>
        <Text style={styles.h2}>Record a check done today</Text>
        <Text style={styles.label}>Tenancy</Text>
        <View style={styles.row}>
          {(data?.tenancies ?? []).map((t) => (
            <Chip key={t.id} label={t.propertyAddress.split(',')[0] ?? t.propertyAddress} selected={tenancyId === t.id} onPress={() => { setTenancyId(t.id); setTenantName(''); }} />
          ))}
        </View>
        {tenancy ? (
          <>
            <Text style={styles.label}>Tenant</Text>
            <View style={styles.row}>
              {tenancy.tenantNames.map((name) => (
                <Chip key={name} label={name} selected={tenantName === name} onPress={() => setTenantName(name)} />
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.label}>How was it checked?</Text>
        <View style={styles.row}>
          <Chip label="Original documents" selected={method === 'documents'} onPress={() => setMethod('documents')} />
          <Chip label="Home Office share code" selected={method === 'share_code'} onPress={() => setMethod('share_code')} />
        </View>
        <Text style={styles.label}>Permission expires (YYYY-MM-DD), if time-limited</Text>
        <TextInput style={styles.input} value={expiresOn} onChangeText={setExpiresOn} placeholder="Leave empty if there is no time limit" autoCapitalize="none" />
        {formError ?? save.error ? <Text style={styles.error}>{formError ?? save.error}</Text> : null}
        <Button title="Record check" onPress={record} busy={save.busy} />
      </View>
    </ScrollView>
  );
}
