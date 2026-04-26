import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useCameraPermissions } from 'expo-camera';
import type { User } from '@supabase/supabase-js';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Linking, Pressable, Platform, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionRow, ActionRowGlyph } from '@/components/ui/action-row';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { LoadingBlock } from '@/components/ui/loading-block';
import { PageHeader } from '@/components/ui/page-header';
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
import { getActiveStorageScope, readScopedStorageValue, writeScopedStorageValue } from '@/lib/storage';
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
type SyncChoice = 'undecided' | 'local-only';
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
const SYNC_CHOICE_STORAGE_KEY = 'social-pressure-alarm/sync-choice';
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

function getFriendlyAuthError(error: unknown, authRedirectUrl: string) {
  const message = error instanceof Error ? error.message : 'The request could not be completed right now.';

  if (/canceled/i.test(message)) {
    return message;
  }

  if (/redirect|valid session|invalid_grant|grant/i.test(message)) {
    return `Could not finish sign-in. Confirm ${authRedirectUrl} is allowed in Supabase redirect URLs, then try again.`;
  }

  if (/provider/i.test(message)) {
    return 'That provider is not configured yet in Supabase. Finish the provider setup, then try again.';
  }

  return message;
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

async function readSyncChoice(): Promise<SyncChoice> {
  const storedChoice = await readScopedStorageValue(SYNC_CHOICE_STORAGE_KEY);
  return storedChoice.value === 'local-only' ? 'local-only' : 'undecided';
}

async function saveSyncChoice(choice: SyncChoice) {
  await writeScopedStorageValue(SYNC_CHOICE_STORAGE_KEY, choice);
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

function getCameraPermissionTone(permission: ReturnType<typeof useCameraPermissions>[0]) {
  if (permission?.granted) {
    return 'success' as const;
  }

  return 'warning' as const;
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
    authRedirectUrl,
    authProviderInFlight,
    continueWithApple,
    continueWithGoogle,
    configured,
    isLoading,
    isProfileLoading,
    profile,
    profileError,
    refreshProfile,
    signOut,
    saveProfile,
    user,
  } = useSocialSession();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [authFeedback, setAuthFeedback] = useState<FormFeedback | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [allowCircleNotifications, setAllowCircleNotifications] = useState(true);
  const [allowMissedAlarmAlerts, setAllowMissedAlarmAlerts] = useState(true);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasAttemptedProfileSubmit, setHasAttemptedProfileSubmit] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<FormFeedback | null>(null);
  const [notificationPermissionState, setNotificationPermissionState] =
    useState<NotificationPermissionState>('undetermined');
  const [reminderPreferences, setReminderPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isReminderPreferencesLoading, setIsReminderPreferencesLoading] = useState(true);
  const [isReminderPreferencesSubmitting, setIsReminderPreferencesSubmitting] = useState(false);
  const [reminderFeedback, setReminderFeedback] = useState<FormFeedback | null>(null);
  const [syncChoice, setSyncChoice] = useState<SyncChoice>('undecided');
  const [isSyncChoiceLoading, setIsSyncChoiceLoading] = useState(true);
  const [isSyncChoiceSubmitting, setIsSyncChoiceSubmitting] = useState(false);
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
  const suggestedDisplayName = createSuggestedDisplayName(user);
  const suggestedHandle = createSuggestedHandle(user);
  const signedInAccountLabel = getAccountLabel(user);
  const supportsAppleSignIn = Platform.OS === 'ios';
  const isGoogleSubmitting = authProviderInFlight === 'google';
  const isAppleSubmitting = authProviderInFlight === 'apple';

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
  const authFeedbackColors = authFeedback ? getFeedbackColors(authFeedback.tone, colors) : null;
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
  const isLocalOnlySelected = !user && syncChoice === 'local-only';
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

  const loadSyncChoice = useCallback(async () => {
    setIsSyncChoiceLoading(true);

    try {
      setSyncChoice(await readSyncChoice());
    } finally {
      setIsSyncChoiceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSyncChoice();
  }, [loadSyncChoice, user?.id]);

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

  const handleContinueWithGoogle = async () => {
    setAuthFeedback(null);

    try {
      await continueWithGoogle();
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: getFriendlyAuthError(error, authRedirectUrl),
      });
    }
  };

  const handleContinueWithApple = async () => {
    setAuthFeedback(null);

    try {
      await continueWithApple();
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: getFriendlyAuthError(error, authRedirectUrl),
      });
    }
  };

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

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setProfileFeedback(null);

    try {
      await signOut();
    } catch (error) {
      setProfileFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Sign-out failed right now.',
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleKeepLocalOnly = async () => {
    setIsSyncChoiceSubmitting(true);
    setAuthFeedback(null);

    try {
      await saveSyncChoice('local-only');
      setSyncChoice('local-only');
      setAuthFeedback({
        tone: 'success',
        message: 'Local-only mode saved. Sync and circles stay off until you turn them on here.',
      });
    } catch (error) {
      setAuthFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Local-only mode could not be saved right now.',
      });
    } finally {
      setIsSyncChoiceSubmitting(false);
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
    <AppScreen keyboardAware>
        <PageHeader
          eyebrow="Settings"
          title="Settings & Privacy"
          description="Choose local-only use, optional sync, reminders, data export, and circle privacy."
          badgeLabel={user ? 'Sync on' : isLocalOnlySelected ? 'Local only' : 'Guest'}
          badgeTone={user ? 'success' : 'warning'}
        />

        <AppCard elevated tone={user ? 'success' : isLocalOnlySelected ? 'canvas' : 'primary'}>
          <SectionHeader
            action={
              <StatusPill
                label={user ? 'Enabled' : isLocalOnlySelected ? 'Saved' : 'Optional'}
                tone={user ? 'success' : isLocalOnlySelected ? 'default' : 'primary'}
              />
            }
            kicker="Optional sync"
            title={user ? 'Secure backup is on' : isLocalOnlySelected ? 'Local-only mode' : 'Enable sync only if you want it'}
            description={
              user
                ? 'Your signed-in account can back up checkpoints, restore them on another device, and unlock circles.'
                : isLocalOnlySelected
                  ? 'Checkpoints, proof history, and preferences stay on this device. You can enable sync here later.'
                  : 'The app works locally without an account. Sync adds secure backup, cross-device access, and private circles.'
            }
          />

          <View style={styles.modeGrid}>
            <ActionRow
              description="Create and clear checkpoints on this device without sending proof history to an account."
              leading={<ActionRowGlyph label="L" />}
              statusLabel={user ? 'Off' : 'On'}
              statusTone={user ? 'default' : 'success'}
              style={styles.modeRow}
              title="Local-only use"
            />
            <ActionRow
              description="Sign in when you want checkpoint backup, restore, and circle invites."
              leading={<ActionRowGlyph label="S" />}
              statusLabel={user ? 'On' : 'Off'}
              statusTone={user ? 'success' : 'default'}
              style={styles.modeRow}
              title="Account sync"
            />
            <ActionRow
              description="Trusted people only see what each checkpoint is configured to share."
              leading={<ActionRowGlyph label="C" />}
              statusLabel={user ? 'Available' : 'Opt-in'}
              statusTone={user ? 'primary' : 'default'}
              style={styles.modeRow}
              title="Private circles"
            />
          </View>

          {!configured ? (
            <StateCard
              description="Add the Supabase URL and anon key before enabling sync or circles. Local checkpoints still work."
              title="Sync is not configured"
              variant="inline"
            />
          ) : isLoading || isSyncChoiceLoading ? (
            <Text style={[styles.helperCaption, { color: colors.muted }]}>Checking sync state...</Text>
          ) : !user ? (
            <>
              <View style={styles.buttonGroup}>
                <AppButton
                  disabled={Boolean(authProviderInFlight)}
                  label={isGoogleSubmitting ? 'Connecting Google...' : 'Enable sync with Google'}
                  onPress={handleContinueWithGoogle}
                  variant="secondary"
                />
                {supportsAppleSignIn ? (
                  <AppButton
                    disabled={Boolean(authProviderInFlight)}
                    label={isAppleSubmitting ? 'Connecting Apple...' : 'Enable sync with Apple'}
                    onPress={handleContinueWithApple}
                    variant="ghost"
                  />
                ) : null}
                <AppButton
                  disabled={isSyncChoiceSubmitting}
                  label={isLocalOnlySelected ? 'Local-only saved' : 'Keep Local Only'}
                  onPress={handleKeepLocalOnly}
                  variant={isLocalOnlySelected ? 'ghost' : 'secondary'}
                />
              </View>

              <Text style={[styles.helperCaption, { color: colors.muted }]}>
                If sign-in returns to the browser, confirm {authRedirectUrl} is allowed in your Supabase redirect URLs.
              </Text>
              {!supportsAppleSignIn ? (
                <Text style={[styles.helperCaption, { color: colors.muted }]}>
                  Apple sign-in appears on iPhone and iPad builds.
                </Text>
              ) : null}

              {authFeedback && authFeedbackColors ? (
                <View
                  style={[
                    styles.feedbackCard,
                    {
                      backgroundColor: authFeedbackColors.backgroundColor,
                      borderColor: authFeedbackColors.borderColor,
                    },
                  ]}>
                  <Text style={[TextPresets.body, { color: authFeedbackColors.textColor }]}>
                    {authFeedback.message}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <AppButton
              disabled={isSigningOut}
              label={isSigningOut ? 'Signing out...' : 'Sign out and keep this device local'}
              onPress={handleSignOut}
              variant="ghost"
            />
          )}
        </AppCard>

        <AppCard elevated tone="canvas">
          <SectionHeader
            action={
              <StatusPill
                label={cameraPermissionLabel}
                tone={getCameraPermissionTone(cameraPermission)}
              />
            }
            kicker="Device access"
            title="Camera, defaults, and accessibility"
            description="Set up the device pieces that make proof-code scanning and checkpoint creation reliable."
          />

          <View style={styles.modeGrid}>
            <ActionRow
              description={cameraPermissionHelper}
              leading={<ActionRowGlyph label="C" />}
              onPress={handleRequestCameraAccess}
              statusLabel={cameraPermissionLabel}
              statusTone={getCameraPermissionTone(cameraPermission)}
              style={styles.modeRow}
              title={cameraPermission?.canAskAgain === false ? 'Open camera settings' : 'Camera access'}
            />
            <ActionRow
              description="Use the original exact-match behavior for every new checkpoint unless changed while creating it."
              disabled={isAppPreferencesLoading || isAppPreferencesSubmitting}
              leading={<ActionRowGlyph label="X" />}
              onPress={() => {
                void handleSaveDefaultProofStrictness('strict');
              }}
              statusLabel={appPreferences.defaultProofStrictness === 'strict' ? 'Default' : 'Available'}
              statusTone={appPreferences.defaultProofStrictness === 'strict' ? 'success' : 'default'}
              style={styles.modeRow}
              title="Strict default"
            />
            <ActionRow
              description="Keep exact-match proof, but make fallback copy a little more guided on newly created checkpoints."
              disabled={isAppPreferencesLoading || isAppPreferencesSubmitting}
              leading={<ActionRowGlyph label="S" />}
              onPress={() => {
                void handleSaveDefaultProofStrictness('standard');
              }}
              statusLabel={appPreferences.defaultProofStrictness === 'standard' ? 'Default' : 'Available'}
              statusTone={appPreferences.defaultProofStrictness === 'standard' ? 'primary' : 'default'}
              style={styles.modeRow}
              title="Standard default"
            />
            <ActionRow
              description="Text follows device scaling, screens scroll inside safe areas, and scan controls keep visible labels."
              leading={<ActionRowGlyph label="A" />}
              statusLabel="System"
              statusTone="success"
              style={styles.modeRow}
              title="Accessibility behavior"
            />
          </View>

          <Text style={[styles.helperCaption, { color: colors.muted }]}>
            Existing checkpoints keep their saved strictness. The default only changes new checkpoint setup.
          </Text>

          {deviceFeedback && deviceFeedbackColors ? (
            <View
              style={[
                styles.feedbackCard,
                {
                  backgroundColor: deviceFeedbackColors.backgroundColor,
                  borderColor: deviceFeedbackColors.borderColor,
                },
              ]}>
              <Text style={[TextPresets.body, { color: deviceFeedbackColors.textColor }]}>
                {deviceFeedback.message}
              </Text>
            </View>
          ) : null}
        </AppCard>

        <AppCard elevated tone="canvas">
          <SectionHeader
            action={
              <StatusPill
                label={notificationPermissionLabel}
                tone={getNotificationPermissionTone(notificationPermissionState)}
              />
            }
            kicker="Device reminders"
            title="Optional notification strategy"
            description="Core checkpoint alerts still follow your schedules. These switches only control extra nudges."
          />

          {isReminderPreferencesLoading ? (
            <Text style={[styles.helperCaption, { color: colors.muted }]}>Loading reminder preferences...</Text>
          ) : (
            <>
              <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                <View style={styles.preferenceCopy}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>Urgency reminder</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    Send one follow-up while a live checkpoint window is still open. Best for longer grace windows only.
                  </Text>
                </View>
                <Switch
                  accessibilityHint="Turns the in-window urgency reminder on or off."
                  accessibilityLabel="Urgency reminder"
                  onValueChange={(value) => {
                    setReminderPreferences((current) => ({
                      ...current,
                      urgencyRemindersEnabled: value,
                    }));
                    setReminderFeedback(null);
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  value={reminderPreferences.urgencyRemindersEnabled}
                />
              </View>

              <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                <View style={styles.preferenceCopy}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>Evening readiness reminder</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    For morning checkpoints, send one low-noise prep reminder the night before.
                  </Text>
                </View>
                <Switch
                  accessibilityHint="Turns the evening readiness reminder on or off."
                  accessibilityLabel="Evening readiness reminder"
                  onValueChange={(value) => {
                    setReminderPreferences((current) => ({
                      ...current,
                      eveningReadinessRemindersEnabled: value,
                    }));
                    setReminderFeedback(null);
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  value={reminderPreferences.eveningReadinessRemindersEnabled}
                />
              </View>

              <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                <View style={styles.preferenceCopy}>
                  <Text style={[TextPresets.label, { color: colors.text }]}>Weekly review reminder</Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>
                    Send one Sunday-evening prompt to review what held and what needs work.
                  </Text>
                </View>
                <Switch
                  accessibilityHint="Turns the weekly review reminder on or off."
                  accessibilityLabel="Weekly review reminder"
                  onValueChange={(value) => {
                    setReminderPreferences((current) => ({
                      ...current,
                      weeklyReviewRemindersEnabled: value,
                    }));
                    setReminderFeedback(null);
                  }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  value={reminderPreferences.weeklyReviewRemindersEnabled}
                />
              </View>

              <Text style={[styles.helperCaption, { color: colors.muted }]}>{notificationPermissionHelper}</Text>

              {reminderFeedback && reminderFeedbackColors ? (
                <View
                  style={[
                    styles.feedbackCard,
                    {
                      backgroundColor: reminderFeedbackColors.backgroundColor,
                      borderColor: reminderFeedbackColors.borderColor,
                    },
                  ]}>
                  <Text style={[TextPresets.body, { color: reminderFeedbackColors.textColor }]}>
                    {reminderFeedback.message}
                  </Text>
                </View>
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

        <AppCard elevated tone="canvas">
          <SectionHeader
            action={
              <StatusPill
                label={isProofCodeStatsLoading ? 'Loading' : `${proofCodeStats.linkedCodeCount} linked`}
                tone={proofCodeStats.linkedCodeCount > 0 ? 'success' : 'default'}
              />
            }
            kicker="Code management"
            title="Proof codes live on checkpoints"
            description={proofCodeStatsDescription}
          />

          <View style={styles.modeGrid}>
            <ActionRow
              description="Edit or relink proof codes from the checkpoint that uses them."
              disabled={isProofCodeStatsLoading}
              leading={<ActionRowGlyph label="P" />}
              onPress={handleReviewCheckpoints}
              statusLabel={`${proofCodeStats.linkedCodeCount}`}
              statusTone={proofCodeStats.linkedCodeCount > 0 ? 'success' : 'default'}
              style={styles.modeRow}
              title="Linked proof codes"
            />
            <ActionRow
              description="Generated, scanned, or reused codes kept only to speed up future checkpoint setup."
              disabled={isProofCodeStatsLoading || isClearingUnusedCodes}
              leading={<ActionRowGlyph label="R" />}
              onPress={handleClearUnusedCodes}
              statusLabel={
                proofCodeStats.unusedPresetCount > 0 ? `${proofCodeStats.unusedPresetCount} unused` : 'Clean'
              }
              statusTone={proofCodeStats.unusedPresetCount > 0 ? 'warning' : 'success'}
              style={styles.modeRow}
              title="Saved presets"
            />
            <ActionRow
              description="Review how saved checkpoints split between Strict and Standard exact-match behavior."
              disabled={isProofCodeStatsLoading}
              leading={<ActionRowGlyph label="X" />}
              statusLabel={`${proofCodeStats.strictCount} strict`}
              statusTone={proofCodeStats.strictCount > 0 ? 'primary' : 'default'}
              style={styles.modeRow}
              title="Strictness"
            />
          </View>

          <View style={styles.buttonGroup}>
            <AppButton
              label="Review checkpoints"
              onPress={handleReviewCheckpoints}
              variant="secondary"
            />
            <AppButton
              disabled={isProofCodeStatsLoading || isClearingUnusedCodes}
              label={isClearingUnusedCodes ? 'Clearing...' : 'Clear unused saved codes'}
              onPress={handleClearUnusedCodes}
              variant="ghost"
            />
          </View>

          <Text style={[styles.helperCaption, { color: colors.muted }]}>
            {proofCodeStats.standardCount > 0
              ? `${proofCodeStats.standardCount} checkpoint${proofCodeStats.standardCount === 1 ? '' : 's'} use Standard exact-match copy.`
              : 'All saved checkpoints use Strict exact-match proof unless changed per checkpoint.'}
          </Text>

          {codeFeedback && codeFeedbackColors ? (
            <View
              style={[
                styles.feedbackCard,
                {
                  backgroundColor: codeFeedbackColors.backgroundColor,
                  borderColor: codeFeedbackColors.borderColor,
                },
              ]}>
              <Text style={[TextPresets.body, { color: codeFeedbackColors.textColor }]}>{codeFeedback.message}</Text>
            </View>
          ) : null}
        </AppCard>

        {configured && isLoading ? (
          <LoadingBlock description="Checking your account session and profile." title="Loading account" />
        ) : !configured || !user ? (
          null
        ) : (
          <>
            <AppCard elevated tone="primary">
              <View style={styles.accountStrip}>
                <View style={styles.accountCopy}>
                  <Text style={[TextPresets.eyebrow, { color: colors.primary }]}>Signed in</Text>
                  <Text style={[styles.accountTitle, { color: colors.text }]}>
                    {profile?.displayName || suggestedDisplayName || 'Your account'}
                  </Text>
                  <Text style={[styles.accountMeta, { color: colors.primary }]}>
                    {profile?.handle ? `@${profile.handle}` : 'Finish your profile to show up clearly in circles.'}
                  </Text>
                  <Text style={[TextPresets.body, { color: colors.muted }]}>{signedInAccountLabel}</Text>
                </View>
              </View>

              <View style={styles.summaryPillRow}>
                <View
                  style={[
                    styles.summaryPill,
                    {
                      backgroundColor: profile ? colors.successSurface : colors.warningSurface,
                      borderColor: profile ? colors.success : colors.warning,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.summaryPillLabel,
                      { color: profile ? colors.success : colors.warning },
                    ]}>
                    {profile ? 'Profile ready' : 'Finish setup'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.summaryPill,
                    {
                      backgroundColor: colors.elevated,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text style={[styles.summaryPillLabel, { color: colors.textSoft }]}>{timezone}</Text>
                </View>
              </View>
            </AppCard>

            {isProfileLoading && !profile ? (
              <LoadingBlock
                description="Pulling down your name, handle, timezone, and alert preferences."
                title="Loading profile"
              />
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
                <AppCard elevated>
                  <SectionHeader
                    kicker="Identity"
                    title={profile ? 'Public profile' : 'Finish your profile'}
                    description="This is how circles will recognize you."
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
                          <Text
                            style={[
                              styles.timezoneChipLabel,
                              { color: isSelected ? colors.primary : colors.textSoft },
                            ]}>
                            {zone}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.helperCaption, { color: colors.muted }]}>
                    Quick picks come from your device timezone plus common regions.
                  </Text>

                  {profileError ? (
                    <Text style={[TextPresets.body, { color: colors.danger }]}>{profileError}</Text>
                  ) : null}

                  {profileFeedback && profileFeedbackColors ? (
                    <View
                      style={[
                        styles.feedbackCard,
                        {
                          backgroundColor: profileFeedbackColors.backgroundColor,
                          borderColor: profileFeedbackColors.borderColor,
                        },
                      ]}>
                      <Text style={[TextPresets.body, { color: profileFeedbackColors.textColor }]}>
                        {profileFeedback.message}
                      </Text>
                    </View>
                  ) : null}

                  <AppButton
                    disabled={isProfileSubmitting || isProfileLoading}
                    label={isProfileSubmitting || isProfileLoading ? 'Saving...' : 'Save profile'}
                    onPress={handleSaveProfile}
                  />
                </AppCard>

                <AppCard elevated tone="canvas">
                  <SectionHeader
                    kicker="Circle alerts"
                    title="Shared accountability preferences"
                    description="Controls for circle activity and miss-related follow-up on your account."
                  />

                  <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                    <View style={styles.preferenceCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Circle notifications</Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>
                        Updates for circles, invites, and shared progress.
                      </Text>
                    </View>
                    <Switch
                      accessibilityHint="Turns circle activity notifications on or off."
                      accessibilityLabel="Circle notifications"
                      onValueChange={(value) => {
                        setAllowCircleNotifications(value);
                        setProfileFeedback(null);
                      }}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={allowCircleNotifications}
                    />
                  </View>

                  <View style={[styles.preferenceRow, { borderColor: colors.border }]}>
                    <View style={styles.preferenceCopy}>
                      <Text style={[TextPresets.label, { color: colors.text }]}>Missed-checkpoint alerts</Text>
                      <Text style={[TextPresets.body, { color: colors.muted }]}>
                        Alerts when you miss a scheduled checkpoint.
                      </Text>
                    </View>
                    <Switch
                      accessibilityHint="Turns missed checkpoint alerts on or off."
                      accessibilityLabel="Missed-checkpoint alerts"
                      onValueChange={(value) => {
                        setAllowMissedAlarmAlerts(value);
                        setProfileFeedback(null);
                      }}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={allowMissedAlarmAlerts}
                    />
                  </View>
                </AppCard>

              </>
            )}
          </>
        )}

        <AppCard elevated tone="canvas">
          <SectionHeader
            kicker="Data ownership"
            title="Export or delete data"
            description="Your checkpoint data is yours. Export a readable copy before deleting anything destructive."
          />

          <ActionRow
            description="Copies a JSON export with checkpoints, proof history, notification preferences, and sync profile context."
            disabled={isExportingData || isDeletingData}
            leading={<ActionRowGlyph label="E" />}
            onPress={handleExportData}
            statusLabel={isExportingData ? 'Working' : 'JSON'}
            statusTone="primary"
            title="Export checkpoint data"
          />

          <ActionRow
            description={
              user
                ? 'Clears checkpoint data for this signed-in account on the device and attempts to clear synced checkpoint backups.'
                : 'Clears local checkpoints, proof history, queued sync state, and scheduled notifications from this device.'
            }
            disabled={isExportingData || isDeletingData}
            leading={<ActionRowGlyph label="D" />}
            onPress={handleDeleteData}
            statusLabel={isDeletingData ? 'Working' : 'Destructive'}
            statusTone="danger"
            title="Delete checkpoint data"
          />

          {dataFeedback && dataFeedbackColors ? (
            <View
              style={[
                styles.feedbackCard,
                {
                  backgroundColor: dataFeedbackColors.backgroundColor,
                  borderColor: dataFeedbackColors.borderColor,
                },
              ]}>
              <Text style={[TextPresets.body, { color: dataFeedbackColors.textColor }]}>{dataFeedback.message}</Text>
            </View>
          ) : null}
        </AppCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
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
