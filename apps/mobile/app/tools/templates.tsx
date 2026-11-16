import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { TEMPLATE_FIELDS, fillTemplate, templateValues, today, type TemplateDto } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { shareText } from '../../src/platform';
import { useSession } from '../../src/session';
import { Button, Chip, styles } from '../../src/ui';

/** The landlord's own letters and documents, filled in with a tenancy's details. */
export default function Templates() {
  const { api, identity } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [templates, tenancies] = await Promise.all([api.listTemplates(), api.listTenancies()]);
    return { templates, tenancies };
  });
  const save = useAction();
  const [tenancyId, setTenancyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateDto | { id?: undefined; name: string; body: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const tenancy = data?.tenancies.find((t) => t.id === tenancyId);

  async function share(template: TemplateDto) {
    if (!tenancy) {
      setNote('Choose a tenancy first.');
      return;
    }
    const filled = fillTemplate(template.body, templateValues(tenancy, identity?.email ?? '', today()));
    const shared = await shareText(template.name, filled.text);
    setNote(filled.unknown.length > 0 ? `These placeholders were not recognised and were left as they are: ${filled.unknown.join(', ')}` : shared);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      <Text style={styles.muted}>
        Keep your own wording here, for example a tenancy agreement from your solicitor or a letter you send often. Placeholders in double curly brackets are filled in from the tenancy you choose.
      </Text>
      <Text style={styles.muted}>Placeholders: {TEMPLATE_FIELDS.map((f) => `{{${f}}}`).join('  ')}</Text>

      <Text style={styles.label}>Fill in for which tenancy?</Text>
      <View style={styles.row}>
        {(data?.tenancies ?? []).map((t) => (
          <Chip key={t.id} label={t.propertyAddress.split(',')[0] ?? t.propertyAddress} selected={tenancyId === t.id} onPress={() => setTenancyId(t.id)} />
        ))}
      </View>
      {note ? <Text style={styles.muted}>{note}</Text> : null}

      {(data?.templates ?? []).map((template) => (
        <View key={template.id} style={styles.card}>
          <Text style={styles.h2}>{template.name}</Text>
          <Text style={styles.muted} numberOfLines={3}>
            {template.body}
          </Text>
          <Button title="Fill in and share" onPress={() => share(template)} />
          <Button title="Edit" kind="secondary" onPress={() => setEditing(template)} />
        </View>
      ))}

      {editing ? (
        <View style={styles.card}>
          <Text style={styles.h2}>{editing.id ? 'Edit template' : 'New template'}</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={editing.name} onChangeText={(text: string) => setEditing({ ...editing, name: text })} />
          <Text style={styles.label}>Wording</Text>
          <TextInput style={[styles.input, { minHeight: 220, textAlignVertical: 'top' }]} value={editing.body} onChangeText={(text: string) => setEditing({ ...editing, body: text })} multiline />
          <Button
            title="Save template"
            busy={save.busy}
            onPress={async () => {
              if (await save.run(() => api.saveTemplate(editing))) {
                setEditing(null);
                await reload();
              }
            }}
          />
          <Button title="Cancel" kind="secondary" onPress={() => setEditing(null)} />
        </View>
      ) : (
        <Button title="New template" kind="secondary" onPress={() => setEditing({ name: '', body: '' })} />
      )}
    </ScrollView>
  );
}
