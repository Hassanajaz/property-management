import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

/** Loads data when the screen comes into view, with reload, loading and error state. */
export function useLoad<T>(loader: () => Promise<T>) {
  const latest = useRef(loader);
  latest.current = loader;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await latest.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, loading, error, reload };
}

/** Runs an action with busy and error state, for buttons that save something. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}

/** Reads an amount typed in pounds ("1,250.50") as whole pence, or null if it is not a valid amount. */
export function poundsToPence(text: string): number | null {
  const cleaned = text.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
