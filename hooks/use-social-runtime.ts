import { useEffect } from 'react';
import { AppState } from 'react-native';

import { getSupabaseClient } from '@/lib/social/client';
import { flushAlarmEventQueue } from '@/lib/social/queue';

export function useSocialRuntime() {
  useEffect(() => {
    void flushAlarmEventQueue();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void flushAlarmEventQueue();
      }
    });

    const client = getSupabaseClient();
    const authSubscription = client?.auth.onAuthStateChange(() => {
      void flushAlarmEventQueue();
    });

    return () => {
      appStateSubscription.remove();
      authSubscription?.data.subscription.unsubscribe();
    };
  }, []);
}
