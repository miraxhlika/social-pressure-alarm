import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { getAppColors } from '@/constants/theme';
import { useAlarmRuntime } from '@/hooks/use-alarm-runtime';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocialRuntime } from '@/hooks/use-social-runtime';
import { SocialSessionProvider } from '@/providers/social-session-provider';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = getAppColors(colorScheme);

  useAlarmRuntime();
  useSocialRuntime();

  return (
    <SocialSessionProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: colors.canvas,
            },
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="create" />
          <Stack.Screen
            name="ringing"
            options={{
              gestureEnabled: false,
            }}
          />
          <Stack.Screen name="success" />
          <Stack.Screen name="paywall" />
          <Stack.Screen name="account" />
          <Stack.Screen name="circles" />
        </Stack>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </SocialSessionProvider>
  );
}
