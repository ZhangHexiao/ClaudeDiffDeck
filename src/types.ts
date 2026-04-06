export type ChangeType = 'edit' | 'write' | 'create' | 'delete' | 'multiedit';
export type RiskLevel = 'high' | 'medium' | 'low';
export type ReviewStatus = 'pending' | 'confirmed' | 'rejected';

export interface DiffStats {
  added: number;
  deleted: number;
}

export interface RiskInfo {
  level: RiskLevel;
  reasons: string[];
}

export interface FileChange {
  id: string;
  filePath: string;
  relPath: string;
  changeType: ChangeType;
  before: string;
  after: string;
  explanation: string;
  risk: RiskInfo;
  diffStats: DiffStats;
  diffHtml: string;
  status: ReviewStatus;
}

export interface Batch {
  id: string;
  sessionId: string;
  timestamp: number;
  userPrompt: string;
  lastMessage: string;
  files: FileChange[];
  activity?: ActivityLog;
}

/** Raw JSON shape written by the hook script. */
export interface RawBatch {
  id: string;
  sessionId: string;
  timestamp: number;
  userPrompt: string;
  lastMessage: string;
  files: Array<{
    id: string;
    filePath: string;
    relPath: string;
    changeType: ChangeType;
    before: string;
    after: string;
  }>;
}

export interface ActivityEntry {
  timestamp: number;
  message: string;
  status: 'info' | 'success' | 'error' | 'warning';
}

export interface ActivityLog {
  workflowType: 'start' | 'save' | 'reRequestReview';
  entries: ActivityEntry[];
  result: 'success' | 'error' | 'cancelled';
  summary: string;
}

export type ExtToWeb = { type: 'state'; batches: Batch[] };

export type WebToExt =
  | { type: 'confirm'; batchId: string; fileId: string }
  | { type: 'reject'; batchId: string; fileId: string }
  | { type: 'openFile'; path: string }
  | { type: 'clearAll' }
  | { type: 'gitStart' }
  | { type: 'gitSave' }
  | { type: 'gitReReview' };
