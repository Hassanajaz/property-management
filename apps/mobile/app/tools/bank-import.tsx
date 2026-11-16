import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { formatPence, matchBankRows, parseBankCsv, type BankMatch } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { pickTextFile } from '../../src/platform';
import { useSession } from '../../src/session';
import { Button, Chip, colors, styles } from '../../src/ui';

/**
 * Records rent payments from a bank statement. The landlord downloads the
 * statement from their bank as a CSV file, the app suggests which tenancy each
 * payment belongs to, and nothing is recorded until they confirm.
 */
export default function BankImport() {
  const { api } = useSession();
  const { data, error } = useLoad(async () => {
    const [tenancies, payments] = await Promise.all([api.listTenancies(), api.listPayments()]);
    return { tenancies: tenancies.filter((t) => t.status !== 'draft'), payments };
  });
  const save = useAction();
  const [text, setText] = useState('');
  const [matches, setMatches] = useState<BankMatch[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [ignored, setIgnored] = useState(0);
  /** The tenancy chosen for each row; null means leave it out. */
  const [choice, setChoice] = useState<(string | null)[]>([]);
  const [result, setResult] = useState<string | null>(null);

  function read(content: string) {
    setResult(null);
    const parsed = parseBankCsv(content);
    const found = matchBankRows(parsed.rows, data?.tenancies ?? [], data?.payments ?? []);
    setMatches(found);
    setProblems(parsed.errors);
    setIgnored(parsed.ignored);
    setChoice(found.map((m) => (m.alreadyRecorded ? null : m.tenancyId)));
  }

  const chosen = (matches ?? []).flatMap((m, index) => (choice[index] ? [{ tenancyId: choice[index]!, row: m.row }] : []));
  const total = chosen.reduce((sum, c) => sum + c.row.amountPence, 0);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      <Text style={styles.muted}>
        In your bank's app or website, download your statement as a CSV file (sometimes called "spreadsheet" or "Excel" format), then choose it here. Only money coming in is looked at. Nothing is recorded until you press the button at the bottom.
      </Text>
      <Button
        title="Choose the bank file"
        busy={save.busy}
        onPress={() =>
          void save.run(async () => {
            const file = await pickTextFile(['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', 'public.comma-separated-values-text']);
            if (file) read(file.text);
          })
        }
      />
      <Text style={styles.label}>Or paste the rows here</Text>
      <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]} value={text} onChangeText={setText} multiline autoCapitalize="none" placeholder={'Date,Description,Paid in\n05/11/2026,LLOYD M RENT,895.00'} />
      {text.trim() ? <Button title="Read the pasted rows" kind="secondary" onPress={() => read(text)} /> : null}

      {problems.map((problem) => (
        <Text key={problem} style={styles.error}>
          {problem}
        </Text>
      ))}
      {matches ? (
        <Text style={styles.muted}>
          {matches.length} payment{matches.length === 1 ? '' : 's'} in found{ignored > 0 ? `, ${ignored} other row${ignored === 1 ? '' : 's'} (money out) left out` : ''}. Check each one below.
        </Text>
      ) : null}

      {(matches ?? []).map((match, index) => (
        <View key={index} style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={[styles.body, { flex: 1 }]}>{match.row.description || 'No description'}</Text>
            <Text style={[styles.body, { color: colors.good }]}>{formatPence(match.row.amountPence)}</Text>
          </View>
          <Text style={styles.muted}>
            {match.row.date}
            {match.reason === 'name' ? ' · matched by the name' : match.reason === 'amount' ? ' · matched by the amount, check it' : ' · no clear match'}
          </Text>
          {match.alreadyRecorded ? <Text style={[styles.body, { color: colors.warn }]}>A payment of this amount on this date is already recorded, so it is left out.</Text> : null}
          <View style={styles.row}>
            {(data?.tenancies ?? []).map((t) => (
              <Chip
                key={t.id}
                label={`${t.tenantNames[0] ?? 'Tenant'}, ${t.propertyAddress.split(',')[0]}`}
                selected={choice[index] === t.id}
                onPress={() => setChoice((current) => current.map((value, n) => (n === index ? t.id : value)))}
              />
            ))}
            <Chip label="Not rent" selected={!choice[index]} onPress={() => setChoice((current) => current.map((value, n) => (n === index ? null : value)))} />
          </View>
        </View>
      ))}

      {result ? <Text style={styles.body}>{result}</Text> : null}
      {matches && matches.length > 0 ? (
        <Button
          title={chosen.length === 0 ? 'Nothing chosen to record' : `Record ${chosen.length} payment${chosen.length === 1 ? '' : 's'}, ${formatPence(total)}`}
          busy={save.busy}
          onPress={() =>
            void save.run(async () => {
              if (chosen.length === 0) throw new Error('Choose a tenancy for at least one payment.');
              for (const { tenancyId, row } of chosen) await api.recordPayment(tenancyId, { date: row.date, amountPence: row.amountPence, method: 'bank_transfer' });
              setResult(`Recorded ${chosen.length} payment${chosen.length === 1 ? '' : 's'}, ${formatPence(total)} in total. Each rent statement is up to date.`);
              setMatches(null);
              setText('');
            })
          }
        />
      ) : null}
    </ScrollView>
  );
}
