export class BranchLingoError extends Error {
  constructor(status, code, message, context = {}) {
    super(message); this.name = 'BranchLingoError'; this.status = status; this.code = code; this.context = context;
  }
}
export const invalid = (code, message, context) => { throw new BranchLingoError('invalid', code, message, context); };
export const incomplete = message => { throw new BranchLingoError('incomplete', 'resource-limit', message); };
export const mismatch = message => { throw new BranchLingoError('mismatch', 'verification-mismatch', message); };
export function diagnostic(error) {
  return {code:error instanceof BranchLingoError ? error.code : 'internal-error',message:error instanceof BranchLingoError ? error.message : 'An internal operation failed',catalogId:error.context?.catalogId ?? null,messageId:error.context?.messageId ?? null,armId:error.context?.armId ?? null};
}
export function failure(error) { return {kind:'branchlingo-diagnostic-report',schemaVersion:1,status:error.status ?? 'incomplete',diagnostics:[diagnostic(error)]}; }
