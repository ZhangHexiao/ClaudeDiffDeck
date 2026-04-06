import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BatchStore } from './batchStore';
import { ExtToWeb, WebToExt } from './types';
import { BeforeContentProvider } from './beforeContentProvider';
import { startWorkflow, saveToRemoteWorkflow, reRequestReviewWorkflow } from './workflows';

export class ReviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'claudeReview.panel';
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: BatchStore
  ) {
    store.onChange(() => this.postState());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebToExt) => this.handleMessage(msg));
    this.postState();
  }

  private handleMessage(msg: WebToExt): void {
    switch (msg.type) {
      case 'confirm':
        this.store.setStatus(msg.batchId, msg.fileId, 'confirmed');
        break;
      case 'reject':
        this.store.setStatus(msg.batchId, msg.fileId, 'rejected');
        this.openDiffForFile(msg.batchId, msg.fileId);
        break;
      case 'openFile':
        vscode.workspace.openTextDocument(msg.path).then(
          doc => vscode.window.showTextDocument(doc),
          err => vscode.window.showErrorMessage(`Cannot open file: ${err}`)
        );
        break;
      case 'clearAll':
        vscode.commands.executeCommand('claudeReview.clearBatches');
        break;
      case 'gitStart':
        startWorkflow(this.store);
        break;
      case 'gitSave':
        saveToRemoteWorkflow(this.store);
        break;
      case 'gitReReview':
        reRequestReviewWorkflow(this.store);
        break;
    }
  }

  private openDiffForFile(batchId: string, fileId: string): void {
    const batch = this.store.getAll().find(b => b.id === batchId);
    if (!batch) return;
    const file = batch.files.find(f => f.id === fileId);
    if (!file) return;

    const basename = path.basename(file.filePath);
    const beforeUri = BeforeContentProvider.buildUri(batchId, fileId, basename);
    const currentUri = vscode.Uri.file(file.filePath);
    const title = `${file.relPath} (before ↔ current)`;

    vscode.commands.executeCommand('vscode.diff', beforeUri, currentUri, title);
  }

  private postState(): void {
    if (!this.view) return;
    const msg: ExtToWeb = { type: 'state', batches: this.store.getAll() };
    this.view.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'styles.css'));
    const nonce = getNonce();
    const htmlPath = path.join(distUri.fsPath, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{scriptUri}}/g, scriptUri.toString())
      .replace(/{{styleUri}}/g, styleUri.toString())
      .replace(/{{cspSource}}/g, webview.cspSource);
    return html;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
