import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCameraPermissions } from 'expo-camera';
import type { User } from '@supabase/supabase-js';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Linking, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionRow, ActionRowGlyph } from '@/components/ui/action-row';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { SectionHeader } from '@/components/ui/section-header';
import { StateCard } from '@/components/ui/state-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { clearUnusedCheckpointPresets, readAlarmStore, resetAlarmStore } from '@/lib/alarms';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPermissionState,
  cancelAlarmNotificationAsync,
  ensureNotificationPermissionsAsync,
  getNotificationPermissionState,
  readNotificationPreferences,
  saveNotificationPreferences,
  syncNotificationStrategyAsync,
  syncWeeklyReviewReminderAsync,
} from '@/lib/notifications';
import { DEFAULT_APP_PREFERENCES, AppPreferences, readAppPreferences, saveAppPreferences } from '@/lib/preferences';
import { resetSocialSyncState } from '@/lib/social/queue';
import { getActiveStorageScope } from '@/lib/storage';
import { useSocialSession } from '@/providers/social-session-provider';
import { AlarmProofStrictness } from '@/types/alarm';

type FormFeedbackTone = 'success' | 'danger' | 'warning';
type ProfileFieldErrors = {
  displayName?: string;
  handle?: string;
  timezone?: string;
};
type FormFeedback = {
  tone: FormFeedbackTone;
  message: string;
};
type SettingsPanel = 'notifications' | 'reminders' | 'codes' | 'strictness' | 'privacy' | null;
type ProofCodeStats = {
  linkedCodeCount: number;
  savedPresetCount: number;
  unusedPresetCount: number;
  strictCount: number;
  standardCount: number;
};

const EMPTY_PROOF_CODE_STATS: ProofCodeStats = {
  linkedCodeCount: 0,
  savedPresetCount: 0,
  unusedPresetCount: 0,
  strictCount: 0,
  standardCount: 0,
};
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const COMMON_TIMEZONES = [
  'UTC',
  DEFAULT_TIMEZONE,
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
];
const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

function getMetadataString(user: User | null | undefined, ...keys: string[]) {
  const metadata = user?.user_metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getProviderLabel(user: User | null | undefined) {
  const provider = typeof user?.app_metadata?.provider === 'string' ? user.app_metadata.provider : null;

  if (provider === 'apple') {
    return 'Apple';
  }

  if (provider === 'google') {
    return 'Google';
  }

  return null;
}

function formatSeedLabel(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function createSuggestedDisplayName(user?: User | null) {
  const fullName = getMetadataString(user, 'full_name', 'name');

  if (fullName) {
    return fullName;
  }

  const firstName = getMetadataString(user, 'given_name', 'first_name');
  const lastName = getMetadataString(user, 'family_name', 'last_name');
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();

  if (combinedName) {
    return combinedName;
  }

  if (!user?.email) {
    return '';
  }

  const localPart = user.email.split('@')[0] ?? '';
  return formatSeedLabel(localPart);
}

function normalizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

function createSuggestedHandle(user?: User | null) {
  const preferredHandle = getMetadataString(user, 'preferred_username', 'user_name', 'nickname');

  if (preferredHandle) {
    return normalizeHandle(preferredHandle);
  }

  if (user?.email) {
    return normalizeHandle(user.email.split('@')[0] ?? '');
  }

  return normalizeHandle(createSuggestedDisplayName(user));
}

function getAccountLabel(user: User | null) {
  return user?.email ?? getMetadataString(user, 'email') ?? `${getProviderLabel(user) ?? 'Connected'} account`;
}

function getSuggestedTimezones(...zones: (string | null | undefined)[]) {
  const supportedTimezones = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [];
  const hasSupportedTimezones = supportedTimezones.length > 0;

  return Array.from(new Set([...zones, ...COMMON_TIMEZONES].filter((zone): zone is string => Boolean(zone))))
    .filter((zone) => !hasSupportedTimezones || supportedTimezones.includes(zone))
    .slice(0, 8);
}

function getProfileErrors({
  displayName,
  handle,
  timezone,
}: {
  displayName: string;
  handle: string;
  timezone: string;
}): ProfileFieldErrors {
  const trimmedDisplayName = displayName.trim();
  const normalizedHandle = normalizeHandle(handle);
  const trimmedTimezone = timezone.trim();
  const supportedTimezones = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [];
  const hasSupportedTimezones = supportedTimezones.length > 0;
  const errors: ProfileFieldErrors = {};

  if (!trimmedDisplayName) {
    errors.displayName = 'Add the name your circle will recognize.';
  }

  if (!normalizedHandle) {
    errors.handle = 'Choose a handle for circles and the activity feed.';
  } else if (normalizedHandle.length < 3) {
    errors.handle = 'Use at least 3 letters or numbers.';
  }

  if (!trimmedTimezone) {
    errors.timezone = 'Choose the timezone used for social timing.';
  } else if (hasSupportedTimezones && !supportedTimezones.includes(trimmedTimezone)) {
    errors.timezone = 'Use one of the suggested IANA timezones, like Europe/Skopje.';
  }

  return errors;
}

function getFriendlyProfileError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Your profile could not be saved right now.';

  if (/duplicate key|profiles_handle_key|handle/i.test(message)) {
    return 'That handle is already taken. Try another one.';
  }

  return message;
}

function hasErrors(errors: Record<string, string | undefined>) {
  return Object.values(errors).some(Boolean);
}

function getProofCodeStatsDescription(stats: ProofCodeStats) {
  if (stats.linkedCodeCount === 0) {
    return 'No proof codes are linked yet. Create a checkpoint to save the first exact QR or barcode.';
  }

  return `${stats.linkedCodeCount} linked proof code${stats.linkedCodeCount === 1 ? '' : 's'} across saved checkpoints. ${
    stats.savedPresetCount
  } reusable preset${stats.savedPresetCount === 1 ? '' : 's'} kept for faster setup.`;
}

function getFeedbackColors(tone: FormFeedbackTone, colors: ReturnType<typeof getAppColors>) {
  if (tone === 'danger') {
    return {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.danger,
      textColor: colors.danger,
    };
  }

  if (tone === 'warning') {
    return {
      backgroundColor: colors.warningSurface,
      borderColor: colors.warning,
      textColor: colors.warning,
    };
  }

  return {
    backgroundColor: colors.successSurface,
    borderColor: colors.success,
    textColor: colors.success,
  };
}

function getNotificationPermissionLabel(state: NotificationPermissionState) {
  switch (state) {
    case 'granted':
      return 'Allowed';
    case 'provisional':
      return 'Quietly allowed';
    case 'denied':
      return 'Blocked';
    default:
      return 'Not set';
  }
}

function getNotificationPermissionTone(state: NotificationPermissionState) {
  switch (state) {
    case 'granted':
      return 'success' as const;
    case 'provisional':
      return 'primary' as const;
    default:
      return 'warning' as const;
  }
}

function getNotificationPermissionHelper(state: NotificationPermissionState) {
  switch (state) {
    case 'granted':
      return 'Core checkpoint alerts can fire on time. Optional reminders use the switches below.';
    case 'provisional':
      return 'Notifications can arrive quietly. Open device settings if you want banners and sound.';
    case 'denied':
      return 'Device notifications are blocked right now. Core checkpoint alerts and optional reminders will stay quiet until you re-enable them in system settings.';
    default:
      return 'Turn notifications on when prompted so your live checkpoints can ring on time.';
  }
}

function getCameraPermissionLabel(permission: ReturnType<typeof useCameraPermissions>[0]) {
  if (permission?.granted) {
    return 'Allowed';
  }

  if (permission?.canAskAgain === false) {
    return 'Blocked';
  }

  return 'Not set';
}

function getCameraPermissionHelper(permission: ReturnType<typeof useCameraPermissions>[0]) {
  if (permission?.granted) {
    return 'Camera access is ready for linking and clearing proof codes.';
  }

  if (permission?.canAskAgain === false) {
    return 'Camera access is blocked in device settings. Manual entry stays available, but scanning needs camera access.';
  }

  return 'Allow camera access before your first live checkpoint so proof-code scans are ready.';
}

function getProofStrictnessLabel(strictness: AlarmProofStrictness) {
  return strictness === 'strict' ? 'Strict' : 'Standard';
}

export default function AccountScreen() {
  const router = useRouter();
  const colors = getAppColors(useColorScheme());
  const {
    configured,
    isLoading,
    isProfileLoading,
    profile,
    profileError,
    refreshProfile,
    saveProfile,
    user,
  } = useSocialSession();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [allowCircleNotifications, setAllowCircleNotifications] = useState(true);
  const [allowMissedAlarmAlerts, setAllowMissedAlarmAlerts] = useState(true);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [hasAttemptedProfileSubmit, setHasAttemptedProfileSubmit] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<FormFeedback | null>(null);
  const [notificationPermissionState, setNotificationPermissionState] =
    useState<NotificationPermissionState>('undetermined');
  const [reminderPreferences, setReminderPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isReminderPreferencesLoading, setIsReminderPreferencesLoading] = useState(true);
  const [isReminderPreferencesSubmitting, setIsReminderPreferencesSubmitting] = useState(false);
  const [reminderFeedback, setReminderFeedback] = useState<FormFeedback | null>(null);
  const [dataFeedback, setDataFeedback] = useState<FormFeedback | null>(null);
  const [isExportingData, setIsExportingData] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [proofCodeStats, setProofCodeStats] = useState<ProofCodeStats>(EMPTY_PROOF_CODE_STATS);
  const [isProofCodeStatsLoading, setIsProofCodeStatsLoading] = useState(true);
  const [codeFeedback, setCodeFeedback] = useState<FormFeedback | null>(null);
  const [isClearingUnusedCodes, setIsClearingUnusedCodes] = useState(false);
  const [appPreferences, setAppPreferences] = useState<AppPreferences>(DEFAULT_APP_PREFERENCES);
  const [isAppPreferencesLoading, setIsAppPreferencesLoading] = useState(true);
  const [isAppPreferencesSubmitting, setIsAppPreferencesSubmitting] = useState(false);
  const [deviceFeedback, setDeviceFeedback] = useState<FormFeedback | null>(null);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>(null);
  const suggestedDisplayName = createSuggestedDisplayName(user);
  const suggestedHandle = createSuggestedHandle(user);
  const signedInAccountLabel = getAccountLabel(user);

  useEffect(() => {
    const hydrationKey = `${user?.id ?? 'signed-out'}:${profile?.updatedAt ?? 'no-profile'}`;

    if (hydratedFormKeyRef.current === hydrationKey) {
      return;
    }

    hydratedFormKeyRef.current = hydrationKey;
    setDisplayName(profile?.displayName ?? suggestedDisplayName);
    setHandle(profile?.handle ?? suggestedHandle);
    setTimezone(profile?.timezone ?? DEFAULT_TIMEZONE);
    setAllowCircleNotifications(profile?.allowCircleNotifications ?? true);
    setAllowMissedAlarmAlerts(profile?.allowMissedAlarmAlerts ?? true);
    setProfileFeedback(null);
    setHasAttemptedProfileSubmit(false);
  }, [profile, suggestedDisplayName, suggestedHandle, user?.id]);

  const profileErrors = getProfileErrors({
    displayName,
    handle,
    timezone,
  });
  const normalizedHandle = normalizeHandle(handle);
  const timezoneSuggestions = getSuggestedTimezones(timezone, profile?.timezone, DEFAULT_TIMEZONE);
  const profileFeedbackColors = profileFeedback ? getFeedbackColors(profileFeedback.tone, colors) : null;
  const reminderFeedbackColors = reminderFeedback ? getFeedbackColors(reminderFeedback.tone, colors) : null;
  const dataFeedbackColors = dataFeedback ? getFeedbackColors(dataFeedback.tone, colors) : null;
  const codeFeedbackColors = codeFeedback ? getFeedbackColors(codeFeedback.tone, colors) : null;
  const deviceFeedbackColors = deviceFeedback ? getFeedbackColors(deviceFeedback.tone, colors) : null;
  const handleHelper =
    normalizedHandle.length >= 3
      ? `Circle members will see @${normalizedHandle}.`
      : 'Lowercase only, with letters, numbers, and underscores.';
  const notificationPermissionLabel = getNotificationPermissionLabel(notificationPermissionState);
  const notificationPermissionHelper = getNotificationPermissionHelper(notificationPermissionState);
  const cameraPermissionLabel = getCameraPermissionLabel(cameraPermission);
  const cameraPermissionHelper = getCameraPermissionHelper(cameraPermission);
  const proofCodeStatsDescription = getProofCodeStatsDescription(proofCodeStats);

  const loadReminderSettings = useCallback(async () => {
    setIsReminderPreferencesLoading(true);

    try {
      const [storedPreferences, permissionState] = await Promise.all([
        readNotificationPreferences(),
        getNotificationPermissionState(),
      ]);

      setReminderPreferences(storedPreferences);
      setNotificationPermissionState(permissionState);
      setReminderFeedback(null);
    } finally {
      setIsReminderPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReminderSettings();
  }, [loadReminderSettings]);

  const loadAppPreferences = useCallback(async () => {
    setIsAppPreferencesLoading(true);

    try {
      setAppPreferences(await readAppPreferences());
      setDeviceFeedback(null);
    } finally {
      setIsAppPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAppPreferences();
  }, [loadAppPreferences, user?.id]);

  const loadProofCodeStats = useCallback(async () => {
    setIsProofCodeStatsLoading(true);

    try {
      const store = await readAlarmStore();
      const linkedPresetKeys = new Set(
        store.alarms.map((alarm) => `${alarm.label.trim().toLowerCase()}::${alarm.expectedQrPayload}`)
      );

      setProofCodeStats({
        linkedCodeCount: store.alarms.filter((alarm) => alarm.expectedQrPayload.trim().length > 0).length,
        savedPresetCount: store.checkpointPresets.length,
        unusedPresetCount: store.checkpointPresets.filter(
          (preset) => !linkedPresetKeys.has(`${preset.label.trim().toLowerCase()}::${preset.expectedQrPayload}`)
        ).length,
        strictCount: store.alarms.filter((alarm) => alarm.proofStrictness === 'strict').length,
        standardCount: store.alarms.filter((alarm) => alarm.proofStrictness === 'standard').length,
      });
    } finally {
      setIsProofCodeStatsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProofCodeStats();
    }, [loadProofCodeStats])
  );

  const handleSaveProfile = async () => {
    setHasAttemptedProfileSubmit(true);

    if (hasErrors(profileErrors)) {
      setProfileFeedback(null);
      return;
    }

    const trimmedDisplayName = displayName.trim();
    const trimmedTimezone = timezone.trim();

    setIsProfileSubmitting(true);
    setProfileFeedback(null);

    try {
      await saveProfile({
        displayName: trimmedDisplayName,
        handle: normalizedHandle,
        timezone: trimmedTimezone,
        allowCircleNotifications,
        allowMissedAlarmAlerts,
      });
      setHandle(normalizedHandle);
      setTimezone(trimmedTimezone);
      setProfileFeedback({
        tone: 'success',
        message: 'Profile saved.',
      });
    } catch (error) {
      setProfileFeedback({
        tone: 'danger',
        message: getFriendlyProfileError(error),
      });
    } finally {
      setIsProfileSubmitting(false);
    }
  };

  const handleReviewCheckpoints = () => {
    router.push('/alarms');
  };

  const handleRequestCameraAccess = async () => {
    setDeviceFeedback(null);

    if (cameraPermission?.canAskAgain === false) {
      await Linking.openSettings();
      return;
    }

    const nextPermission = await requestCameraPermission();

    setDeviceFeedback({
      tone: nextPermission.granted ? 'success' : 'warning',
      message: nextPermission.granted
        ? 'Camera access is ready for proof-code scanning.'
        : 'Camera access is still unavailable. Manual entry remains available for setup and recovery.',
    });
  };

  const handleRequestNotificationAccess = async () => {
    setReminderFeedback(null);
    setActiveSettingsPanel('notifications');

    try {
      const granted = await ensureNotificationPermissionsAsync();
      const nextPermissionState = await getNotificationPermissionState();
      setNotificationPermissionState(nextPermissionState);
      setReminderFeedback({
        tone: granted ? 'success' : 'warning',
        message: granted
          ? 'Notifications are ready for checkpoint reminders and optional alerts.'
          : 'Notifications are still blocked. You can re-enable them from device settings.',
      });
    } catch (error) {
      setReminderFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Notification access could not be updated right now.',
      });
    }
  };

  const handleShowAccessibilityInfo = () => {
    Alert.alert(
      'Accessibility',
      'The app follows device text scaling, safe-area layout, reduced-motion expectations, and system permission controls.',
      [
        {
          text: 'Open Settings',
          onPress: () => {
            void Linking.openSettings();
          },
        },
        {
          text: 'Done',
          style: 'cancel',
        },
      ]
    );
  };

  const handleSaveDefaultProofStrictness = async (defaultProofStrictness: AlarmProofStrictness) => {
    setIsAppPreferencesSubmitting(true);
    setDeviceFeedback(null);

    try {
      const nextPreferences = await saveAppPreferences({
        ...appPreferences,
        defaultProofStrictness,
      });
      setAppPreferences(nextPreferences);
      setDeviceFeedback({
        tone: 'success',
        message: `${getProofStrictnessLabel(defaultProofStrictness)} is now the default for new checkpoints.`,
      });
    } catch (error) {
      setDeviceFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Default checkpoint settings could not be saved right now.',
      });
    } finally {
      setIsAppPreferencesSubmitting(false);
    }
  };

  const clearUnusedCodes = async () => {
    setIsClearingUnusedCodes(true);
    setCodeFeedback(null);

    try {
      const result = await clearUnusedCheckpointPresets();
      await loadProofCodeStats();
      setCodeFeedback({
        tone: 'success',
        message:
          result.removedCount === 0
            ? 'No unused saved proof codes to clear.'
            : `Cleared ${result.removedCount} unused saved proof code${result.removedCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setCodeFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Unused proof codes could not be cleared right now.',
      });
    } finally {
      setIsClearingUnusedCodes(false);
    }
  };

  const handleClearUnusedCodes = () => {
    if (proofCodeStats.unusedPresetCount === 0) {
      setCodeFeedback({
        tone: 'success',
        message: 'No unused saved proof codes to clear.',
      });
      return;
    }

    Alert.alert(
      'Clear unused saved codes?',
      'This removes reusable proof-code presets that are not currently linked to any checkpoint. Linked checkpoint proof codes stay unchanged.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Clear unused',
          style: 'destructive',
          onPress: () => {
            void clearUnusedCodes();
          },
        },
      ]
    );
  };

  const handleExportData = async () => {
    setIsExportingData(true);
    setDataFeedback(null);

    try {
      const [store, notificationPreferences, preferences, storageScope] = await Promise.all([
        readAlarmStore(),
        readNotificationPreferences(),
        readAppPreferences(),
        getActiveStorageScope(),
      ]);
      const exportedData = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        storageScope,
        sync: {
          configured,
          signedIn: Boolean(user),
          account: user ? getAccountLabel(user) : null,
          profile: profile
            ? {
                displayName: profile.displayName,
                handle: profile.handle,
                timezone: profile.timezone,
                allowCircleNotifications: profile.allowCircleNotifications,
                allowMissedAlarmAlerts: profile.allowMissedAlarmAlerts,
              }
            : null,
        },
        notificationPreferences,
        appPreferences: preferences,
        store,
      };
      const serializedData = JSON.stringify(exportedData, null, 2);

      await Clipboard.setStringAsync(serializedData);
      await Share.share({
        title: 'QR Checkpoint Alarm export',
        message: serializedData,
      });
      setDataFeedback({
        tone: 'success',
        message: 'Data export prepared and copied to the clipboard.',
      });
    } catch (error) {
      setDataFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Data export could not be prepared right now.',
      });
    } finally {
      setIsExportingData(false);
    }
  };

  const deleteCheckpointData = async () => {
    setIsDeletingData(true);
    setDataFeedback(null);

    try {
      const store = await readAlarmStore();
      await Promise.all(store.alarms.map((alarm) => cancelAlarmNotificationAsync(alarm.notificationIds)));
      await Promise.all([resetAlarmStore(), resetSocialSyncState()]);
      await Promise.all([loadReminderSettings(), loadProofCodeStats()]);
      setDataFeedback({
        tone: 'success',
        message: user
          ? 'Checkpoint data was deleted for this account and device.'
          : 'Local checkpoint data was deleted from this device.',
      });
    } catch (error) {
      setDataFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Data could not be deleted right now.',
      });
    } finally {
      setIsDeletingData(false);
    }
  };

  const handleDeleteData = () => {
    Alert.alert(
      'Delete checkpoint data?',
      user
        ? 'This clears saved checkpoints, proof history, queued social sync state, and scheduled notifications for the signed-in account on this device. Synced checkpoint backups are cleared when the backend is reachable.'
        : 'This clears saved checkpoints, proof history, queued sync state, and scheduled notifications from this device.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete data',
          style: 'destructive',
          onPress: () => {
            void deleteCheckpointData();
          },
        },
      ]
    );
  };

  const handleSaveReminderPreferences = async () => {
    const wantsOptionalReminder =
      reminderPreferences.urgencyRemindersEnabled ||
      reminderPreferences.eveningReadinessRemindersEnabled ||
      reminderPreferences.weeklyReviewRemindersEnabled;

    setIsReminderPreferencesSubmitting(true);
    setReminderFeedback(null);

    try {
      if (wantsOptionalReminder) {
        const hasPermission = await ensureNotificationPermissionsAsync();
        const nextPermissionState = await getNotificationPermissionState();
        setNotificationPermissionState(nextPermissionState);

        if (!hasPermission) {
          await saveNotificationPreferences(reminderPreferences);
          await syncWeeklyReviewReminderAsync(reminderPreferences, {
            requestPermissions: false,
          });
          setReminderFeedback({
            tone: 'warning',
            message: 'Preferences were saved, but notifications are still blocked in device settings.',
          });
          return;
        }
      }

      await syncNotificationStrategyAsync(reminderPreferences);
      setNotificationPermissionState(await getNotificationPermissionState());
      setReminderFeedback({
        tone: 'success',
        message: 'Reminder preferences saved.',
      });
    } catch (error) {
      setReminderFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Reminder preferences could not be updated right now.',
      });
    } finally {
      setIsReminderPreferencesSubmitting(false);
    }
  };

  return (
    <AppScreen backgroundColor={colors.elevated} contentStyle={styles.flowContent} keyboardAware>
      <FlowHeader
        subtitle="Transparent. Secure. Yours."
        title="Settings & Privacy"
      />

      <View style={styles.settingsList}>
        <SettingsRow
          icon={user ? 'person-circle-outline' : 'person-outline'}
          subtitle={user ? signedInAccountLabel : 'Enable sync, backup, and circles'}
          title={user ? 'Signed In' : 'Optional Sign In'}
          value={user ? 'Manage' : configured ? undefined : 'Unavailable'}
          onPress={() => {
            if (user) {
              setActiveSettingsPanel(activeSettingsPanel === 'privacy' ? null : 'privacy');
              return;
            }

            router.push('/sync');
          }}
        />
        <SettingsRow
          icon="notifications-outline"
          subtitle="Customize reminders and alerts"
          title="Notifications"
          value={notificationPermissionLabel}
          onPress={() => {
            void handleRequestNotificationAccess();
          }}
        />
        <SettingsRow
          icon="camera-outline"
          subtitle="QR scanning and camera access"
          title="Camera"
          value={cameraPermissionLabel}
          onPress={() => {
            void handleRequestCameraAccess();
            setActiveSettingsPanel('notifications');
          }}
        />
        <SettingsRow
          icon="qr-code-outline"
          subtitle="Add, edit, and organize codes"
          title="Code Management"
          value={isProofCodeStatsLoading ? 'Loading' : `${proofCodeStats.linkedCodeCount} linked`}
          onPress={() => setActiveSettingsPanel(activeSettingsPanel === 'codes' ? null : 'codes')}
        />
        <SettingsRow
          icon="time-outline"
          subtitle="Timing, snooze, and persistence"
          title="Reminder Behavior"
          onPress={() => setActiveSettingsPanel(activeSettingsPanel === 'reminders' ? null : 'reminders')}
        />
        <SettingsRow
          icon="sparkles-outline"
          subtitle="Set default strictness level"
          title="Strictness Defaults"
          value={getProofStrictnessLabel(appPreferences.defaultProofStrictness)}
          onPress={() => setActiveSettingsPanel(activeSettingsPanel === 'strictness' ? null : 'strictness')}
        />
      </View>

      {activeSettingsPanel === 'notifications' ? (
        <SettingsDetailCard
          title="Device access"
          description={`${notificationPermissionHelper} ${cameraPermissionHelper}`}
          feedback={reminderFeedback}
          feedbackColors={reminderFeedbackColors}
          secondaryFeedback={deviceFeedback}
          secondaryFeedbackColors={deviceFeedbackColors}
        />
      ) : null}

      {activeSettingsPanel === 'reminders' ? (
        <AppCard elevated tone="canvas">
          <SectionHeader
            action={<StatusPill label={notificationPermissionLabel} tone={getNotificationPermissionTone(notificationPermissionState)} />}
            kicker="Device reminders"
            size="compact"
            title="Reminder behavior"
            description="Core checkpoint alerts still follow your schedules. These switches only control extra nudges."
          />
          {isReminderPreferencesLoading ? (
            <Text style={[styles.helperCaption, { color: colors.muted }]}>Loading reminder preferences...</Text>
          ) : (
            <>
              <PreferenceSwitch
                label="Urgency reminder"
                description="Send one follow-up while a live checkpoint window is still open."
                value={reminderPreferences.urgencyRemindersEnabled}
                onValueChange={(value) => {
                  setReminderPreferences((current) => ({ ...current, urgencyRemindersEnabled: value }));
                  setReminderFeedback(null);
                }}
              />
              <PreferenceSwitch
                label="Evening readiness reminder"
                description="For morning checkpoints, send one low-noise prep reminder the night before."
                value={reminderPreferences.eveningReadinessRemindersEnabled}
                onValueChange={(value) => {
                  setReminderPreferences((current) => ({ ...current, eveningReadinessRemindersEnabled: value }));
                  setReminderFeedback(null);
                }}
              />
              <PreferenceSwitch
                label="Weekly review reminder"
                description="Send one Sunday-evening prompt to review what held and what needs work."
                value={reminderPreferences.weeklyReviewRemindersEnabled}
                onValueChange={(value) => {
                  setReminderPreferences((current) => ({ ...current, weeklyReviewRemindersEnabled: value }));
                  setReminderFeedback(null);
                }}
              />
              {reminderFeedback && reminderFeedbackColors ? (
                <FeedbackMessage colors={reminderFeedbackColors} message={reminderFeedback.message} />
              ) : null}
              <AppButton
                disabled={isReminderPreferencesSubmitting}
                label={isReminderPreferencesSubmitting ? 'Saving...' : 'Save reminder preferences'}
                onPress={handleSaveReminderPreferences}
                variant="secondary"
              />
            </>
          )}
        </AppCard>
      ) : null}

      {activeSettingsPanel === 'codes' ? (
        <AppCard elevated tone="canvas">
          <SectionHeader
            action={
              <StatusPill
                label={isProofCodeStatsLoading ? 'Loading' : `${proofCodeStats.linkedCodeCount} linked`}
                tone={proofCodeStats.linkedCodeCount > 0 ? 'success' : 'default'}
              />
            }
            kicker="Code management"
            size="compact"
            title="Proof codes live on checkpoints"
            description={proofCodeStatsDescription}
          />
          <View style={styles.buttonGroup}>
            <AppButton label="Review checkpoints" onPress={handleReviewCheckpoints} variant="secondary" />
            <AppButton
              disabled={isProofCodeStatsLoading || isClearingUnusedCodes}
              label={isClearingUnusedCodes ? 'Clearing...' : 'Clear unused saved codes'}
              onPress={handleClearUnusedCodes}
              variant="ghost"
            />
          </View>
          {codeFeedback && codeFeedbackColors ? (
            <FeedbackMessage colors={codeFeedbackColors} message={codeFeedback.message} />
          ) : null}
        </AppCard>
      ) : null}

      {activeSettingsPanel === 'strictness' ? (
        <AppCard elevated tone="canvas">
          <SectionHeader
            kicker="Defaults"
            size="compact"
            title="Strictness defaults"
            description="Existing checkpoints keep their saved strictness. This only changes new checkpoint setup."
          />
          <View style={styles.modeGrid}>
            <ActionRow
              description="Use original exact-match behavior for every new checkpoint."
              disabled={isAppPreferencesLoading || isAppPreferencesSubmitting}
              leading={<ActionRowGlyph label="X" />}
              onPress={() => {
                void handleSaveDefaultProofStrictness('strict');
              }}
              statusLabel={appPreferences.defaultProofStrictness === 'strict' ? 'Default' : 'Available'}
              statusTone={appPreferences.defaultProofStrictness === 'strict' ? 'success' : 'default'}
              style={styles.modeRow}
              title="Strict"
            />
            <ActionRow
              description="Keep exact-match proof with more guided fallback copy."
              disabled={isAppPreferencesLoading || isAppPreferencesSubmitting}
              leading={<ActionRowGlyph label="S" />}
              onPress={() => {
                void handleSaveDefaultProofStrictness('standard');
              }}
              statusLabel={appPreferences.defaultProofStrictness === 'standard' ? 'Default' : 'Available'}
              statusTone={appPreferences.defaultProofStrictness === 'standard' ? 'primary' : 'default'}
              style={styles.modeRow}
              title="Standard"
            />
          </View>
          {deviceFeedback && deviceFeedbackColors ? (
            <FeedbackMessage colors={deviceFeedbackColors} message={deviceFeedback.message} />
          ) : null}
        </AppCard>
      ) : null}

      <View style={styles.settingsList}>
        <SettingsRow
          icon="download-outline"
          subtitle="Save or transfer your data"
          title="Export Data"
          value={isExportingData ? 'Working' : undefined}
          onPress={handleExportData}
        />
        <SettingsRow
          icon="trash-outline"
          subtitle="Permanently delete your data"
          title="Delete Data"
          value={isDeletingData ? 'Working' : undefined}
          onPress={handleDeleteData}
        />
      </View>

      {dataFeedback && dataFeedbackColors ? (
        <FeedbackMessage colors={dataFeedbackColors} message={dataFeedback.message} />
      ) : null}

      <View style={styles.settingsList}>
        <SettingsRow
          icon="accessibility-outline"
          subtitle="Display, motion, and interaction"
          title="Accessibility"
          onPress={handleShowAccessibilityInfo}
        />
        <SettingsRow
          icon="lock-closed-outline"
          subtitle="Encryption, sync, and permissions"
          title="Privacy Controls"
          onPress={() => setActiveSettingsPanel(activeSettingsPanel === 'privacy' ? null : 'privacy')}
        />
      </View>

      {activeSettingsPanel === 'privacy' ? (
        <AppCard elevated tone="canvas">
          {configured && isLoading ? (
            <LoadingBlock description="Checking your account session and profile." title="Loading account" />
          ) : !configured || !user ? (
            <SectionHeader
              kicker="Privacy"
              size="compact"
              title="Your data stays on your device"
              description="Sync and circles remain optional. Enable sync above only when you want backup or private accountability."
            />
          ) : isProfileLoading && !profile ? (
            <LoadingBlock description="Pulling down your name, handle, timezone, and alert preferences." title="Loading profile" />
          ) : profileError && !profile ? (
            <StateCard
              actionLabel="Try again"
              description={profileError}
              onAction={() => {
                void refreshProfile();
              }}
              title="Could not load your profile"
              tone="danger"
            />
          ) : (
            <>
              <SectionHeader
                kicker="Signed in"
                size="compact"
                title={profile?.displayName || suggestedDisplayName || 'Your account'}
                description={`${profile?.handle ? `@${profile.handle}` : 'Finish your profile to show up clearly in circles.'} ${signedInAccountLabel}`}
              />
              <AppInput
                autoCapitalize="words"
                error={hasAttemptedProfileSubmit ? profileErrors.displayName : undefined}
                helper="Use the name your circle will recognize quickly."
                label="Display name"
                onChangeText={(value) => {
                  setDisplayName(value);
                  setProfileFeedback(null);
                }}
                placeholder="Early Riser"
                value={displayName}
              />
              <AppInput
                autoCapitalize="none"
                autoCorrect={false}
                error={hasAttemptedProfileSubmit ? profileErrors.handle : undefined}
                helper={hasAttemptedProfileSubmit && profileErrors.handle ? undefined : handleHelper}
                label="Handle"
                onChangeText={(value) => {
                  setHandle(normalizeHandle(value));
                  setProfileFeedback(null);
                }}
                placeholder="early_riser"
                value={handle}
              />
              <AppInput
                autoCapitalize="none"
                autoCorrect={false}
                error={hasAttemptedProfileSubmit ? profileErrors.timezone : undefined}
                helper="Used for circle timestamps and checkpoint follow-up timing."
                label="Timezone"
                onChangeText={(value) => {
                  setTimezone(value);
                  setProfileFeedback(null);
                }}
                placeholder="Europe/Skopje"
                value={timezone}
              />
              <View style={styles.timezoneSuggestions}>
                {timezoneSuggestions.map((zone) => {
                  const isSelected = timezone === zone;

                  return (
                    <Pressable
                      key={zone}
                      accessibilityHint="Sets the profile timezone."
                      accessibilityLabel={`Use timezone ${zone}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => {
                        setTimezone(zone);
                        setProfileFeedback(null);
                      }}
                      style={[
                        styles.timezoneChip,
                        {
                          backgroundColor: isSelected ? colors.primarySurface : colors.elevated,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}>
                      <Text style={[styles.timezoneChipLabel, { color: isSelected ? colors.primary : colors.textSoft }]}>
                        {zone}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <PreferenceSwitch
                label="Circle notifications"
                description="Updates for circles, invites, and shared progress."
                value={allowCircleNotifications}
                onValueChange={(value) => {
                  setAllowCircleNotifications(value);
                  setProfileFeedback(null);
                }}
              />
              <PreferenceSwitch
                label="Missed-checkpoint alerts"
                description="Alerts when you miss a scheduled checkpoint."
                value={allowMissedAlarmAlerts}
                onValueChange={(value) => {
                  setAllowMissedAlarmAlerts(value);
                  setProfileFeedback(null);
                }}
              />
              {profileError ? <Text style={[TextPresets.body, { color: colors.danger }]}>{profileError}</Text> : null}
              {profileFeedback && profileFeedbackColors ? (
                <FeedbackMessage colors={profileFeedbackColors} message={profileFeedback.message} />
              ) : null}
              <AppButton
                disabled={isProfileSubmitting || isProfileLoading}
                label={isProfileSubmitting || isProfileLoading ? 'Saving...' : 'Save profile'}
                onPress={handleSaveProfile}
              />
            </>
          )}
        </AppCard>
      ) : null}

      <View style={[styles.localFooter, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
        <Ionicons color={colors.textSoft} name="lock-closed-outline" size={20} />
        <Text style={[styles.helperCaption, { color: colors.textSoft }]}>
          Your data stays on your device. You are always in control.
        </Text>
      </View>
    </AppScreen>
  );
}

function FlowHeader({
  subtitle,
  title,
}: {
  subtitle: string;
  title: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.flowHeader}>
      <Text style={[styles.flowTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.flowSubtitle, { color: colors.textSoft }]}>{subtitle}</Text>
      <View style={[styles.flowRule, { backgroundColor: colors.primary }]} />
    </View>
  );
}

function SettingsRow({
  icon,
  onPress,
  subtitle,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  subtitle: string;
  title: string;
  value?: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}${value ? `. ${value}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        {
          backgroundColor: colors.elevated,
          borderColor: colors.line,
        },
        pressed ? styles.rowPressed : null,
      ]}>
      <View style={[styles.settingsIcon, { backgroundColor: colors.panelMuted }]}>
        <Ionicons color={colors.text} name={icon} size={22} />
      </View>
      <View style={styles.settingsCopy}>
        <Text style={[styles.settingsTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.settingsSubtitle, { color: colors.textSoft }]}>{subtitle}</Text>
      </View>
      {value ? <Text style={[styles.settingsValue, { color: colors.muted }]}>{value}</Text> : null}
      <Ionicons color={colors.muted} name="chevron-forward" size={19} />
    </Pressable>
  );
}

function PreferenceSwitch({
  description,
  label,
  onValueChange,
  value,
}: {
  description: string;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
      <View style={styles.preferenceCopy}>
        <Text style={[TextPresets.label, { color: colors.text }]}>{label}</Text>
        <Text style={[TextPresets.body, { color: colors.muted }]}>{description}</Text>
      </View>
      <Switch
        accessibilityHint={`Turns ${label.toLowerCase()} on or off.`}
        accessibilityLabel={label}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

function FeedbackMessage({
  colors,
  message,
}: {
  colors: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
  };
  message: string;
}) {
  return (
    <View
      style={[
        styles.feedbackCard,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
        },
      ]}>
      <Text style={[TextPresets.body, { color: colors.textColor }]}>{message}</Text>
    </View>
  );
}

function SettingsDetailCard({
  description,
  feedback,
  feedbackColors,
  secondaryFeedback,
  secondaryFeedbackColors,
  title,
}: {
  description: string;
  feedback: FormFeedback | null;
  feedbackColors: ReturnType<typeof getFeedbackColors> | null;
  secondaryFeedback?: FormFeedback | null;
  secondaryFeedbackColors?: ReturnType<typeof getFeedbackColors> | null;
  title: string;
}) {
  return (
    <AppCard elevated tone="canvas">
      <SectionHeader kicker="Device access" size="compact" title={title} description={description} />
      {feedback && feedbackColors ? <FeedbackMessage colors={feedbackColors} message={feedback.message} /> : null}
      {secondaryFeedback && secondaryFeedbackColors ? (
        <FeedbackMessage colors={secondaryFeedbackColors} message={secondaryFeedback.message} />
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  flowContent: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  flowHeader: {
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  flowTitle: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    textAlign: 'center',
  },
  flowSubtitle: {
    ...TextPresets.body,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  flowRule: {
    borderRadius: Radius.pill,
    height: 2,
    marginTop: Spacing.sm,
    width: 42,
  },
  syncCard: {
    gap: Spacing.md,
  },
  syncBenefits: {
    gap: Spacing.sm,
  },
  miniRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 36,
  },
  miniIcon: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  miniText: {
    ...TextPresets.body,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  privacyNotice: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  privacyNoticeCopy: {
    flex: 1,
    gap: 2,
  },
  settingsList: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  settingsRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 68,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  rowPressed: {
    opacity: 0.88,
  },
  settingsIcon: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  settingsCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  settingsTitle: {
    ...TextPresets.label,
  },
  settingsSubtitle: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  settingsValue: {
    ...TextPresets.label,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 86,
    textAlign: 'right',
  },
  localFooter: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    maxWidth: 360,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    gap: Spacing.xl,
    padding: Spacing.xl,
    paddingBottom: 100,
  },
  authIntro: {
    marginBottom: Spacing.md,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  modeRow: {
    flexBasis: 220,
    flexGrow: 1,
  },
  modeCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    gap: Spacing.sm,
    minHeight: 108,
    padding: Spacing.lg,
  },
  modeTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  buttonGroup: {
    gap: Spacing.sm,
  },
  helperCaption: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  feedbackCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  accountStrip: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  accountAction: {
    alignSelf: 'flex-start',
  },
  accountCopy: {
    gap: Spacing.xs,
    maxWidth: 420,
  },
  accountTitle: {
    fontFamily: Fonts.rounded,
    fontSize: Type.title,
    fontWeight: '700',
    lineHeight: 30,
  },
  accountMeta: {
    ...TextPresets.label,
    fontSize: 16,
    lineHeight: 22,
  },
  summaryPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryPill: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  summaryPillLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  timezoneSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: -Spacing.xs,
  },
  timezoneChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  timezoneChipLabel: {
    ...TextPresets.label,
    fontSize: 13,
    lineHeight: 18,
  },
  preferenceRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  preferenceCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
});
