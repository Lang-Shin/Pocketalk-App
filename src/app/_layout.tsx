import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FinanceProvider } from '@/data/financeStore';
import { PocketaThemeProvider, useAppTheme } from '@/theme';

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
  const [fontsLoaded, fontError] = useFonts({
    NunitoSans_400Regular: require('../../node_modules/@expo-google-fonts/nunito-sans/400Regular/NunitoSans_400Regular.ttf'),
    NunitoSans_500Medium: require('../../node_modules/@expo-google-fonts/nunito-sans/500Medium/NunitoSans_500Medium.ttf'),
    NunitoSans_600SemiBold: require('../../node_modules/@expo-google-fonts/nunito-sans/600SemiBold/NunitoSans_600SemiBold.ttf'),
    NunitoSans_700Bold: require('../../node_modules/@expo-google-fonts/nunito-sans/700Bold/NunitoSans_700Bold.ttf'),
    NunitoSans_800ExtraBold: require('../../node_modules/@expo-google-fonts/nunito-sans/800ExtraBold/NunitoSans_800ExtraBold.ttf'),
  });

  useEffect(() => {
    if (fontError) console.warn('Nunito Sans could not be loaded; using system fonts.', fontError);
  }, [fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PocketaThemeProvider>
          <FinanceProvider>
            <RootNavigator />
          </FinanceProvider>
        </PocketaThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
