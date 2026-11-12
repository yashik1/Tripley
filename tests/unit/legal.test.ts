import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { contactBlocks, PRIVACY, supportEmail, TERMS, type LegalDoc } from '../../src/lib/legal';

const root = path.resolve(__dirname, '../..');
const migrations = readdirSync(path.join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'))
  .join('\n');
const api = readFileSync(path.join(root, 'src/lib/api.ts'), 'utf8');

function allText(doc: LegalDoc): string {
  return [
    ...doc.summary,
    ...doc.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => ('list' in b ? b.list : [b.lead ?? '', b.text]))]),
  ].join('\n');
}
const privacy = allText(PRIVACY);
const terms = allText(TERMS);

describe('supportEmail', () => {
  it('is null until a real address is set', () => {
    expect(supportEmail(undefined)).toBeNull();
    expect(supportEmail('')).toBeNull();
    expect(supportEmail('   ')).toBeNull();
    expect(supportEmail('not an email')).toBeNull();
    expect(supportEmail('  help@tripley.app ')).toBe('help@tripley.app');
  });

  it('without an address, points people to what they can do in the app', () => {
    const text = JSON.stringify(contactBlocks(null));
    expect(text).toContain('Profile');
    expect(text).not.toContain('@');
    expect(JSON.stringify(contactBlocks('help@tripley.app'))).toContain('help@tripley.app');
  });
});

describe('legal documents', () => {
  it.each([PRIVACY, TERMS])('$title has unique, non-empty sections', (doc) => {
    const ids = doc.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of doc.sections) {
      expect(s.heading.trim()).not.toBe('');
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it('both state the same minimum age', () => {
    expect(privacy).toContain('at least 16');
    expect(terms).toContain('at least 16');
    expect(privacy).toContain('18 in India');
    expect(terms).toContain('18 in India');
  });
});

// The policy makes promises about how long data is kept. These checks fail if
// the database code changes without the policy being updated (or vice versa).
describe('the privacy policy matches what the code does', () => {
  it('keeps only the latest position per person and trip', () => {
    expect(privacy).toContain('only your latest position');
    expect(migrations).toMatch(/create table public\.member_locations[\s\S]*?primary key \(trip_id, user_id\)/);
  });

  it('deletes positions when the organizer ends the trip, and within 3 days of the end date', () => {
    expect(privacy).toContain('straight away if the organizer ends it');
    expect(migrations).toMatch(/new\.ended_at is not null then\s+delete from public\.member_locations where trip_id = new\.id/);
    // Purged hourly once the end date is more than 2 days back: at the latest on the third day after it.
    expect(privacy).toContain('within 3 days of the trip’s end date');
    expect(migrations).toContain("t.ends_on < (now() at time zone 'utc')::date - 2");
    expect(migrations).toContain("cron.schedule('tripley-purge-locations', '17 * * * *'");
    // Members can read positions only while the trip is active: up to the day after its end date.
    expect(privacy).toContain('stop seeing them the day after the end date');
    expect(migrations).toContain("t.ends_on >= (now() at time zone 'utc')::date - 1");
  });

  it('deletes your position when you leave a trip', () => {
    expect(privacy).toContain('Leaving a trip deletes your position');
    expect(migrations).toContain('foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade');
  });

  it('keeps AI results for a day and request records for 90 days', () => {
    expect(privacy).toContain('AI results (receipts, bookings, plan drafts): one day. Request records: 90 days.');
    expect(migrations).toContain("update public.ai_scan_requests set result = null");
    expect(migrations).toContain("finished_at < now() - interval '1 day'");
    expect(migrations).toContain("delete from public.ai_scan_requests where user_id = p_user and created_at < now() - interval '90 days'");
  });

  it('shows private photos through links that expire after 10 minutes', () => {
    expect(privacy).toContain('expire after 10 minutes');
    expect(api).toContain('SIGNED_URL_SECONDS = 600');
  });

  it('lets people delete their account themselves, keeping only anonymous money records', () => {
    expect(privacy).toContain('Delete your account and the data that goes with it, in Profile, then Delete account.');
    expect(privacy).toContain('under the name “Former member”');
    expect(terms).toContain('delete your account from your profile');
    expect(JSON.stringify(contactBlocks(null))).toContain('Delete your account yourself');
    expect(migrations).toContain('delete from auth.users where id = v_uid;');
    expect(migrations).toContain("set display_name = 'Former member',");
    expect(migrations).toContain('delete from public.trip_posts where author_id = v_uid;');
  });

  it('keeps packing lists, templates and “Only me” bookings private', () => {
    expect(privacy).toContain('Your packing list, your templates and bookings or documents you mark “Only me” are visible only to you');
    expect(migrations).toContain('using (public.is_trip_member(trip_id) and (not private or created_by = auth.uid()));');
    expect(migrations).toContain('create policy "templates: only yours" on public.trip_templates for select to authenticated using (owner_id = auth.uid());');
    expect(migrations).toContain("using (public.is_trip_member(trip_id) and (kind = 'group' or created_by = auth.uid()));");
  });

  it('deletes documents, templates and invite codes with the account', () => {
    expect(privacy).toContain('documents, private bookings, packing lists, templates, invite code and location are deleted straight away');
    expect(migrations).toContain('delete from public.trip_documents where uploaded_by = new.id;');
    expect(migrations).toContain('delete from public.trip_templates where owner_id = new.id;');
    expect(migrations).toContain('delete from public.referral_codes where user_id = new.id;');
  });
});
