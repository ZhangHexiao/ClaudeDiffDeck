import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface HookEntry {
  type: string;
  command: string;
}
interface StopHookBlock {
  hooks?: HookEntry[];
  matcher?: string;
}
interface Settings {
  hooks?: { Stop?: StopHookBlock[]; [k: string]: StopHookBlock[] | undefined };
  [k: string]: unknown;
}

const MARKER = 'stop-hook.js';

export async function installHook(extensionPath: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage('Claude Review: Please open a workspace first.');
    return;
  }
  const root = folders[0].uri.fsPath;

  const hookScript = path.join(extensionPath, 'hooks', 'stop-hook.js');
  if (!fs.existsSync(hookScript)) {
    vscode.window.showErrorMessage(`Claude Review: Hook script not found at ${hookScript}`);
    return;
  }

  // 1. Merge .claude/settings.json
  const claudeDir = path.join(root, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, 'settings.json');

  let settings: Settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      const overwrite = await vscode.window.showWarningMessage(
        '.claude/settings.json exists but is not valid JSON. Overwrite?',
        'Overwrite', 'Cancel'
      );
      if (overwrite !== 'Overwrite') return;
      settings = {};
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];

  const newCmd = `node "${hookScript}"`;
  const stopArr = settings.hooks.Stop as StopHookBlock[];

  // Remove any previous entry pointing to our script (path may have changed)
  for (const block of stopArr) {
    if (Array.isArray(block.hooks)) {
      block.hooks = block.hooks.filter(h => !h.command?.includes(MARKER));
    }
  }
  // Drop blocks whose hooks became empty
  settings.hooks.Stop = stopArr.filter(b => Array.isArray(b.hooks) && b.hooks.length > 0);

  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: newCmd }] });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  // 2. Create pending-review dir
  fs.mkdirSync(path.join(claudeDir, 'pending-review'), { recursive: true });

  // 3. Update .gitignore
  const gitignorePath = path.join(root, '.gitignore');
  const entry = '.claude/pending-review/';
  let contents = '';
  if (fs.existsSync(gitignorePath)) {
    contents = fs.readFileSync(gitignorePath, 'utf8');
  }
  const lines = contents.split('\n').map(l => l.trim());
  if (!lines.includes(entry) && !lines.includes('.claude/pending-review') && !lines.includes('.claude/')) {
    const sep = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, contents + sep + entry + '\n', 'utf8');
  }

  vscode.window.showInformationMessage(
    'Claude Review: Hook installed ✓ Run `claude` in the terminal — changes will appear here after each turn.'
  );
}
