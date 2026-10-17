import type { SFSymbol, AndroidSymbol, SymbolViewProps } from 'expo-symbols';

/**
 * Single source of truth for icons: SF Symbol name (iOS) -> Material Symbol name (Android).
 * Every `SymbolView` / `symbol=` prop goes through `sym()`. Adding an icon = adding a line here;
 * both names are type-checked (SFSymbol and AndroidSymbol).
 */
const MAP = {
  'slider.vertical.3': 'tune',
  'music.note.list': 'library_music',
  'rectangle.stack': 'playlist_play',
  metronome: 'timer',
  tuningfork: 'graphic_eq',
  plus: 'add',
  minus: 'remove',
  'minus.circle': 'remove_circle',
  magnifyingglass: 'search',
  'xmark.circle.fill': 'cancel',
  ellipsis: 'more_horiz',
  'play.fill': 'play_arrow',
  'stop.fill': 'stop',
  'pause.fill': 'pause',
  'backward.end.fill': 'skip_previous',
  'forward.end.fill': 'skip_next',
  'line.3.horizontal': 'drag_handle',
  'chevron.up': 'keyboard_arrow_up',
  'chevron.down': 'keyboard_arrow_down',
  'chevron.right': 'chevron_right',
  'chevron.left': 'chevron_left',
  'info.circle': 'info',
  'square.and.arrow.up': 'ios_share',
  'square.and.arrow.down': 'file_download',
  'arrow.counterclockwise': 'restore',
  lightbulb: 'lightbulb',
  'exclamationmark.bubble': 'feedback',
  star: 'star',
  book: 'menu_book',
  'icloud.and.arrow.up': 'cloud_upload',
  'hand.raised': 'privacy_tip',
  'doc.text': 'description',
  'music.note': 'music_note',
  'play.circle': 'play_circle',
  'speaker.wave.2.fill': 'volume_up',
  'arrow.down': 'arrow_downward',
  'checkmark.circle.fill': 'check_circle',
  'exclamationmark.triangle.fill': 'warning',
  circle: 'radio_button_unchecked',
} as const satisfies Partial<Record<SFSymbol, AndroidSymbol>>;

export type IconName = keyof typeof MAP;
/** What `SymbolView` takes as `name` (and what `IconButton` & co. take as `symbol`). */
export type SymbolName = SymbolViewProps['name'];

export function sym<K extends IconName>(name: K): { ios: K; android: (typeof MAP)[K] } {
  return { ios: name, android: MAP[name] };
}
