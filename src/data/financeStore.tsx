import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { FinanceError } from '@/db/errors';
import { FinanceEngine } from '@/db/financeEngine';
import { openPocketaDatabase } from '@/db/expoDatabase';
import { ErrorState, LoadingState } from '@/components/ui/QueryStates';
import { Screen } from '@/components/ui/Screen';
import { monthKeyForDateKey, toLocalDateKey } from '@/lib/period';
import { useRepositoryQuery, type QueryResult } from './hooks';
import {
  FinanceService,
  type ActionResult,
  type ContainerInput,
  type HistoryView,
  type MoneyEntryInput,
  type MonthView,
  type UpdateContainerInput,
  type WalletView,
} from './financeService';

export type { EntryMode } from './financeService';

type FinanceStatus = 'loading' | 'ready' | 'error';

interface FinanceStoreValue {
  status: FinanceStatus;
  error: string | null;
  retry: () => void;
  service: FinanceService | null;
  activeMonthKey: string;
  todayDateKey: string;
  revision: number;
  refresh: () => void;
  recordMoneyEntry: (input: MoneyEntryInput) => Promise<ActionResult>;
  createContainer: (input: ContainerInput) => Promise<ActionResult>;
  updateContainer: (input: UpdateContainerInput) => Promise<ActionResult>;
  archiveContainer: (containerId: string) => Promise<ActionResult>;
  reactivateContainer: (containerId: string) => Promise<ActionResult>;
  deleteContainer: (containerId: string) => Promise<ActionResult>;
}

const FinanceStoreContext = createContext<FinanceStoreValue | null>(null);

export function FinanceProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<FinanceStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState<FinanceService | null>(null);
  const [today, setToday] = useState(() => new Date());
  const [revision, setRevision] = useState(0);
  const serviceRef = useRef<FinanceService | null>(null);
  const startupRef = useRef(false);

  const start = useCallback(async () => {
    if (startupRef.current) return;
    startupRef.current = true;

    try {
      const database = await openPocketaDatabase();
      const nextService = new FinanceService(new FinanceEngine(database));
      await nextService.initialize();
      serviceRef.current = nextService;
      setService(nextService);
      setToday(new Date());
      setError(null);
      setStatus('ready');
    } catch (startupError) {
      startupRef.current = false;
      setError(toMessage(startupError));
      setStatus('error');
    }
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setError(null);
    void start();
  }, [start]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void start();
    }, 0);

    return () => clearTimeout(timer);
  }, [start]);

  const todayDateKey = toLocalDateKey(today);
  const activeMonthKey = monthKeyForDateKey(todayDateKey);

  useEffect(() => {
    if (status !== 'ready') return;

    const refreshDate = () => {
      const next = new Date();
      const nextDateKey = toLocalDateKey(next);
      if (nextDateKey !== todayDateKey) {
        setToday(next);
        setRevision((current) => current + 1);
      }
    };

    const interval = setInterval(refreshDate, 60_000);
    const subscription = AppState.addEventListener('change', (nextStatus) => {
      if (nextStatus === 'active') refreshDate();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [status, todayDateKey]);

  const refresh = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const perform = useCallback(
    async (
      operation: (current: FinanceService) => Promise<unknown>,
    ): Promise<ActionResult> => {
      const current = serviceRef.current;
      if (!current) {
        return {
          ok: false,
          message: 'The local ledger is still opening. Try again in a moment.',
        };
      }

      try {
        await operation(current);
        setRevision((value) => value + 1);
        return { ok: true };
      } catch (operationError) {
        return { ok: false, message: toMessage(operationError) };
      }
    },
    [],
  );

  const recordMoneyEntry = useCallback(
    (input: MoneyEntryInput) =>
      perform((current) => current.recordMoneyEntry(input)),
    [perform],
  );
  const createContainer = useCallback(
    (input: ContainerInput) =>
      perform((current) => current.createContainer(input)),
    [perform],
  );
  const updateContainer = useCallback(
    (input: UpdateContainerInput) =>
      perform((current) => current.updateContainer(input)),
    [perform],
  );
  const archiveContainer = useCallback(
    (containerId: string) =>
      perform((current) => current.archiveContainer(containerId)),
    [perform],
  );
  const reactivateContainer = useCallback(
    (containerId: string) =>
      perform((current) => current.reactivateContainer(containerId)),
    [perform],
  );
  const deleteContainer = useCallback(
    (containerId: string) =>
      perform((current) => current.deleteContainer(containerId)),
    [perform],
  );

  const value = useMemo<FinanceStoreValue>(
    () => ({
      status,
      error,
      retry,
      service,
      activeMonthKey,
      todayDateKey,
      revision,
      refresh,
      recordMoneyEntry,
      createContainer,
      updateContainer,
      archiveContainer,
      reactivateContainer,
      deleteContainer,
    }),
    [
      status,
      error,
      retry,
      service,
      activeMonthKey,
      todayDateKey,
      revision,
      refresh,
      recordMoneyEntry,
      createContainer,
      updateContainer,
      archiveContainer,
      reactivateContainer,
      deleteContainer,
    ],
  );

  if (status !== 'ready' || !service) {
    return (
      <FinanceStoreContext.Provider value={value}>
        <Screen edges={['top', 'bottom']}>
          {status === 'error' ? (
            <ErrorState
              message={error ?? 'The local ledger could not be opened.'}
              onRetry={retry}
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

function toMessage(error: unknown): string {
  if (error instanceof FinanceError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Something went wrong while updating the local ledger.';
}
