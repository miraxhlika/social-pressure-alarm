import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function PaywallScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <View style={styles.content}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}>
          <Text style={[styles.kicker, { color: colors.primary }]}>Free limit reached</Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Stop relying on willpower. Use pressure.
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            You&apos;ve used the 3 free alarm creations in this MVP. Payments are not implemented
            yet, so this screen is a placeholder for the premium upgrade flow.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert('Coming soon', 'Payments are intentionally not implemented yet.')}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
            <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
              Unlock Unlimited Alarms
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/')}
            style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Back Home</Text>
          </Pressable>
        </View>
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
    padding: 24,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 22,
  },
  kicker: {
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    marginTop: 8,
    paddingVertical: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
