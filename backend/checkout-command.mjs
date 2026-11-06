import { catalogUuid } from './catalog-model.mjs';
import { ApiError } from './errors.mjs';
import { normalizeSale } from './sale-command.mjs';

export const paymentMethods = Object.freeze(['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']);
// Anonymous checkout carries no customer identifiers or payment credentials.
export function normalizeCheckout(input,{allowIdentified=false}={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(['customerId', 'expectedTotalCents', 'idempotencyKey', 'items', 'paymentMethod']) ||
      input.customerId !== null && (!allowIdentified || !catalogUuid(input.customerId)) || !paymentMethods.includes(input.paymentMethod) ||
      !Number.isSafeInteger(input.expectedTotalCents) || input.expectedTotalCents < 0) throw new ApiError(400, 'INVALID_SALE');
  return { ...normalizeSale({ idempotencyKey: input.idempotencyKey, items: input.items }),
    paymentMethod: input.paymentMethod, customerId: input.customerId, expectedTotalCents: input.expectedTotalCents };
}
