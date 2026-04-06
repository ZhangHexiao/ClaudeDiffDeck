import * as vscode from 'vscode';
import { Batch, ReviewStatus } from './types';

export class BatchStore {
  private batches: Batch[] = [];
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onChange = this._onChange.event;

  addBatch(batch: Batch): void {
    // Dedup by id
    if (this.batches.some(b => b.id === batch.id)) return;
    this.batches.push(batch);
    // Keep newest first
    this.batches.sort((a, b) => b.timestamp - a.timestamp);
    this._onChange.fire();
  }

  setStatus(batchId: string, fileId: string, status: ReviewStatus): void {
    const batch = this.batches.find(b => b.id === batchId);
    if (!batch) return;
    const file = batch.files.find(f => f.id === fileId);
    if (!file) return;
    file.status = status;
    this._onChange.fire();
  }

  getAll(): Batch[] {
    return this.batches;
  }

  clear(): void {
    this.batches = [];
    this._onChange.fire();
  }

  dispose(): void {
    this._onChange.dispose();
  }
}
