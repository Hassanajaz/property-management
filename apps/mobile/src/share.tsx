import { useState } from 'react';
import { Text, View } from 'react-native';
import { sharePdf, shareText } from './platform';
import { Button, styles } from './ui';

/**
 * The two ways to send a report or document: as a PDF file, or as plain text
 * to paste into a message. `text` can be a function so the wording is only
 * put together when a button is pressed.
 */
export function ShareButtons({ title, text, label }: { title: string; text: string | (() => string | null); label?: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(send: (title: string, text: string) => Promise<string | null>, pdf: boolean) {
    const wording = typeof text === 'function' ? text() : text;
    if (!wording) return;
    if (pdf) setBusy(true);
    try {
      setNote(await send(title, wording));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Button title={`${label ?? 'Share'} as PDF`} busy={busy} onPress={() => go(sharePdf, true)} />
      <Button title={`${label ?? 'Share'} as text`} kind="secondary" onPress={() => go(shareText, false)} />
      {note ? <Text style={styles.muted}>{note}</Text> : null}
    </View>
  );
}
