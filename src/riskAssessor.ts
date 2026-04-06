import { ChangeType, DiffStats, RiskInfo, RiskLevel } from './types';

const BUILT_IN_GLOBS = [
  '**/.env*',
  '**/package.json',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/*.config.{js,ts,json,mjs,cjs}',
  '**/.github/workflows/**',
  '**/Dockerfile',
  '**/docker-compose*.yml',
  '**/tsconfig*.json',
  '**/webpack.config.*',
  '**/vite.config.*',
  '**/next.config.*'
];

/** Convert a glob pattern to a RegExp. Supports *, **, ?, {a,b}. */
function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // **
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i++;
      } else {
        const opts = glob.slice(i + 1, end).split(',').map(o => o.replace(/[.+^$()|[\]\\]/g, '\\$&'));
        re += '(?:' + opts.join('|') + ')';
        i = end + 1;
      }
    } else if ('.+^$()|[]\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

const compiledCache = new Map<string, RegExp>();
function matchGlob(glob: string, relPath: string): boolean {
  let re = compiledCache.get(glob);
  if (!re) {
    re = globToRegex(glob);
    compiledCache.set(glob, re);
  }
  // Normalize separators
  const p = relPath.replace(/\\/g, '/');
  return re.test(p);
}

export function assessRisk(
  relPath: string,
  changeType: ChangeType,
  stats: DiffStats,
  userGlobs: string[],
  largeDeletionThreshold: number
): RiskInfo {
  const reasons: string[] = [];
  let level: RiskLevel = 'low';

  const allGlobs = [...BUILT_IN_GLOBS, ...userGlobs];
  const matched = allGlobs.find(g => matchGlob(g, relPath));
  if (matched) {
    level = 'high';
    reasons.push(`Sensitive file (${matched})`);
  }

  if (changeType === 'delete') {
    level = 'high';
    reasons.push('File deleted');
  }

  if (stats.deleted > largeDeletionThreshold) {
    level = 'high';
    reasons.push(`Large deletion (${stats.deleted} lines)`);
  }

  if (changeType === 'create' && !relPath.includes('/')) {
    if (level === 'low') level = 'medium';
    reasons.push('New file at repo root');
  }

  if (reasons.length === 0) reasons.push('Routine change');

  return { level, reasons };
}
