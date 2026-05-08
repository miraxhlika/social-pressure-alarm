import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { Fonts, Radius, Spacing, TextPresets, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { writeScopedStorageValue } from '@/lib/storage';
import { useSocialSession } from '@/providers/social-session-provider';

const SYNC_CHOICE_STORAGE_KEY = 'social-pressure-alarm/sync-choice';

export default function SyncScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const { authProviderInFlight, configured, continueWithApple, continueWithGoogle } = useSocialSession();
  const supportsAppleSignIn = Platform.OS === 'ios';
  const isSyncing = Boolean(authProviderInFlight);

  const handleEnableSync = async () => {
    if (!configured) {
      Alert.alert('Sync is not configured', 'Local checkpoints still work. Add backend configuration before enabling sync.');
      return;
    }

    try {
      if (supportsAppleSignIn) {
        await continueWithApple();
      } else {
        await continueWithGoogle();
      }
      router.replace('/circles');
    } catch (error) {
      Alert.alert('Unable to enable sync', error instanceof Error ? error.message : 'Sync could not be enabled right now.');
    }
  };

  const handleKeepLocalOnly = async () => {
    await writeScopedStorageValue(SYNC_CHOICE_STORAGE_KEY, 'local-only');
    router.replace('/circles');
  };

  return (
    <AppScreen contentStyle={styles.content}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Optional Sync{'\n'}You&apos;re in control.</Text>
        <View style={[styles.rule, { backgroundColor: colors.primary }]} />
        <Text style={[styles.subtitle, { color: colors.textSoft }]}>
          The app is local-first by default. Sync is optional for backup and cross-device use.
        </Text>
      </View>

      <View style={styles.artWrap}>
        <View style={[styles.landscape, { backgroundColor: colors.panelMuted }]}>
          <View style={[styles.cloud, styles.cloudBack, { borderColor: colors.border }]} />
          <View style={[styles.cloud, { borderColor: colors.border }]}>
            <Ionicons color={colors.text} name="sync-outline" size={34} />
          </View>
          <View style={[styles.dashArc, { borderColor: colors.muted }]} />
          <View style={[styles.pedestal, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
            <View style={[styles.shield, { backgroundColor: colors.accent }]}>
              <Ionicons color="#FFFFFF" name="checkmark" size={44} />
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>Benefits of Sync</Text>
        <BenefitRow icon="shield-checkmark-outline" text="Secure backup of your data" />
        <BenefitRow icon="cloud-outline" text="Access your data on other devices" />
        <BenefitRow icon="swap-horizontal-outline" text="Seamless experience when you switch" />
      </View>

      <View style={[styles.privacyCard, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
        <View style={[styles.privacyIcon, { backgroundColor: colors.panelMuted }]}>
          <Ionicons color={colors.text} name="lock-closed-outline" size={22} />
        </View>
        <View style={styles.privacyCopy}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Privacy First</Text>
          <Text style={[styles.smallText, { color: colors.textSoft }]}>Your data is encrypted end-to-end. We can&apos;t read it.</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={isSyncing}
          onPress={handleEnableSync}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.text, borderColor: colors.text },
            isSyncing ? styles.disabled : null,
            pressed ? styles.pressed : null,
          ]}>
          <Text style={[styles.primaryButtonText, { color: colors.elevated }]}>{isSyncing ? 'Enabling Sync...' : 'Enable Sync'}</Text>
          <Ionicons color={colors.elevated} name="chevron-forward" size={18} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleKeepLocalOnly}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: colors.elevated, borderColor: colors.borderStrong },
            pressed ? styles.pressed : null,
          ]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Keep Local Only</Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}

function BenefitRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.benefitRow}>
      <View style={[styles.benefitIcon, { backgroundColor: colors.panelMuted }]}>
        <Ionicons color={colors.text} name={icon} size={17} />
      </View>
      <Text style={[styles.benefitText, { color: colors.textSoft }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    textAlign: 'center',
  },
  rule: {
    borderRadius: Radius.pill,
    height: 2,
    width: 42,
  },
  subtitle: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 270,
    textAlign: 'center',
  },
  artWrap: {
    alignItems: 'center',
    minHeight: 190,
    justifyContent: 'center',
  },
  landscape: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    height: 174,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  cloud: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: 1,
    height: 68,
    justifyContent: 'center',
    position: 'absolute',
    right: 34,
    top: 48,
    width: 92,
  },
  cloudBack: {
    opacity: 0.35,
    right: 20,
    top: 38,
  },
  dashArc: {
    borderRadius: Radius.pill,
    borderStyle: 'dashed',
    borderTopWidth: 2,
    height: 52,
    left: 118,
    position: 'absolute',
    top: 34,
    transform: [{ rotate: '15deg' }],
    width: 92,
  },
  pedestal: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    bottom: 18,
    height: 54,
    justifyContent: 'center',
    left: 44,
    position: 'absolute',
    width: 112,
  },
  shield: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    height: 82,
    justifyContent: 'center',
    marginTop: -42,
    width: 72,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  cardTitle: {
    ...TextPresets.label,
  },
  benefitRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 34,
  },
  benefitIcon: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  benefitText: {
    ...TextPresets.body,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  privacyCard: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  privacyIcon: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  privacyCopy: {
    flex: 1,
    gap: 2,
  },
  smallText: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    gap: Spacing.sm,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: Spacing.xl,
  },
  primaryButtonText: {
    ...TextPresets.label,
    flex: 1,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.xl,
  },
  secondaryButtonText: {
    ...TextPresets.label,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.88,
  },
});
