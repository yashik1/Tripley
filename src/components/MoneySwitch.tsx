/** Bills | Balances: the two halves of the Money tab. */
import { router } from 'expo-router';

import { Segmented } from './ui';

export function MoneySwitch({ tripId, value }: { tripId: string; value: 'bills' | 'balances' }) {
  return (
    <Segmented<'bills' | 'balances'>
      options={[
        { value: 'bills', label: 'Bills' },
        { value: 'balances', label: 'Balances' },
      ]}
      value={value}
      onChange={(v) => v !== value && router.replace(`/trip/${tripId}/${v}`)}
    />
  );
}
