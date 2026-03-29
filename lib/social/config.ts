import Constants from 'expo-constants';

type SocialConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

function getTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getExpoExtraValue(key: string) {
  const extra = Constants.expoConfig?.extra;
  return extra && typeof extra === 'object' ? getTrimmedString(extra[key]) : null;
}

export function getSocialConfig(): SocialConfig | null {
  const supabaseUrl =
    getTrimmedString(process.env.EXPO_PUBLIC_SUPABASE_URL) ?? getExpoExtraValue('supabaseUrl');
  const supabaseAnonKey =
    getTrimmedString(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ??
    getExpoExtraValue('supabaseAnonKey');

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
  };
}

export function hasSocialBackendConfig() {
  return getSocialConfig() !== null;
}
