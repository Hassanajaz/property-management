import * as Print from 'expo-print';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import { textToHtml } from '@lettly/core';

/**
 * Small differences between the phone app and the browser version live here,
 * so every screen can stay the same on both.
 */
export const isWeb = Platform.OS === 'web';

/**
 * Shares text using the phone's share sheet. In a browser it uses the
 * browser's share dialog where there is one, and otherwise copies the text
 * to the clipboard. Returns a short note to show the user, or null.
 */
export async function shareText(title: string, text: string): Promise<string | null> {
  if (!isWeb) {
    await Share.share({ title, message: text });
    return null;
  }
  const browser = globalThis as { navigator?: { share?: (data: { title: string; text: string }) => Promise<void>; clipboard?: { writeText: (t: string) => Promise<void> } } };
  try {
    if (browser.navigator?.share) {
      await browser.navigator.share({ title, text });
      return null;
    }
    if (browser.navigator?.clipboard) {
      await browser.navigator.clipboard.writeText(text);
      return 'Copied to the clipboard. Paste it into an email or message.';
    }
  } catch {
    // The person closed the share dialog, or the browser refused: nothing to do.
    return null;
  }
  return 'Sharing is not available in this browser.';
}

/**
 * Makes a PDF of a report or document and hands it over. On the phone it opens
 * the share sheet with the PDF file (save to Files, email, AirDrop, print).
 * In a browser it opens the print dialog, where "Save as PDF" makes the file.
 * Returns a short note to show the user, or null.
 */
export async function sharePdf(title: string, text: string): Promise<string | null> {
  const html = textToHtml(title, text);
  try {
    if (!isWeb) {
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
        return null;
      }
      await Print.printAsync({ uri });
      return null;
    }
    const browser = globalThis as { open?: (url: string, target: string) => { document: { write: (h: string) => void; close: () => void }; focus: () => void; print: () => void } | null };
    const page = browser.open?.('', '_blank');
    if (!page) return 'Your browser blocked the new window. Allow pop-ups for this page and try again.';
    page.document.write(html);
    page.document.close();
    page.focus();
    page.print();
    return 'In the print window, choose "Save as PDF" to keep a copy.';
  } catch {
    return 'The PDF could not be made. Try again, or share it as text instead.';
  }
}

/**
 * Where the sign-in session is kept: the phone's secure storage, or the
 * browser's own storage on the web. Failures are ignored; the person simply
 * signs in again next time.
 */
export const sessionStore = {
  async get(key: string): Promise<string | null> {
    try {
      if (isWeb) return (globalThis as { localStorage?: { getItem: (k: string) => string | null } }).localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (isWeb) (globalThis as { localStorage?: { setItem: (k: string, v: string) => void } }).localStorage?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      /* ignore */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (isWeb) (globalThis as { localStorage?: { removeItem: (k: string) => void } }).localStorage?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  },
};
