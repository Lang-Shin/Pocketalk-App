import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FinanceProvider } from '@/data/financeStore';
import { LaunchExperience } from '@/features/launch/LaunchExperience';
import { PocketaThemeProvider, useAppTheme } from '@/theme';

const interFonts =
  Platform.OS === 'ios'
    ? {}
    : {
        Inter_400Regular: require('../../node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
        Inter_500Medium: require('../../node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
        Inter_600SemiBold: require('../../node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
        Inter_700Bold: require('../../node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
        Inter_800ExtraBold: require('../../node_modules/@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf'),
      };

function RootNavigator() {
  const { theme } = useAppTheme();

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="profile"
          options={{
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="monthly-history"
          options={{
            animation: 'slide_from_right',
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [, fontError] = useFonts(interFonts);

  useEffect(() => {
    if (fontError) {
      console.warn(
        'Inter could not be loaded; using the platform system font.',
        fontError,
      );
    }
  }, [fontError]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PocketaThemeProvider>
          <View style={{ flex: 1 }}>
            <FinanceProvider>
              <RootNavigator />
            </FinanceProvider>
            <LaunchExperience />
          </View>
        </PocketaThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
