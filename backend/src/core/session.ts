import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Session as SDKSession, AgentInputItem } from '@openai/agents';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, '..', '..', 'sessions');

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConversationItem {
  type: 'user' | 'agent' | 'system';
  text: string;
  agent?: string;
}

interface SessionMeta {
  name: string;
  createdAt: number;
  /** UI-only items (system messages, agent labels) not captured by SDK history */
  displayItems: ConversationItem[];
  /** User input history for up-arrow recall */
  inputHistory?: string[];
  /** Last error for debugging and recovery */
  lastError?: string;
}

// ── File paths ──────────────────────────────────────────────────────────────

function itemsPath(id: string): string { return path.join(SESSIONS_DIR, `${id}.json`); }
function metaPath(id: string): string { return path.join(SESSIONS_DIR, `${id}.meta.json`); }

// ── SessionStore — single source of truth ───────────────────────────────────

/** Unified session store: SDK Session interface + UI display items. */
export class SessionStore implements SDKSession {
  private id: string;

  constructor(id: string) {
    this.id = id;
  }

  // ── SDK Session interface ───────────────────────────────────────────────

  async getSessionId(): Promise<string> { return this.id; }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    ensureDir();
    const p = itemsPath(this.id);
    if (!fs.existsSync(p)) return [];
    try {
      const items: AgentInputItem[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return limit ? items.slice(-limit) : items;
    } catch { return []; }
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    ensureDir();
    const existing = await this.getItems();
    existing.push(...items);
    const trimmed = existing.slice(-100);
    fs.writeFileSync(itemsPath(this.id), JSON.stringify(trimmed), 'utf-8');
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const items = await this.getItems();
    const popped = items.pop();
    fs.writeFileSync(itemsPath(this.id), JSON.stringify(items), 'utf-8');
    return popped;
  }

  async clearSession(): Promise<void> {
    try { fs.unlinkSync(itemsPath(this.id)); } catch { /* ignore */ }
    try { fs.unlinkSync(metaPath(this.id)); } catch { /* ignore */ }
  }

  // ── Metadata ────────────────────────────────────────────────────────────

  private getMeta(): SessionMeta {
    const p = metaPath(this.id);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { /* fall through */ }
    }
    return { name: 'New session', createdAt: Date.now(), displayItems: [] };
  }

  private saveMeta(meta: SessionMeta): void {
    ensureDir();
    fs.writeFileSync(metaPath(this.id), JSON.stringify(meta), 'utf-8');
  }

  getName(): string { return this.getMeta().name; }

  setName(name: string): void {
    const meta = this.getMeta();
    meta.name = name;
    this.saveMeta(meta);
  }

  // ── UI display items ──────────────────────────────────────────────────

  /** Add a UI display item (system messages, agent labels). */
  addDisplayItem(item: ConversationItem): void {
    const meta = this.getMeta();
    meta.displayItems.push(item);
    // Auto-name from first user message
    if (meta.name === 'New session' && item.type === 'user') {
      meta.name = item.text.length > 20 ? item.text.slice(0, 20) + '...' : item.text;
    }
    this.saveMeta(meta);
  }

  /** Get all UI display items for the frontend. */
  getDisplayItems(): ConversationItem[] {
    return this.getMeta().displayItems;
  }

  /** Append a user input to the input history. */
  addInputHistory(text: string): void {
    const meta = this.getMeta();
    if (!meta.inputHistory) meta.inputHistory = [];
    // Avoid consecutive duplicates
    if (meta.inputHistory[meta.inputHistory.length - 1] !== text) {
      meta.inputHistory.push(text);
    }
    this.saveMeta(meta);
  }

  /** Get user input history for up-arrow recall. */
  getInputHistory(): string[] {
    return this.getMeta().inputHistory || [];
  }

  /** Record the last error for debugging. */
  setLastError(error: string): void {
    const meta = this.getMeta();
    meta.lastError = error;
    this.saveMeta(meta);
  }

  /** Get the last recorded error. */
  getLastError(): string | undefined {
    return this.getMeta().lastError;
  }

  // ── Static helpers ────────────────────────────────────────────────────

  static create(): { id: string; name: string; items: ConversationItem[] } {
    ensureDir();
    const id = crypto.randomUUID();
    const meta: SessionMeta = { name: 'New session', createdAt: Date.now(), displayItems: [] };
    fs.writeFileSync(metaPath(id), JSON.stringify(meta), 'utf-8');
    return { id, name: meta.name, items: [] };
  }

  static delete(id: string): void {
    try { fs.unlinkSync(itemsPath(id)); } catch { /* ignore */ }
    try { fs.unlinkSync(metaPath(id)); } catch { /* ignore */ }
  }

  static list(): Array<{ id: string; name: string }> {
    ensureDir();
    const sessions: Array<{ id: string; name: string; createdAt: number }> = [];
    for (const file of fs.readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith('.meta.json')) continue;
      const id = file.replace('.meta.json', '');
      try {
        const meta: SessionMeta = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
        sessions.push({ id, name: meta.name, createdAt: meta.createdAt });
      } catch { /* skip corrupt */ }
    }
    return sessions.sort((a, b) => b.createdAt - a.createdAt).map(({ id, name }) => ({ id, name }));
  }

  static exists(id: string): boolean {
    return fs.existsSync(metaPath(id));
  }
}
