import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { today } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, colors, styles } from '../../src/ui';

/** Contractors the landlord uses, with their registrations and insurance expiry. */
export default function Contractors() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(() => api.listContractors());
  const save = useAction();
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [phone, setPhone] = useState('');
  const [gasSafeNumber, setGasSafeNumber] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function add() {
    if (!name.trim() || !trade.trim()) {
      setFormError('Enter a name and trade.');
      return;
    }
    if (insuranceExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(insuranceExpiry)) {
      setFormError('Enter the insurance expiry as YYYY-MM-DD.');
      return;
    }
    setFormError(null);
    const ok = await save.run(() =>
      api.addContractor({ name: name.trim(), trade: trade.trim(), phone: phone.trim() || null, gasSafeNumber: gasSafeNumber.trim() || null, electricalScheme: null, insuranceExpiry: insuranceExpiry || null, rating: null }),
    );
    if (ok) {
      setName('');
      setTrade('');
      setPhone('');
      setGasSafeNumber('');
      setInsuranceExpiry('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>Assign a contractor to a repair from the repair's own screen.</Text>

      {(data ?? []).map((c) => {
        const expired = c.insuranceExpiry !== null && c.insuranceExpiry < today();
        return (
          <View key={c.id} style={styles.card}>
            <Text style={styles.h2}>{c.name}</Text>
            <Text style={styles.body}>
              {c.trade}
              {c.rating ? ` · rated ${c.rating} out of 5` : ''}
            </Text>
            {c.phone ? <Text style={styles.muted}>{c.phone}</Text> : null}
            {c.gasSafeNumber ? <Text style={styles.muted}>Gas Safe number {c.gasSafeNumber}</Text> : null}
            {c.electricalScheme ? <Text style={styles.muted}>Electrical scheme: {c.electricalScheme}</Text> : null}
            <Text style={[styles.muted, { color: expired ? colors.bad : colors.muted }]}>
              {c.insuranceExpiry ? (expired ? `Insurance expired ${c.insuranceExpiry}. Ask for a new certificate before using them.` : `Insurance valid to ${c.insuranceExpiry}`) : 'No insurance date recorded'}
            </Text>
          </View>
        );
      })}

      <View style={styles.card}>
        <Text style={styles.h2}>Add a contractor</Text>
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Text style={styles.label}>Trade</Text>
        <TextInput style={styles.input} value={trade} onChangeText={setTrade} placeholder="e.g. Plumber" />
        <Text style={styles.label}>Phone</Text>
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Text style={styles.label}>Gas Safe number (if any)</Text>
        <TextInput style={styles.input} value={gasSafeNumber} onChangeText={setGasSafeNumber} keyboardType="number-pad" />
        <Text style={styles.label}>Insurance expiry (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={insuranceExpiry} onChangeText={setInsuranceExpiry} placeholder="2027-06-30" autoCapitalize="none" />
        {formError ?? save.error ? <Text style={styles.error}>{formError ?? save.error}</Text> : null}
        <Button title="Add contractor" onPress={add} busy={save.busy} />
      </View>
    </ScrollView>
  );
}
