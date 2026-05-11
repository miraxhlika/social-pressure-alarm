import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCameraPermissions } from 'expo-camera';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { Alert, Animated, Easing, Linking, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { AppInput } from '@/components/ui/app-input';
import { AppScreen } from '@/components/ui/app-screen';
import { FlowTopBar } from '@/components/ui/flow-primitives';
import { LoadingBlock } from '@/components/ui/loading-block';
import { StateCard } from '@/components/ui/state-card';
import { StatusPill } from '@/components/ui/status-pill';
import { Fonts, Radius, Spacing, TextPresets, Type, getAppColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readAlarmStore, resetAlarmStore } from '@/lib/alarms';
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
import { resetSocialSyncState } from '@/lib/social/queue';
import { getActiveStorageScope } from '@/lib/storage';
import { useSocialSession } from '@/providers/social-session-provider';

type FormFeedbackTone = 'success' | 'danger' | 'warning';
type ProfileFieldErrors = {
  displayName?: string;
  handle?: string;
};
type FormFeedback = {
  tone: FormFeedbackTone;
  message: string;
};
type SettingsPanel = 'account' | 'notifications' | 'camera' | 'reminders' | null;
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function getProfileErrors({
  displayName,
  handle,
}: {
  displayName: string;
  handle: string;
}): ProfileFieldErrors {
  const trimmedDisplayName = displayName.trim();
  const normalizedHandle = normalizeHandle(handle);
  const errors: ProfileFieldErrors = {};

  if (!trimmedDisplayName) {
    errors.displayName = 'Add the name your circle will recognize.';
  }

  if (!normalizedHandle) {
    errors.handle = 'Choose a handle for circles and the activity feed.';
  } else if (normalizedHandle.length < 3) {
    errors.handle = 'Use at least 3 letters or numbers.';
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
    case 'denied':
      return 'danger' as const;
    default:
      return 'warning' as const;
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
    signOut,
    user,
  } = useSocialSession();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const hydratedFormKeyRef = useRef<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
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
  const [dataFeedback, setDataFeedback] = useState<FormFeedback | null>(null);
  const [isExportingData, setIsExportingData] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
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
    setAllowCircleNotifications(profile?.allowCircleNotifications ?? true);
    setAllowMissedAlarmAlerts(profile?.allowMissedAlarmAlerts ?? true);
    setProfileFeedback(null);
    setHasAttemptedProfileSubmit(false);
  }, [profile, suggestedDisplayName, suggestedHandle, user?.id]);

  const profileErrors = getProfileErrors({
    displayName,
    handle,
  });
  const normalizedHandle = normalizeHandle(handle);
  const profileFeedbackColors = profileFeedback ? getFeedbackColors(profileFeedback.tone, colors) : null;
  const reminderFeedbackColors = reminderFeedback ? getFeedbackColors(reminderFeedback.tone, colors) : null;
  const dataFeedbackColors = dataFeedback ? getFeedbackColors(dataFeedback.tone, colors) : null;
  const deviceFeedbackColors = deviceFeedback ? getFeedbackColors(deviceFeedback.tone, colors) : null;

  useEffect(() => {
    if (!dataFeedback || dataFeedback.tone !== 'success') {
      return;
    }

    const timeoutId = setTimeout(() => {
      setDataFeedback(null);
    }, 4500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [dataFeedback]);

  const handleHelper =
    normalizedHandle.length >= 3
      ? `Circle members will see @${normalizedHandle}.`
      : 'Unique @name for circles and activity. Lowercase letters, numbers, and underscores.';
  const notificationPermissionLabel = getNotificationPermissionLabel(notificationPermissionState);
  const cameraPermissionLabel = getCameraPermissionLabel(cameraPermission);

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

  const handleSaveProfile = async () => {
    setHasAttemptedProfileSubmit(true);

    if (hasErrors(profileErrors)) {
      setProfileFeedback(null);
      return;
    }

    const trimmedDisplayName = displayName.trim();
    const profileTimezone = (profile?.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

    setIsProfileSubmitting(true);
    setProfileFeedback(null);

    try {
      await saveProfile({
        displayName: trimmedDisplayName,
        handle: normalizedHandle,
        timezone: profileTimezone,
        allowCircleNotifications,
        allowMissedAlarmAlerts,
      });
      setHandle(normalizedHandle);
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

  const signOutAccount = async () => {
    setIsSigningOut(true);
    setProfileFeedback(null);

    try {
      await signOut();
      setActiveSettingsPanel(null);
    } catch (error) {
      setProfileFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Sign out could not be completed right now.',
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'This disconnects sync and circles on this device. Your local checkpoints stay on the device.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void signOutAccount();
          },
        },
      ]
    );
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
      if (notificationPermissionState === 'denied') {
        await Linking.openSettings();
        return;
      }

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

  const handleExportData = async () => {
    setIsExportingData(true);
    setDataFeedback(null);

    try {
      const [store, notificationPreferences, storageScope] = await Promise.all([
        readAlarmStore(),
        readNotificationPreferences(),
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
      await loadReminderSettings();
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
      <FlowTopBar
        subtitle="Transparent. Secure. Yours."
        title="Settings & Privacy"
      />

      <View style={styles.settingsList}>
        <SettingsRow
          icon={user ? 'person-circle-outline' : 'person-outline'}
          isExpanded={user ? activeSettingsPanel === 'account' : undefined}
          subtitle={user ? signedInAccountLabel : 'Enable sync, backup, and circles'}
          title={user ? 'Signed In' : 'Optional Sign In'}
          value={user ? 'Manage' : configured ? undefined : 'Unavailable'}
          onPress={() => {
            if (user) {
              setActiveSettingsPanel(activeSettingsPanel === 'account' ? null : 'account');
              return;
            }

            router.push('/sync');
          }}
        />
        {activeSettingsPanel === 'account' ? (
          <View style={styles.settingsDetailSlot}>
            <AppCard tone="canvas" variant="inline" style={styles.settingsDetailCard}>
              {configured && isLoading ? (
                <LoadingBlock description="Checking your profile." title="Loading account" />
              ) : !configured || !user ? (
                <SettingsPanelHeader
                  title="Your data stays on your device"
                  description="Sync and circles are optional."
                />
              ) : isProfileLoading && !profile ? (
                <LoadingBlock description="Loading profile details." title="Loading profile" />
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
                  <SettingsPanelHeader
                    title={profile?.displayName || suggestedDisplayName || 'Your account'}
                    description={profile?.handle ? `@${profile.handle} - ${signedInAccountLabel}` : signedInAccountLabel}
                  />
                  <AppInput
                    autoCapitalize="words"
                    error={hasAttemptedProfileSubmit ? profileErrors.displayName : undefined}
                    helper="The readable name your circles see."
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
                  <AppButton
                    disabled={isSigningOut}
                    label={isSigningOut ? 'Signing out...' : 'Sign out'}
                    onPress={handleSignOut}
                    variant="danger"
                  />
                </>
              )}
            </AppCard>
          </View>
        ) : null}
        <SettingsRow
          icon="notifications-outline"
          isExpanded={activeSettingsPanel === 'notifications'}
          subtitle="Required for checkpoint alarms"
          title="Notifications"
          value={notificationPermissionLabel}
          onPress={() => {
            if (activeSettingsPanel === 'notifications') {
              setActiveSettingsPanel(null);
              return;
            }

            setActiveSettingsPanel('notifications');
          }}
        />
        {activeSettingsPanel === 'notifications' ? (
          <View style={styles.settingsDetailSlot}>
            <AppCard tone="canvas" variant="inline" style={styles.settingsDetailCard}>
              <SettingsPanelHeader
                action={<StatusPill label={notificationPermissionLabel} tone={getNotificationPermissionTone(notificationPermissionState)} />}
                title="Notifications"
                description={
                  notificationPermissionState === 'granted'
                    ? 'Checkpoint alarms can ring in the background.'
                    : 'Enable alerts so checkpoint alarms ring on time.'
                }
              />
              {notificationPermissionState !== 'granted' ? (
                <AppButton
                  label={notificationPermissionState === 'denied' ? 'Open device settings' : 'Enable notifications'}
                  onPress={handleRequestNotificationAccess}
                  variant="secondary"
                />
              ) : null}
              {reminderFeedback && reminderFeedbackColors ? (
                <FeedbackMessage colors={reminderFeedbackColors} message={reminderFeedback.message} />
              ) : null}
            </AppCard>
          </View>
        ) : null}
        <SettingsRow
          icon="camera-outline"
          isExpanded={activeSettingsPanel === 'camera'}
          subtitle="Required for QR proof scans"
          title="Camera"
          value={cameraPermissionLabel}
          onPress={() => {
            if (activeSettingsPanel === 'camera') {
              setActiveSettingsPanel(null);
              return;
            }

            setActiveSettingsPanel('camera');
          }}
        />
        {activeSettingsPanel === 'camera' ? (
          <View style={styles.settingsDetailSlot}>
            <AppCard tone="canvas" variant="inline" style={styles.settingsDetailCard}>
              <SettingsPanelHeader
                action={<StatusPill label={cameraPermissionLabel} tone={cameraPermission?.granted ? 'success' : 'warning'} />}
                title="Camera"
                description={
                  cameraPermission?.granted
                    ? 'Ready to scan proof codes.'
                    : 'Enable camera to scan QR and barcode proof codes.'
                }
              />
              {!cameraPermission?.granted ? (
                <AppButton
                  label={cameraPermission?.canAskAgain === false ? 'Open device settings' : 'Enable camera'}
                  onPress={handleRequestCameraAccess}
                  variant="secondary"
                />
              ) : null}
              {deviceFeedback && deviceFeedbackColors ? (
                <FeedbackMessage colors={deviceFeedbackColors} message={deviceFeedback.message} />
              ) : null}
            </AppCard>
          </View>
        ) : null}
        <SettingsRow
          icon="time-outline"
          isExpanded={activeSettingsPanel === 'reminders'}
          subtitle="Urgency, evening prep, and weekly review"
          title="Reminder Behavior"
          onPress={() => setActiveSettingsPanel(activeSettingsPanel === 'reminders' ? null : 'reminders')}
        />
        {activeSettingsPanel === 'reminders' ? (
          <View style={styles.settingsDetailSlot}>
            <AppCard tone="canvas" variant="inline" style={styles.settingsDetailCard}>
              {isReminderPreferencesLoading ? (
                <Text style={[styles.helperCaption, { color: colors.muted }]}>Loading reminder preferences...</Text>
              ) : (
                <>
                  <PreferenceSwitch
                    label="Urgency reminder"
                    description="One follow-up during a live checkpoint."
                    value={reminderPreferences.urgencyRemindersEnabled}
                    onValueChange={(value) => {
                      setReminderPreferences((current) => ({ ...current, urgencyRemindersEnabled: value }));
                      setReminderFeedback(null);
                    }}
                  />
                  <PreferenceSwitch
                    label="Evening prep"
                    description="A quiet reminder the night before."
                    value={reminderPreferences.eveningReadinessRemindersEnabled}
                    onValueChange={(value) => {
                      setReminderPreferences((current) => ({ ...current, eveningReadinessRemindersEnabled: value }));
                      setReminderFeedback(null);
                    }}
                  />
                  <PreferenceSwitch
                    label="Weekly review"
                    description="A Sunday prompt to reflect and adjust."
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
                    label={isReminderPreferencesSubmitting ? 'Saving...' : 'Save'}
                    onPress={handleSaveReminderPreferences}
                    variant="secondary"
                  />
                </>
              )}
            </AppCard>
          </View>
        ) : null}
      </View>

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
      <View style={[styles.localFooter, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
        <Ionicons color={colors.textSoft} name="lock-closed-outline" size={20} />
        <Text style={[styles.helperCaption, styles.localFooterText, { color: colors.textSoft }]}>
          Your data stays on your device. You are always in control.
        </Text>
      </View>
    </AppScreen>
  );
}

function SettingsPanelHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={styles.settingsPanelHeader}>
      <View style={styles.settingsPanelCopy}>
        <Text style={[styles.settingsPanelTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.settingsPanelDescription, { color: colors.textSoft }]}>{description}</Text>
      </View>
      {action ? <View style={styles.settingsPanelAction}>{action}</View> : null}
    </View>
  );
}

function SettingsRow({
  icon,
  isExpanded,
  onPress,
  subtitle,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  isExpanded?: boolean;
  onPress: () => void;
  subtitle: string;
  title: string;
  value?: string;
}) {
  const colors = getAppColors(useColorScheme());
  const arrowProgress = useRef(new Animated.Value(isExpanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(arrowProgress, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      toValue: isExpanded ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [arrowProgress, isExpanded]);

  const arrowRotation = arrowProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}${value ? `. ${value}` : ''}`}
      accessibilityState={typeof isExpanded === 'boolean' ? { expanded: isExpanded } : undefined}
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
      <Animated.View style={{ transform: [{ rotate: arrowRotation }] }}>
        <Ionicons color={colors.muted} name="chevron-forward" size={19} />
      </Animated.View>
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

const styles = StyleSheet.create({
  flowContent: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 88,
    paddingTop: 2,
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
  settingsDetailSlot: {
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  settingsDetailCard: {
    gap: Spacing.md,
  },
  settingsPanelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  settingsPanelCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  settingsPanelTitle: {
    ...TextPresets.label,
    fontSize: 16,
    lineHeight: 21,
  },
  settingsPanelDescription: {
    ...TextPresets.body,
    fontSize: 13,
    lineHeight: 18,
  },
  settingsPanelAction: {
    alignSelf: 'flex-start',
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
    width: '100%',
  },
  localFooterText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
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
  helperCaption: {
    ...TextPresets.body,
    fontSize: 14,
    lineHeight: 20,
  },
  feedbackCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
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
  preferenceRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  preferenceCopy: {
    flex: 1,
    gap: Spacing.xs,
  },
});
