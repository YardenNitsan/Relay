import { AppError } from '../core/errors.js';

/** The caller cannot infer rollback from a thrown error once a commit starts. */
export class UncertainToolEffect extends AppError {
  constructor(cause:unknown,scope:'workspace'|'external'='workspace') {
    super('UNCERTAIN_TOOL_EFFECT',scope==='external'?'An external tool request was dispatched, but its outcome is uncertain. Inspect the external service before starting new work; automatic replay is blocked.':'A workspace mutation may have completed, but its verification or checkpoint could not be committed. Inspect the workspace and checkpoint before starting new work; automatic replay is blocked.',409);
    this.cause=cause;
  }
}
