import {
  ChecklistItem,
  CompletionMethod,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_ITEM_LENGTH,
} from '../types/alarm';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Alarms saved before completion methods existed always required a scan, so a
 * missing value falls back to `scan` unless there is no code to scan.
 */
export function normalizeCompletionMethod(value: unknown, expectedQrPayload: string): CompletionMethod {
  if (value === 'confirm' || value === 'scan') {
    return value === 'scan' && !expectedQrPayload.trim() ? 'confirm' : value;
  }

  return expectedQrPayload.trim() ? 'scan' : 'confirm';
}

export function createChecklistItemId() {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeChecklistItems(value: unknown): ChecklistItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seenIds = new Set<string>();
  const items = value.flatMap((rawItem): ChecklistItem[] => {
    if (!isRecord(rawItem) || typeof rawItem.label !== 'string') {
      return [];
    }

    const label = rawItem.label.trim().slice(0, MAX_CHECKLIST_ITEM_LENGTH);

    if (!label) {
      return [];
    }

    const rawId = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
    const id = rawId && !seenIds.has(rawId) ? rawId : createChecklistItemId();
    seenIds.add(id);

    return [{ id, label }];
  });

  return items.length > 0 ? items.slice(0, MAX_CHECKLIST_ITEMS) : undefined;
}

export function normalizeSharedCompletionDetails(payload: Record<string, unknown>) {
  return {
    completionMethod:
      payload.completionMethod === 'confirm' || payload.completionMethod === 'scan'
        ? (payload.completionMethod as CompletionMethod)
        : undefined,
    checklistItemCount:
      typeof payload.checklistItemCount === 'number' && Number.isFinite(payload.checklistItemCount)
        ? Math.max(0, Math.min(MAX_CHECKLIST_ITEMS, Math.trunc(payload.checklistItemCount)))
        : undefined,
  };
}

/** History recorded before completion methods existed was always a scan. */
export function getCompletionMethodLabel(method: CompletionMethod | undefined) {
  return method === 'confirm' ? 'Confirmed by you' : 'Code scanned';
}
