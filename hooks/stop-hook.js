#!/usr/bin/env node
/**
 * Claude Code `Stop` hook script.
 * Reads hook payload from stdin, parses the transcript, collects file edits
 * made during the latest turn, and writes a JSON batch to
 * <workspaceRoot>/.claude/pending-review/<ts>-<sid>.json (atomic via rename).
 *
 * Never throws; always exits 0 so Claude is not blocked.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    // Safety timeout
    setTimeout(() => resolve(data), 5000);
  });
}

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    try {
      if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.claude'))) {
        return dir;
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/** Returns true if a `user` entry is actually a tool_result wrapper (not a real user message). */
function isToolResultWrapper(entry) {
  if (!entry || entry.type !== 'user') return false;
  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) return false;
  return content.every(b => b && b.type === 'tool_result');
}

/** Extract plain-text content from a user message entry. */
function extractUserText(entry) {
  if (!entry || !entry.message) return '';
  const c = entry.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const parts = [];
    for (const b of c) {
      if (!b) continue;
      if (typeof b === 'string') parts.push(b);
      else if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Walk JSONL backward; collect tool_use for Edit/Write/MultiEdit/NotebookEdit until previous user turn.
 * Also returns the user prompt text that initiated this turn.
 */
function collectToolUses(lines) {
  const tools = [];
  let userPrompt = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = safeParse(lines[i]);
    if (!entry) continue;
    if (entry.type === 'user' && !isToolResultWrapper(entry)) {
      userPrompt = extractUserText(entry);
      break;
    }
    if (entry.type === 'assistant') {
      const content = entry.message && entry.message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && block.type === 'tool_use' &&
            ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) {
          tools.unshift({ name: block.name, input: block.input || {}, id: block.id });
        }
      }
    }
  }
  return { tools, userPrompt };
}

/** Reverse-apply a list of edits (Edit and MultiEdit) to `after` content to reconstruct `before`. */
function reverseApply(after, changes) {
  let content = after;
  // Reverse order, because edits were applied sequentially forward.
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    if (c.name === 'Edit') {
      const oldS = c.input.old_string || '';
      const newS = c.input.new_string || '';
      const replaceAll = !!c.input.replace_all;
      if (replaceAll) {
        content = content.split(newS).join(oldS);
      } else {
        const idx = content.lastIndexOf(newS);
        if (idx >= 0) content = content.slice(0, idx) + oldS + content.slice(idx + newS.length);
      }
    } else if (c.name === 'MultiEdit') {
      const edits = Array.isArray(c.input.edits) ? c.input.edits : [];
      for (let j = edits.length - 1; j >= 0; j--) {
        const e = edits[j];
        const oldS = e.old_string || '';
        const newS = e.new_string || '';
        const replaceAll = !!e.replace_all;
        if (replaceAll) {
          content = content.split(newS).join(oldS);
        } else {
          const idx = content.lastIndexOf(newS);
          if (idx >= 0) content = content.slice(0, idx) + oldS + content.slice(idx + newS.length);
        }
      }
    }
    // For Write entries in reverseApply: we pass through unchanged.
  }
  return content;
}

function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

async function main() {
  const stdinRaw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(stdinRaw);
  } catch {
    process.exit(0);
  }
  if (!payload || !payload.transcript_path) process.exit(0);

  const transcriptPath = payload.transcript_path;
  const cwd = payload.cwd || process.cwd();
  const sessionId = payload.session_id || 'unknown';
  const lastMessage = payload.last_assistant_message || '';

  const workspaceRoot = findWorkspaceRoot(cwd);

  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }

  const { tools, userPrompt } = collectToolUses(lines);
  if (tools.length === 0) process.exit(0);

  // Group by file_path, preserving order.
  const byFile = new Map();
  for (const t of tools) {
    const fp = t.input.file_path;
    if (!fp) continue;
    if (!byFile.has(fp)) byFile.set(fp, []);
    byFile.get(fp).push(t);
  }

  const files = [];
  for (const [fp, changes] of byFile) {
    const first = changes[0];
    const last = changes[changes.length - 1];
    let changeType;
    let before = '';
    let after = '';

    // Determine current content
    const fileExists = fs.existsSync(fp);
    const currentContent = fileExists ? safeReadFile(fp) : null;

    if (last.name === 'Write') {
      // Either create or overwrite
      after = currentContent != null ? currentContent : (last.input.content || '');
      // Check if file existed before this turn: if first op is Write and no prior Edit existed,
      // we can't easily know. Heuristic: check if basename was mentioned in earlier transcript as existing.
      // Simpler: if changes has only Writes and no Edit preceded, call it 'create' if previous filesize unknown.
      changeType = (changes.length === 1 && first.name === 'Write') ? 'write' : 'write';
      // Before reconstruction: try reverse-apply over edits (ignoring Writes, which reset)
      before = reverseApply(after, changes);
      // If the reconstruction didn't differ and first op was Write, treat as create
      if (before === after && first.name === 'Write') {
        // We can't tell from transcript alone; leave before as after-reversed attempt.
        // For a clean create signal, Write would be the only op — mark create if empty reverse
        before = '';
        changeType = 'create';
      }
    } else if (changes.some(c => c.name === 'MultiEdit')) {
      changeType = 'multiedit';
      after = currentContent != null ? currentContent : '';
      before = reverseApply(after, changes);
    } else {
      // Edit only
      changeType = 'edit';
      after = currentContent != null ? currentContent : '';
      before = reverseApply(after, changes);
    }

    const relPath = path.relative(workspaceRoot, fp) || path.basename(fp);
    files.push({
      id: shortHash(sessionId + ':' + fp + ':' + Date.now()),
      filePath: fp,
      relPath,
      changeType,
      before,
      after
    });
  }

  if (files.length === 0) process.exit(0);

  const ts = Date.now();
  const batchId = `${ts}-${String(sessionId).slice(0, 8)}`;
  const outDir = path.join(workspaceRoot, '.claude', 'pending-review');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
  const outPath = path.join(outDir, `${batchId}-${shortHash(batchId).slice(0, 4)}.json`);
  const tmpPath = outPath + '.tmp';
  const batch = {
    id: batchId,
    sessionId,
    timestamp: ts,
    userPrompt,
    lastMessage,
    files
  };
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(batch, null, 2), 'utf8');
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    // swallow
  }

  process.exit(0);
}

function safeReadFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

main().catch(() => process.exit(0));
