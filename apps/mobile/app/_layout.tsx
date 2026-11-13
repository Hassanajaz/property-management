import { Redirect, Stack, usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SessionProvider, useSession } from '../src/session';
import { colors } from '../src/ui';

function Screens() {
  const { identity } = useSession();
  const pathname = usePathname();

  if (identity === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (identity === null && pathname !== '/sign-in') return <Redirect href="/sign-in" />;
  if (identity && pathname === '/sign-in') return <Redirect href="/" />;

  return (
    <Stack screenOptions={{ headerTintColor: colors.brand, headerTitleStyle: { color: colors.ink } }}>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="report" options={{ title: 'Report a repair', presentation: 'modal' }} />
      <Stack.Screen name="repair/[id]" options={{ title: 'Repair' }} />
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
