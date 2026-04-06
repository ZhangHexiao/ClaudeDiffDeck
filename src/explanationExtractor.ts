import * as path from 'path';

/**
 * Extract 1-2 sentences from the assistant message that mention the given file.
 * Scoring: relPath substring +3, basename +2, stem (no ext) +1.
 */
export function extractExplanation(message: string, filePath: string, relPath: string): string {
  if (!message || !message.trim()) {
    return '未找到该文件的说明 / No explanation found.';
  }

  const basename = path.basename(filePath);
  const stem = basename.replace(/\.[^.]+$/, '');

  // Split into sentences (also breaks on newlines). Keep original text.
  const raw = message.replace(/\r/g, '');
  const sentences = raw
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 500);

  const scored = sentences.map(s => {
    let score = 0;
    if (relPath && s.includes(relPath)) score += 3;
    if (s.includes(basename)) score += 2;
    if (stem && stem.length > 2 && s.includes(stem)) score += 1;
    return { s, score };
  }).filter(x => x.score > 0);

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Fallback: return first non-empty sentence as a general summary
    const first = sentences[0];
    if (first) {
      return (first.length > 200 ? first.slice(0, 200) + '…' : first);
    }
    return '未找到该文件的说明 / No explanation found.';
  }

  const top = scored.slice(0, 2).map(x => x.s).join(' ');
  return top.length > 300 ? top.slice(0, 300) + '…' : top;
}
