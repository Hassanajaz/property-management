import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useAction } from '../../src/hooks';
import { API_URL, useSession } from '../../src/session';
import { Button, styles } from '../../src/ui';

/** Your sign-in details, and changing your password. */
export default function Account() {
  const { identity, mode, changePassword, signOut } = useSession();
  const save = useAction();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.h2}>{identity?.email}</Text>
        <Text style={styles.muted}>Signed in as {identity?.role}</Text>
        {mode === 'local' ? <Text style={styles.muted}>Server: {API_URL}</Text> : null}
        {mode === 'demo' ? <Text style={styles.muted}>Demo mode: sample data, nothing is saved.</Text> : null}
      </View>

      {mode === 'local' ? (
        <View style={styles.card}>
          <Text style={styles.h2}>Change password</Text>
          <Text style={styles.label}>New password (at least 8 characters)</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          {save.error ? <Text style={styles.error}>{save.error}</Text> : null}
          {done ? <Text style={styles.body}>Password changed.</Text> : null}
          <Button
            title="Change password"
            busy={save.busy}
            onPress={async () => {
              setDone(false);
              if (await save.run(() => changePassword(password))) {
                setPassword('');
                setDone(true);
              }
            }}
          />
        </View>
      ) : null}

      <Button title="Sign out" kind="secondary" onPress={signOut} />
    </ScrollView>
  );
}
