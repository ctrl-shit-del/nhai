import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

export interface GuardDeviceInfo {
  deviceId: string;
  platform: 'android' | 'ios' | 'unknown';
  appVersion?: string;
}

export async function getGuardDeviceInfo(deviceIdFallback = 'unknown-device'): Promise<GuardDeviceInfo> {
  const deviceId = await DeviceInfo.getUniqueId();

  return {
    deviceId: deviceId || deviceIdFallback,
    platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
    appVersion: DeviceInfo.getVersion()
  };
}
