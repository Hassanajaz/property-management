import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { formatPence, type LedgerDto, type TenancyDto } from '@lettly/core';
import { useSession } from '../../src/session';
import { colors, styles } from '../../src/ui';

interface Line {
  key: string;
  date: string;
  label: string;
  amountPence: number;
  kind: 'charge' | 'payment';
}

/** Rent statement for one tenancy: what was due, what was paid, and the balance. */
export default function RentStatement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [tenancy, setTenancy] = useState<TenancyDto | null>(null);
  const [ledger, setLedger] = useState<LedgerDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, statement] = await Promise.all([api.listTenancies(), api.getLedger(id)]);
      setTenancy(all.find((t) => t.id === id) ?? null);
      setLedger(statement);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines: Line[] = ledger
    ? [
        ...ledger.charges.map((c, n): Line => ({ key: `charge-${n}`, date: c.dueDate, label: c.proRata ? 'Rent due (part period)' : 'Rent due', amountPence: c.amountPence, kind: 'charge' })),
        ...ledger.payments.map((p): Line => ({ key: p.id, date: p.date, label: `Payment received${p.status === 'confirmed' ? '' : ` (${p.status})`}`, amountPence: p.amountPence, kind: 'payment' })),
      ].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind))
    : [];

  const balance = ledger?.summary.balancePence ?? 0;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {ledger ? (
        <>
          <View style={styles.card}>
            {tenancy ? (
              <>
                <Text style={styles.h2}>{tenancy.propertyAddress}</Text>
                <Text style={styles.muted}>
                  {tenancy.tenantNames.join(' and ')} · {formatPence(tenancy.rentAmountPence)} {tenancy.rentFrequency.replace('_', ' ')}
                </Text>
              </>
            ) : null}
            <Text style={styles.muted}>{balance > 0 ? 'Rent owed' : balance < 0 ? 'In credit' : 'Balance'}</Text>
            <Text style={[styles.h1, { color: balance > 0 ? colors.bad : colors.good }]}>{formatPence(Math.abs(balance))}</Text>
            {balance > 0 && ledger.summary.oldestUnpaidDueDate ? (
              <Text style={styles.body}>
                Oldest unpaid rent was due {ledger.summary.oldestUnpaidDueDate} ({ledger.summary.daysInArrears} days ago).
              </Text>
            ) : null}
            <Text style={styles.muted}>
              Charged {formatPence(ledger.summary.chargedPence)} · Paid {formatPence(ledger.summary.paidPence)}
            </Text>
          </View>

          <Text style={[styles.h2, { marginTop: 8 }]}>Statement</Text>
          <View style={styles.card}>
            {lines.map((line) => (
              <View key={line.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <View>
                  <Text style={styles.body}>{line.label}</Text>
                  <Text style={styles.muted}>{line.date}</Text>
                </View>
                <Text style={[styles.body, { color: line.kind === 'payment' ? colors.good : colors.ink }]}>
                  {line.kind === 'payment' ? '+' : ''}
                  {formatPence(line.amountPence)}
                </Text>
              </View>
            ))}
            {lines.length === 0 ? <Text style={styles.muted}>Nothing on this account yet.</Text> : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
