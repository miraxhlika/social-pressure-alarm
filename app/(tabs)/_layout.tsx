import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { Radius, Shadows, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ALARM_RUNTIME_CACHE_MAX_AGE_MS, hydrateAlarmRuntimeForCurrentUser } from '@/lib/alarms';
import { SOCIAL_CIRCLES_CACHE_MAX_AGE_MS, listMySocialCircles } from '@/lib/social/circles';
import { listVisibleSocialFeed } from '@/lib/social/feed';
import { getSocialQueueSummary } from '@/lib/social/queue';
import { useSocialSession } from '@/providers/social-session-provider';

export default function TabLayout() {
  const colors = getAppColors(useColorScheme());
  const { configured, isLoading, isProfileComplete, user } = useSocialSession();
  const prefetchedAlarmKeyRef = useRef<string | null>(null);
  const prefetchedCircleKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const userKey = user?.id ?? 'guest';
    const shouldPrefetchAlarms = !isLoading && prefetchedAlarmKeyRef.current !== userKey;
    const shouldPrefetchCircles =
      configured && !isLoading && Boolean(user?.id) && isProfileComplete && prefetchedCircleKeyRef.current !== userKey;

    if (!shouldPrefetchAlarms && !shouldPrefetchCircles) {
      return;
    }

    const prefetchTimeout = setTimeout(() => {
      if (shouldPrefetchAlarms) {
        prefetchedAlarmKeyRef.current = userKey;
        void hydrateAlarmRuntimeForCurrentUser({ maxAgeMs: ALARM_RUNTIME_CACHE_MAX_AGE_MS }).catch(() => null);
      }

      if (shouldPrefetchCircles) {
        prefetchedCircleKeyRef.current = userKey;
        void Promise.all([
          listMySocialCircles({ maxAgeMs: SOCIAL_CIRCLES_CACHE_MAX_AGE_MS }).catch(() => []),
          listVisibleSocialFeed({ limitCount: 12 }).catch(() => []),
          getSocialQueueSummary().catch(() => ({ queuedEvents: [] })),
        ]);
      }
    }, 350);

    return () => {
      clearTimeout(prefetchTimeout);
    };
  }, [configured, isLoading, isProfileComplete, user?.id]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: colors.canvas,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarButton: HapticTab,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          ...TextPresets.eyebrow,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.2,
          lineHeight: 14,
          marginBottom: 0,
          textTransform: 'none',
        },
        tabBarItemStyle: {
          borderRadius: Radius.md,
          marginHorizontal: 0,
          marginVertical: 0,
          minHeight: 44,
          paddingBottom: 0,
          paddingTop: 4,
        },
        tabBarStyle: {
          ...Shadows.card,
          backgroundColor: colors.tabBar ?? colors.elevated,
          borderColor: colors.line,
          borderTopLeftRadius: Radius.lg,
          borderTopRightRadius: Radius.lg,
          borderTopWidth: 0,
          borderWidth: 1,
          bottom: 0,
          left: 0,
          minHeight: 78,
          position: 'absolute',
          paddingBottom: 22,
          paddingHorizontal: 28,
          paddingTop: 6,
          right: 0,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
        tabBarBackground: () => null,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'today' : 'today-outline'} size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="alarms"
        options={{
          title: 'Checkpoints',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'alarm' : 'alarm-outline'} size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="circles"
        options={{
          title: 'Circles',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'people' : 'people-outline'} size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'person' : 'person-outline'} size={20} />
          ),
        }}
      />
    </Tabs>
  );
}
