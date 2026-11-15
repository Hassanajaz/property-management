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
