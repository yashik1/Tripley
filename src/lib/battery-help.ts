/**
 * Keeping location sharing on: many Android phones stop apps in the background
 * to save battery, each maker in its own way. Steps per maker, matched from
 * the phone's manufacturer or brand. Menu names vary a little between models
 * and versions, so each set links to dontkillmyapp.com for the latest.
 */
export type BatteryHelp = { vendor: string; name: string; steps: string[]; more: string };

const ALWAYS = 'Location permission: Settings › Apps › Tripley › Permissions › Location › Allow all the time.';

const HELP: (BatteryHelp & { match: RegExp })[] = [
  {
    vendor: 'samsung',
    name: 'Samsung',
    match: /samsung/i,
    steps: [
      'Settings › Apps › Tripley › Battery › choose Unrestricted.',
      'Settings › Battery › Background usage limits: take Tripley out of Sleeping and Deep sleeping apps, and add it to Never sleeping apps.',
    ],
    more: 'https://dontkillmyapp.com/samsung',
  },
  {
    vendor: 'xiaomi',
    name: 'Xiaomi, Redmi and POCO',
    match: /xiaomi|redmi|poco/i,
    steps: [
      'Settings › Apps › Manage apps › Tripley › Battery saver › No restrictions.',
      'Same page: turn on Autostart.',
      'In recent apps, hold Tripley’s card and tap the lock, so clearing recent apps doesn’t close it.',
    ],
    more: 'https://dontkillmyapp.com/xiaomi',
  },
  {
    vendor: 'oneplus',
    name: 'OnePlus',
    match: /oneplus/i,
    steps: ['Settings › Battery › Battery optimisation › Tripley › Don’t optimise.', 'In recent apps, lock Tripley’s card.'],
    more: 'https://dontkillmyapp.com/oneplus',
  },
  {
    vendor: 'huawei',
    name: 'Huawei and Honor',
    match: /huawei|honor/i,
    steps: ['Settings › Battery › App launch › Tripley: turn off Manage automatically, then turn on Auto-launch, Secondary launch and Run in background.'],
    more: 'https://dontkillmyapp.com/huawei',
  },
  {
    vendor: 'oppo',
    name: 'OPPO and realme',
    match: /oppo|realme/i,
    steps: ['Settings › Battery › App battery management (or More settings) › Tripley › Allow background activity.', 'Settings › Apps › Auto launch: turn on Tripley.'],
    more: 'https://dontkillmyapp.com/oppo',
  },
  {
    vendor: 'vivo',
    name: 'vivo and iQOO',
    match: /vivo|iqoo/i,
    steps: ['Settings › Battery › Background power consumption management › Tripley › Allow.', 'i Manager › App manager › Autostart: turn on Tripley.'],
    more: 'https://dontkillmyapp.com/vivo',
  },
];

const STOCK: BatteryHelp = {
  vendor: 'android',
  name: 'Android',
  steps: ['Settings › Apps › Tripley › App battery usage › Unrestricted.'],
  more: 'https://dontkillmyapp.com',
};

/** The steps for this phone (manufacturer or brand from the system), always ending with the location permission. */
export function batteryHelpFor(manufacturer: string | null | undefined, brand?: string | null): BatteryHelp {
  const text = `${manufacturer ?? ''} ${brand ?? ''}`;
  const hit = HELP.find((h) => h.match.test(text));
  const base = hit ? { vendor: hit.vendor, name: hit.name, steps: hit.steps, more: hit.more } : STOCK;
  return { ...base, steps: [...base.steps, ALWAYS, 'Battery saver mode (in quick settings) limits sharing too: Tripley switches to its own battery saver instead.'] };
}

export const IOS_HELP = [
  'Settings › Tripley › Location › Always, with Precise Location on.',
  'Settings › General › Background App Refresh: on, and on for Tripley.',
  'Low Power Mode slows background updates; they catch up when it’s off.',
];
