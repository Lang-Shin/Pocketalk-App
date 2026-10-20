# Pocketa

AI-powered mobile app for natural language allowance and container-based budget tracking.

## Status

Phase 2 is a UI foundation built with Expo, React Native, Expo Router, and TypeScript. Wallets, containers, limits, and transactions are seeded mock data, clearly labeled as samples. The app supports session-only sample interactions, including recording money, managing containers, and viewing monthly history. There is no database, persistent ledger, GCash integration, or AI model connection yet.

## Stack

- Expo SDK 57 / React Native 0.86
- TypeScript in strict mode
- Expo Router with typed routes
- React Native Safe Area Context, Screens, Gesture Handler, and Reanimated

## Run locally

```powershell
npm install
npm start
```

Then scan the QR code with Expo Go on an Android device, press `a` to open an Android emulator, or press `w` for the browser preview. Expo Go currently supports SDK 57; keep the installed Expo Go version aligned with the project SDK.

Run the browser preview directly with:

```powershell
npm run web
```

`npm run android` requires Android Studio, an Android SDK, and a running emulator or connected device.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npx expo-doctor
npx expo export --platform android
npx expo export --platform web
```

The current tests cover calendar boundaries, peso parsing, the wallet/container balance invariant, net-savings transfer exclusion, historical container labels, archived-container reporting, recorded-date metadata, recent-activity ordering, and late entries affecting prior months. Database and migration tests will be added with the database and ledger phases.

## Current boundaries

- Money is stored and manipulated as integer PHP centavos in the mock store. Session actions update in-memory state only.
- Mock finance data and actions live in `src/data/financeStore.tsx`, with derived values in `src/data/financeSelectors.ts`. The store boundary can later be replaced by SQLite-backed repositories.
- Reloading the app, or using **Reset mock session** in Profile, restores the sample data. Nothing is persisted yet.
- The assistant is a UI preview; it does not call an AI model and cannot save transactions.
- The virtual GCash wallet is manually maintained in the design and is not connected to GCash.
