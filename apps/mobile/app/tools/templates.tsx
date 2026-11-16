import { useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { BUILT_IN_TEMPLATES, TEMPLATE_FIELDS, builtInTemplatesFor, fillTemplate, templateValues, today, type TemplateDto } from '@lettly/core';
import { useAction, useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { ShareButtons } from '../../src/share';
import { Button, Chip, styles } from '../../src/ui';

type Draft = { id?: string; name: string; body: string };

/**
 * Ready-made documents and the landlord's own wording. Either kind is filled
 * in with a tenancy's details, checked and finished on screen, then shared as
 * a PDF or as text.
 */
export default function Templates() {
  const { api, identity } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [templates, tenancies, properties] = await Promise.all([api.listTemplates(), api.listTenancies(), api.listProperties()]);
    return { templates, tenancies, properties };
  });
  const save = useAction();
  const [tenancyId, setTenancyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [filled, setFilled] = useState<{ templateId: string; name: string; text: string; unknown: string[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const tenancy = data?.tenancies.find((t) => t.id === tenancyId);
  const nation = tenancy ? data?.properties.find((p) => p.id === tenancy.propertyId)?.nation : undefined;
  const readyMade = nation ? builtInTemplatesFor(nation) : BUILT_IN_TEMPLATES;

  function fill(template: TemplateDto) {
    if (!tenancy) {
      setNote('Choose a tenancy first.');
      return;
    }
    setNote(null);
    const result = fillTemplate(template.body, templateValues(tenancy, identity?.email ?? '', today()));
    setFilled({ templateId: template.id, name: template.name, text: result.text, unknown: result.unknown });
  }

  function card(template: TemplateDto, description: string | null, own: boolean) {
    const open = filled?.templateId === template.id ? filled : null;
    return (
      <View key={template.id} style={styles.card}>
        <Text style={styles.h2}>{template.name}</Text>
        {description ? (
          <Text style={styles.muted}>{description}</Text>
        ) : (
          <Text style={styles.muted} numberOfLines={3}>
            {template.body}
          </Text>
        )}
        {open ? (
          <>
            <Text style={styles.label}>Check the wording and complete anything in [square brackets]</Text>
            <TextInput
              style={[styles.input, { minHeight: 260, textAlignVertical: 'top' }]}
              value={open.text}
              onChangeText={(text: string) => setFilled({ ...open, text })}
              multiline
            />
            {open.unknown.length > 0 ? <Text style={styles.muted}>These placeholders were not recognised and were left as they are: {open.unknown.join(', ')}</Text> : null}
            {open.text.includes('[') ? <Text style={styles.muted}>There is still wording in [square brackets] to complete.</Text> : null}
            <ShareButtons title={open.name} text={() => open.text} />
            <Button title="Close" kind="secondary" onPress={() => setFilled(null)} />
          </>
        ) : (
          <>
            <Button title="Fill in" onPress={() => fill(template)} />
            {own ? (
              <Button title="Edit" kind="secondary" onPress={() => setEditing(template)} />
            ) : (
              <Button title="Copy to my templates to change the wording" kind="secondary" onPress={() => setEditing({ name: template.name, body: template.body })} />
            )}
          </>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
      {error ?? save.error ? <Text style={styles.error}>{error ?? save.error}</Text> : null}
      <Text style={styles.muted}>
        Choose a tenancy, then a document. The tenancy's details are filled in for you, you finish the wording on screen, and share it as a PDF or as text.
      </Text>

      <Text style={styles.label}>Which tenancy is it for?</Text>
      <View style={styles.row}>
        {(data?.tenancies ?? []).map((t) => (
          <Chip
            key={t.id}
            label={t.propertyAddress.split(',')[0] ?? t.propertyAddress}
            selected={tenancyId === t.id}
            onPress={() => {
              setTenancyId(t.id);
              setFilled(null);
              setNote(null);
            }}
          />
        ))}
      </View>
      {data && data.tenancies.length === 0 ? <Text style={styles.muted}>Add a tenancy to a property first.</Text> : null}
      {note ? <Text style={styles.error}>{note}</Text> : null}

      <Text style={[styles.h2, { marginTop: 8 }]}>Ready-made documents</Text>
      <Text style={styles.muted}>
        Plain-English starting points. They have not been checked by a solicitor, so read each one before you send it. Rent increases and possession notices only count on the official form; the letters here go with that form.
      </Text>
      {readyMade.map((template) => card(template, template.description, false))}

      <Text style={[styles.h2, { marginTop: 8 }]}>My templates</Text>
      {data && data.templates.length === 0 ? <Text style={styles.muted}>Nothing saved yet. Write your own, or copy a ready-made document and change it.</Text> : null}
      {(data?.templates ?? []).map((template) => card(template, null, true))}

      {editing ? (
        <View style={styles.card}>
          <Text style={styles.h2}>{editing.id ? 'Edit template' : 'New template'}</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={editing.name} onChangeText={(text: string) => setEditing({ ...editing, name: text })} />
          <Text style={styles.label}>Wording</Text>
          <TextInput style={[styles.input, { minHeight: 220, textAlignVertical: 'top' }]} value={editing.body} onChangeText={(text: string) => setEditing({ ...editing, body: text })} multiline />
          <Text style={styles.muted}>Placeholders filled in from the tenancy: {TEMPLATE_FIELDS.map((f) => `{{${f}}}`).join('  ')}</Text>
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
        <Button title="Write a new template" kind="secondary" onPress={() => setEditing({ name: '', body: '' })} />
      )}
    </ScrollView>
  );
}
