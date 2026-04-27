import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { getAppColors } from '@/constants/theme';
import { useAlarmRuntime } from '@/hooks/use-alarm-runtime';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocialRuntime } from '@/hooks/use-social-runtime';
import { readAlarmStore } from '@/lib/alarms';
import { markOnboardingCompleted, readOnboardingState } from '@/lib/onboarding';
import { SocialSessionProvider } from '@/providers/social-session-provider';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const rootSegment = segments[0];
  const colorScheme = useColorScheme();
  const colors = getAppColors(colorScheme);
  const [isOnboardingGateReady, setIsOnboardingGateReady] = useState(false);
  const navigationTheme = {
    ...(colorScheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(colorScheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.canvas,
      card: colors.card,
      border: colors.border,
      notification: colors.primary,
      primary: colors.primary,
      text: colors.text,
    },
  };

  useAlarmRuntime();
  useSocialRuntime();

  useEffect(() => {
    let isMounted = true;

    const syncOnboardingGate = async () => {
      try {
        const [onboardingState, store] = await Promise.all([readOnboardingState(), readAlarmStore()]);
        const hasExistingUsage =
          store.alarms.length > 0 ||
          store.lifetimeAlarmCreations > 0 ||
          store.successHistory.length > 0 ||
          store.failureHistory.length > 0;

        if (onboardingState.status === 'pending' && hasExistingUsage) {
          await markOnboardingCompleted();
          return;
        }

        if (
          (onboardingState.status === 'pending' || onboardingState.status === 'active') &&
          rootSegment !== 'onboarding'
        ) {
          router.replace('/onboarding');
        }
      } finally {
        if (isMounted) {
          setIsOnboardingGateReady(true);
        }
      }
    };

    void syncOnboardingGate();

    return () => {
      isMounted = false;
    };
  }, [rootSegment, router]);

  if (!isOnboardingGateReady) {
    return null;
  }

  return (
    <SocialSessionProvider>
      <ThemeProvider value={navigationTheme}>
        <Stack
          screenOptions={{
            animation: 'fade_from_bottom',
            headerShown: false,
            contentStyle: {
              backgroundColor: colors.canvas,
            },
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="create"
            options={{
              animation: 'slide_from_bottom',
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="ringing"
            options={{
              animation: 'fade',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="success"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="missed"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="checkpoint/[id]"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="history"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="today-activity"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="onboarding"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen name="paywall" />
        </Stack>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </SocialSessionProvider>
  );
}
