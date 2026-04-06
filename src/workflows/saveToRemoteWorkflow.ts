import * as vscode from 'vscode';
import { run, getWorkspaceCwd, escapeShell, GitRunnerError } from '../gitRunner';
import { BatchStore } from '../batchStore';
import { ActivityEntry } from '../types';
import { addActivityBatch, formatError } from './startWorkflow';

function parseStatusFiles(porcelain: string): string[] {
  const files: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    const raw = line.slice(3);
    const arrow = raw.indexOf(' -> ');
    files.push(arrow >= 0 ? raw.slice(arrow + 4) : raw);
  }
  return files;
}

function groupByDirectory(files: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const f of files) {
    const parts = f.split('/');
    let key: string;
    if (parts.length === 1) key = '.';
    else if (parts.length === 2) key = parts[0];
    else key = `${parts[0]}/${parts[1]}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  return groups;
}

const COMMIT_TYPE_HINTS: [RegExp, string][] = [
  [/\.(test|spec)\.[jt]sx?$/i, 'test'],
  [/\.(md|txt|rst)$/i, 'docs'],
  [/\.(css|scss|less|style)$/i, 'style'],
  [/package(-lock)?\.json$|yarn\.lock$|pnpm-lock\.yaml$/i, 'chore'],
  [/\.github\/|Dockerfile|docker-compose|\.yml$/i, 'chore'],
  [/\.(config|rc)\.[jt]s$/i, 'chore'],
];

function inferCommitType(files: string[]): string {
  for (const [re, type] of COMMIT_TYPE_HINTS) {
    if (files.some(f => re.test(f))) return type;
  }
  return 'feat';
}

function generateCommitMessage(type: string, dir: string, files: string[]): string {
  const scope = dir === '.' ? '' : `(${dir})`;
  if (files.length === 1) {
    const base = files[0].split('/').pop() ?? files[0];
    return `${type}${scope}: update ${base}`;
  }
  return `${type}${scope}: update ${files.length} files`;
}

export async function saveToRemoteWorkflow(store: BatchStore): Promise<void> {
  const entries: ActivityEntry[] = [];
  const log = (message: string, status: ActivityEntry['status'] = 'info') => {
    entries.push({ timestamp: Date.now(), message, status });
  };

  try {
    const cwd = getWorkspaceCwd();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Save to Remote', cancellable: false },
      async (progress) => {
        progress.report({ message: 'Checking branch...' });
        const { stdout: branchRaw } = await run('git rev-parse --abbrev-ref HEAD', cwd);
        const currentBranch = branchRaw.trim();
        log(`Current branch: ${currentBranch}`);

        if (currentBranch === 'main') {
          log('On main — aborted', 'warning');
          vscode.window.showWarningMessage('Never commit directly on main. Create a branch first.');
          addActivityBatch(store, 'save', entries, 'error', 'Cannot commit on main');
          return;
        }
        if (currentBranch === 'test') {
          log('On test — aborted', 'warning');
          vscode.window.showWarningMessage('Do not commit directly on test. Use your feature branch.');
          addActivityBatch(store, 'save', entries, 'error', 'Cannot commit on test');
          return;
        }

        const { stdout: status } = await run('git status --porcelain', cwd);
        if (!status.trim()) {
          log('No changes to save', 'info');
          vscode.window.showInformationMessage('No changes to save.');
          addActivityBatch(store, 'save', entries, 'success', 'No changes');
          return;
        }

        progress.report({ message: 'Analyzing changes...' });
        const files = parseStatusFiles(status);
        log(`${files.length} changed files`);
        const groups = groupByDirectory(files);
        const groupKeys = Object.keys(groups);

        const commitMessages: string[] = [];
        if (groupKeys.length === 1) {
          progress.report({ message: 'Committing...' });
          await run('git add .', cwd);
          const type = inferCommitType(files);
          const dir = groupKeys[0];
          const msg = generateCommitMessage(type, dir, files);
          await run(`git commit -m "${escapeShell(msg)}"`, cwd);
          log(`Committed: ${msg}`, 'success');
          commitMessages.push(msg);
        } else {
          log(`Auto-splitting into ${groupKeys.length} commits`);
          for (const dir of groupKeys) {
            const groupFiles = groups[dir];
            progress.report({ message: `Committing ${dir}...` });
            const filePaths = groupFiles.map(f => `"${escapeShell(f)}"`).join(' ');
            await run(`git add ${filePaths}`, cwd);
            const type = inferCommitType(groupFiles);
            const msg = generateCommitMessage(type, dir, groupFiles);
            await run(`git commit -m "${escapeShell(msg)}"`, cwd);
            log(`Committed: ${msg}`, 'success');
            commitMessages.push(msg);
          }
        }

        progress.report({ message: 'Pushing...' });
        await pushWithFallback(cwd, currentBranch, progress, log);
        log('Pushed to remote', 'success');

        addActivityBatch(store, 'save', entries, 'success',
          `${commitMessages.length} commit(s) pushed to ${currentBranch}`);

        vscode.window.showInformationMessage(
          `Saved ${commitMessages.length} commit${commitMessages.length > 1 ? 's' : ''} and pushed to remote.`
        );
      }
    );
  } catch (err) {
    const msg = formatError(err);
    log(msg, 'error');
    addActivityBatch(store, 'save', entries, 'error', msg);
    if (err instanceof GitRunnerError) {
      vscode.window.showErrorMessage(`Save to Remote failed: ${err.stderr || err.message}`);
    } else {
      vscode.window.showErrorMessage(`Save to Remote failed: ${String(err)}`);
    }
  }
}

export async function pushWithFallback(
  cwd: string,
  branch: string,
  progress?: vscode.Progress<{ message?: string }>,
  log?: (msg: string, status?: ActivityEntry['status']) => void
): Promise<void> {
  try {
    await run('git push', cwd);
  } catch (e) {
    const msg = e instanceof GitRunnerError ? e.stderr : String(e);
    if (msg.includes('no upstream') || msg.includes('has no upstream') || msg.includes('--set-upstream')) {
      log?.('No upstream — setting upstream', 'info');
      await run(`git push -u origin ${branch}`, cwd);
    } else if (msg.includes('rejected') || msg.includes('non-fast-forward') || msg.includes('fetch first')) {
      progress?.report({ message: 'Rebasing on remote...' });
      log?.('Remote ahead — rebasing', 'info');
      await run(`git pull --rebase origin ${branch}`, cwd);
      await run('git push', cwd);
    } else {
      throw e;
    }
  }
}
