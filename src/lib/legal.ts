/**
 * The Privacy Policy and Terms of Use shown at /privacy and /terms.
 *
 * Written to match what the app actually does. If you change how data is
 * collected, shared or kept, change this text in the same commit:
 * tests/unit/legal.test.ts checks the retention periods stated here against
 * the database migrations.
 *
 * The contact address comes from EXPO_PUBLIC_SUPPORT_EMAIL (set it on the
 * Railway `web` service, then redeploy). Until it is set, the pages point
 * people to what they can do themselves in the app.
 */

export const LEGAL_UPDATED = '10 November 2026';

/** One paragraph (optionally with a bold lead-in) or a bulleted list. */
export type LegalBlock = { text: string; lead?: string } | { list: string[] };
export type LegalSection = { id: string; heading: string; blocks: LegalBlock[] };
export type LegalDoc = {
  kind: 'privacy' | 'terms';
  title: string;
  /** "The short version", shown first. */
  summary: string[];
  sections: LegalSection[];
};

/** The public contact address, or null when it isn't set or isn't an email address. */
export function supportEmail(raw: string | undefined = process.env.EXPO_PUBLIC_SUPPORT_EMAIL): string | null {
  const value = (raw ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}

/** How to reach us, or what to do until a contact address is published. */
export function contactBlocks(email: string | null): LegalBlock[] {
  if (email) {
    return [
      { text: `Email ${email} with any question about these documents, or to ask for a copy of your data or a correction. We reply within one month. You can delete your account yourself in the app, from Profile, then Delete account.` },
      { text: 'For a privacy request, write from the email address or phone number on your account if you can, so we can confirm it’s you. If you’re in India, this address is also our grievance contact under the DPDP Act.' },
    ];
  }
  return [
    { text: 'We’re setting up a contact address for privacy and support requests, and it will appear here.' },
    {
      text: 'Until then, you can see and change most of your data yourself in the app:',
    },
    {
      list: [
        'Open Profile to edit your name, payment details, notification settings and badge privacy.',
        'Delete your account yourself, at any time, from Profile, then Delete account.',
        'Pause location sharing at any time from the trip’s map.',
        'Delete your own posts and comments, or leave a trip, from inside the trip.',
        'Sign out to remove the copy of your trips kept on this device.',
      ],
    },
  ];
}

// ---------------------------------------------------------------- privacy

export const PRIVACY: LegalDoc = {
  kind: 'privacy',
  title: 'Privacy Policy',
  summary: [
    'We collect what Tripley needs to run your trips: your name, how you sign in, the trips you’re on and what you add to them.',
    'Your location is shared only with people on the same trip, only while the trip is on and you’re sharing. We keep only your latest position, never a history, and delete it after the trip ends.',
    'We don’t sell your data, show ads, or use third-party analytics or advertising trackers.',
    'You can see and change most of your data in the app, delete your account there yourself, and ask us for a copy.',
  ],
  sections: [
    {
      id: 'who',
      heading: 'Who we are',
      blocks: [
        {
          text: 'Tripley (“we”, “us”) is an app for planning group trips, seeing your group on a map, and splitting costs. This policy explains what personal data Tripley handles, why, who can see it, how long we keep it, and the choices you have. It applies to the Tripley website and the iPhone and Android apps, wherever in the world you use them.',
        },
        {
          text: 'We decide how and why your data is used, which makes us the “controller” (or “data fiduciary” under India’s Digital Personal Data Protection Act). You can reach us using the details under “Contact us”.',
        },
      ],
    },
    {
      id: 'collect',
      heading: 'What we collect',
      blocks: [
        {
          lead: 'Your account.',
          text: 'Your name, your usual currency and, depending on how you sign in, your email address, your phone number, or the name and email address your Google or Apple account shares with us. Passwords are stored only in hashed form. A guest account has no email address or phone number.',
        },
        {
          lead: 'Trips and plans.',
          text: 'Trip names, dates, destinations and cover photos; who is on each trip and who invited them; plans, RSVPs, comments, places you pin, ideas, polls and votes, group tasks, challenges, and your own packing list.',
        },
        {
          lead: 'Your location, only if you share it.',
          text: 'While a trip is on and you have sharing turned on, your device sends your latest position, its accuracy, your direction and speed, your battery level and the time. On a phone this can continue in the background if you allow “Always” location access. We also work out whether you’re inside a place the group pinned for arrival alerts. Places and posts can also include a map point you choose to add.',
        },
        {
          lead: 'Money.',
          text: 'Bills (amounts, items, who had what and who paid), receipt photos, the exchange rate used, payments marked as made, cash kitties, and any payment details you choose to add to your profile, such as a UPI ID, Venmo username or IBAN. Tripley doesn’t process payments and never sees your card details or bank login.',
        },
        {
          lead: 'Posts and photos.',
          text: 'What you post to a trip’s feed, including photos, places, reactions and comments.',
        },
        {
          lead: 'Tripley Pro.',
          text: 'If you subscribe, the app store and our subscription provider tell us your plan and when it renews or ends. We never see your card details. If you use AI receipt reading, we keep a record of each scan so we can count your monthly allowance.',
        },
        {
          lead: 'Notifications.',
          text: 'Your device’s push notification token and your notification settings.',
        },
        {
          lead: 'Technical data.',
          text: 'Like any website, our servers receive your IP address, details of your browser or app, and the requests you make. These are kept in server logs for security and troubleshooting.',
        },
        {
          lead: 'Contacts.',
          text: 'If you pick a friend from your phone’s contacts to invite them, only the phone number you picked is used, to find their Tripley account. We don’t upload or store your address book.',
        },
        { text: 'We don’t collect anything else from your device, and we don’t buy data about you from anyone.' },
      ],
    },
    {
      id: 'use',
      heading: 'How we use it',
      blocks: [
        {
          list: [
            'To run Tripley: show your trips to the people on them, put your group on the map, split bills, work out balances, and send the notifications you’ve chosen.',
            'To keep Tripley safe: limit how fast accounts can post or invite, protect accounts, and look into problems and misuse.',
            'To read receipts, when you ask: AI receipt reading sends the photo to our AI provider to pull out the items and prices. The result is kept for one day so the bill form can use it.',
            'To manage your subscription and answer your requests.',
            'To meet our legal obligations.',
          ],
        },
        {
          text: 'We don’t use your data for advertising, don’t sell it, and don’t share it for targeted advertising. We don’t make decisions about you by automated means alone that have legal or similarly significant effects on you.',
        },
      ],
    },
    {
      id: 'bases',
      heading: 'Our legal reasons',
      blocks: [
        { text: 'Where a law (such as the GDPR in Europe and the UK) asks for a legal basis, ours are:' },
        {
          list: [
            'Contract: most processing is needed to provide the service you signed up for.',
            'Consent: sharing your location, AI receipt reading, and the device permissions for location, camera, photos, contacts and notifications. You can withdraw consent at any time in the app or in your device settings; this doesn’t affect what was done before.',
            'Legitimate interests: keeping Tripley secure and preventing misuse, balanced against your rights.',
            'Legal obligation: where the law requires us to keep or disclose information.',
          ],
        },
        {
          text: 'In India, we process your data with the consent you give when you create an account and when you turn on features such as location sharing, and for the other lawful uses the DPDP Act allows.',
        },
      ],
    },
    {
      id: 'share',
      heading: 'Who can see your data',
      blocks: [
        {
          lead: 'People on your trips.',
          text: 'Your name and profile photo, what you add to a trip, and your location while sharing is on are visible to the other members of that trip. Your packing list is visible only to you. Your badges are private unless you choose to show them. Payment details on your profile are shown to people on your trips when they settle up with you.',
        },
        {
          lead: 'Service providers.',
          text: 'These companies process data for us, only to run Tripley:',
        },
        {
          list: [
            'Railway: hosting. Our servers, database and stored photos are in the United States.',
            'Expo, with Apple and Google: delivering push notifications. They receive your push token and the notification text.',
            'Anthropic: AI receipt reading. It receives the receipt photos you choose to scan.',
            'RevenueCat, with Apple’s App Store and Google Play: subscriptions.',
            'Twilio and our email provider: sending sign-in codes and account emails, if you sign in that way.',
            'Google or Apple: if you choose to sign in with them.',
            'OpenFreeMap: the map images. It receives your IP address and the area of the map on your screen, not the location you share.',
            'Photon by komoot: address and place search. It receives what you type into a search box, a rough area to search near (such as the trip’s destination) and your IP address, not the location you share.',
            'Frankfurter: exchange rates. No personal data is sent.',
          ],
        },
        {
          lead: 'Apps you open from Tripley.',
          text: 'Pay links open apps such as UPI apps, Venmo or PayPal, and Directions opens Google Maps or Apple Maps. Their own privacy policies apply there.',
        },
        {
          lead: 'When the law requires it.',
          text: 'We may disclose data to comply with the law, or to protect someone’s safety, our users or Tripley.',
        },
        {
          lead: 'If Tripley changes hands.',
          text: 'If Tripley is merged or sold, your data may pass to the new owner, who must keep the protections in this policy or tell you first.',
        },
        { text: 'We never sell your personal data.' },
      ],
    },
    {
      id: 'location',
      heading: 'Your location',
      blocks: [
        {
          list: [
            'Sharing is off until you turn it on. It stops when the trip is over: the day after its end date, or as soon as the organizer ends it.',
            'Only the people on that trip can see it. You can pause at any time.',
            'We keep only your latest position for each trip, not a history of where you’ve been.',
            'When a trip ends, positions are deleted: straight away if the organizer ends it, and otherwise automatically within 3 days of the trip’s end date. Other members stop seeing them the day after the end date.',
            'Leaving a trip deletes your position for that trip straight away.',
            'In a browser, your location is sent only while the Tripley page is open. On a phone with “Always” access it can continue in the background; you can change this in your phone’s settings.',
          ],
        },
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      blocks: [
        {
          list: [
            'Shared location: until the trip ends or you leave it (see above).',
            'AI receipt results: one day. Scan records: 90 days.',
            'Your account and trips: for as long as you have an account. Trip records such as bills, payments and plans are shared with your group, so what you added to a trip stays for the others after you leave it.',
            'When you delete your account, your sign-in details, name, payment details, posts, comments, photos, packing lists and location are deleted straight away. Trips nobody else is on are deleted too. On shared trips, bills, payments and plans stay in the group’s records under the name “Former member”, so everyone’s balances still add up.',
            'Any copies in backups are overwritten as the backups are replaced.',
            'Server logs: kept only for a limited time by our hosting provider.',
            'Data on your device: the copy kept for offline use is tied to your account and removed when you sign out.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      heading: 'Your choices and rights',
      blocks: [
        { text: 'Wherever you live, you can:' },
        {
          list: [
            'See and correct your profile, payment details and notification settings in Profile.',
            'Pause location sharing, and turn off location, camera, photos, contacts or notification access in your device settings.',
            'Delete your own posts and comments, and leave a trip.',
            'Delete your account and the data that goes with it, in Profile, then Delete account. It takes effect straight away.',
            'Ask us for a copy of your data, to correct it, or object to how we use it, using “Contact us”. We reply within one month, or sooner if your law requires.',
          ],
        },
        {
          lead: 'Europe and the UK.',
          text: 'You can also restrict how we use your data, receive it in a portable format, and complain to your local data protection authority.',
        },
        {
          lead: 'India.',
          text: 'Under the Digital Personal Data Protection Act 2023 you can get a summary of your data and who it has been shared with, have it corrected, completed or erased, withdraw consent, nominate someone to use your rights if you die or can’t act, and raise a grievance with us. If you’re not satisfied with our answer, you can complain to the Data Protection Board of India.',
        },
        {
          lead: 'United States.',
          text: 'If you live in California or another state with a consumer privacy law, you can ask to know, access, correct and delete your data, and opt out of its sale, of sharing for targeted advertising, and of profiling. We don’t do any of those, so there’s nothing to opt out of. We use precise location only for the feature you turned on, and we won’t treat you differently for using your rights.',
        },
        {
          lead: 'Everywhere else.',
          text: 'You have the rights your local law gives you, for example in Brazil, Canada, Australia, Japan, Singapore or South Africa. Contact us and we’ll help.',
        },
        {
          text: 'We may need to confirm it’s you before acting on a request. Where the law allows, someone you authorise can make a request for you.',
        },
      ],
    },
    {
      id: 'transfers',
      heading: 'International transfers',
      blocks: [
        {
          text: 'Tripley’s servers are in the United States, and some of our providers process data in other countries. If you use Tripley from elsewhere, your data is transferred to the United States. Where the law requires it, we rely on recognised safeguards, such as the standard contractual clauses in our providers’ data processing terms.',
        },
      ],
    },
    {
      id: 'security',
      heading: 'Security',
      blocks: [
        {
          text: 'Data is encrypted in transit (HTTPS). Database rules check on every request that you’re on a trip before showing you anything from it. Trip photos and receipts are stored privately and shown through links that expire after 10 minutes. No system is perfectly secure; if a breach affects your data, we’ll tell you and the authorities where the law requires.',
        },
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [
        {
          text: 'Tripley isn’t for children. You must be at least 16, or older where your local law sets a higher age for using online services without a parent’s consent (for example 18 in India). If you think a child has given us personal data, contact us and we’ll delete it.',
        },
      ],
    },
    {
      id: 'storage',
      heading: 'Cookies and storage on your device',
      blocks: [
        {
          text: 'Tripley doesn’t use advertising or analytics cookies. The website keeps your sign-in and an offline copy of your trips in your browser’s storage, and its offline helper saves the app’s files and recent map images so Tripley works without a connection. Clearing this site’s data removes them; a guest account can’t be recovered after that.',
        },
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      blocks: [
        {
          text: 'If we change this policy in a way that matters, we’ll tell you in the app before the change applies. The date at the top shows when it was last updated.',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------- terms

export const TERMS: LegalDoc = {
  kind: 'terms',
  title: 'Terms of Use',
  summary: [
    'Tripley helps groups plan trips, see each other on a map and split costs. It’s free; Tripley Pro adds AI receipt reading.',
    'Only share your location with people who know, and never use Tripley to track someone.',
    'Tripley does the maths but never holds or moves money. Check amounts before you pay anyone.',
    'Locations can be wrong or late. In an emergency, contact local emergency services.',
  ],
  sections: [
    {
      id: 'agree',
      heading: 'Agreeing to these terms',
      blocks: [
        {
          text: 'By creating an account or using Tripley, you agree to these terms and confirm you’ve read our Privacy Policy. If you don’t agree, please don’t use Tripley. “Tripley”, “we” and “us” mean the people who run Tripley.',
        },
      ],
    },
    {
      id: 'eligibility',
      heading: 'Who can use Tripley',
      blocks: [
        {
          text: 'You must be at least 16, or older where your local law sets a higher age for using online services without a parent’s consent (for example 18 in India). You must be able to agree to these terms where you live, and not be barred by law from using the service.',
        },
      ],
    },
    {
      id: 'account',
      heading: 'Your account',
      blocks: [
        {
          list: [
            'Give accurate details, keep your sign-in secure, and tell us if you think someone else is using your account. You’re responsible for what happens in your account.',
            'A guest account lives only in the browser where it was made. If you sign out or clear that site’s data, it can’t be recovered. Save it with an email address to keep it.',
          ],
        },
      ],
    },
    {
      id: 'location',
      heading: 'Location sharing',
      blocks: [
        {
          list: [
            'Sharing is your choice. Only share with people who know they can see you, and only add people to a trip who want to be on it.',
            'Never use Tripley to track, monitor, stalk or harass anyone, or to share someone else’s location without their consent. We close accounts that do.',
            'Location, arrival alerts and the friend finder depend on your device, its GPS and your connection. They can be inaccurate, late or unavailable.',
            'Tripley isn’t a safety or emergency service. In an emergency, contact local emergency services.',
          ],
        },
      ],
    },
    {
      id: 'money',
      heading: 'Bills, balances and payments',
      blocks: [
        {
          list: [
            'Tripley works out splits and balances from what members enter. It’s a record-keeping tool, not a bank or payment service, and it never holds or moves money.',
            'Payments happen in other apps, such as UPI apps, Venmo, PayPal or your bank. Check the amount and the person before you pay. We aren’t responsible for payments made outside Tripley, or for disagreements between members about money.',
            'Exchange rates are published reference rates or rates entered by members, and can differ from what your bank or card charges.',
            'AI receipt reading can make mistakes. Check the items and totals before you save.',
            'A cash kitty only records who is holding the group’s cash. Tripley never holds it.',
            'Nothing in Tripley is financial, tax or legal advice.',
          ],
        },
      ],
    },
    {
      id: 'content',
      heading: 'Your content',
      blocks: [
        {
          text: 'You own what you add to Tripley: posts, photos, comments, plans and bills. You give us a worldwide, non-exclusive, royalty-free licence to store, copy and show it to the people on your trips, and in any recap you choose to share, only so we can run Tripley. The licence ends when the content is deleted, except for copies that stay in other members’ trip records (such as bills) or that we must keep by law.',
        },
        {
          text: 'Only post what you have the right to share, and ask people before posting photos of them where that’s needed.',
        },
      ],
    },
    {
      id: 'rules',
      heading: 'Rules',
      blocks: [
        { text: 'Don’t:' },
        {
          list: [
            'post anything illegal, hateful, harassing, sexually explicit, violent, or that infringes someone else’s rights;',
            'share other people’s personal data without their permission;',
            'spam, impersonate anyone, or mislead people;',
            'try to break into accounts or systems, get around limits or security, scrape, or reverse engineer Tripley, except where the law allows;',
            'overload or disrupt the service;',
            'use Tripley to break the law, including sanctions and export laws.',
          ],
        },
        {
          text: 'Trip organizers can remove posts and comments in their trips. We may remove content, or suspend or close accounts, that break these rules.',
        },
      ],
    },
    {
      id: 'pro',
      heading: 'Tripley Pro',
      blocks: [
        {
          list: [
            'Pro is a subscription billed by Apple’s App Store, Google Play or, where offered, our web checkout, at the price shown before you buy.',
            'It renews automatically until you cancel. Cancel at least 24 hours before it renews, in your app store account settings or from Tripley’s Pro screen.',
            'Refunds follow the store’s refund policy, and you keep any rights your local consumer law gives you.',
            'AI receipt reading has a monthly allowance shown in the app.',
            'We’ll tell you before a price change, and you can cancel before it applies.',
          ],
        },
      ],
    },
    {
      id: 'third',
      heading: 'Other services',
      blocks: [
        {
          text: 'Tripley works with services run by others, such as maps, payment apps, app stores and sign-in providers. Their terms apply when you use them, and we aren’t responsible for them.',
        },
        {
          lead: 'If you got Tripley from Apple’s App Store.',
          text: 'These terms are between you and us, not Apple. Apple isn’t responsible for Tripley or its content, has no obligation to provide support or maintenance for it, and isn’t responsible for any claims about it, including product liability, legal compliance or intellectual property claims. If Tripley fails to meet a warranty that applies, you can tell Apple, which may refund the purchase price; Apple has no other warranty obligation. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you.',
        },
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to Tripley and these terms',
      blocks: [
        {
          text: 'We’re improving Tripley all the time and may add, change or remove features. We try to keep it running, but can’t promise it will always be available or free of errors.',
        },
        {
          text: 'If we change these terms in a way that matters, we’ll tell you in the app before the change applies. If you keep using Tripley after that, the new terms apply. If you don’t agree with them, you can stop using Tripley.',
        },
      ],
    },
    {
      id: 'ending',
      heading: 'Ending',
      blocks: [
        {
          text: 'You can stop using Tripley at any time, and delete your account from your profile. Deleting it doesn’t cancel a Tripley Pro subscription; cancel that in your app store. We may suspend or close an account that seriously or repeatedly breaks these terms, or where the law requires; where it’s reasonable, we’ll tell you why. Parts of these terms that by their nature should continue (such as content licences already used, and limits on liability) continue after that.',
        },
      ],
    },
    {
      id: 'liability',
      heading: 'Our responsibility to you',
      blocks: [
        {
          text: 'Tripley is provided “as is”. As far as the law allows, we don’t give any promises beyond those in these terms, including implied promises that it will be fit for a particular purpose.',
        },
        {
          text: 'As far as the law allows, we aren’t liable for indirect or consequential losses, lost profits or lost data, or for losses caused by payments between members, inaccurate locations, or other people’s content or behaviour. Our total liability for all claims is limited to the greater of what you paid us in the 12 months before the claim and 50 US dollars (or the same in your currency).',
        },
        {
          text: 'Nothing in these terms limits liability that can’t be limited by law, such as for death or personal injury caused by negligence, or for fraud, or takes away rights you have as a consumer under the law where you live.',
        },
      ],
    },
    {
      id: 'law',
      heading: 'Law and disputes',
      blocks: [
        {
          text: 'These terms are governed by the law of the country where you live, and you can bring a claim in the courts where you live. If something goes wrong, please contact us first and we’ll try to put it right.',
        },
        {
          text: 'If part of these terms can’t be enforced, the rest still applies. If we don’t enforce something straight away, we can still do so later. We may transfer these terms to someone who takes over Tripley, and they must keep your rights under them.',
        },
      ],
    },
  ],
};
