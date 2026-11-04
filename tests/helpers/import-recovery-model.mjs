// Test-only single-process model. It is not an emulator or an importer.
export class ImportRecoveryModel {
  constructor() { this.records = new Map(); this.checkpoints = new Map(); }
  commit(batch, failure) {
    const existing = this.checkpoints.get(batch.id);
    if (existing !== undefined) {
      if (existing !== batch.fingerprint) throw Error('CHECKPOINT_CONFLICT');
      return 'REPLAY';
    }
    const records = new Map(this.records);
    for (const record of batch.records) {
      if (records.has(record.id) && records.get(record.id) !== record.value) throw Error('RECORD_CONFLICT');
      records.set(record.id, record.value);
    }
    if (failure === 'before-commit') throw Error('INJECTED_FAILURE');
    this.records = records;
    this.checkpoints.set(batch.id, batch.fingerprint);
    if (failure === 'after-commit') throw Error('LOST_ACK');
    return 'COMMITTED';
  }
}