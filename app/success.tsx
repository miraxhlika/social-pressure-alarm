import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contactName?: string }>();
  const colors = getAppColors(useColorScheme());

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.canvas }]}>
      <View style={styles.content}>
        <Text style={[styles.kicker, { color: colors.success }]}>Confirmed</Text>
        <Text style={[styles.title, { color: colors.text }]}>You&apos;re awake.</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {params.contactName
            ? `${params.contactName} will not be notified.`
            : 'Your accountability contact will not be notified.'}
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>
            Back Home
          </Text>
        </Pressable>
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
  kicker: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 38,
    fontWeight: '800',
    lineHeight: 42,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    marginTop: 14,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    marginTop: 28,
    paddingVertical: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
