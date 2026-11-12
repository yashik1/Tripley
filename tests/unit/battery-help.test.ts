import { describe, expect, it } from 'vitest';

import { batteryHelpFor } from '../../src/lib/battery-help';

describe('keeping sharing on, per phone maker', () => {
  it('matches the maker or the brand', () => {
    expect(batteryHelpFor('samsung', 'samsung').vendor).toBe('samsung');
    expect(batteryHelpFor('Xiaomi', 'POCO').name).toBe('Xiaomi, Redmi and POCO');
    expect(batteryHelpFor('HONOR', null).vendor).toBe('huawei');
    expect(batteryHelpFor('realme', 'realme').vendor).toBe('oppo');
    expect(batteryHelpFor(null, 'iQOO').vendor).toBe('vivo');
  });

  it('other phones get the stock Android steps; everyone gets the location permission step', () => {
    const pixel = batteryHelpFor('Google', 'google');
    expect(pixel.vendor).toBe('android');
    expect(pixel.steps[0]).toContain('Unrestricted');
    for (const h of [pixel, batteryHelpFor('samsung')]) {
      expect(h.steps.some((s) => s.includes('Allow all the time'))).toBe(true);
      expect(h.more.startsWith('https://dontkillmyapp.com')).toBe(true);
    }
  });
});
