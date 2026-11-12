import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';

// Semantic icon names -> SF Symbol (iOS) and Material Symbol (Android/web).
const ICONS = {
  map: ['map', 'map'],
  bills: ['receipt', 'receipt_long'],
  balances: ['arrow.left.arrow.right', 'account_balance_wallet'],
  people: ['person.2', 'group'],
  person: ['person.crop.circle', 'person'],
  add: ['plus', 'add'],
  bell: ['bell', 'notifications'],
  share: ['square.and.arrow.up', 'share'],
  qr: ['qrcode', 'qr_code'],
  location: ['location.fill', 'location_on'],
  pause: ['pause.fill', 'pause'],
  play: ['play.fill', 'play_arrow'],
  camera: ['camera', 'photo_camera'],
  photo: ['photo', 'image'],
  check: ['checkmark', 'check'],
  close: ['xmark', 'close'],
  chevron: ['chevron.right', 'chevron_right'],
  sparkles: ['sparkles', 'auto_awesome'],
  directions: ['arrow.triangle.turn.up.right.diamond', 'directions'],
  logout: ['rectangle.portrait.and.arrow.right', 'logout'],
  copy: ['doc.on.doc', 'content_copy'],
  phone: ['phone', 'phone'],
  mail: ['envelope', 'mail'],
  contacts: ['person.crop.rectangle.stack', 'contacts'],
  settings: ['gearshape', 'settings'],
  trash: ['trash', 'delete'],
  edit: ['pencil', 'edit'],
  personAdd: ['person.badge.plus', 'person_add'],
  myLocation: ['location.circle', 'my_location'],
  back: ['chevron.left', 'arrow_back'],
  trip: ['airplane', 'flight_takeoff'],
  link: ['link', 'link'],
  refresh: ['arrow.clockwise', 'refresh'],
  navigate: ['location.north.fill', 'navigation'],
  pin: ['mappin.and.ellipse', 'add_location_alt'],
  calendar: ['calendar', 'event'],
  arrowDown: ['arrow.down', 'arrow_downward'],
  wallet: ['banknote', 'payments'],
  cloudOff: ['icloud.slash', 'cloud_off'],
  arrowUp: ['arrow.up', 'arrow_upward'],
  home: ['house', 'home'],
  feed: ['bubble.left.and.bubble.right', 'forum'],
  comment: ['bubble.left', 'chat_bubble'],
  heart: ['heart', 'favorite'],
  poll: ['chart.bar', 'poll'],
  star: ['star', 'star'],
  checklist: ['checklist', 'checklist'],
  trophy: ['trophy', 'emoji_events'],
  flag: ['flag', 'flag'],
  idea: ['lightbulb', 'lightbulb'],
  explore: ['safari', 'explore'],
  send: ['paperplane', 'send'],
  ticket: ['ticket', 'confirmation_number'],
  megaphone: ['megaphone', 'campaign'],
  clock: ['clock', 'schedule'],
  search: ['magnifyingglass', 'search'],
  bed: ['bed.double', 'bed'],
  document: ['doc.text', 'description'],
  cloud: ['cloud.sun', 'partly_cloudy_day'],
  insights: ['chart.line.uptrend.xyaxis', 'insights'],
  gift: ['gift', 'redeem'],
  copyAll: ['square.on.square', 'library_add'],
} as const satisfies Record<string, readonly [string, AndroidSymbol]>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  const [ios, material] = ICONS[name];
  return (
    <SymbolView
      name={{ ios: ios as SFSymbol, android: material, web: material }}
      size={size}
      tintColor={color}
      resizeMode="scaleAspectFit"
    />
  );
}
