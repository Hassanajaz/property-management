import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SessionProvider, useSession } from '../src/session';
import { colors } from '../src/ui';
import SignIn from './sign-in';

/**
 * Signed out: show the sign-in screen directly. Signed in: show the app's
 * screens. Swapping what is rendered (rather than redirecting between routes)
 * means there is no navigation step that can be dropped.
 */
function Screens() {
  const { identity } = useSession();

  if (identity === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (identity === null) return <SignIn />;

  return (
    <Stack screenOptions={{ headerTintColor: colors.brand, headerTitleStyle: { color: colors.ink } }}>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="report" options={{ title: 'Report a repair', presentation: 'modal' }} />
      <Stack.Screen name="repair/[id]" options={{ title: 'Repair' }} />
      <Stack.Screen name="property/[id]" options={{ title: 'Property' }} />
      <Stack.Screen name="tenancy/[id]" options={{ title: 'Rent statement' }} />
      <Stack.Screen name="tools/finance" options={{ title: 'Finance' }} />
      <Stack.Screen name="tools/reminders" options={{ title: 'Reminders' }} />
      <Stack.Screen name="tools/rent-reviews" options={{ title: 'Rent reviews' }} />
      <Stack.Screen name="tools/inspections" options={{ title: 'Inspections' }} />
      <Stack.Screen name="tools/contractors" options={{ title: 'Contractors' }} />
      <Stack.Screen name="tools/keys" options={{ title: 'Key register' }} />
      <Stack.Screen name="tools/deposits" options={{ title: 'Deposit register' }} />
      <Stack.Screen name="tools/right-to-rent" options={{ title: 'Right to Rent' }} />
      <Stack.Screen name="inventory/[id]" options={{ title: 'Inventory' }} />
      <Stack.Screen name="tools/lettings" options={{ title: 'Adverts and viewings' }} />
      <Stack.Screen name="tools/notices" options={{ title: 'Notices and possession' }} />
      <Stack.Screen name="tools/templates" options={{ title: 'Document templates' }} />
      <Stack.Screen name="tools/import" options={{ title: 'Import properties' }} />
      <Stack.Screen name="tools/account" options={{ title: 'Your account' }} />
      <Stack.Screen name="tools/bank-import" options={{ title: 'Bank statement import' }} />
      <Stack.Screen name="tools/licences" options={{ title: 'Licences' }} />
      <Stack.Screen name="tools/meters" options={{ title: 'Meter readings' }} />
      <Stack.Screen name="tools/backup" options={{ title: 'Backup and restore' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Screens />
    </SessionProvider>
  );
}
