import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, getAppColors, Spacing, TextPresets, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function PaywallScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <View style={styles.content}>
        <AppCard elevated tone="primary" style={styles.card}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Free limit reached</Text>
              <Text style={[styles.title, { color: colors.text }]}>More alarms are coming soon.</Text>
              <Text style={[TextPresets.body, { color: colors.textSoft }]}>
                You have used the 3 free alarm slots. Expanded limits are not available yet.
              </Text>
            </View>
            <StatusPill label="3 of 3 used" tone="primary" />
          </View>

          <AppCard tone="muted" style={styles.featureCard}>
            <Text style={[TextPresets.label, { color: colors.text }]}>Planned</Text>
            <View style={styles.featureList}>
              <Text style={[TextPresets.body, { color: colors.muted }]}>Unlimited checkpoint alarms</Text>
              <Text style={[TextPresets.body, { color: colors.muted }]}>More reusable checkpoint presets</Text>
              <Text style={[TextPresets.body, { color: colors.muted }]}>More flexible account limits</Text>
            </View>
          </AppCard>

          <View style={styles.buttonGroup}>
            <AppButton
              label="Coming soon"
              onPress={() => Alert.alert('Coming soon', 'Expanded limits are not available yet.')}
            />
            <AppButton label="Back to alarms" onPress={() => router.replace('/alarms')} variant="secondary" />
          </View>
        </AppCard>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  card: {
    gap: Spacing.lg,
  },
  header: {
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  copy: {
    gap: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: Type.titleLg,
    fontWeight: '800',
    lineHeight: 32,
  },
  featureCard: {
    gap: Spacing.sm,
  },
  featureList: {
    gap: Spacing.xs,
  },
  buttonGroup: {
    gap: Spacing.sm,
  },
});
