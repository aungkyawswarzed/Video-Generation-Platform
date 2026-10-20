import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Project, Job, Media, Catalog } from './types';
import { projectSchema } from './types';
import { demoProject } from './project';

export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.STUDIO_DATA_DIR || path.join(process.cwd(), 'data'),
);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(path.join(dataDir, 'media'), { recursive: true });
mkdirSync(path.join(dataDir, 'renders'), { recursive: true });
const globalDb = globalThis as unknown as { frameDb?: DatabaseSync };
export const db = (globalDb.frameDb ??= new DatabaseSync(path.join(dataDir, 'studio.sqlite')));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, project_id TEXT, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, job_id TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS job_project ON jobs(project_id);
`);
const keyPath = path.join(dataDir, '.encryption-key');
if (!existsSync(keyPath)) {
  try {
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (!existsSync(keyPath)) throw e;
  }
}
const encryptionKey = readFileSync(keyPath);
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function setting(key: string): string | undefined {
  return (
    db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  )?.value;
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, value);
}
export function setApiKey(value: string) {
  if (!value) {
    db.prepare('DELETE FROM settings WHERE key=?').run('apiKey');
    return;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  setSetting('apiKey', Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'));
}
function decryptApiKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const stored = setting('apiKey');
  if (!stored) return;
  const bytes = Buffer.from(stored, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
}
export function apiKey(): string | undefined {
  try {
    return decryptApiKey();
  } catch {
    return undefined;
  }
}
export function credentialWarning(): string | undefined {
  try {
    decryptApiKey();
  } catch {
    return 'The saved API key could not be decrypted. Your projects are intact. Restore the original workspace encryption key from a backup, or save your OpenRouter API key again in Settings.';
  }
}
export function projects(): Project[] {
  return (
    db.prepare('SELECT json FROM projects ORDER BY rowid DESC').all() as { json: string }[]
  ).map((r) => projectSchema.parse(JSON.parse(r.json)));
}
export function getProject(id: string): Project {
  const row = db.prepare('SELECT json FROM projects WHERE id=?').get(id) as
    { json: string } | undefined;
  if (!row) throw new Error('Project not found');
  return projectSchema.parse(JSON.parse(row.json));
}
export function createProject(p: Project) {
  db.prepare('INSERT INTO projects VALUES (?,?,?)').run(p.id, p.revision, JSON.stringify(p));
  setSetting('lastProjectId', p.id);
  return p;
}
export function saveProject(p: Project): Project {
  return transaction(() => {
    const old = getProject(p.id);
    if (old.revision !== p.revision)
      throw new Error('Conflict: project changed in another tab. Reload before saving.');
    db.prepare('INSERT INTO revisions(project_id,json) VALUES (?,?)').run(
      p.id,
      JSON.stringify(old),
    );
    const next = { ...p, revision: p.revision + 1, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE projects SET revision=?,json=? WHERE id=?').run(
      next.revision,
      JSON.stringify(next),
      p.id,
    );
    db.prepare(
      'DELETE FROM revisions WHERE project_id=? AND id NOT IN (SELECT id FROM revisions WHERE project_id=? ORDER BY id DESC LIMIT 30)',
    ).run(p.id, p.id);
    return next;
  });
}
export function jobs(projectId?: string): Job[] {
  const rows = projectId
    ? db.prepare('SELECT json FROM jobs WHERE project_id=? ORDER BY rowid DESC').all(projectId)
    : db.prepare('SELECT json FROM jobs ORDER BY rowid DESC').all();
  return (rows as { json: string }[]).map((r) => JSON.parse(r.json));
}
export function getJob(id: string): Job {
  const row = db.prepare('SELECT json FROM jobs WHERE id=?').get(id) as
    { json: string } | undefined;
  if (!row) throw new Error('Job not found');
  return JSON.parse(row.json);
}
export function putJob(job: Job) {
  db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?,?,?)').run(
    job.id,
    job.projectId,
    job.status,
    JSON.stringify(job),
  );
}
export function patchJob(id: string, change: Partial<Job>) {
  const next = { ...getJob(id), ...change, updatedAt: new Date().toISOString() };
  putJob(next);
  return next;
}
export function allMedia(projectId: string): Media[] {
  return (
    db.prepare('SELECT json FROM media WHERE project_id=? ORDER BY rowid DESC').all(projectId) as {
      json: string;
    }[]
  ).map((r) => JSON.parse(r.json));
}
export function getMedia(id: string): Media {
  const row = db.prepare('SELECT json FROM media WHERE id=?').get(id) as
    { json: string } | undefined;
  if (!row) throw new Error('Media not found');
  return JSON.parse(row.json);
}
export function putMedia(media: Media) {
  db.prepare('INSERT INTO media VALUES (?,?,?)').run(
    media.id,
    media.projectId,
    JSON.stringify(media),
  );
}
export function mediaPath(id: string) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid media identifier');
  return path.join(dataDir, 'media', id);
}
export function cachedCatalog(): Catalog | undefined {
  const value = setting('catalog');
  return value ? JSON.parse(value) : undefined;
}
transaction(() => {
  if (!db.prepare('SELECT id FROM projects LIMIT 1').get()) createProject(demoProject());
});
