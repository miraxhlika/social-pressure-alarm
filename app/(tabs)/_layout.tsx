import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius, Shadows, getAppColors } from '@/constants/theme';
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
      tabBar={(props) => <PremiumTabBar {...props} />}
      screenOptions={{
        animation: 'none',
        headerShown: false,
        sceneStyle: {
          backgroundColor: colors.canvas,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
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

function PremiumTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = getAppColors(useColorScheme());
  const insets = useSafeAreaInsets();
  const [dockWidth, setDockWidth] = useState(0);
  const selectedPosition = useRef(new Animated.Value(0)).current;
  const itemWidth = dockWidth > 0 ? dockWidth / state.routes.length : 0;

  useEffect(() => {
    if (itemWidth === 0) {
      return;
    }

    const animation = Animated.timing(selectedPosition, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
      toValue: state.index * itemWidth,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [itemWidth, selectedPosition, state.index]);

  return (
    <View
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (Math.abs(nextWidth - dockWidth) > 0.5) {
          selectedPosition.stopAnimation();
          selectedPosition.setValue(state.index * (nextWidth / state.routes.length));
          setDockWidth(nextWidth);
        }
      }}
      style={[
        styles.dock,
        Shadows.hero,
        {
          backgroundColor: colors.tabBar ?? colors.elevated,
          borderColor: colors.border,
          bottom: Math.max(12, insets.bottom - 8),
        },
      ]}>
      {itemWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.selectionRail,
            {
              transform: [{ translateX: selectedPosition }],
              width: itemWidth,
            },
          ]}>
          <View style={[styles.selectionSurface, { backgroundColor: colors.elevated }]} />
          <View style={[styles.activeIndicator, { backgroundColor: colors.primary }]} />
        </Animated.View>
      ) : null}

      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        const options = descriptor.options;
        const focused = state.index === index;
        const label = typeof options.title === 'string' ? options.title : route.name;
        const color = focused ? colors.primary : colors.muted;

        const onPress = () => {
          const event = navigation.emit({
            canPreventDefault: true,
            target: route.key,
            type: 'tabPress',
          });

          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            target: route.key,
            type: 'tabLongPress',
          });
        };

        return (
          <DockTabItem
            accessibilityLabel={options.tabBarAccessibilityLabel}
            color={color}
            focused={focused}
            icon={options.tabBarIcon?.({ color, focused, size: 20 })}
            key={route.key}
            label={label}
            onLongPress={onLongPress}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

function DockTabItem({
  accessibilityLabel,
  color,
  focused,
  icon,
  label,
  onLongPress,
  onPress,
}: {
  accessibilityLabel?: string;
  color: string;
  focused: boolean;
  icon: ReactNode;
  label: string;
  onLongPress: () => void;
  onPress: () => void;
}) {
  const colors = getAppColors(useColorScheme());
  const focusProgress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(focusProgress, {
      duration: focused ? 180 : 140,
      easing: Easing.out(Easing.cubic),
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [focusProgress, focused]);

  const iconScale = focusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1.03],
  });
  const translateY = focusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={() => {
        if (!focused && process.env.EXPO_OS === 'ios') {
          void Haptics.selectionAsync();
        }
      }}
      style={({ pressed }) => [styles.dockButton, pressed && styles.dockButtonPressed]}>
      <Animated.View style={[styles.dockItemContent, { transform: [{ translateY }] }]}>
        <Animated.View style={[styles.iconWrap, { transform: [{ scale: iconScale }] }]}>
          {icon}
        </Animated.View>
        <Animated.Text
          style={[
            styles.dockLabel,
            styles[focused ? 'dockLabelActive' : 'dockLabelInactive'],
            { color: focused ? colors.text : color },
          ]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    height: 68,
    left: 16,
    overflow: 'hidden',
    position: 'absolute',
    right: 16,
  },
  selectionRail: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    top: 0,
  },
  selectionSurface: {
    borderRadius: Radius.md,
    bottom: 6,
    left: 5,
    opacity: 0.58,
    position: 'absolute',
    right: 5,
    top: 6,
  },
  activeIndicator: {
    borderRadius: Radius.pill,
    height: 3,
    position: 'absolute',
    top: 2,
    width: 18,
  },
  dockButton: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    zIndex: 1,
  },
  dockButtonPressed: {
    opacity: 0.76,
  },
  dockItemContent: {
    alignItems: 'center',
    gap: 3,
    justifyContent: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 28,
  },
  dockLabel: {
    fontFamily: Fonts.rounded,
    fontSize: 10,
    letterSpacing: 0.1,
    lineHeight: 13,
  },
  dockLabelActive: {
    fontWeight: '800',
  },
  dockLabelInactive: {
    fontWeight: '700',
  },
});
