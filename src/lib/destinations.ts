/**
 * Destination ideas for the Explore screen: a hand-picked starting point for
 * groups, not live data. Each one only pre-fills a new trip (name, destination
 * and currency); nothing here is fetched from or sent to another service.
 */
export type DestinationIdea = {
  id: string;
  name: string;
  country: string;
  emoji: string;
  currency: string;
  tags: ('City' | 'Beach' | 'Food' | 'Nature' | 'Culture' | 'Nightlife' | 'Adventure')[];
  blurb: string;
};

export const DESTINATIONS: DestinationIdea[] = [
  { id: 'lisbon', name: 'Lisbon', country: 'Portugal', emoji: '🚋', currency: 'EUR', tags: ['City', 'Food', 'Culture'], blurb: 'Hilltop viewpoints, old trams and pastéis de nata.' },
  { id: 'goa', name: 'Goa', country: 'India', emoji: '🏖️', currency: 'INR', tags: ['Beach', 'Food', 'Nightlife'], blurb: 'Beach shacks, Portuguese-era churches and seafood curries.' },
  { id: 'bali', name: 'Bali', country: 'Indonesia', emoji: '🌺', currency: 'IDR', tags: ['Beach', 'Nature', 'Culture'], blurb: 'Rice terraces, temples and surf beaches.' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', emoji: '🗼', currency: 'JPY', tags: ['City', 'Food', 'Culture'], blurb: 'Neon streets, quiet shrines and endless ramen.' },
  { id: 'barcelona', name: 'Barcelona', country: 'Spain', emoji: '🥘', currency: 'EUR', tags: ['City', 'Beach', 'Nightlife'], blurb: 'Gaudí buildings, tapas bars and a city beach.' },
  { id: 'mexico-city', name: 'Mexico City', country: 'Mexico', emoji: '🌮', currency: 'MXN', tags: ['City', 'Food', 'Culture'], blurb: 'Street tacos, murals and big museums.' },
  { id: 'cape-town', name: 'Cape Town', country: 'South Africa', emoji: '⛰️', currency: 'ZAR', tags: ['Nature', 'Adventure', 'Beach'], blurb: 'Table Mountain hikes, penguins and winelands nearby.' },
  { id: 'reykjavik', name: 'Reykjavík', country: 'Iceland', emoji: '🌋', currency: 'ISK', tags: ['Nature', 'Adventure'], blurb: 'Waterfalls, hot springs and black-sand beaches.' },
  { id: 'bangkok', name: 'Bangkok', country: 'Thailand', emoji: '🛺', currency: 'THB', tags: ['City', 'Food', 'Nightlife'], blurb: 'Night markets, temples and river boats.' },
  { id: 'banff', name: 'Banff', country: 'Canada', emoji: '🏔️', currency: 'CAD', tags: ['Nature', 'Adventure'], blurb: 'Turquoise lakes and mountain trails.' },
  { id: 'marrakech', name: 'Marrakech', country: 'Morocco', emoji: '🕌', currency: 'MAD', tags: ['Culture', 'Food'], blurb: 'Souks, riads and mint tea on the rooftops.' },
  { id: 'hanoi', name: 'Hanoi', country: 'Vietnam', emoji: '🍜', currency: 'VND', tags: ['City', 'Food', 'Culture'], blurb: 'Pho on tiny stools, lakes and the Old Quarter.' },
];

export const DESTINATION_TAGS = ['City', 'Beach', 'Food', 'Nature', 'Culture', 'Nightlife', 'Adventure'] as const;
