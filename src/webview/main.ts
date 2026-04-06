type RiskLevel = 'high' | 'medium' | 'low';
type ReviewStatus = 'pending' | 'confirmed' | 'rejected';

interface FileChange {
  id: string;
  filePath: string;
  relPath: string;
  changeType: string;
  explanation: string;
  risk: { level: RiskLevel; reasons: string[] };
  diffStats: { added: number; deleted: number };
  diffHtml: string;
  status: ReviewStatus;
}
interface ActivityEntry {
  timestamp: number;
  message: string;
  status: 'info' | 'success' | 'error' | 'warning';
}
interface ActivityLog {
  workflowType: 'start' | 'save' | 'reRequestReview';
  entries: ActivityEntry[];
  result: 'success' | 'error' | 'cancelled';
  summary: string;
}
interface Batch {
  id: string;
  timestamp: number;
  userPrompt: string;
  files: FileChange[];
  activity?: ActivityLog;
}

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };
const vscode = acquireVsCodeApi();

const root = document.getElementById('root') as HTMLDivElement;
const summary = document.getElementById('summary') as HTMLSpanElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const reviewBtn = document.getElementById('reviewBtn') as HTMLButtonElement;

clearBtn.addEventListener('click', () => {
  if (confirm('Clear all pending reviews?')) {
    vscode.postMessage({ type: 'clearAll' });
  }
});
startBtn.addEventListener('click', () => { vscode.postMessage({ type: 'gitStart' }); });
saveBtn.addEventListener('click', () => { vscode.postMessage({ type: 'gitSave' }); });
reviewBtn.addEventListener('click', () => { vscode.postMessage({ type: 'gitReReview' }); });

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg?.type === 'state') {
    render(msg.batches as Batch[]);
  }
});

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}
function truncate(s: string, n: number): string {
  s = s.trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function render(batches: Batch[]): void {
  const fileBatches = batches.filter(b => b.files.length > 0);
  const totalFiles = fileBatches.reduce((n, b) => n + b.files.length, 0);
  const pending = fileBatches.reduce((n, b) => n + b.files.filter(f => f.status === 'pending').length, 0);
  const activityCount = batches.filter(b => b.activity).length;

  if (batches.length === 0) {
    summary.textContent = 'No activity yet';
    root.innerHTML = `
      <div class="empty">
        <p>Run <code>claude</code> in the terminal. Changes will appear here after each turn.</p>
        <p>Use the buttons below to manage your git workflow.</p>
        <p>First time? Run <strong>DiffDeck: Install Hook</strong> in the Command Palette.</p>
      </div>`;
    return;
  }

  const parts: string[] = [];
  if (totalFiles > 0 || activityCount > 0) {
    const bits: string[] = [];
    if (totalFiles > 0) bits.push(`${totalFiles} files · ${pending} pending`);
    if (activityCount > 0) bits.push(`${activityCount} actions`);
    summary.textContent = bits.join(' · ');
  }

  for (const batch of batches) {
    if (batch.activity) {
      parts.push(renderActivityCard(batch));
    } else if (batch.files.length > 0) {
      parts.push(renderFileBatch(batch));
    }
  }
  root.innerHTML = parts.join('');

  // Wire file card buttons
  root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action!;
      const batchId = btn.dataset.batch!;
      const fileId = btn.dataset.file!;
      if (action === 'confirm' || action === 'reject') {
        vscode.postMessage({ type: action, batchId, fileId });
      } else if (action === 'open') {
        vscode.postMessage({ type: 'openFile', path: btn.dataset.path });
      } else if (action === 'toggle') {
        const card = btn.closest('.file-card');
        card?.classList.toggle('collapsed');
      }
    });
  });
}

function renderFileBatch(batch: Batch): string {
  const promptHtml = batch.userPrompt
    ? `<div class="user-prompt" title="${escapeAttr(batch.userPrompt)}">${escapeText(truncate(batch.userPrompt, 240))}</div>`
    : '';
  let html = `<div class="batch">
    <div class="batch-header">
      <span class="turn-label">Turn @ ${formatTime(batch.timestamp)}</span>
      <span class="turn-count">${batch.files.length} ${batch.files.length === 1 ? 'file' : 'files'}</span>
    </div>
    ${promptHtml}`;
  for (const f of batch.files) {
    html += renderFileCard(batch.id, f);
  }
  html += `</div>`;
  return html;
}

function renderActivityCard(batch: Batch): string {
  const a = batch.activity!;
  const typeLabel: Record<string, string> = {
    start: 'Start',
    save: 'Save',
    reRequestReview: 'Review'
  };
  const label = typeLabel[a.workflowType] || a.workflowType;

  const entriesHtml = a.entries.map(e =>
    `<li class="s-${e.status}"><span class="entry-time">${formatTime(e.timestamp)}</span>${escapeText(e.message)}</li>`
  ).join('');

  return `
    <div class="batch">
      <div class="batch-header">
        <span class="turn-label">Action @ ${formatTime(batch.timestamp)}</span>
      </div>
      <div class="activity-card">
        <div class="activity-header">
          <span class="activity-badge ${escapeAttr(a.workflowType)}">${escapeText(label)}</span>
          <span class="activity-result ${escapeAttr(a.result)}">${a.result.toUpperCase()}</span>
          <span class="activity-summary">${escapeText(a.summary)}</span>
        </div>
        <ul class="activity-entries">${entriesHtml}</ul>
      </div>
    </div>`;
}

function renderFileCard(batchId: string, f: FileChange): string {
  const riskClass = `risk-${f.risk.level}`;
  const statusClass = f.status !== 'pending' ? `status-${f.status}` : '';
  const riskLabel = { high: 'HIGH', medium: 'MED', low: 'LOW' }[f.risk.level];
  const reasons = f.risk.reasons.map(escapeText).join(' · ');
  const stats = `<span class="stats"><span class="add">+${f.diffStats.added}</span> <span class="del">-${f.diffStats.deleted}</span></span>`;
  const actions = f.status === 'pending'
    ? `<button data-action="confirm" data-batch="${escapeAttr(batchId)}" data-file="${escapeAttr(f.id)}">✓ Confirm</button>
       <button data-action="reject" data-batch="${escapeAttr(batchId)}" data-file="${escapeAttr(f.id)}">✗ Reject</button>`
    : `<span class="status-label">${f.status === 'confirmed' ? '✓ Confirmed' : '✗ Rejected'}</span>`;

  return `
    <div class="file-card ${statusClass} collapsed">
      <div class="file-header">
        <span class="risk-badge ${riskClass}">${riskLabel}</span>
        <span class="change-type">${escapeText(f.changeType)}</span>
        <span class="rel-path" title="${escapeAttr(f.filePath)}">${escapeText(f.relPath)}</span>
        ${stats}
        <button class="icon-btn" data-action="toggle" data-batch="${escapeAttr(batchId)}" data-file="${escapeAttr(f.id)}" title="Expand/Collapse">▾</button>
      </div>
      <div class="risk-reasons">${reasons}</div>
      <div class="explanation">${escapeText(f.explanation)}</div>
      <div class="diff-container">${f.diffHtml}</div>
      <div class="actions">
        <button class="link-btn" data-action="open" data-path="${escapeAttr(f.filePath)}" data-batch="${escapeAttr(batchId)}" data-file="${escapeAttr(f.id)}">Open File</button>
        ${actions}
      </div>
    </div>`;
}
