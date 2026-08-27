import os from 'node:os';
import path from 'node:path';

/**
 * Runtime data must live outside the deployed source tree on managed hosts.
 * Hostinger replaces the website contents on every Node.js build, so a
 * project-local database/storage directory is suitable only for development.
 * DPO_RUNTIME_ROOT can be set explicitly when a host provides another
 * persistent directory.
 */
const configuredRoot = process.env.DPO_RUNTIME_ROOT?.trim();
const externalProductionRoot = process.env.NODE_ENV === 'production' && process.env.PGLITE_MEMORY !== '1';
const root = configuredRoot
  ? (path.isAbsolute(configuredRoot) ? configuredRoot : path.resolve(process.cwd(), configuredRoot))
  : externalProductionRoot
    ? path.join(process.env.HOME || os.homedir(), '.dpo-digital-dak-runtime')
    : process.cwd();

export const runtimeRoot = path.resolve(root);
export const dataRoot = path.join(runtimeRoot, 'data');
export const storageRoot = path.join(runtimeRoot, 'storage');
export const snapshotPath = path.join(dataRoot, 'pglite-data.tar');
export const usingExternalRuntimeRoot = runtimeRoot !== path.resolve(process.cwd());

export function storagePath(type: string, name: string) {
  return path.join(storageRoot, ['ORIGINAL', 'SUPPORTING'].includes(type) ? 'originals' : 'derived', path.basename(name));
}

export function signaturePath(name: string) {
  return path.join(storageRoot, 'signatures', path.basename(name));
}
