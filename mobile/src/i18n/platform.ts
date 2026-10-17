import { Platform } from 'react-native';

/** Platform-specific copy: `pick(iosText, androidText)`. */
export const pick = (ios: string, android: string): string => (Platform.OS === 'android' ? android : ios);
