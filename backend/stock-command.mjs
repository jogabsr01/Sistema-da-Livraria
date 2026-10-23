import { ApiError } from './errors.mjs';
import { catalogUuid } from './catalog-model.mjs';

export function normalizeStockReceipt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['commandId', 'expectedVersion', 'id', 'quantity', 'reason']) ||
      !catalogUuid(input.commandId) || !catalogUuid(input.id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion >= 1_000_000_000 ||
      !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000 || typeof input.reason !== 'string') throw new ApiError(400, 'INVALID_STOCK_RECEIPT');
  const reason = input.reason.trim();
  if (!reason || reason.length > 300 || /[\x00-\x1f\x7f]/.test(reason) || /^[=+@-]/.test(reason)) throw new ApiError(400, 'INVALID_STOCK_RECEIPT');
  return { commandId: input.commandId, id: input.id, expectedVersion: input.expectedVersion, quantity: input.quantity, reason };
}
