// SDK messages and stacks can contain credential paths, request details or secrets.
const grpcCodes = ['OK', 'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED'];

export function logFirestoreError(phase, error) {
  const code = typeof error?.code === 'number' && Number.isInteger(error.code) && error.code >= 0 && error.code < grpcCodes.length
    ? grpcCodes[error.code]
    : typeof error?.code === 'string' && grpcCodes.includes(error.code.toUpperCase()) ? error.code.toUpperCase() : 'UNKNOWN';
  console.error(JSON.stringify({ event: 'firestore_sdk_error', phase, code }));
}