import type { ConfigContext, ExpoConfig } from 'expo/config';

// Public web origin used for invite links and iOS/Android deep links.
// Change APP_DOMAIN to the domain you own (e.g. tripley.app).
const APP_DOMAIN = process.env.EXPO_PUBLIC_APP_DOMAIN ?? 'tripley.app';
const BUNDLE_ID = process.env.TRIPLEY_BUNDLE_ID ?? 'app.tripley';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Tripley',
  slug: 'tripley',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'tripley',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${APP_DOMAIN}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#117C78',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: APP_DOMAIN, pathPrefix: '/join' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
    name: 'Tripley',
    shortName: 'Tripley',
    themeColor: '#117C78',
    backgroundColor: '#ffffff',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#117C78',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Tripley shows your trip friends where you are while you are on a trip together.',
        locationAlwaysAndWhenInUsePermission:
          'Allow "Always" so your trip friends can still see you when Tripley is closed or your phone is locked. Sharing stops when the trip ends or you pause it.',
        locationAlwaysPermission:
          'Allow "Always" so your trip friends can still see you when Tripley is closed or your phone is locked.',
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    'expo-task-manager',
    [
      'expo-notifications',
      {
        color: '#117C78',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Tripley uses your photos to attach receipts to bills.',
        cameraPermission: 'Tripley uses the camera to photograph receipts.',
      },
    ],
    [
      'expo-contacts',
      {
        contactsPermission: 'Tripley lets you pick a friend from your contacts to invite them to a trip.',
      },
    ],
    'expo-apple-authentication',
    '@maplibre/maplibre-react-native',
    'expo-dev-client',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appDomain: APP_DOMAIN,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
