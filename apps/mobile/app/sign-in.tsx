import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { setNewPassword, signIn } from '@lettly/core';
import { authConfig, useSession } from '../src/session';
import { Button, styles } from '../src/ui';

/** One sign-in for agency staff, landlords and tenants. */
export default function SignIn() {
  const { signedIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPasswordValue] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        await signedIn(await setNewPassword(authConfig, email.trim(), newPassword, challenge));
        return;
      }
      const result = await signIn(authConfig, email.trim(), password);
      if (result.kind === 'signed_in') await signedIn(result.session);
      else setChallenge(result.challengeSession);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { justifyContent: 'center' }]}>
      <View style={styles.content}>
        <Text style={styles.h1}>{challenge ? 'Choose a password' : 'Sign in'}</Text>
        <Text style={styles.muted}>
          {challenge ? 'This is your first sign-in. Choose a password of at least 10 characters with a number.' : 'Use the email address your letting agent has for you.'}
        </Text>

        {challenge ? (
          <>
            <Text style={styles.label}>New password</Text>
            <TextInput style={styles.input} value={newPassword} onChangeText={setNewPasswordValue} secureTextEntry autoComplete="new-password" />
          </>
        ) : (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={challenge ? 'Save and continue' : 'Sign in'} onPress={submit} busy={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
