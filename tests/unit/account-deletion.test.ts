import { describe, expect, it } from 'vitest';

import { deletionLines } from '../../src/lib/account-deletion';
import type { DeletionPreview } from '../../src/lib/types';

const base: DeletionPreview = { trips_deleted: [], trips_left: [], kitties_held: 0, pro: false, files: [] };

describe('deletionLines', () => {
  it('with no trips, only says what is deleted', () => {
    expect(deletionLines(base)).toEqual([
      'Your posts, comments, photos, packing lists and shared location are deleted.',
      'Your name, sign-in details and payment details are deleted. You won’t be able to log in again.',
    ]);
  });

  it('names the trips that go, the ones you leave, and who takes over', () => {
    const lines = deletionLines({
      ...base,
      trips_deleted: [
        { id: '1', name: 'Solo weekend' },
        { id: '2', name: 'Goa' },
        { id: '3', name: 'Kyoto' },
      ],
      trips_left: [
        { id: '4', name: 'Lisbon', new_organizer: 'Ben' },
        { id: '5', name: 'Rome', new_organizer: null },
      ],
    });
    expect(lines[0]).toBe('Solo weekend, Goa and Kyoto are deleted with everything in them, because you’re the only one on them.');
    expect(lines).toContain('You leave Lisbon, and Ben becomes its organizer.');
    expect(lines).toContain('You leave Rome. It stays for everyone else.');
    expect(lines.some((l) => l.includes('“Former member”'))).toBe(true);
  });

  it('one trip of your own reads naturally', () => {
    expect(deletionLines({ ...base, trips_deleted: [{ id: '1', name: 'Solo weekend' }] })[0]).toBe(
      'Solo weekend is deleted with everything in it, because you’re the only one on it.',
    );
  });
});
