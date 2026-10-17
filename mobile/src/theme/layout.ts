/** Max width of a reading/controls column on tablets; phones are narrower and unaffected. */
export const CONTENT_MAX_WIDTH = 680;
/** Lists (library, playlists) may be a bit wider. */
export const LIST_MAX_WIDTH = 820;
/** Centered column: apply to a ScrollView/FlatList contentContainerStyle (or a wrapper View). */
export const column = (max = CONTENT_MAX_WIDTH) => ({ width: '100%' as const, maxWidth: max, alignSelf: 'center' as const });
