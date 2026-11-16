import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { advertText, formatPence, today, type PropertyDto, type ViewingOutcome } from '@lettly/core';
import { poundsToPence, useAction, useLoad } from '../../src/hooks';
import { shareText } from '../../src/platform';
import { useSession } from '../../src/session';
import { Button, Chip, StatusBadge, styles } from '../../src/ui';

const OUTCOME_LABEL: Record<ViewingOutcome, string> = { booked: 'Booked', attended: 'Attended', no_show: 'Did not attend', cancelled: 'Cancelled' };
const OUTCOME_TONE = { booked: 'scheduled', attended: 'valid', no_show: 'overdue', cancelled: 'cancelled' } as const;

/** Adverts for vacant properties and the viewings booked for them. */
export default function Lettings() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [properties, tenancies, viewings] = await Promise.all([api.listProperties(), api.listTenancies(), api.listViewings()]);
    const letIds = new Set(tenancies.filter((t) => t.status === 'active').map((t) => t.propertyId));
    return { vacant: properties.filter((p) => !letIds.has(p.id)), viewings };
  });
  const save = useAction();
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function book() {
    if (!propertyId || !name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      setFormError('Choose the property, and enter a name, a date as YYYY-MM-DD and a time as HH:MM.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.addViewing({ propertyId, name: name.trim(), contact: contact.trim() || null, at: `${date}T${time}` }))) {
      setName('');
      setContact('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}

      <Text style={styles.h2}>Vacant properties</Text>
      {data && data.vacant.length === 0 ? <Text style={styles.muted}>Every property is let.</Text> : null}
      {(data?.vacant ?? []).map((property) => <AdvertCard key={property.id} property={property} onSaved={reload} />)}

      <Text style={[styles.h2, { marginTop: 8 }]}>Viewings</Text>
      {(data?.viewings ?? []).map((viewing) => (
        <View key={viewing.id} style={styles.card}>
          <StatusBadge status={OUTCOME_TONE[viewing.outcome]} label={OUTCOME_LABEL[viewing.outcome]} />
          <Text style={styles.h2}>{viewing.name}</Text>
          <Text style={styles.body}>
            {viewing.at.replace('T', ' at ')} · {viewing.propertyAddress}
          </Text>
          {viewing.contact ? <Text style={styles.muted}>{viewing.contact}</Text> : null}
          {viewing.notes ? <Text style={styles.muted}>{viewing.notes}</Text> : null}
          {viewing.outcome === 'booked' ? (
            <View style={styles.row}>
              {(['attended', 'no_show', 'cancelled'] as const).map((outcome) => (
                <Chip key={outcome} label={OUTCOME_LABEL[outcome]} selected={false} onPress={async () => (await save.run(() => api.updateViewing(viewing.id, { outcome }))) && reload()} />
              ))}
            </View>
          ) : null}
        </View>
      ))}
      {data && data.viewings.length === 0 ? <Text style={styles.muted}>No viewings yet.</Text> : null}

      <View style={styles.card}>
        <Text style={styles.h2}>Book a viewing</Text>
        <View style={styles.row}>
          {(data?.vacant ?? []).map((p) => (
            <Chip key={p.id} label={p.addressLine1} selected={propertyId === p.id} onPress={() => setPropertyId(p.id)} />
          ))}
        </View>
        <Text style={styles.label}>Who is viewing?</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Text style={styles.label}>Phone or email</Text>
        <TextInput style={styles.input} value={contact} onChangeText={setContact} autoCapitalize="none" />
        <Text style={styles.label}>Date (YYYY-MM-DD) and time (HH:MM)</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} value={date} onChangeText={setDate} placeholder={today()} autoCapitalize="none" />
          <TextInput style={[styles.input, { flex: 1 }]} value={time} onChangeText={setTime} placeholder="17:30" />
        </View>
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Button title="Book viewing" onPress={book} busy={save.busy} />
      </View>
    </ScrollView>
  );
}

function AdvertCard({ property, onSaved }: { property: PropertyDto; onSaved: () => void }) {
  const { api } = useSession();
  const save = useAction();
  const advert = property.advert ?? null;
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(advert?.headline ?? '');
  const [description, setDescription] = useState(advert?.description ?? '');
  const [rent, setRent] = useState(advert ? String(advert.rentPence / 100) : '');
  const [availableFrom, setAvailableFrom] = useState(advert?.availableFrom ?? today());
  const [note, setNote] = useState<string | null>(null);

  async function submit() {
    const rentPence = poundsToPence(rent);
    if (!headline.trim() || !rentPence || !/^\d{4}-\d{2}-\d{2}$/.test(availableFrom)) {
      setNote('Enter a headline, the monthly rent in pounds and the date it is available.');
      return;
    }
    setNote(null);
    if (await save.run(() => api.saveAdvert(property.id, { headline: headline.trim(), description: description.trim(), rentPence, availableFrom }))) {
      setEditing(false);
      onSaved();
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>{property.addressLine1}</Text>
      {advert && !editing ? (
        <>
          <Text style={styles.body}>{advert.headline}</Text>
          <Text style={styles.muted}>
            {formatPence(advert.rentPence)} a month · available {advert.availableFrom}
          </Text>
          <Button title="Share the advert wording" onPress={async () => setNote(await shareText('Property to let', advertText(property, advert)))} />
        </>
      ) : null}
      {!advert && !editing ? <Text style={styles.muted}>No advert written yet.</Text> : null}
      {editing ? (
        <>
          <Text style={styles.label}>Headline</Text>
          <TextInput style={styles.input} value={headline} onChangeText={setHeadline} maxLength={100} />
          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} multiline maxLength={2000} />
          <Text style={styles.label}>Monthly rent in pounds</Text>
          <TextInput style={styles.input} value={rent} onChangeText={setRent} keyboardType="decimal-pad" />
          <Text style={styles.label}>Available from (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={availableFrom} onChangeText={setAvailableFrom} autoCapitalize="none" />
          <Button title="Save advert" onPress={submit} busy={save.busy} />
        </>
      ) : (
        <Button title={advert ? 'Edit advert' : 'Write an advert'} kind="secondary" onPress={() => setEditing(true)} />
      )}
      {note ?? save.error ? <Text style={styles.muted}>{note ?? save.error}</Text> : null}
    </View>
  );
}
