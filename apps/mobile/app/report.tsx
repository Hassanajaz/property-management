import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, TextInput, View } from 'react-native';
import { isLandlord, type MaintenanceCategory, type MaintenanceUrgency, type TenancyDto } from '@lettly/core';
import { useSession } from '../src/session';
import { Button, Chip, styles } from '../src/ui';

const CATEGORIES: { value: MaintenanceCategory; label: string }[] = [
  { value: 'plumbing', label: 'Plumbing or leak' },
  { value: 'heating', label: 'Heating or hot water' },
  { value: 'electrical', label: 'Electrics' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'damp_mould', label: 'Damp or mould' },
  { value: 'security', label: 'Doors, locks, windows' },
  { value: 'structural', label: 'Walls, roof, floors' },
  { value: 'pest', label: 'Pests' },
  { value: 'garden_exterior', label: 'Outside' },
  { value: 'other', label: 'Something else' },
];

const URGENCIES: { value: MaintenanceUrgency; label: string; hint: string }[] = [
  { value: 'emergency', label: 'Emergency', hint: 'Danger to people or serious damage: no heating in winter, major leak, exposed wiring, home not secure.' },
  { value: 'urgent', label: 'Urgent', hint: 'Needs fixing in the next few days.' },
  { value: 'routine', label: 'Routine', hint: 'Can wait for a normal appointment.' },
];

interface Photo {
  uri: string;
  mimeType: string;
  fileName: string;
}

export default function ReportRepair() {
  const { api, identity } = useSession();
  const landlord = identity ? isLandlord(identity.role) : false;
  const [tenancies, setTenancies] = useState<TenancyDto[]>([]);
  const [tenancyId, setTenancyId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('plumbing');
  const [urgency, setUrgency] = useState<MaintenanceUrgency>('routine');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The landlord logs a repair against one of their tenancies; a tenant's goes to their own home.
  useEffect(() => {
    if (!landlord) return;
    api
      .listTenancies()
      .then((all) => setTenancies(all.filter((t) => t.status === 'active')))
      .catch(() => setTenancies([]));
  }, [api, landlord]);

  async function addPhoto(source: 'camera' | 'library') {
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access in Settings to attach photos.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset) {
      setPhotos((current) => [...current, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', fileName: asset.fileName ?? `photo-${Date.now()}.jpg` }].slice(0, 10));
    }
  }

  async function submit() {
    if (title.trim().length < 3 || description.trim().length === 0) {
      setError('Add a short title and describe the problem.');
      return;
    }
    if (landlord && !tenancyId) {
      setError('Choose which home this repair is for.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Photos go straight from the phone to storage using a short-lived link.
      const photoDocumentIds: string[] = [];
      for (const photo of photos) {
        const ticket = await api.requestUpload({ fileName: photo.fileName, contentType: photo.mimeType, type: 'maintenance_photo', tenancyId });
        // Demo mode has no file storage and returns no upload link.
        if (ticket.uploadUrl) {
          const file = await (await fetch(photo.uri)).blob();
          const upload = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': photo.mimeType }, body: file });
          if (!upload.ok) throw new Error('A photo could not be uploaded. Please try again.');
        }
        photoDocumentIds.push(ticket.documentId);
      }
      const created = await api.reportMaintenance({ tenancyId, title: title.trim(), description: description.trim(), category, urgency, photoDocumentIds });
      router.replace(`/repair/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {urgency === 'emergency' ? (
        <View style={styles.card}>
          <Text style={styles.body}>If you smell gas, leave the property and call the gas emergency line: 0800 111 999 in England, Wales and Scotland, or 0800 002 001 in Northern Ireland. If anyone is in danger, call 999.</Text>
        </View>
      ) : null}

      {landlord ? (
        <>
          <Text style={styles.label}>Which home?</Text>
          <View style={styles.row}>
            {tenancies.map((t) => (
              <Chip key={t.id} label={t.propertyAddress.split(',')[0] ?? t.propertyAddress} selected={tenancyId === t.id} onPress={() => setTenancyId(t.id)} />
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.label}>What is the problem?</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Boiler not heating" maxLength={120} />

      <Text style={styles.label}>Type</Text>
      <View style={styles.row}>
        {CATEGORIES.map((c) => (
          <Chip key={c.value} label={c.label} selected={category === c.value} onPress={() => setCategory(c.value)} />
        ))}
      </View>

      <Text style={styles.label}>How urgent is it?</Text>
      <View style={styles.row}>
        {URGENCIES.map((u) => (
          <Chip key={u.value} label={u.label} selected={urgency === u.value} onPress={() => setUrgency(u.value)} />
        ))}
      </View>
      <Text style={styles.muted}>{URGENCIES.find((u) => u.value === urgency)?.hint}</Text>

      <Text style={styles.label}>Details</Text>
      <TextInput
        style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Where is it, when did it start, and when can someone visit?"
        multiline
        maxLength={4000}
      />

      <Text style={styles.label}>Photos ({photos.length}/10)</Text>
      <View style={styles.row}>
        {photos.map((photo) => (
          <Image key={photo.uri} source={{ uri: photo.uri }} style={{ width: 72, height: 72, borderRadius: 8 }} accessibilityLabel="Attached photo" />
        ))}
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button title="Take photo" kind="secondary" onPress={() => addPhoto('camera')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Choose photo" kind="secondary" onPress={() => addPhoto('library')} />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Send report" onPress={submit} busy={busy} />
    </ScrollView>
  );
}
