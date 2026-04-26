import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { HapticTab } from '@/components/haptic-tab';
import { Radius, Shadows, TextPresets, getAppColors } from '@/constants/theme';
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
          borderRadius: Radius.lg,
          borderTopWidth: 0,
          borderWidth: 1,
          bottom: 10,
          left: 20,
          minHeight: 58,
          position: 'absolute',
          paddingBottom: 6,
          paddingHorizontal: 8,
          paddingTop: 6,
          right: 20,
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
