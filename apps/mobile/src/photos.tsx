import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { DocumentType } from '@lettly/core';
import { isWeb } from './platform';
import { useSession } from './session';
import { Button, colors, styles } from './ui';

/**
 * Buttons to take or choose a photo. The photo is stored against the property
 * or tenancy, and `onAdded` is given the id of the stored photo.
 */
export function AddPhoto({ type, propertyId, tenancyId, onAdded, label = 'photo' }: { type: DocumentType; propertyId?: string; tenancyId?: string; onAdded: (documentId: string) => Promise<unknown> | void; label?: string }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(source: 'camera' | 'library') {
    setError(null);
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access in Settings to add photos.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setBusy(true);
    try {
      const contentType = asset.mimeType ?? 'image/jpeg';
      const ticket = await api.requestUpload({ fileName: asset.fileName ?? `${type}-${Date.now()}.jpg`, contentType, type, propertyId, tenancyId });
      // Demo mode has no file storage and returns no upload link.
      if (ticket.uploadUrl) {
        const file = await (await fetch(asset.uri)).blob();
        const upload = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
        if (!upload.ok) throw new Error('The photo could not be uploaded. Please try again.');
      }
      await onAdded(ticket.documentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be added');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        {isWeb ? null : (
          <View style={{ flex: 1 }}>
            <Button title={`Take ${label}`} kind="secondary" busy={busy} onPress={() => add('camera')} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button title={`Choose ${label}`} kind="secondary" busy={busy} onPress={() => add('library')} />
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** Small pictures of stored photos. Tap one to open it full size. */
export function Photos({ documentIds }: { documentIds: readonly string[] | undefined }) {
  const { api, demo } = useSession();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ids = documentIds ?? [];
  const key = ids.join(',');

  useEffect(() => {
    let current = true;
    if (demo) return;
    for (const id of key ? key.split(',') : []) {
      api
        .downloadUrl(id)
        .then(({ url }) => current && setUrls((known) => ({ ...known, [id]: url })))
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [api, demo, key]);

  if (ids.length === 0) return null;
  if (demo) return <Text style={styles.muted}>{ids.length} photo{ids.length === 1 ? '' : 's'} attached. Photos are not stored in demo mode.</Text>;
  return (
    <View style={styles.row}>
      {ids.map((id) =>
        urls[id] ? (
          <Pressable key={id} accessibilityRole="imagebutton" accessibilityLabel="Open photo" onPress={() => void Linking.openURL(urls[id]!)}>
            <Image source={{ uri: urls[id] }} style={{ width: 84, height: 84, borderRadius: 8, backgroundColor: colors.line }} />
          </Pressable>
        ) : (
          <View key={id} style={{ width: 84, height: 84, borderRadius: 8, backgroundColor: colors.line }} />
        ),
      )}
    </View>
  );
}
