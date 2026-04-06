import { exec } from 'child_process';
import * as vscode from 'vscode';

export class GitRunnerError extends Error {
  constructor(
    public readonly cmd: string,
    public readonly stderr: string,
    public readonly exitCode: number | null
  ) {
    super(`Command failed (exit ${exitCode}): ${cmd}\n${stderr}`);
    this.name = 'GitRunnerError';
  }
}

export function run(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new GitRunnerError(cmd, stderr || err.message, err.code ?? null));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function getWorkspaceCwd(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('No workspace folder open.');
  }
  return folders[0].uri.fsPath;
}

export function escapeShell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}
