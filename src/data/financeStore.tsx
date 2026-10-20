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

import type {
  BudgetContainer,
  FinanceState,
  Transaction,
  TransactionKind,
} from './models';
import {
  selectContainerBalanceById,
  selectWalletBalanceById,
} from './financeSelectors';
import { buildMockFinanceState } from './mockFinance';
import { captureRecordedStamp } from '@/lib/date';
import type { IconName } from '@/lib/icons';
import { isValidDateKey } from '@/lib/period';
import type { Tone } from '@/theme';

export type EntryMode =
  | 'expense'
  | 'income'
  | 'wallet_transfer'
  | 'container_transfer';

export interface MoneyEntryInput {
  mode: EntryMode;
  amountMinor: number;
  title: string;
  effectiveDate: string;
  walletId?: string;
  containerId?: string;
  destinationWalletId?: string;
  destinationContainerId?: string;
}

export interface ContainerInput {
  name: string;
  description: string;
  icon: IconName;
  tone: Tone;
  limitMinor: number;
  monthKey: string;
}

export interface UpdateContainerInput extends ContainerInput {
  id: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

interface FinanceStoreValue {
  state: FinanceState;
  activeMonthKey: string;
  todayDateKey: string;
  recordMoneyEntry: (input: MoneyEntryInput) => ActionResult;
  createContainer: (input: ContainerInput) => ActionResult;
  updateContainer: (input: UpdateContainerInput) => ActionResult;
  archiveContainer: (containerId: string) => ActionResult;
  reactivateContainer: (containerId: string) => ActionResult;
  deleteContainer: (containerId: string) => ActionResult;
  resetFinance: () => void;
}

const FinanceStoreContext = createContext<FinanceStoreValue | null>(null);

let transactionSequence = 0;

function nextTransactionId(): string {
  transactionSequence += 1;
  return `session-${Date.now()}-${transactionSequence}`;
}

export function MockFinanceProvider({ children }: PropsWithChildren) {
  const [today, setToday] = useState(() => new Date());
  const [state, setState] = useState<FinanceState>(() =>
    buildMockFinanceState(new Date()),
  );
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const todayDateKey = useMemo(
    () =>
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(today.getDate()).padStart(2, '0')}`,
    [today],
  );
  const activeMonthKey = todayDateKey.slice(0, 7);

  useEffect(() => {
    const refreshDate = () => {
      const next = new Date();
      const nextDateKey = `${next.getFullYear()}-${String(
        next.getMonth() + 1,
      ).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      if (nextDateKey !== todayDateKey) {
        setToday(next);
      }
    };

    const interval = setInterval(refreshDate, 60_000);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') refreshDate();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [todayDateKey]);

  const recordMoneyEntry = useCallback(
    (input: MoneyEntryInput): ActionResult => {
      const current = stateRef.current;

      if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
        return { ok: false, message: 'Enter an amount greater than zero.' };
      }
      if (!isValidDateKey(input.effectiveDate)) {
        return { ok: false, message: 'Use a valid date in YYYY-MM-DD format.' };
      }
      if (input.effectiveDate > todayDateKey) {
        return {
          ok: false,
          message: 'Future-dated entries are not included in this preview.',
        };
      }

      const title = input.title.trim();
      if (!title) {
        return { ok: false, message: 'Add a short description.' };
      }

      const transaction =
        input.mode === 'expense'
          ? buildExpense(current, input, title)
          : input.mode === 'income'
            ? buildIncome(current, input, title)
            : input.mode === 'wallet_transfer'
              ? buildWalletTransfer(current, input, title)
              : buildContainerTransfer(current, input, title);

      if ('ok' in transaction) return transaction;

      setState((previous) => ({
        ...previous,
        transactions: [...previous.transactions, transaction],
      }));
      return { ok: true };
    },
    [todayDateKey],
  );

  const createContainer = useCallback((input: ContainerInput): ActionResult => {
    const validation = validateContainerInput(input);
    if (validation) return validation;

    const current = stateRef.current;
    const container: BudgetContainer = {
      id: `container-${Date.now()}-${nextTransactionId()}`,
      name: input.name.trim(),
      description: input.description.trim(),
      icon: input.icon,
      tone: input.tone,
      kind: 'budget',
      status: 'active',
      sortOrder:
        Math.max(0, ...current.containers.map((item) => item.sortOrder)) + 1,
      createdMonthKey: input.monthKey,
      limitsByMonth: { [input.monthKey]: input.limitMinor },
      labelsByMonth: {
        [input.monthKey]: {
          name: input.name.trim(),
          description: input.description.trim(),
          icon: input.icon,
          tone: input.tone,
        },
      },
    };

    setState((previous) => ({
      ...previous,
      containers: [...previous.containers, container],
    }));
    return { ok: true };
  }, []);

  const updateContainer = useCallback(
    (input: UpdateContainerInput): ActionResult => {
      const validation = validateContainerInput(input);
      if (validation) return validation;

      const current = stateRef.current;
      const existing = current.containers.find(
        (container) => container.id === input.id,
      );
      if (!existing) {
        return { ok: false, message: 'That container no longer exists.' };
      }

      setState((previous) => ({
        ...previous,
        containers: previous.containers.map((container) =>
          container.id === input.id
            ? {
                ...container,
                name: input.name.trim(),
                description: input.description.trim(),
                icon: input.icon,
                tone: input.tone,
                limitsByMonth: {
                  ...container.limitsByMonth,
                  [input.monthKey]: input.limitMinor,
                },
                labelsByMonth: {
                  ...container.labelsByMonth,
                  [input.monthKey]: {
                    name: input.name.trim(),
                    description: input.description.trim(),
                    icon: input.icon,
                    tone: input.tone,
                  },
                },
              }
            : container,
        ),
      }));
      return { ok: true };
    },
    [],
  );

  const archiveContainer = useCallback((containerId: string): ActionResult => {
    const current = stateRef.current;
    const existing = current.containers.find(
      (container) => container.id === containerId,
    );
    if (!existing) {
      return { ok: false, message: 'That container no longer exists.' };
    }
    if (existing.status === 'archived') {
      return { ok: false, message: 'That container is already archived.' };
    }

    setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) =>
        container.id === containerId
          ? {
              ...container,
              status: 'archived',
              archivedAt: new Date().toISOString(),
            }
          : container,
      ),
    }));
    return { ok: true };
  }, []);

  const reactivateContainer = useCallback(
    (containerId: string): ActionResult => {
      const current = stateRef.current;
      const existing = current.containers.find(
        (container) => container.id === containerId,
      );
      if (!existing) {
        return { ok: false, message: 'That container no longer exists.' };
      }
      if (existing.status === 'active') {
        return { ok: false, message: 'That container is already active.' };
      }

      setState((previous) => ({
        ...previous,
        containers: previous.containers.map((container) =>
          container.id === containerId
            ? {
                ...container,
                status: 'active',
                archivedAt: undefined,
                limitsByMonth: {
                  ...container.limitsByMonth,
                  [activeMonthKey]:
                    container.limitsByMonth[activeMonthKey] ?? 0,
                },
                labelsByMonth: {
                  ...container.labelsByMonth,
                  [activeMonthKey]: {
                    name: container.name,
                    description: container.description,
                    icon: container.icon,
                    tone: container.tone,
                  },
                },
              }
            : container,
        ),
      }));
      return { ok: true };
    },
    [activeMonthKey],
  );

  const deleteContainer = useCallback((containerId: string): ActionResult => {
    const current = stateRef.current;
    const existing = current.containers.find(
      (container) => container.id === containerId,
    );
    if (!existing) {
      return { ok: false, message: 'That container no longer exists.' };
    }

    const referenced = current.transactions.some(
      (transaction) =>
        transaction.sourceContainerId === containerId ||
        transaction.destinationContainerId === containerId,
    );
    const hasLimit = Object.values(existing.limitsByMonth).some(
      (limit) => limit > 0,
    );
    const hasBalance =
      selectContainerBalanceById(current, containerId, todayDateKey) !== 0;

    if (referenced || hasLimit || hasBalance) {
      return {
        ok: false,
        message:
          'This container has a balance or history and cannot be deleted. Move any remaining balance, then archive it instead.',
      };
    }

    setState((previous) => ({
      ...previous,
      containers: previous.containers.filter(
        (container) => container.id !== containerId,
      ),
    }));
    return { ok: true };
  }, [todayDateKey]);

  const resetFinance = useCallback(() => {
    const next = buildMockFinanceState(new Date());
    stateRef.current = next;
    setState(next);
    setToday(new Date());
  }, []);

  const value = useMemo<FinanceStoreValue>(
    () => ({
      state,
      activeMonthKey,
      todayDateKey,
      recordMoneyEntry,
      createContainer,
      updateContainer,
      archiveContainer,
      reactivateContainer,
      deleteContainer,
      resetFinance,
    }),
    [
      state,
      activeMonthKey,
      todayDateKey,
      recordMoneyEntry,
      createContainer,
      updateContainer,
      archiveContainer,
      reactivateContainer,
      deleteContainer,
      resetFinance,
    ],
  );

  return (
    <FinanceStoreContext.Provider value={value}>
      {children}
    </FinanceStoreContext.Provider>
  );
}

export function useMockFinance(): FinanceStoreValue {
  const context = useContext(FinanceStoreContext);
  if (!context) {
    throw new Error('useMockFinance must be used inside MockFinanceProvider');
  }
  return context;
}

function validateContainerInput(input: ContainerInput): ActionResult | null {
  const name = input.name.trim();
  if (!name) return { ok: false, message: 'Add a container name.' };
  if (name.length > 40) {
    return { ok: false, message: 'Keep the name to 40 characters or fewer.' };
  }
  if (input.description.trim().length > 90) {
    return {
      ok: false,
      message: 'Keep the description to 90 characters or fewer.',
    };
  }
  if (!Number.isInteger(input.limitMinor) || input.limitMinor < 0) {
    return {
      ok: false,
      message: 'The monthly limit must be zero or more.',
    };
  }
  if (!/^\d{4}-\d{2}$/.test(input.monthKey)) {
    return { ok: false, message: 'The selected month is invalid.' };
  }
  return null;
}

function buildExpense(
  state: FinanceState,
  input: MoneyEntryInput,
  title: string,
): Transaction | ActionResult {
  const wallet = state.wallets.find((item) => item.id === input.walletId);
  const container = state.containers.find(
    (item) => item.id === input.containerId,
  );
  if (!wallet || !container) {
    return { ok: false, message: 'Choose a wallet and container.' };
  }
  if (container.status === 'archived') {
    return {
      ok: false,
      message: 'Archived containers cannot receive new spending.',
    };
  }
  if (!containerExistsOn(container, input.effectiveDate)) {
    return {
      ok: false,
      message: 'That container did not exist on the selected date.',
    };
  }

  const walletBalance = selectWalletBalanceById(
    state,
    wallet.id,
    input.effectiveDate,
  );
  const containerBalance = selectContainerBalanceById(
    state,
    container.id,
    input.effectiveDate,
  );
  if (walletBalance < input.amountMinor) {
    return {
      ok: false,
      message: `That wallet has ${pesoLabel(
        walletBalance,
      )} on this date. Reduce the amount or choose another wallet.`,
    };
  }
  if (containerBalance < input.amountMinor) {
    return {
      ok: false,
      message: `That container has ${pesoLabel(
        containerBalance,
      )} on this date. Fund it first or choose another container.`,
    };
  }

  return {
    id: nextTransactionId(),
    title,
    category: container.name,
    kind: 'expense',
    direction: 'out',
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    ...captureRecordedStamp(),
    status: 'posted',
    sourceWalletId: wallet.id,
    sourceWalletName: wallet.name,
    sourceContainerId: container.id,
    sourceContainerName: container.name,
    icon: container.icon,
    tone: container.tone,
  };
}

function buildIncome(
  state: FinanceState,
  input: MoneyEntryInput,
  title: string,
): Transaction | ActionResult {
  const wallet = state.wallets.find((item) => item.id === input.walletId);
  const container = state.containers.find(
    (item) => item.id === input.containerId,
  );
  if (!wallet || !container) {
    return { ok: false, message: 'Choose a wallet and container.' };
  }
  if (container.status === 'archived') {
    return {
      ok: false,
      message: 'Archived containers cannot receive new income.',
    };
  }
  if (!containerExistsOn(container, input.effectiveDate)) {
    return {
      ok: false,
      message: 'That container did not exist on the selected date.',
    };
  }

  return {
    id: nextTransactionId(),
    title,
    category: container.name,
    kind: 'income',
    direction: 'in',
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    ...captureRecordedStamp(),
    status: 'posted',
    destinationWalletId: wallet.id,
    destinationWalletName: wallet.name,
    destinationContainerId: container.id,
    destinationContainerName: container.name,
    icon: 'arrow-down',
    tone: 'emerald',
  };
}

function buildWalletTransfer(
  state: FinanceState,
  input: MoneyEntryInput,
  title: string,
): Transaction | ActionResult {
  const source = state.wallets.find((item) => item.id === input.walletId);
  const destination = state.wallets.find(
    (item) => item.id === input.destinationWalletId,
  );
  if (!source || !destination || source.id === destination.id) {
    return { ok: false, message: 'Choose two different wallets.' };
  }

  const balance = selectWalletBalanceById(
    state,
    source.id,
    input.effectiveDate,
  );
  if (balance < input.amountMinor) {
    return {
      ok: false,
      message: `That wallet has ${pesoLabel(
        balance,
      )} on this date. Reduce the transfer amount.`,
    };
  }

  return {
    id: nextTransactionId(),
    title,
    category: 'Wallet transfer',
    kind: 'wallet_transfer',
    direction: 'neutral',
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    ...captureRecordedStamp(),
    status: 'posted',
    sourceWalletId: source.id,
    destinationWalletId: destination.id,
    sourceWalletName: source.name,
    destinationWalletName: destination.name,
    icon: 'swap-horizontal-outline',
    tone: 'blue',
  };
}

function buildContainerTransfer(
  state: FinanceState,
  input: MoneyEntryInput,
  title: string,
): Transaction | ActionResult {
  const source = state.containers.find((item) => item.id === input.containerId);
  const destination = state.containers.find(
    (item) => item.id === input.destinationContainerId,
  );
  if (!source || !destination || source.id === destination.id) {
    return { ok: false, message: 'Choose two different containers.' };
  }
  if (source.status === 'archived' || destination.status === 'archived') {
    return {
      ok: false,
      message: 'Archived containers cannot receive or send new transfers.',
    };
  }
  if (
    !containerExistsOn(source, input.effectiveDate) ||
    !containerExistsOn(destination, input.effectiveDate)
  ) {
    return {
      ok: false,
      message: 'One of those containers did not exist on the selected date.',
    };
  }

  const balance = selectContainerBalanceById(
    state,
    source.id,
    input.effectiveDate,
  );
  if (balance < input.amountMinor) {
    return {
      ok: false,
      message: `That container has ${pesoLabel(
        balance,
      )} on this date. Reduce the transfer amount.`,
    };
  }

  const kind: TransactionKind =
    destination.kind === 'savings' ? 'savings' : 'container_transfer';

  return {
    id: nextTransactionId(),
    title,
    category: kind === 'savings' ? 'Savings transfer' : 'Container transfer',
    kind,
    direction: 'neutral',
    amountMinor: input.amountMinor,
    effectiveDate: input.effectiveDate,
    ...captureRecordedStamp(),
    status: 'posted',
    sourceContainerId: source.id,
    destinationContainerId: destination.id,
    sourceContainerName: source.name,
    destinationContainerName: destination.name,
    icon: kind === 'savings' ? 'flag-outline' : 'swap-horizontal-outline',
    tone: kind === 'savings' ? 'emerald' : 'violet',
  };
}

function containerExistsOn(
  container: BudgetContainer,
  effectiveDate: string,
): boolean {
  return container.createdMonthKey <= effectiveDate.slice(0, 7);
}

function pesoLabel(amountMinor: number): string {
  const amount = Math.max(0, Math.round(amountMinor));
  return `\u20B1${(amount / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
