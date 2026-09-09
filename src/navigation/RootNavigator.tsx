import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, DarkTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import TodayScreen from '../screens/TodayScreen';
import OutingsScreen from '../screens/OutingsScreen';
import GoalsScreen from '../screens/GoalsScreen';
import SquadScreen from '../screens/SquadScreen';
import InsightsScreen from '../screens/InsightsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ReviewScreen from '../screens/ReviewScreen';
import { palette, typography } from '../theme/theme';

export type RootStackParamList = {
  Tabs: undefined;
  Settings: undefined;
  Review: undefined;
};

export type TabParamList = {
  Today: undefined;
  Outings: undefined;
  Goals: undefined;
  Squad: undefined;
  Insights: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const pinchTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.background,
    card: palette.surface,
    text: palette.textPrimary,
    border: palette.border,
    primary: palette.neonGreen,
  },
};

// Emoji rather than an icon font: it keeps the bundle smaller, renders
// identically across Android versions, and suits the tone of the app.
const TAB_ICONS: Record<keyof TabParamList, string> = {
  Today: '⚡',
  Outings: '🎉',
  Goals: '🎯',
  Squad: '🤝',
  Insights: '📊',
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: palette.neonGreen,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { ...typography.micro, fontSize: 10 },
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
            {TAB_ICONS[route.name as keyof TabParamList]}
          </Text>
        ),
      })}
    >
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Outings" component={OutingsScreen} />
      <Tab.Screen name="Goals" component={GoalsScreen} />
      <Tab.Screen name="Squad" component={SquadScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer theme={pinchTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Review" component={ReviewScreen} options={{ title: 'Review' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
