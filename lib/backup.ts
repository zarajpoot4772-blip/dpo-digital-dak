import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { getDb, persistDb } from './db';
import { dataRoot, runtimeRoot, snapshotPath, storageRoot } from './runtime-paths';

const MAX_FILES = 5000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const STORAGE_FOLDERS = ['originals', 'derived', 'signatures'] as const;

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

export async function createBackupBytes() {
  const db = await getDb();
  await persistDb();
  let databaseBytes: Uint8Array;
  try {
    databaseBytes = new Uint8Array(await fs.readFile(snapshotPath));
  } catch {
    const dump = await db.dumpDataDir();
    databaseBytes = new Uint8Array(await dump.arrayBuffer());
  }
  const entries: BackupEntries = {
    'manifest.json': strToU8(JSON.stringify({
      format: 'dpo-digital-dak-backup',
      format_version: 1,
      created_at: new Date().toISOString(),
      includes: ['database', 'originals', 'converted', 'approved', 'signatures'],
      note: 'Private prototype backup. Keep this file in an approved secure location.'
    }, null, 2)),
    'data/pglite-data.tar': databaseBytes
  };
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
  const databaseBytes = files['data/pglite-data.tar'];
  if (!manifestBytes || !databaseBytes) throw new Error('Backup is missing its manifest or database snapshot');
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(manifestBytes)); } catch { throw new Error('Backup manifest is invalid'); }
  if (manifest?.format !== 'dpo-digital-dak-backup' || manifest?.format_version !== 1) throw new Error('Backup was not created by this DPO Digital Dak system');
  return { files, databaseBytes };
}

async function exists(target: string) {
  try { await fs.access(target); return true; } catch { return false; }
}

export async function restoreBackupBytes(bytes: Uint8Array) {
  const { files, databaseBytes } = parseBackup(bytes);
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
