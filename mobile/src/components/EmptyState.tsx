import { StyleSheet, View } from 'react-native';

import { T } from '../theme/type';
import { Button } from './Controls';

type Props = { title: string; body: string; actionLabel: string; onAction: () => void };

export function EmptyState({ title, body, actionLabel, onAction }: Props) {
  return (
    <View style={styles.wrap}>
      <T variant="title" style={styles.center}>
        {title}
      </T>
      <T variant="body" tone="inkSecondary" style={styles.center}>
        {body}
      </T>
      <Button label={actionLabel} onPress={onAction} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 32, paddingTop: 48, gap: 12, alignItems: 'stretch' },
  center: { textAlign: 'center' },
  button: { marginTop: 16 },
});
