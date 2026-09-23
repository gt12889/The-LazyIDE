import { deleteSecret, getSecretPresence, setSecret, type SecretPresence } from '../vault/vaultClient';

export const GO_LEGACY_KEY = 'lazygt.apikey.opencode-go';
export const GO_LEGACY_KEY_ID = 'legacy';
const GO_KEY_PREFIX = 'lazygt.apikey.opencode-go.';
const GO_KEYS_STORAGE = 'lazygt.go.keys';
const GO_SELECTED_KEY_STORAGE = 'lazygt.go.selectedKeyId';

export interface OpenCodeGoKeyRecord {
  id: string;
  name: string;
  hint?: string;
  createdAt: number;
  updatedAt: number;
  legacy?: boolean;
}

function now(): number { return Date.now(); }

export function goKeyVaultKey(id: string): string {
  return id === GO_LEGACY_KEY_ID ? GO_LEGACY_KEY : `${GO_KEY_PREFIX}${id}`;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function readStoredKeys(): OpenCodeGoKeyRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GO_KEYS_STORAGE) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): OpenCodeGoKeyRecord[] => {
      if (!item || typeof item !== 'object') return [];
      const rec = item as Partial<OpenCodeGoKeyRecord>;
      if (!rec.id || typeof rec.id !== 'string' || !rec.name || typeof rec.name !== 'string') return [];
      return [{
        id: safeId(rec.id),
        name: rec.name.trim() || 'OpenCode Go key',
        hint: typeof rec.hint === 'string' ? rec.hint : undefined,
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : now(),
        updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : now(),
      }];
    });
  } catch { return []; }
}

function writeStoredKeys(keys: OpenCodeGoKeyRecord[]): void {
  const customKeys = keys.filter(k => !k.legacy).map(k => ({ ...k, id: safeId(k.id), legacy: undefined }));
  localStorage.setItem(GO_KEYS_STORAGE, JSON.stringify(customKeys));
}

export function getSelectedGoKeyId(): string | undefined {
  try { return localStorage.getItem(GO_SELECTED_KEY_STORAGE) || undefined; } catch { return undefined; }
}

export function setSelectedGoKeyId(id: string): void {
  localStorage.setItem(GO_SELECTED_KEY_STORAGE, safeId(id));
}

export async function listOpenCodeGoKeys(): Promise<OpenCodeGoKeyRecord[]> {
  const keys = readStoredKeys();
  const legacy = await getSecretPresence(GO_LEGACY_KEY).catch((): SecretPresence => ({ present: false }));
  const visible = legacy.present
    ? [{ id: GO_LEGACY_KEY_ID, name: 'Default key', hint: legacy.hint, createdAt: 0, updatedAt: 0, legacy: true }, ...keys]
    : keys;
  const selected = getSelectedGoKeyId();
  if ((!selected || !visible.some(k => k.id === selected)) && visible[0]) setSelectedGoKeyId(visible[0].id);
  return visible;
}

export async function saveOpenCodeGoKey(input: { id?: string; name: string; value: string }): Promise<OpenCodeGoKeyRecord> {
  const value = input.value.trim();
  if (!value) throw new Error('Enter an OpenCode Go API key.');
  const id = safeId(input.id || `go_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`);
  if (id === GO_LEGACY_KEY_ID) throw new Error('Use a different key name for new keys.');
  await setSecret(goKeyVaultKey(id), value);
  const presence = await getSecretPresence(goKeyVaultKey(id));
  const existing = readStoredKeys().filter(k => k.id !== id);
  const timestamp = now();
  const record: OpenCodeGoKeyRecord = {
    id,
    name: input.name.trim() || `Go key ${existing.length + 1}`,
    hint: presence.hint,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  writeStoredKeys([...existing, record]);
  setSelectedGoKeyId(id);
  return record;
}

export async function renameOpenCodeGoKey(id: string, name: string): Promise<void> {
  if (id === GO_LEGACY_KEY_ID) return;
  const keys = readStoredKeys();
  writeStoredKeys(keys.map(k => k.id === id ? { ...k, name: name.trim() || k.name, updatedAt: now() } : k));
}

export async function deleteOpenCodeGoKey(id: string): Promise<void> {
  await deleteSecret(goKeyVaultKey(id));
  const keys = readStoredKeys().filter(k => k.id !== id);
  writeStoredKeys(keys);
  if (getSelectedGoKeyId() === id) {
    const remaining = await listOpenCodeGoKeys();
    if (remaining[0]) setSelectedGoKeyId(remaining[0].id);
    else localStorage.removeItem(GO_SELECTED_KEY_STORAGE);
  }
}
