import type { CreateWalletInput, FinanceEngine } from './financeEngine';

export const DEFAULT_WALLETS: readonly CreateWalletInput[] = [
  {
    id: 'wallet-cash',
    name: 'Cash on hand',
    kind: 'cash',
    icon: 'cash-outline',
    tone: 'amber',
    sortOrder: 1,
    idempotencyKey: 'bootstrap-wallet-cash-v1',
  },
  {
    id: 'wallet-gcash',
    name: 'Virtual GCash',
    kind: 'virtual_gcash',
    icon: 'phone-portrait-outline',
    tone: 'blue',
    sortOrder: 2,
    idempotencyKey: 'bootstrap-wallet-gcash-v1',
  },
] as const;

export async function ensureDefaultWallets(engine: FinanceEngine): Promise<void> {
  const existing = await engine.listWallets();
  const existingIds = new Set(existing.map((wallet) => wallet.id));

  for (const wallet of DEFAULT_WALLETS) {
    if (existingIds.has(wallet.id ?? '')) continue;
    await engine.createWallet(wallet);
  }
}
