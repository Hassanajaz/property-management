import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { EXPENSE_CATEGORY_LABEL, accountantPack, financeSummary, formatPence, taxYearOf, today, type ExpenseCategory } from '@lettly/core';
import { poundsToPence, useAction, useLoad } from '../../src/hooks';
import { ShareButtons } from '../../src/share';
import { useSession } from '../../src/session';
import { Button, Chip, colors, styles } from '../../src/ui';

const CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[];

/** Income, expenses, mileage and profit for the current tax year. */
export default function Finance() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [payments, expenses, mileage, properties] = await Promise.all([api.listPayments(), api.listExpenses(), api.listMileage(), api.listProperties()]);
    return { payments, expenses, mileage, properties };
  });
  const save = useAction();

  const [category, setCategory] = useState<ExpenseCategory>('repairs');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [miles, setMiles] = useState('');
  const [purpose, setPurpose] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const taxYear = taxYearOf(today());
  const summary = data ? financeSummary(data, taxYear) : null;

  async function addExpense() {
    const amountPence = poundsToPence(amount);
    if (amountPence === null || amountPence <= 0 || !description.trim()) {
      setFormError('Enter what it was for and the amount in pounds.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.addExpense({ propertyId, date: today(), category, description: description.trim(), amountPence }))) {
      setDescription('');
      setAmount('');
      await reload();
    }
  }

  async function addTrip() {
    const value = Number(miles);
    if (!(value > 0) || !purpose.trim()) {
      setFormError('Enter the miles and what the trip was for.');
      return;
    }
    setFormError(null);
    if (await save.run(() => api.addMileage({ date: today(), miles: value, purpose: purpose.trim() }))) {
      setMiles('');
      setPurpose('');
      await reload();
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {summary ? (
        <>
          <View style={styles.card}>
            <Text style={styles.muted}>Tax year {summary.taxYear.label} so far</Text>
            <Text style={styles.muted}>Profit before finance costs</Text>
            <Text style={[styles.h1, { color: summary.profitPence >= 0 ? colors.good : colors.bad }]}>{formatPence(summary.profitPence)}</Text>
            <Row label="Rent received" value={formatPence(summary.incomePence)} />
            <Row label="Allowable expenses" value={`-${formatPence(summary.allowableExpensesPence)}`} />
            <Row label={`Mileage (${summary.miles} miles)`} value={`-${formatPence(summary.mileagePence)}`} />
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>Expenses by type</Text>
            {CATEGORIES.filter((c) => summary.expensesByCategory[c]).map((c) => (
              <Row key={c} label={EXPENSE_CATEGORY_LABEL[c]} value={formatPence(summary.expensesByCategory[c] ?? 0)} />
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>Mortgage interest</Text>
            <Row label="Finance costs this year" value={formatPence(summary.financeCostsPence)} />
            <Row label="Tax reduction at 20%" value={formatPence(summary.financeCostTaxReductionPence)} />
            <Text style={styles.muted}>Residential mortgage interest is not deducted from profit. It is claimed separately as a basic-rate tax reduction.</Text>
          </View>

          <ShareButtons title={`Rental accounts ${summary.taxYear.label}`} label="Share the accountant pack" text={() => accountantPack(summary, data!.expenses, data!.mileage)} />
          <Text style={styles.muted}>These figures are a working aid for your tax return, not tax advice. Check them with an accountant.</Text>
        </>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.h2}>Add an expense</Text>
        <Text style={styles.label}>Type</Text>
        <View style={styles.row}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={EXPENSE_CATEGORY_LABEL[c]} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <Text style={styles.label}>Property</Text>
        <View style={styles.row}>
          <Chip label="Whole portfolio" selected={propertyId === null} onPress={() => setPropertyId(null)} />
          {(data?.properties ?? []).map((p) => (
            <Chip key={p.id} label={p.addressLine1} selected={propertyId === p.id} onPress={() => setPropertyId(p.id)} />
          ))}
        </View>
        <Text style={styles.label}>What was it for?</Text>
        <TextInput style={styles.input} value={description} onChangeText={setDescription} maxLength={200} />
        <Text style={styles.label}>Amount in pounds</Text>
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        <Button title="Add expense, dated today" onPress={addExpense} busy={save.busy} />
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Add a business trip</Text>
        <Text style={styles.label}>Miles</Text>
        <TextInput style={styles.input} value={miles} onChangeText={setMiles} keyboardType="decimal-pad" />
        <Text style={styles.label}>Purpose</Text>
        <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} maxLength={200} />
        <Button title="Add trip, dated today" kind="secondary" onPress={addTrip} busy={save.busy} />
      </View>
      {formError ?? save.error ? <Text style={styles.error}>{formError ?? save.error}</Text> : null}

      <Text style={[styles.h2, { marginTop: 8 }]}>Expenses</Text>
      {(data?.expenses ?? []).map((e) => (
        <View key={e.id} style={styles.card}>
          <Row label={e.description} value={formatPence(e.amountPence)} />
          <Text style={styles.muted}>
            {EXPENSE_CATEGORY_LABEL[e.category]} · {e.date}
            {e.propertyAddress ? ` · ${e.propertyAddress}` : ''}
          </Text>
        </View>
      ))}

      <Text style={[styles.h2, { marginTop: 8 }]}>Mileage log</Text>
      {(data?.mileage ?? []).map((m) => (
        <View key={m.id} style={styles.card}>
          <Row label={m.purpose} value={`${m.miles} miles`} />
          <Text style={styles.muted}>{m.date}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}
