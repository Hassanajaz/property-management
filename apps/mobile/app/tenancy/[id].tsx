import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { arrearsMessage, formatPence, isLandlord, paymentRate, receiptText, rentReview, today } from '@lettly/core';
import { poundsToPence, useAction, useLoad } from '../../src/hooks';
import { shareText } from '../../src/platform';
import { useSession } from '../../src/session';
import { Button, Chip, colors, styles } from '../../src/ui';

interface Line {
  key: string;
  date: string;
  label: string;
  amountPence: number;
  kind: 'charge' | 'payment';
  method?: string;
}

const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'benefit', label: 'Housing benefit' },
  { value: 'other', label: 'Other' },
] as const;

/** Rent statement for one tenancy. The landlord can also record payments, share receipts and chase arrears. */
export default function RentStatement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, identity } = useSession();
  const landlord = identity ? isLandlord(identity.role) : false;
  const { data, loading, error, reload } = useLoad(async () => {
    const [tenancies, ledger, properties] = await Promise.all([api.listTenancies(), api.getLedger(id), api.listProperties()]);
    const tenancy = tenancies.find((t) => t.id === id) ?? null;
    return { tenancy, ledger, property: properties.find((p) => p.id === tenancy?.propertyId) ?? null };
  });
  const save = useAction();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('bank_transfer');
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const ledger = data?.ledger;
  const tenancy = data?.tenancy;
  const now = today();
  const landlordName = identity?.email ?? 'Your landlord';

  const lines: Line[] = ledger
    ? [
        ...ledger.charges.map((c, n): Line => ({ key: `charge-${n}`, date: c.dueDate, label: c.proRata ? 'Rent due (part period)' : 'Rent due', amountPence: c.amountPence, kind: 'charge' })),
        ...ledger.payments.map((p): Line => ({ key: p.id, date: p.date, label: `Payment received${p.status === 'confirmed' ? '' : ` (${p.status})`}`, amountPence: p.amountPence, kind: 'payment', method: p.method })),
      ].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind))
    : [];

  const balance = ledger?.summary.balancePence ?? 0;
  const review = tenancy && data?.property ? rentReview(data.property.nation, tenancy.startDate, now) : null;

  async function record() {
    const amountPence = poundsToPence(amount);
    if (amountPence === null || amountPence <= 0) {
      setFormError('Enter the amount received in pounds.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.recordPayment(id, { date: now, amountPence, method }))) {
      setAmount('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
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
            {landlord ? <Text style={styles.muted}>Paid on time: {paymentRate(ledger.charges, ledger.payments, now)} out of 100</Text> : null}
          </View>

          {landlord && tenancy && balance > 0 ? (
            <View style={styles.card}>
              <Text style={styles.h2}>Chase the arrears</Text>
              <Text style={styles.muted}>Opens a reminder message you can read, edit and send by email or text. Nothing is sent automatically.</Text>
              <Button
                title="Preview reminder message"
                onPress={async () => setNote(await shareText('Rent reminder', arrearsMessage({ tenantNames: tenancy.tenantNames, propertyAddress: tenancy.propertyAddress, summary: ledger.summary, landlordName })))}
              />
            </View>
          ) : null}

          {landlord ? (
            <View style={styles.card}>
              <Text style={styles.h2}>Record a payment</Text>
              <Text style={styles.label}>Amount received in pounds</Text>
              <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
              <View style={styles.row}>
                {METHODS.map((m) => (
                  <Chip key={m.value} label={m.label} selected={method === m.value} onPress={() => setMethod(m.value)} />
                ))}
              </View>
              {formError ?? save.error ? <Text style={styles.error}>{formError ?? save.error}</Text> : null}
              <Button title="Record payment, dated today" kind="secondary" onPress={record} busy={save.busy} />
            </View>
          ) : null}

          {landlord && review ? (
            <View style={styles.card}>
              <Text style={styles.h2}>Next rent review</Text>
              <Text style={styles.body}>A new rent could start from {review.earliestEffectiveDate}.</Text>
              <Text style={styles.muted}>
                {review.canServeNow ? 'Notice can be served now.' : `Notice can be served from ${review.serveNoticeBy}.`} {review.noticeMonths} months' notice · {review.route}
              </Text>
            </View>
          ) : null}

          <Button title="Inventory and check-out" kind="secondary" onPress={() => router.push(`/inventory/${id}`)} />
          {note ? <Text style={styles.muted}>{note}</Text> : null}

          <Text style={[styles.h2, { marginTop: 8 }]}>Statement</Text>
          {landlord ? <Text style={styles.muted}>Tap a payment to share a receipt.</Text> : null}
          <View style={styles.card}>
            {lines.map((line) => {
              const row = (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                  <View>
                    <Text style={styles.body}>{line.label}</Text>
                    <Text style={styles.muted}>{line.date}</Text>
                  </View>
                  <Text style={[styles.body, { color: line.kind === 'payment' ? colors.good : colors.ink }]}>
                    {line.kind === 'payment' ? '+' : ''}
                    {formatPence(line.amountPence)}
                  </Text>
                </View>
              );
              if (line.kind !== 'payment' || !landlord || !tenancy) return <View key={line.key}>{row}</View>;
              return (
                <Pressable
                  key={line.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Share receipt for payment on ${line.date}`}
                  onPress={async () =>
                    setNote(
                      await shareText(
                        'Rent receipt',
                        receiptText({ landlordName, tenantNames: tenancy.tenantNames, propertyAddress: tenancy.propertyAddress, date: line.date, amountPence: line.amountPence, method: line.method ?? 'other' }),
                      ),
                    )
                  }
                >
                  {row}
                </Pressable>
              );
            })}
            {lines.length === 0 ? <Text style={styles.muted}>Nothing on this account yet.</Text> : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
