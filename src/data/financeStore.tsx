import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { openPocketaDatabase } from '@/db/expoDatabase';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { useRepositoryQuery, type QueryResult } from './hooks';
import {
  FinanceSession,
  type FinanceSessionState,
  type FinanceStatus,
} from './financeSession';
import type {
  ActionResult,
  ContainerInput,
  HistoryView,
  MoneyEntryInput,
  MonthView,
  UpdateContainerInput,
  WalletView,
} from './financeService';

export type { EntryMode } from './financeService';
export type { FinanceStatus };

interface FinanceStoreValue extends FinanceSessionState {
  retry: () => void;
  refresh: () => void;
  recordMoneyEntry: (input: MoneyEntryInput) => Promise<ActionResult>;
  createContainer: (input: ContainerInput) => Promise<ActionResult>;
  updateContainer: (input: UpdateContainerInput) => Promise<ActionResult>;
  archiveContainer: (
    containerId: string,
    idempotencyKey?: string,
  ) => Promise<ActionResult>;
  reactivateContainer: (
    containerId: string,
    idempotencyKey?: string,
  ) => Promise<ActionResult>;
  deleteContainer: (
    containerId: string,
    idempotencyKey?: string,
  ) => Promise<ActionResult>;
}

const FinanceStoreContext = createContext<FinanceStoreValue | null>(null);

export function FinanceProvider({ children }: PropsWithChildren) {
  const [session] = useState(
    () => new FinanceSession({ openDatabase: openPocketaDatabase }),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void session.start();
    }, 0);

    return () => clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (state.status !== 'ready') return;

    const refreshDate = () => {
      session.refreshDate();
    };
    const interval = setInterval(refreshDate, 60_000);
    const subscription = AppState.addEventListener('change', (nextStatus) => {
      if (nextStatus === 'active') refreshDate();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [session, state.status]);

  const value = useMemo<FinanceStoreValue>(
    () => ({
      ...state,
      retry: session.retry,
      refresh: session.refresh,
      recordMoneyEntry: session.recordMoneyEntry,
      createContainer: session.createContainer,
      updateContainer: session.updateContainer,
      archiveContainer: session.archiveContainer,
      reactivateContainer: session.reactivateContainer,
      deleteContainer: session.deleteContainer,
    }),
    [session, state],
  );

  if (state.status !== 'ready' || !state.service) {
    return (
      <FinanceStoreContext.Provider value={value}>
        <Screen edges={['top', 'bottom']}>
          {state.status === 'error' ? (
            <ErrorState
              message={state.error ?? 'The local ledger could not be opened.'}
              onRetry={session.retry}
            />
          ) : (
            <LoadingState label="Opening your saved ledger…" />
          )}
        </Screen>
      </FinanceStoreContext.Provider>
    );
  }

  return (
    <FinanceStoreContext.Provider value={value}>
      {children}
    </FinanceStoreContext.Provider>
  );
}

export function useFinance(): FinanceStoreValue {
  const context = useContext(FinanceStoreContext);
  if (!context) {
    throw new Error('useFinance must be used inside FinanceProvider');
  }
  return context;
}

export function useFinanceMonth(monthKey: string): QueryResult<MonthView> {
  const { revision, service } = useFinance();
  const load = useCallback(() => {
    if (!service) {
      return Promise.reject(new Error('The local ledger is still opening.'));
    }
    return service.getMonthView(monthKey);
  }, [monthKey, service]);

  return useRepositoryQuery(load, revision);
}

export function useFinanceWallets(): QueryResult<WalletView> {
  const { revision, service } = useFinance();
  const load = useCallback(() => {
    if (!service) {
      return Promise.reject(new Error('The local ledger is still opening.'));
    }
    return service.getWalletView();
  }, [service]);

  return useRepositoryQuery(load, revision);
}

export function useFinanceHistory(monthKey: string): QueryResult<HistoryView> {
  const { revision, service } = useFinance();
  const load = useCallback(() => {
    if (!service) {
      return Promise.reject(new Error('The local ledger is still opening.'));
    }
    return service.getHistoryView(monthKey);
  }, [monthKey, service]);

  return useRepositoryQuery(load, revision);
}
