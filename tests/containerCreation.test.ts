import assert from 'node:assert/strict';
import test from 'node:test';

import { ResponsePresentation } from '../src/features/assistant/responsePresentation';
import {
  parseContainerLimit,
  presentContainerCreation,
} from '../src/components/finance/containerCreation';
import { FakePresentationClock } from './helpers/fakePresentationClock';

function callbacks(events: string[]) {
  return {
    onStart: () => events.push('start'),
    onSuccess: () => events.push('success'),
    onError: (message: string) => events.push(`error:${message}`),
    onFinish: () => events.push('finish'),
    onValidationError: (message: string) => events.push(`invalid:${message}`),
  };
}

test('invalid limits fail before loading starts', async () => {
  const events: string[] = [];
  let saves = 0;
  const result = await presentContainerCreation({
    presentation: new ResponsePresentation(new FakePresentationClock()),
    limitText: 'not money',
    save: async () => {
      saves += 1;
      return { ok: true };
    },
    callbacks: callbacks(events),
  });
  assert.equal(result, 'invalid');
  assert.equal(saves, 0);
  assert.equal(events.length, 1);
  assert.match(events[0]!, /^invalid:Enter a valid monthly limit/);
});

test('fast creation waits out the 500 ms minimum before success', async () => {
  const clock = new FakePresentationClock();
  const events: string[] = [];
  const run = presentContainerCreation({
    presentation: new ResponsePresentation(clock),
    limitText: '1200',
    save: async () => {
      clock.advance(50);
      return { ok: true };
    },
    callbacks: callbacks(events),
  });
  await Promise.resolve();
  assert.deepEqual(events, ['start']);
  clock.advance(449);
  await Promise.resolve();
  assert.deepEqual(events, ['start']);
  clock.advance(1);
  await run;
  assert.deepEqual(events, ['start', 'finish', 'success']);
  assert.equal(clock.pending, 0);
});

test('slow creation and business failures do not gain extra presentation delay', async () => {
  const clock = new FakePresentationClock();
  const events: string[] = [];
  await presentContainerCreation({
    presentation: new ResponsePresentation(clock),
    limitText: '1200',
    save: async () => {
      clock.advance(800);
      return { ok: true };
    },
    callbacks: callbacks(events),
  });
  assert.deepEqual(events, ['start', 'finish', 'success']);
  assert.equal(clock.pending, 0);

  events.length = 0;
  await presentContainerCreation({
    presentation: new ResponsePresentation(clock),
    limitText: '1200',
    save: async () => ({ ok: false, message: 'Name already exists.' }),
    callbacks: callbacks(events),
  });
  assert.deepEqual(events, ['start', 'finish', 'error:Name already exists.']);
  assert.equal(clock.pending, 0);
});

test('repeated submission is locked while creation is pending', async () => {
  const clock = new FakePresentationClock();
  const presenter = new ResponsePresentation(clock);
  const events: string[] = [];
  let saves = 0;
  let resolveSave: ((value: { ok: boolean }) => void) | undefined;
  const first = presentContainerCreation({
    presentation: presenter,
    limitText: '500',
    save: () => {
      saves += 1;
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
    callbacks: callbacks(events),
  });
  const second = await presentContainerCreation({
    presentation: presenter,
    limitText: '500',
    save: async () => {
      saves += 1;
      return { ok: true };
    },
    callbacks: callbacks(events),
  });
  assert.equal(second, 'busy');
  assert.equal(saves, 1);
  resolveSave?.({ ok: true });
  await Promise.resolve();
  clock.advance(500);
  await first;
  assert.deepEqual(events, ['start', 'finish', 'success']);
});

test('unmount clears pending presentation timer and suppresses success callback', async () => {
  const clock = new FakePresentationClock();
  const presenter = new ResponsePresentation(clock);
  const events: string[] = [];
  const run = presentContainerCreation({
    presentation: presenter,
    limitText: '500',
    save: async () => ({ ok: true }),
    callbacks: callbacks(events),
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(clock.pending, 1);
  presenter.dispose();
  assert.equal(clock.pending, 0);
  clock.advance(500);
  await run;
  assert.deepEqual(events, ['start']);
});

test('zero and whitespace limits are treated as no monthly limit', () => {
  assert.deepEqual(parseContainerLimit(''), { ok: true, limitMinor: 0 });
  assert.deepEqual(parseContainerLimit('   '), { ok: true, limitMinor: 0 });
  assert.deepEqual(parseContainerLimit('1200.50'), {
    ok: true,
    limitMinor: 120_050,
  });
});
