import type { PropsWithChildren } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  SafeAreaView,
  type Edge,
} from 'react-native-safe-area-context';

import { getContentMaxWidth, useAppTheme, layout } from '@/theme';

interface ScreenProps {
  scroll?: boolean;
  edges?: Edge[];
  wide?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
}

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  wide = false,
  contentContainerStyle,
  style,
  keyboardShouldPersistTaps = 'handled',
}: PropsWithChildren<ScreenProps>) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const contentMaxWidth = getContentMaxWidth(width, wide);

  if (scroll) {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: layout.screenPadding,
              maxWidth: contentMaxWidth,
            },
            contentContainerStyle,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <View
        style={[
          styles.staticContent,
          {
            paddingHorizontal: layout.screenPadding,
            maxWidth: contentMaxWidth,
          },
          style,
          contentContainerStyle,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: 10,
    paddingBottom: 36,
  },
  staticContent: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 10,
    paddingBottom: 16,
  },
});
