import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { config } from '@/config';
import { savePushToken } from '@/lib/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Ask for permission and store this device's Expo push token. Returns the token. */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Trip updates',
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return null;
  if (!config.easProjectId) {
    console.warn('Push notifications need EAS_PROJECT_ID (see README).');
    return null;
  }
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: config.easProjectId });
    await savePushToken(token);
    return token;
  } catch (e) {
    console.warn('Could not register for push notifications', e);
    return null;
  }
}

/** Open the right screen when a notification is tapped. */
export function configureNotificationHandling(onOpen: (data: Record<string, unknown>) => void): () => void {
  const last = Notifications.getLastNotificationResponse();
  if (last) onOpen(last.notification.request.content.data ?? {});
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onOpen(response.notification.request.content.data ?? {});
  });
  return () => sub.remove();
}
