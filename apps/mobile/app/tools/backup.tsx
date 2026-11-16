import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { today, type BackupDto } from '@lettly/core';
import { useAction } from '../../src/hooks';
import { pickTextFile, shareFile } from '../../src/platform';
import { useSession } from '../../src/session';
import { Button, colors, styles } from '../../src/ui';

const count = (backup: BackupDto, key: string): number => {
  const list = (backup.data as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? list.length : 0;
};

/** Saves a copy of everything in the account as one file, and puts such a copy back. */
export default function Backup() {
  const { api, demo } = useSession();
  const action = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [chosen, setChosen] = useState<BackupDto | null>(null);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {action.error ? <Text style={styles.error}>{action.error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.h2}>Save a backup</Text>
        <Text style={styles.muted}>
          One file with everything: properties, tenancies, rent payments, certificates, repairs, expenses, licences, readings, your templates, and the documents and photos you have uploaded. Keep it somewhere safe, such as iCloud Drive or an email to yourself. It holds tenants' personal details, so do not share it.
        </Text>
        {demo ? <Text style={styles.muted}>In demo mode the backup holds the sample data only.</Text> : null}
        <Button
          title="Save a backup now"
          busy={action.busy}
          onPress={() =>
            void action.run(async () => {
              const backup = await api.exportData();
              const shared = await shareFile(`lettly-backup-${today()}.json`, 'application/json', JSON.stringify(backup), 'public.json');
              setNote(shared ?? `Backup made: ${count(backup, 'properties')} properties, ${count(backup, 'tenancies')} tenancies, ${backup.files?.length ?? 0} files.`);
            })
          }
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Put a backup back</Text>
        <Text style={styles.muted}>Choose a backup file made here. Everything in the account now is replaced by what is in the file, so save a fresh backup first if you are unsure.</Text>
        {chosen ? (
          <>
            <Text style={styles.body}>
              Backup from {new Date(chosen.exportedAt).toLocaleString('en-GB')}: {count(chosen, 'properties')} properties, {count(chosen, 'tenancies')} tenancies, {chosen.files?.length ?? 0} files.
            </Text>
            <Text style={[styles.body, { color: colors.bad }]}>This replaces everything in the account. It cannot be undone.</Text>
            <Button
              title="Yes, replace everything with this backup"
              busy={action.busy}
              onPress={() =>
                void action.run(async () => {
                  await api.restoreData(chosen);
                  setChosen(null);
                  setNote('The backup has been put back.');
                })
              }
            />
            <Button title="Cancel" kind="secondary" onPress={() => setChosen(null)} />
          </>
        ) : (
          <Button
            title="Choose a backup file"
            kind="secondary"
            busy={action.busy}
            onPress={() =>
              void action.run(async () => {
                setNote(null);
                const file = await pickTextFile(['application/json', 'public.json', 'text/plain']);
                if (!file) return;
                let backup: BackupDto;
                try {
                  backup = JSON.parse(file.text) as BackupDto;
                } catch {
                  throw new Error('That file could not be read as a backup.');
                }
                if (backup?.app !== 'lettly' || typeof backup.data !== 'object' || backup.data === null) throw new Error('That file is not a backup made by this app.');
                setChosen(backup);
              })
            }
          />
        )}
      </View>
      {note ? <Text style={styles.body}>{note}</Text> : null}
    </ScrollView>
  );
}
