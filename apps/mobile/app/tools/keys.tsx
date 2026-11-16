import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, Chip, StatusBadge, styles } from '../../src/ui';

/** Key register: where every key is, with each handover and return logged. */
export default function Keys() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [keys, properties] = await Promise.all([api.listKeys(), api.listProperties()]);
    return { keys, properties };
  });
  const save = useAction();
  const [person, setPerson] = useState<Record<string, string>>({});
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const out = (data?.keys ?? []).filter((k) => k.holder !== null).length;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      {data ? <Text style={styles.muted}>{out} of {data.keys.length} keys are out.</Text> : null}

      {(data?.keys ?? []).map((key) => (
        <View key={key.id} style={styles.card}>
          <StatusBadge status={key.holder ? 'due_soon' : 'valid'} label={key.holder ? `Out with ${key.holder}` : 'With you'} />
          <Text style={styles.h2}>{key.label}</Text>
          <Text style={styles.muted}>{key.propertyAddress}</Text>
          {key.holder ? (
            <Button title="Mark as returned" kind="secondary" busy={save.busy} onPress={async () => (await save.run(() => api.moveKey(key.id, { action: 'returned', person: '' }))) && reload()} />
          ) : (
            <>
              <TextInput style={styles.input} value={person[key.id] ?? ''} onChangeText={(text: string) => setPerson((p) => ({ ...p, [key.id]: text }))} placeholder="Who is taking it?" />
              <Button title="Hand out" kind="secondary" busy={save.busy} onPress={async () => (await save.run(() => api.moveKey(key.id, { action: 'issued', person: person[key.id] ?? '' }))) && reload()} />
            </>
          )}
          {key.movements.length > 0 ? <Text style={styles.label}>History</Text> : null}
          {[...key.movements].reverse().map((m, n) => (
            <Text key={n} style={styles.muted}>
              {m.date}: {m.action === 'issued' ? 'handed to' : 'returned by'} {m.person}
            </Text>
          ))}
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.h2}>Add a key</Text>
        <Text style={styles.label}>Property</Text>
        <View style={styles.row}>
          {(data?.properties ?? []).map((p) => (
            <Chip key={p.id} label={p.addressLine1} selected={propertyId === p.id} onPress={() => setPropertyId(p.id)} />
          ))}
        </View>
        <Text style={styles.label}>Description</Text>
        <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="e.g. Back door, spare" />
        <Button
          title="Add key"
          busy={save.busy}
          onPress={async () => {
            if (!propertyId || !label.trim()) return;
            if (await save.run(() => api.addKey({ propertyId, label: label.trim() }))) {
              setLabel('');
              await reload();
            }
          }}
        />
      </View>
    </ScrollView>
  );
}
