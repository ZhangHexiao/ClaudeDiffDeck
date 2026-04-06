import * as vscode from 'vscode';
import * as fs from 'fs';
import { RawBatch } from './types';

export type BatchHandler = (raw: RawBatch, sourcePath: string) => void;

export class BatchWatcher {
  private watchers: vscode.FileSystemWatcher[] = [];
  private seen = new Set<string>();

  constructor(private readonly handler: BatchHandler) {}

  start(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, '.claude/pending-review/*.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidCreate(uri => this.handle(uri));
      watcher.onDidChange(uri => this.handle(uri));
      this.watchers.push(watcher);

      // Scan existing files on start
      this.scanExisting(folder);
    }
  }

  private async scanExisting(folder: vscode.WorkspaceFolder): Promise<void> {
    const pattern = new vscode.RelativePattern(folder, '.claude/pending-review/*.json');
    const uris = await vscode.workspace.findFiles(pattern);
    for (const uri of uris) this.handle(uri);
  }

  private handle(uri: vscode.Uri): void {
    if (uri.fsPath.endsWith('.tmp')) return;
    // Debounce brief window for rename-from-.tmp
    setTimeout(() => {
      try {
        if (this.seen.has(uri.fsPath)) return;
        const raw = fs.readFileSync(uri.fsPath, 'utf8');
        const parsed = JSON.parse(raw) as RawBatch;
        if (!parsed || !parsed.id || !Array.isArray(parsed.files)) return;
        this.seen.add(uri.fsPath);
        this.handler(parsed, uri.fsPath);
      } catch (err) {
        console.error('BatchWatcher: failed to parse', uri.fsPath, err);
      }
    }, 60);
  }

  dispose(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
  }
}
