import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { Animated, AppState, Easing, Linking, Platform, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';

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
  ExactAlarmAccessState,
  getExactAlarmAccessState,
  openExactAlarmSettingsAsync,
} from '@/lib/exact-alarm-access';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPermissionState,
  cancelAllCheckpointNotificationsAsync,
  ensureNotificationPermissionsAsync,
  getNotificationPermissionState,
  readNotificationPreferences,
  saveNotificationPreferences,
  syncNotificationStrategyAsync,
  syncWeeklyReviewReminderAsync,
} from '@/lib/notifications';
import { clearMyRemoteCheckpointData } from '@/lib/social/alarms';
import {
  createSuggestedDisplayName,
  createSuggestedHandle,
  getMetadataString,
  normalizeHandle,
} from '@/lib/social/profile-defaults';
import { registerSignedInDevicePushToken } from '@/lib/social/push';
import { resetSocialSyncState } from '@/lib/social/queue';
import { getActiveStorageScope } from '@/lib/storage';
import { useAppDialog } from '@/providers/app-dialog-provider';
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
  const { confirm } = useAppDialog();
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
  const [exactAlarmAccessState, setExactAlarmAccessState] = useState<ExactAlarmAccessState>('unsupported');
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
      const [storedPreferences, permissionState, exactAlarmState] = await Promise.all([
        readNotificationPreferences(),
        getNotificationPermissionState(),
        getExactAlarmAccessState(),
      ]);

      setReminderPreferences(storedPreferences);
      setNotificationPermissionState(permissionState);
      setExactAlarmAccessState(exactAlarmState);
      setReminderFeedback(null);
    } finally {
      setIsReminderPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReminderSettings();
  }, [loadReminderSettings]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void loadReminderSettings();
      }
    });

    return () => subscription.remove();
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
      await cancelAllCheckpointNotificationsAsync();
      await signOut();
      await syncWeeklyReviewReminderAsync(undefined, { requestPermissions: false }).catch(() => null);
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

  const handleSignOut = async () => {
    const shouldSignOut = await confirm({
      confirmLabel: 'Sign out',
      description: 'Sync and circles will disconnect on this device. Your local checkpoints will stay here.',
      icon: 'log-out-outline',
      title: 'Sign out?',
      tone: 'warning',
    });

    if (shouldSignOut) {
      await signOutAccount();
    }
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
        : 'Camera access is still unavailable. Enable it in device settings before linking or clearing a checkpoint.',
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
      if (granted) {
        void registerSignedInDevicePushToken().catch(() => null);
      }
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

      await Share.share({
        title: 'Checkpoint Alarm export',
        message: serializedData,
      });
      setDataFeedback({
        tone: 'success',
        message: 'Data export prepared. It was not copied to the clipboard.',
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
      if (user) {
        await clearMyRemoteCheckpointData();
      }
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

  const handleDeleteData = async () => {
    const shouldDelete = await confirm({
      confirmLabel: 'Delete checkpoint data',
      description: user
        ? 'Permanently clear checkpoints, history, sync state, and notifications from this device and account. Your profile and circle memberships will remain.'
        : 'Permanently clear checkpoints, proof history, sync state, and notifications from this device.',
      icon: 'trash-outline',
      title: 'Delete checkpoint data?',
      tone: 'danger',
    });

    if (shouldDelete) {
      await deleteCheckpointData();
    }
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
      void registerSignedInDevicePushToken().catch(() => null);
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
        subtitle="Private by default."
        title="Settings"
      />

      <SettingsSectionLabel>ACCOUNT</SettingsSectionLabel>
      <View style={[styles.settingsList, { backgroundColor: colors.panel, borderColor: colors.line }]}>
        <SettingsRow
          icon={user ? 'person-circle-outline' : 'person-outline'}
          isExpanded={user ? activeSettingsPanel === 'account' : undefined}
          subtitle={user ? signedInAccountLabel : 'Optional · backup, sync, and circles'}
          title={user ? 'Signed in' : 'Sync & account'}
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
                <LoadingBlock description="Checking your profile." layout="compact" title="Loading account" />
              ) : !configured || !user ? (
                <SettingsPanelHeader
                  title="Your data stays on your device"
                  description="Sync and circles are optional."
                />
              ) : isProfileLoading && !profile ? (
                <LoadingBlock description="Loading profile details." layout="compact" title="Loading profile" />
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
                  <AccountSettingsGroup
                    description="Choose how people recognize you in shared circles."
                    icon="person-outline"
                    title="Public profile">
                    <AppInput
                      autoCapitalize="words"
                      containerStyle={styles.profileField}
                      error={hasAttemptedProfileSubmit ? profileErrors.displayName : undefined}
                      helper="Shown to people in your circles."
                      inputStyle={styles.profileInput}
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
                      containerStyle={styles.profileField}
                      error={hasAttemptedProfileSubmit ? profileErrors.handle : undefined}
                      helper={hasAttemptedProfileSubmit && profileErrors.handle ? undefined : handleHelper}
                      inputStyle={styles.profileInput}
                      label="Handle"
                      onChangeText={(value) => {
                        setHandle(normalizeHandle(value));
                        setProfileFeedback(null);
                      }}
                      placeholder="early_riser"
                      value={handle}
                    />
                  </AccountSettingsGroup>

                  <AccountSettingsGroup
                    description="Control which circle activity reaches this device."
                    icon="notifications-outline"
                    title="Circle alerts">
                    <PreferenceSwitch
                      label="Circle activity"
                      description="Invites, shared progress, and circle updates."
                      value={allowCircleNotifications}
                      onValueChange={(value) => {
                        setAllowCircleNotifications(value);
                        setProfileFeedback(null);
                      }}
                    />
                    <PreferenceSwitch
                      label="Missed checkpoints"
                      description="Alerts when a member shares a missed checkpoint."
                      value={allowMissedAlarmAlerts}
                      onValueChange={(value) => {
                        setAllowMissedAlarmAlerts(value);
                        setProfileFeedback(null);
                      }}
                    />
                  </AccountSettingsGroup>
                  {profileError ? <Text style={[TextPresets.body, { color: colors.danger }]}>{profileError}</Text> : null}
                  {profileFeedback && profileFeedbackColors ? (
                    <FeedbackMessage colors={profileFeedbackColors} message={profileFeedback.message} />
                  ) : null}
                  <AppButton
                    disabled={isProfileSubmitting || isProfileLoading}
                    label={isProfileSubmitting || isProfileLoading ? 'Saving...' : 'Save changes'}
                    onPress={handleSaveProfile}
                    variant="tonal"
                  />
                  <Pressable
                    accessibilityLabel={isSigningOut ? 'Signing out' : 'Sign out'}
                    accessibilityRole="button"
                    disabled={isSigningOut}
                    onPress={handleSignOut}
                    style={({ pressed }) => [
                      styles.signOutAction,
                      {
                        backgroundColor: colors.dangerSurface,
                        borderColor: colors.danger,
                        opacity: isSigningOut ? 0.5 : pressed ? 0.82 : 1,
                      },
                    ]}>
                    <View style={[styles.signOutIcon, { backgroundColor: colors.elevated }]}>
                      <Ionicons color={colors.danger} name="log-out-outline" size={18} />
                    </View>
                    <View style={styles.signOutCopy}>
                      <Text style={[styles.signOutTitle, { color: colors.danger }]}>
                        {isSigningOut ? 'Signing out…' : 'Sign out'}
                      </Text>
                      <Text style={[styles.signOutDescription, { color: colors.textSoft }]}>
                        Disconnect sync and circles on this device.
                      </Text>
                    </View>
                    <Ionicons color={colors.danger} name="chevron-forward" size={17} />
                  </Pressable>
                </>
              )}
            </AppCard>
          </View>
        ) : null}
      </View>

      <SettingsSectionLabel>APP PERMISSIONS</SettingsSectionLabel>
      <View style={[styles.settingsList, { backgroundColor: colors.panel, borderColor: colors.line }]}>
        <SettingsRow
          icon="notifications-outline"
          isExpanded={activeSettingsPanel === 'notifications'}
          subtitle="Alarm alerts and reminders"
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
                  notificationPermissionState === 'granted' || notificationPermissionState === 'provisional'
                    ? exactAlarmAccessState === 'inexact'
                      ? 'Notifications are enabled, but Android may delay checkpoint reminders until exact alarm access is allowed.'
                      : 'Reminders are registered with the device and continue while the app is closed.'
                    : 'Enable alerts so checkpoint reminders can open the app on time.'
                }
              />
              {notificationPermissionState !== 'granted' ? (
                <AppButton
                  label={notificationPermissionState === 'denied' ? 'Open device settings' : 'Enable notifications'}
                  onPress={handleRequestNotificationAccess}
                  variant="secondary"
                />
              ) : null}
              {Platform.OS === 'android' && exactAlarmAccessState === 'inexact' ? (
                <AppButton
                  label="Allow exact alarm timing"
                  onPress={() => {
                    void openExactAlarmSettingsAsync();
                  }}
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
          subtitle="Scan QR and barcode proof"
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
      </View>

      <SettingsSectionLabel>PREFERENCES</SettingsSectionLabel>
      <View style={[styles.settingsList, { backgroundColor: colors.panel, borderColor: colors.line }]}>
        <SettingsRow
          icon="time-outline"
          isExpanded={activeSettingsPanel === 'reminders'}
          subtitle="Extra nudges and weekly review"
          title="Reminder behavior"
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

      <SettingsSectionLabel>YOUR DATA</SettingsSectionLabel>
      <View style={[styles.settingsList, { backgroundColor: colors.panel, borderColor: colors.line }]}>
        <SettingsRow
          icon="download-outline"
          subtitle="Save or transfer your data"
          title="Export data"
          value={isExportingData ? 'Working' : undefined}
          onPress={handleExportData}
        />
        <SettingsRow
          icon="trash-outline"
          subtitle="Permanently delete your data"
          title="Delete data"
          value={isDeletingData ? 'Working' : undefined}
          onPress={handleDeleteData}
        />
      </View>

      {dataFeedback && dataFeedbackColors ? (
        <FeedbackMessage colors={dataFeedbackColors} message={dataFeedback.message} />
      ) : null}
      <View style={[styles.localFooter, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
        <Ionicons color={colors.primary} name="lock-closed-outline" size={18} />
        <Text style={[styles.helperCaption, styles.localFooterText, { color: colors.textSoft }]}>
          Stored on this device unless you choose to sync.
        </Text>
      </View>
    </AppScreen>
  );
}

function SettingsSectionLabel({ children }: { children: ReactNode }) {
  const colors = getAppColors(useColorScheme());

  return <Text style={[styles.sectionLabel, { color: colors.textSoft }]}>{children}</Text>;
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
          backgroundColor: 'transparent',
          borderColor: colors.line,
        },
        pressed ? styles.rowPressed : null,
      ]}>
      <View style={[styles.settingsIcon, { backgroundColor: colors.primarySurface }]}>
        <Ionicons color={colors.primary} name={icon} size={19} />
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

function AccountSettingsGroup({
  children,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const colors = getAppColors(useColorScheme());

  return (
    <View style={[styles.accountSettingsGroup, { backgroundColor: colors.panelMuted, borderColor: colors.line }]}>
      <View style={styles.accountSettingsGroupHeader}>
        <View style={[styles.accountSettingsGroupIcon, { backgroundColor: colors.primarySurface }]}>
          <Ionicons color={colors.primary} name={icon} size={18} />
        </View>
        <View style={styles.accountSettingsGroupCopy}>
          <Text style={[styles.accountSettingsGroupTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.accountSettingsGroupDescription, { color: colors.textSoft }]}>{description}</Text>
        </View>
      </View>
      <View style={styles.accountSettingsGroupBody}>{children}</View>
    </View>
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
        <Text style={[styles.preferenceLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.preferenceDescription, { color: colors.textSoft }]}>{description}</Text>
      </View>
      <Switch
        accessibilityHint={`Turns ${label.toLowerCase()} on or off.`}
        accessibilityLabel={label}
        onValueChange={onValueChange}
        style={styles.preferenceSwitch}
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
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 88,
    paddingTop: Spacing.xs,
  },
  sectionLabel: {
    ...TextPresets.eyebrow,
    fontSize: 10,
    letterSpacing: 0.55,
    lineHeight: 14,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xs,
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
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingsDetailSlot: {
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  settingsDetailCard: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  accountSettingsGroup: {
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.lg,
    padding: Spacing.md,
  },
  accountSettingsGroupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
  },
  accountSettingsGroupIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  accountSettingsGroupCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  accountSettingsGroupTitle: {
    ...TextPresets.label,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  accountSettingsGroupDescription: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  accountSettingsGroupBody: {
    gap: Spacing.md,
  },
  profileField: {
    gap: 6,
  },
  profileInput: {
    borderRadius: Radius.md,
    minHeight: 50,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  signOutAction: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 66,
    padding: Spacing.md,
  },
  signOutIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  signOutCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  signOutTitle: {
    ...TextPresets.label,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  signOutDescription: {
    ...TextPresets.body,
    fontSize: 11,
    lineHeight: 15,
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
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rowPressed: {
    opacity: 0.88,
  },
  settingsIcon: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
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
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    maxWidth: 360,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
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
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Spacing.md,
    minHeight: 62,
    paddingTop: Spacing.md,
  },
  preferenceCopy: {
    flex: 1,
    gap: 2,
  },
  preferenceLabel: {
    ...TextPresets.label,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  preferenceDescription: {
    ...TextPresets.body,
    fontSize: 12,
    lineHeight: 17,
  },
  preferenceSwitch: {
    marginRight: -3,
    transform: [{ scale: 0.9 }],
  },
});
