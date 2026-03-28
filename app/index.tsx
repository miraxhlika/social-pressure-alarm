import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { AlarmCard } from '@/components/alarm-card';
import { getAppColors } from '@/constants/theme';
import { deleteAlarm, readAlarmStore, resetAlarmStore } from '@/lib/alarms';
import { cancelAlarmNotificationAsync } from '@/lib/notifications';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Alarm, FREE_ALARM_LIMIT } from '@/types/alarm';

export default function HomeScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [lifetimeAlarmCreations, setLifetimeAlarmCreations] = useState(0);

  const loadData = useCallback(async () => {
    const store = await readAlarmStore();
    setAlarms(store.alarms);
    setLifetimeAlarmCreations(store.lifetimeAlarmCreations);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const handleCreateAlarmPress = () => {
    if (lifetimeAlarmCreations >= FREE_ALARM_LIMIT) {
      router.push('/paywall');
      return;
    }

    router.push('/create');
  };

  const handleDeleteAlarm = (alarm: Alarm) => {
    Alert.alert('Delete alarm?', `Remove the alarm for ${alarm.contactName}?`, [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelAlarmNotificationAsync(alarm.notificationId);
          await deleteAlarm(alarm.id);
          await loadData();
        },
      },
    ]);
  };

  const handleResetDemoData = () => {
    Alert.alert(
      'Reset demo data?',
      'This clears saved alarms, resets the free limit, and cancels scheduled alarm notifications on this device.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await Promise.all(
              alarms.map((alarm) => cancelAlarmNotificationAsync(alarm.notificationId))
            );
            await resetAlarmStore();
            await loadData();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}>
        <View style={styles.hero}>
          <Text style={[styles.title, { color: colors.text }]}>Social Pressure Alarm</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            If you don&apos;t wake up, someone finds out.
          </Text>
        </View>

        <View
          style={[
            styles.limitCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.limitTitle, { color: colors.text }]}>Free alarms used</Text>
          <Text style={[styles.limitValue, { color: colors.primary }]}>
            {Math.min(lifetimeAlarmCreations, FREE_ALARM_LIMIT)} / {FREE_ALARM_LIMIT}
          </Text>
          <Text style={[styles.limitHelp, { color: colors.muted }]}>
            Create up to 3 alarms free. The 4th creation attempt opens the paywall placeholder.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={handleCreateAlarmPress}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
            Create Alarm
          </Text>
        </Pressable>

        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleResetDemoData}
            style={[styles.devButton, { borderColor: colors.border }]}>
            <Text style={[styles.devButtonText, { color: colors.muted }]}>Reset Demo Data</Text>
          </Pressable>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Existing alarms</Text>
          <Text style={[styles.sectionCaption, { color: colors.muted }]}>
            Notifications wake the user; the app then routes into the alarm confirmation flow.
          </Text>
        </View>

        {alarms.length === 0 ? (
          <View
            style={[
              styles.emptyState,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No alarms yet</Text>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              Create your first accountability alarm to test the full MVP flow.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {alarms.map((alarm) => (
              <AlarmCard key={alarm.id} alarm={alarm} onDelete={handleDeleteAlarm} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  hero: {
    gap: 8,
    paddingTop: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
  },
  limitCard: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  limitTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  limitValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  limitHelp: {
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  devButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  devButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    gap: 6,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sectionCaption: {
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    gap: 14,
  },
});
