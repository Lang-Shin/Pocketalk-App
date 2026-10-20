import { useRouter } from 'expo-router';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Screen } from '@/components/ui/Screen';

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <Screen edges={['top', 'bottom']}>
      <PageHeader title="Not found" preview={false} />
      <EmptyState
        icon="compass-outline"
        title="This screen does not exist"
        description="The link may be outdated. Return to the dashboard to continue."
        actionLabel="Go home"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
