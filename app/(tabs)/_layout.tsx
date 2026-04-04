import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { HapticTab } from '@/components/haptic-tab';
import { Fonts, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colors = getAppColors(useColorScheme());

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
          fontFamily: Fonts.rounded,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.3,
          marginBottom: 4,
          textTransform: 'none',
        },
        tabBarItemStyle: {
          paddingTop: 6,
        },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: 28,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          borderWidth: 1,
          bottom: 14,
          height: 84,
          left: 14,
          position: 'absolute',
          paddingBottom: 10,
          paddingHorizontal: Spacing.sm,
          paddingTop: 6,
          right: 14,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarBackground: () => null,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'sparkles' : 'sparkles-outline'} size={20} />
          ),
        }}
      />
      <Tabs.Screen
        name="alarms"
        options={{
          title: 'Alarms',
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
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'person-circle' : 'person-circle-outline'} size={20} />
          ),
        }}
      />
    </Tabs>
  );
}
