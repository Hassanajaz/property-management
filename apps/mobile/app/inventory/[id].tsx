import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { CONDITIONS, CONDITION_LABEL, inventoryChanges, inventoryReport, isLandlord, type Condition } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { AddPhoto, Photos } from '../../src/photos';
import { ShareButtons } from '../../src/share';
import { useSession } from '../../src/session';
import { Button, Chip, colors, styles } from '../../src/ui';

/** Inventory for a tenancy: condition of each item at check-in and check-out, and what got worse. */
export default function Inventory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, identity } = useSession();
  const landlord = identity ? isLandlord(identity.role) : false;
  const { data, loading, error, reload } = useLoad(() => api.getInventory(id));
  const save = useAction();
  const [room, setRoom] = useState('');
  const [item, setItem] = useState('');
  const [condition, setCondition] = useState<Condition>('good');
  const [itemNote, setItemNote] = useState('');
  const [checkOutNotes, setCheckOutNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const rooms = [...new Set((data?.items ?? []).map((i) => i.room))];
  const worse = data ? inventoryChanges(data.items) : [];

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}

      {data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.h2}>{data.propertyAddress}</Text>
            <Text style={styles.muted}>{data.tenantNames.join(' and ')}</Text>
            <Text style={[styles.body, { color: worse.length > 0 ? colors.warn : colors.ink }]}>
              {data.items.length} items · {worse.length} in worse condition at check-out
            </Text>
            <ShareButtons title="Inventory report" label="Share the full report" text={() => inventoryReport(data)} />
          </View>

          {rooms.map((name) => (
            <View key={name} style={{ gap: 12 }}>
              <Text style={[styles.h2, { marginTop: 8 }]}>{name}</Text>
              {data.items
                .filter((i) => i.room === name)
                .map((entry) => (
                  <View key={entry.id} style={styles.card}>
                    <Text style={styles.h2}>{entry.item}</Text>
                    <Text style={styles.body}>
                      Check-in: {CONDITION_LABEL[entry.checkIn]}
                      {entry.checkInNote ? ` · ${entry.checkInNote}` : ''}
                    </Text>
                    {entry.checkOut ? (
                      <Text style={[styles.body, { color: worse.includes(entry) ? colors.warn : colors.good }]}>
                        Check-out: {CONDITION_LABEL[entry.checkOut]}
                        {entry.checkOutNote ? ` · ${entry.checkOutNote}` : ''}
                      </Text>
                    ) : null}
                    <Photos documentIds={entry.photoDocumentIds} />
                    {landlord ? (
                      <>
                        <AddPhoto type="inventory_photo" tenancyId={id} onAdded={async (documentId) => (await save.run(() => api.addInventoryPhoto(id, entry.id, documentId))) && reload()} />
                        <Text style={styles.label}>{entry.checkOut ? 'Change check-out condition' : 'Record condition at check-out'}</Text>
                        <TextInput
                          style={styles.input}
                          value={checkOutNotes[entry.id] ?? ''}
                          onChangeText={(text: string) => setCheckOutNotes((n) => ({ ...n, [entry.id]: text }))}
                          placeholder="Note (optional), then choose a condition"
                        />
                        <View style={styles.row}>
                          {CONDITIONS.map((c) => (
                            <Chip
                              key={c}
                              label={CONDITION_LABEL[c]}
                              selected={entry.checkOut === c}
                              onPress={async () => (await save.run(() => api.recordCheckOut(id, entry.id, { condition: c, note: checkOutNotes[entry.id] }))) && reload()}
                            />
                          ))}
                        </View>
                      </>
                    ) : null}
                  </View>
                ))}
            </View>
          ))}
          {data.items.length === 0 ? <Text style={styles.muted}>Nothing recorded yet.</Text> : null}

          {landlord ? (
            <View style={styles.card}>
              <Text style={styles.h2}>Add an item at check-in</Text>
              <Text style={styles.label}>Room</Text>
              <TextInput style={styles.input} value={room} onChangeText={setRoom} placeholder="e.g. Kitchen" />
              <Text style={styles.label}>Item</Text>
              <TextInput style={styles.input} value={item} onChangeText={setItem} placeholder="e.g. Oven and hob" />
              <Text style={styles.label}>Condition</Text>
              <View style={styles.row}>
                {CONDITIONS.map((c) => (
                  <Chip key={c} label={CONDITION_LABEL[c]} selected={condition === c} onPress={() => setCondition(c)} />
                ))}
              </View>
              <Text style={styles.label}>Note</Text>
              <TextInput style={styles.input} value={itemNote} onChangeText={setItemNote} />
              <Button
                title="Add item"
                busy={save.busy}
                onPress={async () => {
                  if (await save.run(() => api.addInventoryItem(id, { room, item, condition, note: itemNote }))) {
                    setItem('');
                    setItemNote('');
                    await reload();
                  }
                }}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
