import React from 'react';

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
import TransactionsScreen from '../screens/TransactionsScreen';
import Icon, { IconName } from '../components/Icon';
import { palette, typography } from '../theme/theme';

export type RootStackParamList = {
  Tabs: undefined;
  Settings: undefined;
  Review: undefined;
  Transactions: undefined;
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

// Drawn from Feather / Material Community Icons rather than emoji: emoji are
// rendered by the system font, so the same character is a different picture
// on every Android skin and none of them are designed to sit in a tab bar.
const TAB_ICONS: Record<keyof TabParamList, IconName> = {
  Today: 'today',
  Outings: 'outings',
  Goals: 'goals',
  Squad: 'squad',
  Insights: 'insights',
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
          <Icon
            name={TAB_ICONS[route.name as keyof TabParamList]}
            size={21}
            color={focused ? palette.neonGreen : palette.textMuted}
          />
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
        <Stack.Screen
          name="Transactions"
          component={TransactionsScreen}
          options={{ title: 'Transactions' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
