import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'portal_database.json');

export interface PersistedPortalState {
  users?: any[];
  students?: any[];
  faculty?: any[];
  hod?: any;
  admin?: any;
  departments?: any[];
  subjects?: any[];
  attendance?: any[];
  leaveRequests?: any[];
  announcements?: any[];
  notifications?: any[];
  fees?: any[];
  auditLogs?: any[];
  settings?: any;
  lastUpdated?: string;
}

export function loadDiskState(): PersistedPortalState | null {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err: any) {
    console.warn('[Disk Storage] Warning reading persistence file:', err.message);
    return null;
  }
}

export function saveDiskState(state: PersistedPortalState): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload = {
      ...state,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error('[Disk Storage] Failed to save state to disk:', err.message);
    return false;
  }
}
