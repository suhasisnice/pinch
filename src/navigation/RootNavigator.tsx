import React from 'react';
import { NavigationContainer, DarkTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ParserScreen from '../screens/ParserScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { palette } from '../theme/theme';

export type RootStackParamList = {
  Home: undefined;
  Parser: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const pinchNavigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.background,
    card: palette.cardBackground,
    text: palette.textPrimary,
    border: palette.border,
    primary: palette.neonGreen,
  },
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={pinchNavigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: palette.cardBackground },
          headerTintColor: palette.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Parser" component={ParserScreen} options={{ title: 'SMS Simulator' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Calibration' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
