import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { setNewPassword, signIn } from '@lettly/core';
import { API_URL, authConfig, useSession } from '../src/session';
import { Button, Chip, styles } from '../src/ui';


/** One sign-in for landlords and tenants. */
export default function SignIn() {
  const { signedIn, demo, signInDemo, mode, signInLocal, signUpLocal } = useSession();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [sample, setSample] = useState(true);
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

  if (demo) {
    return (
      <View style={[styles.page, { justifyContent: 'center' }]}>
        <View style={styles.content}>
          <Text style={styles.h1}>Lettly demo</Text>
          <Text style={styles.muted}>
            Sample data only: nothing is saved or sent. Choose who to sign in as. Report a repair as the tenant, then switch person and handle it as the landlord.
          </Text>
          <Button title="Landlord" onPress={() => signInDemo('landlord')} />
          <Button title="Tenant" kind="secondary" onPress={() => signInDemo('tenant')} />
        </View>
      </View>
    );
  }

  if (mode === 'local') {
    const submitLocal = async () => {
      setBusy(true);
      setError(null);
      try {
        if (creating) await signUpLocal({ name: name.trim(), email: email.trim(), password, sample });
        else await signInLocal(email.trim(), password);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed');
      } finally {
        setBusy(false);
      }
    };
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { justifyContent: 'center' }]}>
        <View style={styles.content}>
          <Text style={styles.h1}>{creating ? 'Create a landlord account' : 'Sign in'}</Text>
          <Text style={styles.muted}>
            {creating ? 'Tenants do not create accounts: their landlord gives them a sign-in.' : 'Landlords and tenants sign in here.'}
          </Text>
          {creating ? (
            <>
              <Text style={styles.label}>Your name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} autoComplete="name" />
            </>
          ) : null}
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Text style={styles.label}>{creating ? 'Password (at least 8 characters)' : 'Password'}</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete={creating ? 'new-password' : 'current-password'} />
          {creating ? (
            <View style={styles.row}>
              <Chip label="Start with sample properties" selected={sample} onPress={() => setSample(true)} />
              <Chip label="Start empty" selected={!sample} onPress={() => setSample(false)} />
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={creating ? 'Create account' : 'Sign in'} onPress={submitLocal} busy={busy} />
          <Button title={creating ? 'I already have an account' : 'Create a landlord account'} kind="secondary" onPress={() => { setCreating((v) => !v); setError(null); }} />
          <Text style={styles.muted}>Server: {API_URL}</Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { justifyContent: 'center' }]}>
      <View style={styles.content}>
        <Text style={styles.h1}>{challenge ? 'Choose a password' : 'Sign in'}</Text>
        <Text style={styles.muted}>
          {challenge ? 'This is your first sign-in. Choose a password of at least 10 characters with a number.' : 'Use the email address on your account.'}
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
