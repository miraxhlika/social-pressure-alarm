import { Linking } from 'react-native';
import * as SMS from 'expo-sms';

import { Alarm } from '@/types/alarm';

function buildSmsUrl(phoneNumber: string, message: string) {
  const separator = phoneNumber.includes('?') ? '&' : '?';
  return `sms:${phoneNumber}${separator}body=${encodeURIComponent(message)}`;
}

export async function openAccountabilitySmsAsync(alarm: Alarm) {
  const isSmsAvailable = await SMS.isAvailableAsync();

  if (isSmsAvailable) {
    // Expo can open the native composer, but it cannot silently auto-send the SMS.
    return SMS.sendSMSAsync([alarm.phoneNumber], alarm.message);
  }

  return Linking.openURL(buildSmsUrl(alarm.phoneNumber, alarm.message));
}
