import type { ChatMessage, ProfileData } from './models';

function dateDaysAgo(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export const mockProfile: ProfileData = {
  name: 'Alex Rivera',
  firstName: 'Alex',
  initials: 'AR',
  subtitle: 'Student budgeter',
  goalLabel: 'Build a calm, clear money habit',
  joinedLabel: 'Using Pocketa since August 2026',
};

export const mockChatThread: ChatMessage[] = [
  {
    id: 'chat-1',
    role: 'assistant',
    text: 'Hi Alex! Tell me what you spent or received, and I will prepare a draft for you to review.',
    createdAt: dateDaysAgo(0, 9, 0),
  },
  {
    id: 'chat-2',
    role: 'user',
    text: 'I spent \u20B1145 on lunch kanina.',
    createdAt: dateDaysAgo(0, 9, 2),
  },
  {
    id: 'chat-3',
    role: 'assistant',
    text: 'I found a possible expense. Please check the details before saving. This is a demo draft, so no money has moved.',
    createdAt: dateDaysAgo(0, 9, 2),
    draft: {
      action: 'expense',
      title: 'Lunch',
      amountMinor: 14_500,
      sourceLabel: 'Virtual GCash',
      destinationLabel: 'Food & drinks',
      dateLabel: 'Today',
      note: 'Demo draft only',
    },
  },
];
