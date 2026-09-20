export class HarnessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.details = details;
  }
}

export function asHarnessError(error, fallbackCode = 'E_INTERNAL') {
  if (error instanceof HarnessError) return error;

  return new HarnessError(fallbackCode, 'Unexpected harness failure.', {
    cause: String(error?.message ?? error),
  });
}

export function formatToolFailure(error) {
  const failure = asHarnessError(error);
  return {
    code: failure.code,
    message: failure.message,
    details: failure.details,
  };
}
