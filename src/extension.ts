import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BatchStore } from './batchStore';
import { BatchWatcher } from './batchWatcher';
import { ReviewProvider } from './reviewProvider';
import { installHook } from './hookInstaller';
import { assessRisk } from './riskAssessor';
import { extractExplanation } from './explanationExtractor';
import { renderDiff } from './diffRenderer';
import { Batch, FileChange, RawBatch } from './types';
import { BeforeContentProvider } from './beforeContentProvider';
import { startWorkflow, saveToRemoteWorkflow, reRequestReviewWorkflow } from './workflows';

export function activate(context: vscode.ExtensionContext): void {
  const store = new BatchStore();
  const provider = new ReviewProvider(context.extensionUri, store);

  const beforeProvider = new BeforeContentProvider(store);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BeforeContentProvider.scheme, beforeProvider),
    vscode.window.registerWebviewViewProvider(ReviewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Auto-move to right sidebar on first-ever activation.
  const FIRST_RUN_KEY = 'claudeReview.movedToRightSidebar';
  if (!context.globalState.get<boolean>(FIRST_RUN_KEY)) {
    context.globalState.update(FIRST_RUN_KEY, true);
    setTimeout(() => moveToRightSidebar().catch(() => {}), 1200);
  }

  const watcher = new BatchWatcher((raw, sourcePath) => {
    const batch = enrichBatch(raw);
    store.addBatch(batch);
    console.log('DiffDeck: loaded batch', batch.id, 'from', sourcePath);
  });
  watcher.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeReview.installHook', () => installHook(context.extensionPath)),
    vscode.commands.registerCommand('claudeReview.clearBatches', () => {
      store.clear();
      // Also delete pending-review files on disk
      const folders = vscode.workspace.workspaceFolders ?? [];
      for (const folder of folders) {
        const dir = path.join(folder.uri.fsPath, '.claude', 'pending-review');
        try {
          if (fs.existsSync(dir)) {
            for (const f of fs.readdirSync(dir)) {
              if (f.endsWith('.json')) fs.unlinkSync(path.join(dir, f));
            }
          }
        } catch (err) {
          console.error('clearBatches:', err);
        }
      }
    }),
    vscode.commands.registerCommand('claudeReview.refresh', () => {
      watcher.dispose();
      watcher.start();
    }),
    vscode.commands.registerCommand('claudeReview.moveToRightSidebar', () => moveToRightSidebar()),
    vscode.commands.registerCommand('claudeReview.gitStart', () => startWorkflow(store)),
    vscode.commands.registerCommand('claudeReview.gitSave', () => saveToRemoteWorkflow(store)),
    vscode.commands.registerCommand('claudeReview.gitReReview', () => reRequestReviewWorkflow(store)),
    { dispose: () => watcher.dispose() },
    { dispose: () => store.dispose() }
  );
}

export function deactivate(): void {}

async function moveToRightSidebar(): Promise<void> {
  try {
    // VSCode internal command that moves a view to the auxiliary (right) sidebar.
    await vscode.commands.executeCommand('vscode.moveViews', {
      viewIds: ['claudeReview.panel'],
      destinationId: 'workbench.view.extension.claudeReview.auxiliary'
    });
  } catch {
    // Fallback: reveal the view and open the interactive move picker.
    try {
      await vscode.commands.executeCommand('workbench.view.extension.claudeReview');
      await vscode.commands.executeCommand('workbench.action.moveView');
      vscode.window.showInformationMessage(
        'Please choose "Secondary Side Bar" to move the DiffDeck panel to the right.'
      );
    } catch {
      vscode.window.showWarningMessage(
        'Could not auto-move. Right-click the DiffDeck view header and choose "Move View → Secondary Side Bar".'
      );
    }
  }
}

function enrichBatch(raw: RawBatch): Batch {
  const config = vscode.workspace.getConfiguration('diffDeck');
  const userGlobs = config.get<string[]>('riskyGlobs', []);
  const largeThreshold = config.get<number>('largeDeletionThreshold', 50);

  const files: FileChange[] = raw.files.map(f => {
    const { html, stats } = renderDiff(f.before, f.after);
    const explanation = extractExplanation(raw.lastMessage, f.filePath, f.relPath);
    const risk = assessRisk(f.relPath, f.changeType, stats, userGlobs, largeThreshold);
    return {
      id: f.id,
      filePath: f.filePath,
      relPath: f.relPath,
      changeType: f.changeType,
      before: f.before,
      after: f.after,
      explanation,
      risk,
      diffStats: stats,
      diffHtml: html,
      status: 'pending'
    };
  });

  return {
    id: raw.id,
    sessionId: raw.sessionId,
    timestamp: raw.timestamp,
    userPrompt: raw.userPrompt || '',
    lastMessage: raw.lastMessage,
    files
  };
}
