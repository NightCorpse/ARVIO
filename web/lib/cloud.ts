import type { AuthClient } from "./auth";
import type { AppSettings, InstalledAddon, WatchHistoryEntry } from "./types";

export interface CloudPayload {
  version: number;
  addons: InstalledAddon[];
  settings?: Partial<AppSettings>;
  updatedAt: number;
}

export async function pullCloudPayload(auth: AuthClient): Promise<CloudPayload> {
  if (!auth.session) return { version: 1, addons: [], updatedAt: 0 };
  const rows = await auth.supabase<Array<{ payload?: string | null }>>(
    `/rest/v1/account_sync_state?user_id=eq.${auth.session.userId}&select=user_id,payload,updated_at`
  );
  const raw = rows[0]?.payload;
  if (!raw) return { version: 1, addons: [], updatedAt: 0 };
  try {
    return JSON.parse(raw) as CloudPayload;
  } catch {
    return { version: 1, addons: [], updatedAt: 0 };
  }
}

export async function saveCloudAddons(auth: AuthClient, addons: InstalledAddon[]) {
  if (!auth.session) return;
  const payload: CloudPayload = { version: 1, addons, updatedAt: Date.now() / 1000 };
  await auth.supabase("/rest/v1/account_sync_state", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: auth.session.userId,
      payload: JSON.stringify(payload),
      updated_at: new Date().toISOString()
    })
  });
}

export async function saveCloudSettings(auth: AuthClient, settings: AppSettings, addons: InstalledAddon[]) {
  if (!auth.session) return;
  const payload: CloudPayload = { version: 2, addons, settings, updatedAt: Date.now() / 1000 };
  await auth.supabase("/rest/v1/account_sync_state", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: auth.session.userId,
      payload: JSON.stringify(payload),
      updated_at: new Date().toISOString()
    })
  });
}

export async function getContinueWatching(auth: AuthClient) {
  if (!auth.session) return [];
  return auth.supabase<WatchHistoryEntry[]>(
    `/rest/v1/watch_history?user_id=eq.${auth.session.userId}&progress=lt.0.9&select=*&order=updated_at.desc&limit=50`
  );
}

export async function saveProgress(auth: AuthClient, entry: Omit<WatchHistoryEntry, "user_id">) {
  if (!auth.session) return;
  await auth.supabase("/rest/v1/watch_history", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      ...entry,
      user_id: auth.session.userId,
      paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
}

export async function markWatched(auth: AuthClient, entry: Omit<WatchHistoryEntry, "user_id" | "progress" | "position_seconds">) {
  await saveProgress(auth, {
    ...entry,
    progress: 1,
    position_seconds: entry.duration_seconds
  });
}
