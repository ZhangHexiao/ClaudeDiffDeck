import * as vscode from 'vscode';
import { run, getWorkspaceCwd, GitRunnerError } from '../gitRunner';
import { BatchStore } from '../batchStore';
import { ActivityEntry } from '../types';
import { addActivityBatch, formatError } from './startWorkflow';
import { saveToRemoteWorkflow, pushWithFallback } from './saveToRemoteWorkflow';

export async function reRequestReviewWorkflow(store: BatchStore): Promise<void> {
  const entries: ActivityEntry[] = [];
  const log = (message: string, status: ActivityEntry['status'] = 'info') => {
    entries.push({ timestamp: Date.now(), message, status });
  };

  try {
    const cwd = getWorkspaceCwd();

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Re-request Review', cancellable: false },
      async (progress) => {
        progress.report({ message: 'Checking PR status...' });
        let prRaw: string;
        try {
          const result = await run('gh pr view --json number,isDraft,url', cwd);
          prRaw = result.stdout;
        } catch {
          log('No PR found for current branch', 'warning');
          vscode.window.showWarningMessage('No pull request found for the current branch. Create one first.');
          addActivityBatch(store, 'reRequestReview', entries, 'error', 'No PR found');
          return;
        }

        const pr = JSON.parse(prRaw) as { number: number; isDraft: boolean; url: string };
        log(`PR #${pr.number} (${pr.isDraft ? 'draft' : 'ready'}) — ${pr.url}`);

        const { stdout: status } = await run('git status --porcelain', cwd);
        if (status.trim()) {
          progress.report({ message: 'Saving uncommitted changes first...' });
          log('Dirty working tree — saving first');
          await saveToRemoteWorkflow(store);
        } else {
          progress.report({ message: 'Pushing latest...' });
          const { stdout: branchRaw } = await run('git rev-parse --abbrev-ref HEAD', cwd);
          await pushWithFallback(cwd, branchRaw.trim(), progress, log);
          log('Pushed latest commits');
        }

        if (pr.isDraft) {
          progress.report({ message: 'Marking PR as ready for review...' });
          await run('gh pr ready', cwd);
          log(`PR #${pr.number} marked as ready`, 'success');
          addActivityBatch(store, 'reRequestReview', entries, 'success',
            `PR #${pr.number} is now ready for review`);
          vscode.window.showInformationMessage(`PR #${pr.number} is now ready for review.`);
          return;
        }

        progress.report({ message: 'Finding previous reviewers...' });
        let reviewers: string[] = [];

        try {
          const { stdout: reviewsOut } = await run(
            `gh pr view --json reviews --jq '[.reviews[].author.login] | unique | .[]'`,
            cwd
          );
          for (const login of reviewsOut.split('\n')) {
            const trimmed = login.trim();
            if (trimmed) reviewers.push(trimmed);
          }
        } catch { /* no reviews yet */ }

        try {
          const { stdout: requestedOut } = await run(
            `gh pr view --json reviewRequests --jq '[.reviewRequests[].login] | unique | .[]'`,
            cwd
          );
          for (const login of requestedOut.split('\n')) {
            const trimmed = login.trim();
            if (trimmed) reviewers.push(trimmed);
          }
        } catch { /* no pending requests */ }

        reviewers = [...new Set(reviewers)];

        if (reviewers.length === 0) {
          log('No previous reviewers found', 'info');
          addActivityBatch(store, 'reRequestReview', entries, 'success',
            `PR #${pr.number} pushed, no reviewers to re-request`);
          vscode.window.showInformationMessage(
            `PR #${pr.number} pushed. No previous reviewers found to re-request.`
          );
          return;
        }

        progress.report({ message: `Re-requesting review from ${reviewers.join(', ')}...` });
        await run(`gh pr edit --add-reviewer ${reviewers.join(',')}`, cwd);
        log(`Re-requested review from: ${reviewers.join(', ')}`, 'success');

        addActivityBatch(store, 'reRequestReview', entries, 'success',
          `Re-requested review from: ${reviewers.join(', ')}`);

        vscode.window.showInformationMessage(
          `Review re-requested from: ${reviewers.join(', ')}`
        );
      }
    );
  } catch (err) {
    const msg = formatError(err);
    log(msg, 'error');
    addActivityBatch(store, 'reRequestReview', entries, 'error', msg);
    if (err instanceof GitRunnerError) {
      const m = err.stderr || err.message;
      if (m.includes('not found') || m.includes('ENOENT')) {
        vscode.window.showErrorMessage('GitHub CLI (gh) not found. Install from https://cli.github.com');
        return;
      }
      if (m.includes('not logged in') || m.includes('auth login')) {
        vscode.window.showErrorMessage('GitHub CLI not authenticated. Run `gh auth login`.');
        return;
      }
      vscode.window.showErrorMessage(`Re-request Review failed: ${m}`);
    } else {
      vscode.window.showErrorMessage(`Re-request Review failed: ${String(err)}`);
    }
  }
}
