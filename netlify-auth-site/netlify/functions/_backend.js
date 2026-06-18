const { Pool } = require("pg");
const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-arvio-user-id,x-arvio-email"
};

let pool;

function getPool() {
  if (pool) return pool;
  const connectionString =
    process.env.NETLIFY_DB_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("NETLIFY_DB_URL is not configured");
  }
  pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX || 4),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000
  });
  return pool;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  };
}

function options(event) {
  return event.httpMethod === "OPTIONS" ? json(204, {}) : null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw);
}

function payloadMetrics(payload) {
  const root = typeof payload === "string" ? JSON.parse(payload) : payload;
  const profiles = Array.isArray(root.profiles) ? root.profiles : null;
  const profileCount = profiles ? profiles.length : null;
  const profileIds = new Set(
    (profiles || [])
      .map((profile) => profile && profile.id)
      .filter((id) => typeof id === "string" && id.length > 0)
  );
  const scopedKeys = [
    "profileSettingsById",
    "addonsByProfile",
    "catalogsByProfile",
    "hiddenPreinstalledByProfile",
    "hiddenAddonByProfile",
    "hiddenHomeServerByProfile",
    "iptvByProfile",
    "watchlistByProfile"
  ];
  const scopedCoverage = scopedKeys.reduce((total, key) => {
    const obj = root[key];
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return total;
    let count = 0;
    profileIds.forEach((profileId) => {
      if (Object.prototype.hasOwnProperty.call(obj, profileId)) count += 1;
    });
    return total + count;
  }, 0);

  const hasFullShape = scopedKeys.some((key) => Object.prototype.hasOwnProperty.call(root, key));
  const hasConfiguredState =
    (Array.isArray(root.addons) && root.addons.length > 0) ||
    Boolean(String(root.iptvM3uUrl || "").trim()) ||
    Object.values(root.addonsByProfile || {}).some((value) => Array.isArray(value) && value.length > 0) ||
    Object.values(root.watchlistByProfile || {}).some((value) => Array.isArray(value) && value.length > 0) ||
    Object.values(root.iptvByProfile || {}).some((value) => {
      if (!value || typeof value !== "object") return false;
      return Boolean(String(value.m3uUrl || "").trim()) ||
        Boolean(String(value.epgUrl || "").trim()) ||
        (Array.isArray(value.playlists) && value.playlists.length > 0) ||
        (Array.isArray(value.favoriteChannels) && value.favoriteChannels.length > 0) ||
        (Array.isArray(value.favoriteGroups) && value.favoriteGroups.length > 0);
    });

  let usefulProfiles = false;
  if (profileCount > 1) {
    usefulProfiles = true;
  } else if (profileCount === 1) {
    const profile = profiles[0] || {};
    usefulProfiles = !(
      String(profile.name || "").toLowerCase() === "profile 1" &&
      Number(profile.avatarId || 0) === 0 &&
      Number(profile.avatarImageVersion || 0) <= 0 &&
      !profile.isKidsProfile &&
      !profile.isLocked &&
      !String(profile.pin || "").trim()
    );
  }

  let restoreRank;
  if (profileCount !== null && profileCount <= 0) restoreRank = 0;
  else if (profileCount !== null && profileCount > 1 && hasFullShape) restoreRank = 80;
  else if (profileCount !== null && profileCount > 1) restoreRank = 70;
  else if ((usefulProfiles || hasConfiguredState) && hasFullShape) restoreRank = 50;
  else if (usefulProfiles || hasConfiguredState) restoreRank = 40;
  else if (profileCount === null && hasFullShape) restoreRank = 30;
  else if (profileCount === null) restoreRank = 20;
  else restoreRank = 10;

  return {
    payload: root,
    profileCount,
    scopedCoverage,
    restoreRank,
    payloadVersion: Number(root.version || 1),
    payloadUpdatedAt: Number(root.updatedAt || 0) > 0
      ? new Date(Number(root.updatedAt)).toISOString()
      : null
  };
}

function isExistingSnapshotRicher(existing, incoming) {
  if (!existing) return false;
  const existingRank = Number(existing.restore_rank ?? existing.restoreRank ?? 0);
  const existingProfilesRaw = existing.profile_count ?? existing.profileCount;
  const existingCoverage = Number(existing.scoped_coverage ?? existing.scopedCoverage ?? 0);

  if (existingRank > incoming.restoreRank) return true;
  if (existingRank < incoming.restoreRank) return false;

  const existingProfiles = existingProfilesRaw === null || existingProfilesRaw === undefined
    ? -1
    : Number(existingProfilesRaw);
  const incomingProfiles = incoming.profileCount === null || incoming.profileCount === undefined
    ? -1
    : Number(incoming.profileCount);
  if (existingProfiles > incomingProfiles) return true;
  if (existingProfiles < incomingProfiles) return false;

  return existingCoverage > incoming.scopedCoverage;
}

async function verifySupabaseToken(accessToken) {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase migration verifier is not configured");
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase token rejected (${response.status})`);
  }
  const user = await response.json();
  const id = user.id || user.sub;
  const email = normalizeEmail(user.email);
  if (!id || !email) {
    throw new Error("Supabase token has no usable user identity");
  }
  return { supabaseUserId: id, email };
}

function bearerToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function resolveIdentity(event) {
  const token = bearerToken(event);
  if (!token) {
    throw new Error("Missing Authorization bearer token");
  }
  return verifySupabaseToken(token);
}

function snapshotStores(event) {
  connectLambda(event);
  return {
    account: getStore("account-sync"),
    legacy: getStore("legacy-supabase-sync"),
    events: getStore("account-sync-events"),
    usage: getStore("app-usage")
  };
}

function snapshotKeys(identity) {
  const supabaseUserId = String(identity.supabaseUserId || "").trim();
  const email = normalizeEmail(identity.email);
  return {
    supabase: `supabase/${supabaseUserId}.json`,
    email: `email/${sha256(email)}.json`
  };
}

async function getJSONOrNull(store, key) {
  try {
    return await store.get(key, { type: "json", consistency: "strong" });
  } catch (error) {
    if (error?.status === 404 || error?.name === "BlobNotFoundError") return null;
    throw error;
  }
}

async function loadSnapshotFromBlobs(event, identity) {
  const stores = snapshotStores(event);
  const keys = snapshotKeys(identity);
  const accountSnapshot = await getJSONOrNull(stores.account, keys.supabase) ||
    await getJSONOrNull(stores.account, keys.email);
  if (accountSnapshot) return { ...accountSnapshot, source: accountSnapshot.source || "netlify" };

  const legacySnapshot = await getJSONOrNull(stores.legacy, keys.supabase) ||
    await getJSONOrNull(stores.legacy, keys.email);
  if (!legacySnapshot) return null;

  const claimed = {
    ...legacySnapshot,
    source: "supabase_import_claimed",
    claimedAt: new Date().toISOString()
  };
  await saveSnapshotToBlobs(event, identity, claimed);
  return claimed;
}

async function saveSnapshotToBlobs(event, identity, snapshot) {
  const stores = snapshotStores(event);
  const keys = snapshotKeys(identity);
  const normalized = {
    payload: snapshot.payload,
    payloadVersion: snapshot.payloadVersion ?? snapshot.payload_version ?? 1,
    restoreRank: snapshot.restoreRank ?? snapshot.restore_rank ?? 0,
    profileCount: snapshot.profileCount ?? snapshot.profile_count ?? null,
    scopedCoverage: snapshot.scopedCoverage ?? snapshot.scoped_coverage ?? 0,
    payloadUpdatedAt: snapshot.payloadUpdatedAt ?? snapshot.payload_updated_at ?? null,
    source: snapshot.source || "netlify",
    updatedAt: snapshot.updatedAt || new Date().toISOString()
  };
  const metadata = {
    email: normalizeEmail(identity.email),
    supabaseUserId: identity.supabaseUserId,
    restoreRank: String(normalized.restoreRank),
    profileCount: String(normalized.profileCount ?? ""),
    updatedAt: normalized.updatedAt
  };
  await stores.account.setJSON(keys.supabase, normalized, { metadata });
  await stores.account.setJSON(keys.email, normalized, { metadata });
  return normalized;
}

async function appendSnapshotEvent(event, identity, snapshot) {
  const stores = snapshotStores(event);
  const cursor = Date.now();
  const keys = snapshotKeys(identity);
  await stores.events.setJSON(`supabase/${identity.supabaseUserId}/${cursor}.json`, {
    event_id: cursor,
    scope: "snapshot",
    profile_id: "",
    entity_key: "account",
    operation: "upsert",
    payload: snapshot.payload,
    item_version: cursor,
    created_at: new Date(cursor).toISOString()
  }, {
    metadata: {
      supabaseUserId: identity.supabaseUserId,
      email: normalizeEmail(identity.email),
      accountKey: keys.supabase
    }
  });
  return cursor;
}

async function getOrCreateAccount(client, identity) {
  const email = normalizeEmail(identity.email);
  const existing = await client.query(
    `SELECT *
       FROM public.arvio_accounts
      WHERE supabase_user_id = $1 OR email_normalized = $2
      ORDER BY CASE WHEN supabase_user_id = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [identity.supabaseUserId, email]
  );
  if (existing.rows[0]) {
    const account = existing.rows[0];
    await client.query(
      `UPDATE public.arvio_accounts
          SET email = $2,
              email_normalized = $3,
              supabase_user_id = COALESCE(supabase_user_id, $1::uuid),
              updated_at = now(),
              last_seen_at = now()
        WHERE id = $4`,
      [identity.supabaseUserId, identity.email, email, account.id]
    );
    return { ...account, email: identity.email, email_normalized: email };
  }

  const inserted = await client.query(
    `INSERT INTO public.arvio_accounts (email, email_normalized, supabase_user_id, last_seen_at)
     VALUES ($1, $2, $3::uuid, now())
     RETURNING *`,
    [identity.email, email, identity.supabaseUserId]
  );
  return inserted.rows[0];
}

async function claimLegacySnapshotIfNeeded(client, account, identity) {
  const current = await client.query(
    `SELECT payload, payload_version, restore_rank, profile_count, scoped_coverage,
            payload_updated_at, updated_at, source
       FROM public.account_sync_snapshots
      WHERE account_id = $1`,
    [account.id]
  );
  if (current.rows[0]) return current.rows[0];

  const legacy = await client.query(
    `SELECT *
       FROM public.legacy_supabase_snapshots
      WHERE supabase_user_id = $1::uuid OR email_normalized = $2
      ORDER BY restore_rank DESC, profile_count DESC NULLS LAST, scoped_coverage DESC, payload_updated_at DESC NULLS LAST
      LIMIT 1`,
    [identity.supabaseUserId, normalizeEmail(identity.email)]
  );
  const row = legacy.rows[0];
  if (!row) return null;

  await client.query(
    `INSERT INTO public.account_sync_snapshots (
       account_id, payload, payload_version, restore_rank, profile_count,
       scoped_coverage, payload_updated_at, source, updated_at
     )
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, 'supabase_import', now())
     ON CONFLICT (account_id) DO NOTHING`,
    [
      account.id,
      JSON.stringify(row.payload),
      row.payload_version,
      row.restore_rank,
      row.profile_count,
      row.scoped_coverage,
      row.payload_updated_at
    ]
  );
  await client.query(
    `UPDATE public.legacy_supabase_snapshots
        SET claimed_account_id = $2,
            claimed_at = now()
      WHERE supabase_user_id = $1::uuid`,
    [identity.supabaseUserId, account.id]
  );

  return {
    payload: row.payload,
    payload_version: row.payload_version,
    restore_rank: row.restore_rank,
    profile_count: row.profile_count,
    scoped_coverage: row.scoped_coverage,
    payload_updated_at: row.payload_updated_at,
    updated_at: row.imported_at,
    source: "supabase_import"
  };
}

module.exports = {
  getPool,
  json,
  options,
  parseBody,
  payloadMetrics,
  isExistingSnapshotRicher,
  resolveIdentity,
  getOrCreateAccount,
  claimLegacySnapshotIfNeeded,
  normalizeEmail,
  sha256,
  snapshotStores,
  snapshotKeys,
  loadSnapshotFromBlobs,
  saveSnapshotToBlobs,
  appendSnapshotEvent
};
