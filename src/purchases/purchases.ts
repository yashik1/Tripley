/**
 * Tripley Pro through RevenueCat: App Store / Google Play in-app purchase on
 * phones, and RevenueCat Web Billing (Stripe) on the web. The server learns
 * about purchases from the revenuecat-webhook function.
 */
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

import { config } from '@/config';

export const PRO_ENTITLEMENT = 'pro';

let configuredFor: string | null = null;

function apiKey(): string {
  if (Platform.OS === 'ios') return config.revenueCat.ios;
  if (Platform.OS === 'android') return config.revenueCat.android;
  return config.revenueCat.web;
}

export function purchasesAvailable(): boolean {
  return Boolean(apiKey());
}

export async function setupPurchases(userId: string): Promise<boolean> {
  const key = apiKey();
  if (!key) return false;
  if (configuredFor === userId) return true;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: key, appUserID: userId });
  } else {
    await Purchases.logIn(userId);
  }
  configuredFor = userId;
  return true;
}

export async function getProPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

/** Returns true if Pro is active after the purchase. Throws on errors other than cancelling. */
export async function buyPackage(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return Boolean(customerInfo.entitlements.active[PRO_ENTITLEMENT]);
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
}

export async function restorePurchases(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  return Boolean(info.entitlements.active[PRO_ENTITLEMENT]);
}

export async function manageSubscriptionUrl(): Promise<string | null> {
  const info = await Purchases.getCustomerInfo();
  return info.managementURL ?? null;
}
