import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ChatMessage } from '@/data/models';
import { formatTime } from '@/lib/date';
import { useAppTheme, radii, spacing } from '@/theme';
import { AppText } from '../AppText';

interface ChatBubbleProps {
  message: ChatMessage;
  children?: ReactNode;
}

export function ChatBubble({ message, children }: ChatBubbleProps) {
  const { theme } = useAppTheme();
  const isUser = message.role === 'user';

  return (
    <View
      style={[
        styles.row,
        isUser ? styles.userRow : null,
      ]}
    >
      {!isUser ? (
        <View
          style={[
            styles.avatar,
            { backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <Ionicons
            name="sparkles"
            size={16}
            color={theme.colors.primarySoftText}
          />
        </View>
      ) : null}

      <View
        accessible
        accessibilityLabel={`${isUser ? 'You' : 'Pocketa assistant'}: ${
          message.text
        }`}
        style={[
          styles.bubble,
          {
            backgroundColor: isUser
              ? theme.colors.primary
              : theme.colors.surface,
            borderColor: isUser ? theme.colors.primary : theme.colors.border,
          },
          isUser ? styles.userBubble : theme.shadows.card,
        ]}
      >
        {!isUser ? (
          <View style={styles.meta}>
            <AppText
              variant="micro"
              color={theme.colors.primary}
            >
              POCKETA
            </AppText>
            <AppText variant="micro" color={theme.colors.textTertiary}>
              {formatTime(message.createdAt)}
            </AppText>
          </View>
        ) : null}
        <AppText
          variant="bodySmall"
          color={isUser ? theme.colors.onPrimary : theme.colors.text}
        >
          {message.text}
        </AppText>
        {isUser ? (
          <AppText
            variant="micro"
            color={theme.colors.onPrimary}
            align="right"
            style={styles.userTime}
          >
            {formatTime(message.createdAt)}
          </AppText>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    maxWidth: '90%',
  },
  userRow: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  bubble: {
    flexShrink: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    borderTopLeftRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 6,
  },
  userBubble: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  userTime: {
    opacity: 0.75,
  },
});
