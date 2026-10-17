/** Contact address for suggestions/bug reports (a dedicated mailbox, not the developer's personal one). */
export const SUPPORT_EMAIL = 'info@re-pitch.it';
/** Public website (landing + privacy). null until the domain is decided: links are hidden. */
export const SITE_URL: string | null = 'https://re-pitch.it';
/** Numeric App Store id, known after the app is created in App Store Connect. null = hide "rate on App Store" link. */
export const APP_STORE_ID: string | null = '6823679480';

/** False while SUPPORT_EMAIL is still the placeholder: mail actions must be hidden. */
export function supportEmailConfigured(): boolean {
  return !SUPPORT_EMAIL.includes('example.com');
}
