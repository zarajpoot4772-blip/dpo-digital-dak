import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { getDb, persistDb, usingExternalPostgres } from './db';
import { dataRoot, runtimeRoot, snapshotPath, storageRoot } from './runtime-paths';

const MAX_FILES = 5000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const STORAGE_FOLDERS = ['originals', 'derived', 'signatures'] as const;
export const backupDirectory = path.join(runtimeRoot, 'backups');

type BackupEntries = Record<string, Uint8Array>;

function cleanName(name: string) {
  return path.basename(name).replace(/[\\/\r\n]/g, '');
}

async function readStorageEntries(entries: BackupEntries) {
  let totalBytes = entries['data/pglite-data.tar']?.byteLength || 0;
  let fileCount = Object.keys(entries).length;
  for (const folder of STORAGE_FOLDERS) {
    const directory = path.join(storageRoot, folder);
    let items: import('node:fs').Dirent[] = [];
    try { items = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      if (!item.isFile() || item.name === '.gitkeep') continue;
      const name = cleanName(item.name);
      if (!name || name === '.' || name === '..') continue;
      if (++fileCount > MAX_FILES) throw new Error('Backup contains too many files');
      const bytes = new Uint8Array(await fs.readFile(path.join(directory, name)));
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('Backup is larger than the 500 MB prototype limit');
      entries[`storage/${folder}/${name}`] = bytes;
    }
  }
}

export async function ensureDailyBackup() {
  if (process.env.PGLITE_MEMORY === '1') return { created: false, name: null };
  await fs.mkdir(backupDirectory, { recursive: true });
  const name = `automatic-${new Date().toISOString().slice(0, 10)}.zip`;
  const target = path.join(backupDirectory, name);
  if (await exists(target)) return { created: false, name };
  const bytes = await createBackupBytes();
  try {
    await fs.writeFile(target, bytes, { flag: 'wx' });
    return { created: true, name };
  } catch (error: any) {
    if (error?.code === 'EEXIST') return { created: false, name };
    throw error;
  }
}

export async function listBackupFiles() {
  await fs.mkdir(backupDirectory, { recursive: true });
  const items = await fs.readdir(backupDirectory, { withFileTypes: true });
  const files = [];
  for (const item of items) {
    if (!item.isFile() || !item.name.endsWith('.zip')) continue;
    const stat = await fs.stat(path.join(backupDirectory, item.name));
    files.push({ name: item.name, size: stat.size, modified_at: stat.mtime.toISOString(), automatic: item.name.startsWith('automatic-') });
  }
  return files.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 50);
}

export async function createBackupBytes() {
  await getDb();
  const entries: BackupEntries = {};
  if (usingExternalPostgres) {
    // A managed PostgreSQL server owns its durability: the database is backed
    // up and restored by the administrator with pg_dump/WAL/PITR. The ZIP
    // still protects the private original/derived/signature files.
    entries['manifest.json'] = strToU8(JSON.stringify({
      format: 'dpo-digital-dak-backup',
      format_version: 1,
      engine: 'postgresql',
      created_at: new Date().toISOString(),
      includes: ['originals', 'converted', 'approved', 'signatures'],
      note: 'PostgreSQL deployment backup: private document files only. Back up and restore the database with department-approved pg_dump/PITR procedures. Keep this file in an approved secure location.'
    }, null, 2));
  } else {
    await persistDb();
    const db = await getDb();
    let databaseBytes: Uint8Array;
    try {
      databaseBytes = new Uint8Array(await fs.readFile(snapshotPath));
    } catch {
      const dump = await (db as any).dumpDataDir();
      databaseBytes = new Uint8Array(await dump.arrayBuffer());
    }
    entries['manifest.json'] = strToU8(JSON.stringify({
      format: 'dpo-digital-dak-backup',
      format_version: 1,
      engine: 'pglite',
      created_at: new Date().toISOString(),
      includes: ['database', 'originals', 'converted', 'approved', 'signatures'],
      note: 'Private prototype backup. Keep this file in an approved secure location.'
    }, null, 2));
    entries['data/pglite-data.tar'] = databaseBytes;
  }
  await readStorageEntries(entries);
  return Buffer.from(zipSync(entries, { level: 6 }));
}

function validateEntryName(name: string) {
  if (name === 'manifest.json' || name === 'data/pglite-data.tar') return;
  if (!/^storage\/(originals|derived|signatures)\/[^/]+$/.test(name)) {
    throw new Error('Backup contains an unsupported file path');
  }
  const leaf = name.split('/').pop() || '';
  if (!leaf || leaf === '.' || leaf === '..' || leaf.includes('..')) throw new Error('Backup contains an unsafe filename');
}

function parseBackup(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > 300 * 1024 * 1024) throw new Error('Backup ZIP must be between 1 byte and 300 MB');
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('Backup ZIP could not be opened'); }
  const names = Object.keys(files);
  if (!names.length || names.length > MAX_FILES) throw new Error('Backup contains an invalid number of files');
  let total = 0;
  for (const name of names) {
    validateEntryName(name);
    total += files[name].byteLength;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('Backup expands beyond the 500 MB prototype limit');
  }
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('Backup is missing its manifest');
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(manifestBytes)); } catch { throw new Error('Backup manifest is invalid'); }
  if (manifest?.format !== 'dpo-digital-dak-backup' || manifest?.format_version !== 1) throw new Error('Backup was not created by this DPO Digital Dak system');
  const isPostgresqlBackup = manifest?.engine === 'postgresql';
  const databaseBytes = files['data/pglite-data.tar'];
  if (!isPostgresqlBackup && !databaseBytes) throw new Error('Backup is missing its database snapshot');
  return { files, databaseBytes, manifest };
}

async function exists(target: string) {
  try { await fs.access(target); return true; } catch { return false; }
}

export async function restoreBackupBytes(bytes: Uint8Array) {
  const { files, databaseBytes, manifest } = parseBackup(bytes);
  if (manifest?.engine !== 'pglite') {
    throw new Error('PostgreSQL deployment backups contain document files only; restore the database with the administrator using department-approved pg_dump/PITR archives');
  }
  const restoreId = crypto.randomUUID();
  const staging = await fs.mkdtemp(path.join(runtimeRoot, `restore-${restoreId}-`));
  const stagingData = path.join(staging, 'data');
  const stagingStorage = path.join(staging, 'storage');
  await fs.mkdir(stagingData, { recursive: true });
  for (const folder of STORAGE_FOLDERS) await fs.mkdir(path.join(stagingStorage, folder), { recursive: true });
  await fs.writeFile(path.join(stagingData, 'pglite-data.tar'), databaseBytes, { flag: 'wx' });
  for (const name of Object.keys(files)) {
    if (!name.startsWith('storage/')) continue;
    const [, folder, leaf] = name.split('/');
    await fs.writeFile(path.join(stagingStorage, folder, leaf), files[name], { flag: 'wx' });
  }

  const oldData = path.join(runtimeRoot, `data-before-restore-${restoreId}`);
  const oldStorage = path.join(runtimeRoot, `storage-before-restore-${restoreId}`);
  let movedData = false;
  let movedStorage = false;
  let installedData = false;
  let installedStorage = false;
  try {
    if (await exists(dataRoot)) { await fs.rename(dataRoot, oldData); movedData = true; }
    if (await exists(storageRoot)) { await fs.rename(storageRoot, oldStorage); movedStorage = true; }
    await fs.rename(stagingData, dataRoot); installedData = true;
    await fs.rename(stagingStorage, storageRoot); installedStorage = true;
    await fs.rm(oldData, { recursive: true, force: true });
    await fs.rm(oldStorage, { recursive: true, force: true });
  } catch (error) {
    if (installedData) await fs.rm(dataRoot, { recursive: true, force: true });
    if (installedStorage) await fs.rm(storageRoot, { recursive: true, force: true });
    if (movedData && !(await exists(dataRoot))) await fs.rename(oldData, dataRoot);
    if (movedStorage && !(await exists(storageRoot))) await fs.rename(oldStorage, storageRoot);
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return { restoredFiles: Object.keys(files).length, databaseBytes: databaseBytes.byteLength };
}
