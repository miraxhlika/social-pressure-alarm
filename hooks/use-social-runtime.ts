import { useEffect } from 'react';
import { AppState } from 'react-native';

import { getSupabaseClient } from '@/lib/social/client';
import { registerSignedInDevicePushToken } from '@/lib/social/push';
import { flushAlarmEventQueue } from '@/lib/social/queue';

export function useSocialRuntime() {
  useEffect(() => {
    const syncSocialRuntime = () => {
      void registerSignedInDevicePushToken().catch(() => null);
      void flushAlarmEventQueue();
    };

    syncSocialRuntime();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncSocialRuntime();
      }
    });

    const client = getSupabaseClient();
    const authSubscription = client?.auth.onAuthStateChange(() => {
      syncSocialRuntime();
    });

    return () => {
      appStateSubscription.remove();
      authSubscription?.data.subscription.unsubscribe();
    };
  }, []);
}
