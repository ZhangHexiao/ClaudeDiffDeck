import { diffLines } from 'diff';
import { DiffStats } from './types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderDiff(before: string, after: string): { html: string; stats: DiffStats } {
  const parts = diffLines(before || '', after || '');
  let added = 0;
  let deleted = 0;
  const lines: string[] = [];

  for (const part of parts) {
    const value = part.value.replace(/\n$/, '');
    const partLines = value.split('\n');
    if (part.added) {
      added += partLines.length;
      for (const l of partLines) {
        lines.push(`<div class="line add">+ ${escapeHtml(l)}</div>`);
      }
    } else if (part.removed) {
      deleted += partLines.length;
      for (const l of partLines) {
        lines.push(`<div class="line del">- ${escapeHtml(l)}</div>`);
      }
    } else {
      // Context: show at most 3 lines before/after change blocks; truncate long runs
      if (partLines.length > 6) {
        for (const l of partLines.slice(0, 3)) {
          lines.push(`<div class="line ctx">  ${escapeHtml(l)}</div>`);
        }
        lines.push(`<div class="line gap">  … ${partLines.length - 6} unchanged lines …</div>`);
        for (const l of partLines.slice(-3)) {
          lines.push(`<div class="line ctx">  ${escapeHtml(l)}</div>`);
        }
      } else {
        for (const l of partLines) {
          lines.push(`<div class="line ctx">  ${escapeHtml(l)}</div>`);
        }
      }
    }
  }

  return {
    html: `<div class="diff">${lines.join('')}</div>`,
    stats: { added, deleted }
  };
}
