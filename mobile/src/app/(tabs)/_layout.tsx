import { BottomTabBar, Tabs } from 'expo-router/js-tabs';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { BottomDock } from '../../components/BottomDock';
import { Paper } from '../../components/Paper';
import { s } from '../../i18n';
import { useColors } from '../../theme';
import { fonts } from '../../theme/type';
import { sym } from '../../lib/icons';

export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      tabBar={(props) => (
        <View>
          <BottomDock />
          <Paper style={{ flex: 0 }}>
            <BottomTabBar {...props} />
          </Paper>
        </View>
      )}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.paper },
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.inkSecondary,
        tabBarLabelStyle: { fontFamily: fonts.caslon, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopColor: colors.rule,
          borderTopWidth: StyleSheet.hairlineWidth,
          // Android draws an elevation shadow behind a transparent bar: a dark band with inset edges over the paper.
          elevation: 0,
          shadowOpacity: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: s.tabs.tuning,
          tabBarIcon: ({ color, size }) => <SymbolView name={sym('slider.vertical.3')} size={size} tintColor={color} />,
        }}
      />
      <Tabs.Screen
        name="libreria"
        options={{
          title: s.tabs.library,
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={sym('music.note.list')} size={size} tintColor={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="playlists"
        options={{
          title: s.tabs.playlists,
          tabBarIcon: ({ color, size }) => (
            <SymbolView name={sym('rectangle.stack')} size={size} tintColor={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="metronomo"
        options={{
          title: s.tabs.metronome,
          tabBarIcon: ({ color, size }) => <SymbolView name={sym('metronome')} size={size} tintColor={color} />,
        }}
      />
      <Tabs.Screen
        name="accordatore"
        options={{
          title: s.tabs.tuner,
          tabBarIcon: ({ color, size }) => <SymbolView name={sym('tuningfork')} size={size} tintColor={color} />,
        }}
      />
    </Tabs>
  );
}
