import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { METER_KINDS, METER_LABEL, METER_OCCASION_LABEL, isLandlord, latestReadings, meterReport, today, type MeterKind, type MeterOccasion } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { AddPhoto, Photos } from '../../src/photos';
import { ShareButtons } from '../../src/share';
import { useSession } from '../../src/session';
import { Button, Chip, styles } from '../../src/ui';

const OCCASIONS = Object.keys(METER_OCCASION_LABEL) as MeterOccasion[];

/**
 * Gas, electricity and water readings for each home, with a photo of the
 * meter as proof. The landlord records them at move-in and move-out; a tenant
 * can send one for their own home at any time.
 */
export default function Meters() {
  const { api, identity } = useSession();
  const landlord = identity ? isLandlord(identity.role) : false;
  const { data, loading, error, reload } = useLoad(async () => {
    const [readings, properties] = await Promise.all([api.listMeterReadings(), api.listProperties()]);
    return { readings, properties };
  });
  const save = useAction();
  const [chosen, setChosen] = useState<string | null>(null);
  const [meter, setMeter] = useState<MeterKind>('gas');
  const [occasion, setOccasion] = useState<MeterOccasion>('routine');
  const [reading, setReading] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const properties = data?.properties ?? [];
  const propertyId = chosen ?? (properties.length === 1 ? properties[0]!.id : null);
  const property = properties.find((p) => p.id === propertyId);
  const own = (data?.readings ?? []).filter((r) => r.propertyId === propertyId);
  const meters = property && !property.hasGas ? METER_KINDS.filter((kind) => kind !== 'gas') : METER_KINDS;

  async function add() {
    const value = Number(reading.replace(/[,\s]/g, ''));
    if (!propertyId || reading.trim() === '' || !Number.isFinite(value) || value < 0) {
      setFormError('Choose the home and enter the reading as a number.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.addMeterReading({ propertyId, meter, reading: value, date: today(), occasion: landlord ? occasion : 'routine', photoDocumentId: photoId }))) {
      setReading('');
      setPhotoId(null);
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}

      {properties.length > 1 ? (
        <>
          <Text style={styles.label}>Which home?</Text>
          <View style={styles.row}>
            {properties.map((p) => (
              <Chip key={p.id} label={p.addressLine1} selected={propertyId === p.id} onPress={() => setChosen(p.id)} />
            ))}
          </View>
        </>
      ) : null}

      {property ? (
        <>
          <View style={styles.card}>
            <Text style={styles.h2}>{property.addressLine1}</Text>
            {latestReadings(own, property.id).map(({ meter: kind, latest, usedSincePrevious }) => (
              <Text key={kind} style={styles.body}>
                {METER_LABEL[kind]}: {latest.reading.toLocaleString('en-GB')} on {latest.date}
                {usedSincePrevious !== null ? ` (${usedSincePrevious.toLocaleString('en-GB')} used since the reading before)` : ''}
              </Text>
            ))}
            {own.length === 0 ? <Text style={styles.muted}>No readings yet.</Text> : <ShareButtons title="Meter readings" label="Share the readings" text={() => meterReport(`${property.addressLine1}, ${property.town} ${property.postcode}`, own)} />}
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>{landlord ? 'Record a reading' : 'Send a reading'}</Text>
            <Text style={styles.label}>Meter</Text>
            <View style={styles.row}>
              {meters.map((kind) => (
                <Chip key={kind} label={METER_LABEL[kind]} selected={meter === kind} onPress={() => setMeter(kind)} />
              ))}
            </View>
            {landlord ? (
              <>
                <Text style={styles.label}>Occasion</Text>
                <View style={styles.row}>
                  {OCCASIONS.map((o) => (
                    <Chip key={o} label={METER_OCCASION_LABEL[o]} selected={occasion === o} onPress={() => setOccasion(o)} />
                  ))}
                </View>
              </>
            ) : null}
            <Text style={styles.label}>Reading (the numbers before the decimal point)</Text>
            <TextInput style={styles.input} value={reading} onChangeText={setReading} keyboardType="number-pad" placeholder="e.g. 04821" />
            <Text style={styles.label}>Photo of the meter</Text>
            {photoId ? <Text style={styles.body}>Photo attached.</Text> : <AddPhoto type="meter_photo" propertyId={property.id} onAdded={(documentId) => setPhotoId(documentId)} />}
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <Button title="Save reading, dated today" onPress={add} busy={save.busy} />
          </View>

          <Text style={[styles.h2, { marginTop: 8 }]}>All readings</Text>
          {own.map((r) => (
            <View key={r.id} style={styles.card}>
              <Text style={styles.h2}>
                {METER_LABEL[r.meter]}: {r.reading.toLocaleString('en-GB')}
              </Text>
              <Text style={styles.muted}>
                {r.date} · {METER_OCCASION_LABEL[r.occasion]} · recorded by the {r.recordedBy}
              </Text>
              <Photos documentIds={r.photoDocumentId ? [r.photoDocumentId] : []} />
            </View>
          ))}
        </>
      ) : data && properties.length === 0 ? (
        <Text style={styles.muted}>{landlord ? 'Add a property first.' : 'There is no home linked to your sign-in yet.'}</Text>
      ) : null}
    </ScrollView>
  );
}
