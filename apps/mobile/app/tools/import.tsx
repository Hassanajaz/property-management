import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { parsePropertiesCsv } from '@lettly/core';
import { useAction } from '../../src/hooks';
import { useSession } from '../../src/session';
import { Button, styles } from '../../src/ui';

/** Adds many properties at once from rows copied out of a spreadsheet. */
export default function ImportProperties() {
  const { api } = useSession();
  const save = useAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const preview = text.trim() ? parsePropertiesCsv(text) : null;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>
        In your spreadsheet, put one property per row with these columns in this order: address, town, postcode, nation, gas (yes or no), HMO (yes or no). Select the rows, copy them, and paste them below.
      </Text>
      <TextInput
        style={[styles.input, { minHeight: 180, textAlignVertical: 'top' }]}
        value={text}
        onChangeText={(value: string) => {
          setText(value);
          setResult(null);
        }}
        multiline
        autoCapitalize="none"
        placeholder={'12 Oak Avenue, Leeds, LS8 2AB, England, yes, no'}
      />

      {preview ? (
        <View style={styles.card}>
          <Text style={styles.h2}>
            {preview.rows.length} propert{preview.rows.length === 1 ? 'y' : 'ies'} ready to add
          </Text>
          {preview.rows.slice(0, 8).map((row, n) => (
            <Text key={n} style={styles.body}>
              {row.addressLine1}, {row.town} {row.postcode} · {row.nation.replace('_', ' ')}
            </Text>
          ))}
          {preview.rows.length > 8 ? <Text style={styles.muted}>and {preview.rows.length - 8} more</Text> : null}
          {preview.errors.map((problem) => (
            <Text key={problem} style={styles.error}>
              {problem}
            </Text>
          ))}
        </View>
      ) : null}

      {save.error ? <Text style={styles.error}>{save.error}</Text> : null}
      {result ? <Text style={styles.body}>{result}</Text> : null}
      <Button
        title="Add these properties"
        busy={save.busy}
        onPress={() =>
          void save.run(async () => {
            if (!preview || preview.rows.length === 0) throw new Error('There are no valid rows to add yet.');
            const outcome = await api.importProperties(text);
            setResult(`Added ${outcome.created}. The certificates each one needs have been set up.${outcome.errors.length ? ` ${outcome.errors.length} row(s) were skipped.` : ''}`);
            setText('');
          })
        }
      />
    </ScrollView>
  );
}
