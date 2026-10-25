import {
  getCompletionMethodLabel,
  normalizeChecklistItems,
  normalizeCompletionMethod,
  normalizeSharedCompletionDetails,
} from './checkpoint-completion';

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('legacy alarms with a saved code stay scan checkpoints', () => {
  assertEquals(normalizeCompletionMethod(undefined, 'QR-123'), 'scan');
  assertEquals(normalizeCompletionMethod(undefined, ''), 'confirm');
});

Deno.test('scan without a code falls back to confirm', () => {
  assertEquals(normalizeCompletionMethod('scan', '  '), 'confirm');
  assertEquals(normalizeCompletionMethod('scan', 'QR-123'), 'scan');
  assertEquals(normalizeCompletionMethod('confirm', 'QR-123'), 'confirm');
  assertEquals(normalizeCompletionMethod('photo', ''), 'confirm');
});

Deno.test('checklist items are trimmed, deduped, and capped', () => {
  const items = normalizeChecklistItems([
    { id: 'a', label: '  Keys ' },
    { id: 'a', label: 'Wallet' },
    { id: 'b', label: '   ' },
    { id: 'c', label: 'x'.repeat(80) },
    { id: 'd', label: 'Phone' },
    { id: 'e', label: 'Badge' },
    { id: 'f', label: 'Water' },
    { id: 'g', label: 'Snack' },
    { id: 'h', label: 'Umbrella' },
  ]);

  if (!items) {
    throw new Error('Expected checklist items');
  }

  assertEquals(items.length, 6);
  assertEquals(items[0], { id: 'a', label: 'Keys' });
  assertEquals(items[1].label, 'Wallet');
  assertEquals(items[1].id !== 'a', true);
  assertEquals(items[2].label.length, 60);
  assertEquals(new Set(items.map((item) => item.id)).size, 6);
});

Deno.test('empty or invalid checklists normalize to undefined', () => {
  assertEquals(normalizeChecklistItems(undefined), undefined);
  assertEquals(normalizeChecklistItems([]), undefined);
  assertEquals(normalizeChecklistItems([{ id: 'a', label: '' }, 'Keys']), undefined);
});

Deno.test('shared completion details only expose method and count', () => {
  assertEquals(
    normalizeSharedCompletionDetails({ completionMethod: 'confirm', checklistItemCount: 3, labels: ['Keys'] }),
    { completionMethod: 'confirm', checklistItemCount: 3 }
  );
  assertEquals(normalizeSharedCompletionDetails({ completionMethod: 'nope', checklistItemCount: -1 }), {
    completionMethod: undefined,
    checklistItemCount: 0,
  });
  assertEquals(getCompletionMethodLabel(undefined), 'Code scanned');
  assertEquals(getCompletionMethodLabel('confirm'), 'Confirmed by you');
});
