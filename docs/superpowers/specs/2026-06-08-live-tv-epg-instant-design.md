# Live TV — Instant ±48h EPG & Butter-Smooth Guide

**Date:** 2026-06-08
**Surface:** Android APK (Android TV + mobile), Compose. Backend on Supabase.
**Status:** Approved design, pending spec review.

## Goal

The Live TV guide must:
1. Show the EPG **together with the channels, near-instantly** (instant on revisit, fast on first visit).
2. Cover **past 48h and future 48h** of programming for every channel that has guide data.
3. **Navigate butter-smooth** (no recomposition stutter, no focus/scroll churn).
4. Keep **catch-up playback** working for past programs where the provider supports it.

## Non-goals

- Redesigning the Live TV visual language (the grid layout/tokens stay).
- Web Live TV page (`web/components/livetv`) — out of scope.
- New EPG sources/providers beyond what's already parsed (XMLTV + Xtream).

---

## Root cause analysis (current state)

### Why EPG "isn't fully loading"
1. **The SQLite index is populated from a lossy model.** `IptvEpgIndex.insertNowNextRows()`
   ([IptvEpgIndex.kt:210](../../../app/src/main/kotlin/com/arflix/tv/data/repository/IptvEpgIndex.kt)) only writes the
   compact `IptvNowNext` slice (now/next/later + `upcoming`≤96 + `recent`≤240). The table schema can hold a full window,
   but full per-channel program lists are never persisted.
2. **The grid reconstructs programs from the in-memory compact map**, not a real windowed query
   (`programsInWindow()` in [EpgGrid.kt:785](../../../app/src/main/kotlin/com/arflix/tv/ui/screens/tv/live/EpgGrid.kt)).
   A channel absent from the in-memory `nowNext` shows "Guide pending…/No guide data matched" even when data is on disk.
3. **`loadSnapshot()` is a ~460-line branching tangle** ([IptvRepository.kt:1361](../../../app/src/main/kotlin/com/arflix/tv/data/repository/IptvRepository.kt))
   (Xtream-short → XMLTV → full-Xtream → broad-Xtream) with coverage-target early-exits and large-list skips that
   frequently leave channels empty.
4. **Heavy XMLTV parse runs on the TV CPU** with a 300s timeout — slow and often partial/aborted on weak hardware.

### Why it lags
1. **`buildProgramPlacements`/`programsInWindow` are `remember`-keyed on `clockTickMillis`** — every clock tick recomputes
   placements for every visible row → recomposition storms.
2. **Channel windowing re-slices the list** (`onRequestPreviousChannels/Next`) → `remember(channels)` resets → focus/scroll
   churn + `delay()`-based focus-retry loops ([EpgGrid.kt:197-224](../../../app/src/main/kotlin/com/arflix/tv/ui/screens/tv/live/EpgGrid.kt)).
3. **Future window is only 24h** (`EpgFutureWindowMinutes = 24*60`) — does not meet the +48h requirement.

---

## Target architecture

### Decisions locked
- **Backend parses + caches EPG** (offload XMLTV/Xtream parsing off the TV CPU). Reuse Supabase.
- **Stale-while-revalidate** everywhere (instant on revisit, fast first paint).
- **Full timeline grid**, window **past 48h / future 48h**.
- **Catch-up** kept for past cells.
- **Private Xtream/EPG creds may be parsed server-side, cached under a per-user hashed key** (never shared cross-user).
- Build the whole thing as one spec, ship in **3 phases**.

### Component 1 — Backend EPG service (Supabase edge function `epg` + Postgres cache)

New Deno edge function `supabase/functions/epg/index.ts`, conventions copied from `tmdb-proxy`
(APP_ANON_KEY / Bearer auth, CORS allow-list, IP rate-limit, retry/backoff).

**Responsibilities**
- Input: a source descriptor — either `{ kind: "xmltv", url }` or `{ kind: "xtream", host, username, password }` —
  plus an optional `channels: string[]` (epg channel ids the caller wants) and optional `cursor`/`page` for chunking.
- Fetch + parse server-side, slice to `[now-48h, now+48h]`, dedupe (start/end/title), normalize times to UTC.
- Persist parsed rows to Postgres (see schema). Public XMLTV URLs are keyed by **normalized URL** so the parse is shared
  across all users. Xtream/private sources are keyed by a **per-user hash** that includes credentials + user id.
- Serve from cache when fresh (`expires_at` not passed); when stale, return cached rows immediately and trigger a
  background re-parse (service-level SWR). When no cache, parse inline.
- Output: compact gzipped JSON:
  ```json
  {
    "source": "<source_key>",
    "generatedAt": 1717843200,
    "windowStart": 1717670400,
    "windowEnd": 1718016000,
    "channels": { "<epgId>": [ { "s": 0, "e": 3600, "t": "Title", "d": "desc?" } ] }
  }
  ```
  `s`/`e` are **second offsets from `windowStart`** to shrink payload; `d` omitted when empty.
- Chunking: when `channels` is large or omitted, paginate by channel-id batches so the client can request the visible
  screenful first and backfill the rest.

**Postgres schema (new migration)**
```sql
create table epg_source (
  source_key   text primary key,
  kind         text not null,            -- 'xmltv' | 'xtream'
  owner_user   uuid null,                -- null = shared/public; set = per-user private
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  etag         text null,
  last_modified text null,
  status       text not null default 'ok'
);

create table epg_program (
  source_key      text not null references epg_source(source_key) on delete cascade,
  epg_channel_id  text not null,
  start_s         bigint not null,        -- epoch seconds
  end_s           bigint not null,
  title           text not null,
  descr           text null,
  primary key (source_key, epg_channel_id, start_s, end_s, title)
);
create index idx_epg_program_window on epg_program (source_key, epg_channel_id, start_s);
```
RLS: shared rows (`owner_user is null`) readable by any authenticated app key; private rows readable only by `owner_user`.
Writes happen via the edge function (service role).

**Scheduled warm refresh:** pg_cron job (or scheduled function) re-parses sources whose `expires_at` is near, every ~30 min,
for shared/public sources, so most client requests hit a warm cache → instant.

**Freshness windows:** `expires_at = fetched_at + 30 min` for the now-centred window; background refresh keeps the rolling
±48h current. Tunable via function env.

### Component 2 — Android data layer

- **`EpgRemoteService`** (OkHttp) → the `epg` function. Decodes the compact payload into
  `Map<epgChannelId, List<IptvProgram>>` (absolute millis reconstructed from `windowStart + s*1000`).
- **`IptvEpgIndex` v2** (DB version bump + migration that recreates the table):
  - Store **full** window rows (not derived from compact nowNext).
  - `replaceWindow(sourceKey, programsByChannel, windowStartMs, windowEndMs, fetchedAtMs)` — bulk upsert; prunes rows
    outside the rolling window.
  - `loadWindow(sourceKey, channelIds, startMs, endMs): Map<channelId, List<IptvProgram>>` — returns full programs.
  - Keep `loadNowNext(...)` for compact now/next badges in list views.
- **`IptvGuideRepository`** (new, extracted from `IptvRepository`): owns guide concerns only.
  - `warmGuideFromCache(window): Map<channelId, List<IptvProgram>>` — synchronous-ish index read for instant paint.
  - `fetchGuideForChannels(source, channelIds, window)` — calls backend, writes index v2, emits.
  - `refreshGuide(source, window)` — full ±48h background refresh; writes index; emits.
  - Owns channelId ↔ epgId mapping (reuse existing epgId/tvgName matching from `IptvRepository`).
  - Exposes a `StateFlow<GuideWindow>` the grid observes.
- **`IptvRepository`** keeps channel/playlist responsibility; the guide branches are removed from `loadSnapshot()` and
  delegated to `IptvGuideRepository`. (Targeted decomposition of the 376KB file, scoped to guide code only.)

### Component 3 — Grid rendering (smoothness)

- Grid consumes `Map<channelId, List<IptvProgram>>` (full window) from a `StateFlow`; remove reconstruction from now/next.
- **`EpgFutureWindowMinutes = 48 * 60`** (and backend window matches).
- **Decouple clock from layout:**
  - `programsInWindow` + `buildProgramPlacements` keyed only on `(channelId, programs, windowStart, windowEnd)` — never on
    `clockTickMillis`.
  - `isNow`/`isPast`/NOW-line position become tiny leaf composables reading the tick via `derivedStateOf`; cell layout does
    not recompute on tick.
  - Clock ticks once/minute for placement-relevant logic; the NOW-line `offset` may read a 1s tick (single value read).
- **Full-list `LazyColumn`** instead of re-sliced windows. Drive EPG fetch off a debounced (~150ms)
  `snapshotFlow { layoutInfo.visibleItemsInfo }` → request those channels' window (index-first, backend-fill). Keep paging
  only for extreme lists (>~50k channels).
- **Deterministic focus:** replace `delay()`-retry loops with `BringIntoViewRequester` + channelId-keyed `FocusRequester`s
  that survive data updates (key on `channelId`, not list identity).

### Component 4 — Loading orchestration (instant feel / SWR)

1. App start → `warmupFromCacheOnly()` paints channels (existing).
2. Immediately `loadWindow` from index for the first screenful → grid paints EPG **instantly** from cache.
3. In parallel `fetchGuideForChannels(visible)` → on response upsert index → grid updates.
4. On scroll, visible-range flow requests more channels (index-first, backend-fill).
5. Background `refreshGuide` keeps the rolling ±48h fresh. SWR at both client and service layers.

### Component 5 — Catch-up

Unchanged logic (`getCatchupUrl`, `resolvePlayableCatchupUrl`, `isCatchupSupported`, `canFocus`). The reliable past-48h
window now guarantees catch-up targets exist; past cells stay focusable/clickable when catch-up is supported.

---

## Data flow (happy path, revisit)

```
LiveTvScreen mount
  → ViewModel.warmupFromCacheOnly()         (channels painted)
  → GuideRepo.warmGuideFromCache(±48h)       (EPG painted instantly from IptvEpgIndex v2)
  → GuideRepo.fetchGuideForChannels(visible) ─HTTP→ epg function ─cache hit→ compact JSON
        → IptvEpgIndex.replaceWindow(...)    (StateFlow emits)
        → grid updates in place (no layout thrash; placements keyed on programs)
  → scroll → snapshotFlow(visible) debounced → loadWindow(index) + fetchGuideForChannels(new)
  → background GuideRepo.refreshGuide(±48h)
```

## Error handling

- Backend unreachable / 5xx / timeout → client falls back to **on-device parse** path (existing `loadSnapshot` EPG code is
  retained as fallback, not deleted, until Phase 3 proves the backend reliable). Cached index window still paints.
- Backend returns partial coverage → merge into index; missing channels show "Guide pending…" then resolve on refresh.
- Private Xtream parse failure server-side → fall back to on-device Xtream short-EPG (existing).
- Index migration failure → recreate table (acceptable: guide is a cache, repopulated from backend/cache on next load).

## Testing strategy

- **Backend:** unit tests for XMLTV parse + ±48h slicing + compact encoding; per-user vs shared keying; conditional
  (etag/last-modified) refresh; payload round-trip (encode→decode equals source within window).
- **Index v2:** `replaceWindow`/`loadWindow` round-trip; window pruning; large-list (50k channel) query latency under
  budget; migration from v1.
- **Grid:** placements do **not** recompute on clock tick (recomposition count assertion / snapshot test); future window =
  48h; full programs render; catch-up cells focusable.
- **Orchestration:** instant paint from cache (no network) test; SWR update test; visible-range debounced fetch test.
- **Manual UAT:** cold start, warm revisit, scroll smoothness on a real TV box; large Xtream list; offline.

## Phasing (each independently shippable)

- **Phase 1 — Fix "not loading":** `epg` edge function + Postgres schema/migration + scheduled warm; `EpgRemoteService`;
  `IptvEpgIndex` v2 (`replaceWindow`/`loadWindow`); `IptvGuideRepository`; grid reads the window; future→48h.
  *Exit:* complete ±48h guide appears for channels with data, sourced from backend+index.
- **Phase 2 — Fix lag:** decouple clock from layout; full-list `LazyColumn` + debounced visible-range fetch; deterministic
  focus. *Exit:* no recomposition storms on tick; smooth dpad/scroll; no focus churn on data updates.
- **Phase 3 — Instant everywhere:** scheduled-cache tuning, SWR polish, payload/virtualization tuning, retire the on-device
  broad-EPG fallback paths from `loadSnapshot` once backend reliability is proven.

## Open implementation notes

- Confirm the channelId↔epgId mapping is centralised in `IptvGuideRepository` so both index writes and backend requests use
  the same normalization.
- Decide payload size cap per request batch (target a screenful + lookahead, e.g. 60 channels) to keep responses small.
- pg_cron availability on the Supabase plan — if unavailable, use a scheduled edge function invocation instead.
