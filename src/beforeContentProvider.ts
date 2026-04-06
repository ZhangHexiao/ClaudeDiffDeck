import * as vscode from 'vscode';
import { BatchStore } from './batchStore';

/**
 * Virtual document provider that serves "before" content for rejected files.
 * URI format: claude-before:/{batchId}/{fileId}/{basename}
 */
export class BeforeContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'claude-before';

  constructor(private readonly store: BatchStore) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    // Path: /{batchId}/{fileId}/{basename}
    const parts = uri.path.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    const [batchId, fileId] = parts;

    const batches = this.store.getAll();
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return '';
    const file = batch.files.find(f => f.id === fileId);
    if (!file) return '';

    return file.before;
  }

  static buildUri(batchId: string, fileId: string, basename: string): vscode.Uri {
    return vscode.Uri.parse(`${BeforeContentProvider.scheme}:/${batchId}/${fileId}/${basename}`);
  }
}
