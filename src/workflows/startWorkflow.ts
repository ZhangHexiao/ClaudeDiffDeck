import * as vscode from 'vscode';
import { run, getWorkspaceCwd, escapeShell, GitRunnerError } from '../gitRunner';
import { BatchStore } from '../batchStore';
import { ActivityEntry } from '../types';

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/\b(fix|bug|error|crash|issue|broken|wrong)\b/i, 'fix'],
  [/\b(refactor|cleanup|restructure|reorganize|rename|move)\b/i, 'refactor'],
  [/\b(doc|readme|comment|jsdoc|typedoc)\b/i, 'docs'],
  [/\b(perf|performance|speed|optimiz|fast|slow|latency)\b/i, 'perf'],
  [/\b(chore|ci|build|dep|lint|format|upgrade|bump|config)\b/i, 'chore'],
];

function inferType(description: string): string {
  for (const [re, type] of TYPE_KEYWORDS) {
    if (re.test(description)) return type;
  }
  return 'feat';
}

function generateSlug(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
}

function datePart(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

export async function startWorkflow(store: BatchStore): Promise<void> {
  const entries: ActivityEntry[] = [];
  const log = (message: string, status: ActivityEntry['status'] = 'info') => {
    entries.push({ timestamp: Date.now(), message, status });
  };

  try {
    const cwd = getWorkspaceCwd();

    const description = await vscode.window.showInputBox({
      prompt: 'Describe what you want to do (any language)',
      placeHolder: 'e.g. Fix the login timeout bug on mobile',
      ignoreFocusOut: true
    });
    if (!description) {
      log('Cancelled by user', 'warning');
      addActivityBatch(store, 'start', entries, 'cancelled', 'Cancelled');
      return;
    }

    const type = inferType(description);
    const slug = generateSlug(description);
    const branch = `${type}/${datePart()}-${slug}`;
    log(`Task: ${description}`);
    log(`Inferred type: ${type}, branch: ${branch}`);

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Start', cancellable: false },
      async (progress) => {
        progress.report({ message: 'Checking working tree...' });
        const { stdout: status } = await run('git status --porcelain', cwd);
        if (status.trim()) {
          log('Working tree is dirty — aborted', 'warning');
          vscode.window.showWarningMessage(
            'Working tree is dirty. Please commit or stash your changes first.'
          );
          addActivityBatch(store, 'start', entries, 'error', 'Dirty working tree');
          return;
        }
        log('Working tree clean');

        progress.report({ message: 'Switching to main...' });
        await run('git checkout main', cwd);
        log('Checked out main');

        progress.report({ message: 'Pulling latest main...' });
        await run('git pull origin main', cwd);
        log('Pulled latest main');

        progress.report({ message: `Creating branch ${branch}...` });
        await run(`git checkout -b ${branch}`, cwd);
        log(`Created branch ${branch}`, 'success');

        progress.report({ message: 'Pushing branch...' });
        await run(`git commit --allow-empty -m "${escapeShell(`${type}: ${slug} [skip ci]`)}"`, cwd);
        await run(`git push -u origin ${branch}`, cwd);
        log('Pushed to remote');

        progress.report({ message: 'Creating draft PR...' });
        const title = `${type}: ${slug}`;
        const body = `## Description\\n\\n${escapeShell(description)}\\n\\n---\\n*Created via Claude Review extension*`;
        const { stdout: prUrl } = await run(
          `gh pr create --draft --title "${escapeShell(title)}" --body "${body}"`,
          cwd
        );
        const trimmedUrl = prUrl.trim();
        log(`Draft PR created: ${trimmedUrl}`, 'success');

        addActivityBatch(store, 'start', entries, 'success',
          `Branch: ${branch} | PR: ${trimmedUrl}`);

        const action = await vscode.window.showInformationMessage(
          `Branch created: ${branch}\nDraft PR: ${trimmedUrl}`,
          'Open in Browser'
        );
        if (action === 'Open in Browser') {
          vscode.env.openExternal(vscode.Uri.parse(trimmedUrl));
        }
      }
    );
  } catch (err) {
    const msg = formatError(err);
    log(msg, 'error');
    addActivityBatch(store, 'start', entries, 'error', msg);
    showWorkflowError('Start', err);
  }
}

function addActivityBatch(
  store: BatchStore,
  workflowType: 'start' | 'save' | 'reRequestReview',
  entries: ActivityEntry[],
  result: 'success' | 'error' | 'cancelled',
  summary: string
): void {
  store.addBatch({
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId: '',
    timestamp: Date.now(),
    userPrompt: '',
    lastMessage: '',
    files: [],
    activity: { workflowType, entries, result, summary }
  });
}

function formatError(err: unknown): string {
  if (err instanceof GitRunnerError) return err.stderr || err.message;
  return String(err);
}

function showWorkflowError(workflow: string, err: unknown): void {
  if (err instanceof GitRunnerError) {
    const msg = err.stderr || err.message;
    if ((msg.includes('not found') || msg.includes('ENOENT')) && err.cmd.startsWith('gh')) {
      vscode.window.showErrorMessage('GitHub CLI (gh) not found. Install from https://cli.github.com');
      return;
    }
    if (msg.includes('not logged in') || msg.includes('auth login')) {
      vscode.window.showErrorMessage('GitHub CLI not authenticated. Run `gh auth login`.');
      return;
    }
    if (msg.includes('already exists')) {
      vscode.window.showErrorMessage('Branch already exists. Try a different description.');
      return;
    }
    vscode.window.showErrorMessage(`${workflow} failed: ${msg}`);
  } else {
    vscode.window.showErrorMessage(`${workflow} failed: ${String(err)}`);
  }
}

export { addActivityBatch, formatError, showWorkflowError };
