"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getStreams, installAddon as installAddonManifest, loadLocalAddons, saveLocalAddons } from "./addons";
import { AuthClient } from "./auth";
import { defaultCatalogs, mergeCatalogs } from "./catalogs";
import { getContinueWatching, pullCloudPayload, saveCloudAddons, saveCloudSettings } from "./cloud";
import { loadIptvSnapshot, loadPlaylists, savePlaylists } from "./iptv";
import { dedupeMedia, historyToItem, hydrateTraktItems, traktItemToMedia, traktPlaybackToMedia } from "./mappers";
import { loadStored, saveStored } from "./storage";
import { getDetails, loadHomeCategories, searchMedia } from "./tmdb";
import { TraktClient, type TraktDeviceCode } from "./trakt";
import type {
  AppSettings,
  AuthSession,
  Category,
  InstalledAddon,
  IptvChannel,
  IptvPlaylistEntry,
  IptvSnapshot,
  MediaItem,
  NavSection,
  StreamSource
} from "./types";

export const authClient = new AuthClient();
export const traktClient = new TraktClient();

const settingsKey = "arvio.web.settings";

export const defaultSettings: AppSettings = {
  defaultSubtitle: "en",
  secondarySubtitle: "",
  subtitleSize: 100,
  subtitleColor: "#ffffff",
  subtitleOffsetMs: 0,
  removeHearingImpaired: true,
  aiSubtitlesEnabled: false,
  aiSubtitleModel: "off",
  autoPlayNext: true,
  skipProfileSelection: false,
  cardDensity: "comfortable",
  language: "en-US",
  dnsProvider: "system",
  catalogs: defaultCatalogs,
  hiddenCatalogIds: [],
  disabledAddonIds: [],
  iptvPlaylists: [],
  favoriteChannelIds: [],
  favoriteGroupIds: [],
  hiddenGroupIds: [],
  groupOrder: []
};

const emptyIptv: IptvSnapshot = {
  channels: [],
  grouped: {},
  nowNext: {},
  favoriteGroups: [],
  favoriteChannels: [],
  hiddenGroups: [],
  groupOrder: [],
  loadedAt: 0
};

export interface AppStore {
  section: NavSection;
  setSection: (section: NavSection) => void;
  categories: Category[];
  continueWatching: MediaItem[];
  watchlist: MediaItem[];
  hero: MediaItem | null;
  selected: MediaItem | null;
  streams: StreamSource[];
  activeStream: StreamSource | null;
  activeChannel: IptvChannel | null;
  addons: InstalledAddon[];
  iptvSnapshot: IptvSnapshot;
  query: string;
  setQuery: (value: string) => void;
  results: MediaItem[];
  settings: AppSettings;
  setSettings: (next: AppSettings) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  auth: AuthSession | null;
  traktConnected: boolean;
  deviceCode: TraktDeviceCode | null;
  busy: string;
  toast: string | null;
  setToast: (value: string | null) => void;

  refreshData: () => Promise<void>;
  openDetails: (item: MediaItem) => Promise<void>;
  closeDetails: () => void;
  playStream: (stream: StreamSource) => void;
  playChannel: (channel: IptvChannel) => void;
  closePlayer: () => void;
  installAddon: (url: string) => Promise<void>;
  removeAddon: (addon: InstalledAddon) => Promise<void>;
  setAddonsState: (next: InstalledAddon[]) => Promise<void>;
  signIn: (email: string, password: string, mode: "sign-in" | "sign-up") => Promise<void>;
  signOut: () => void;
  beginTrakt: () => Promise<void>;
  pollTrakt: () => Promise<void>;
  disconnectTrakt: () => void;
}

const AppContext = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const store = useContext(AppContext);
  if (!store) throw new Error("useApp must be used within <AppProvider>");
  return store;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [section, setSection] = useState<NavSection>("home");
  const [categories, setCategories] = useState<Category[]>([]);
  const [continueWatching, setContinueWatching] = useState<MediaItem[]>([]);
  const [watchlist, setWatchlist] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [streams, setStreams] = useState<StreamSource[]>([]);
  const [activeStream, setActiveStream] = useState<StreamSource | null>(null);
  const [activeChannel, setActiveChannel] = useState<IptvChannel | null>(null);
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [iptvSnapshot, setIptvSnapshot] = useState<IptvSnapshot>(emptyIptv);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = loadStored<AppSettings>(settingsKey, defaultSettings);
    return {
      ...defaultSettings,
      ...stored,
      iptvPlaylists: loadPlaylists(),
      catalogs: mergeCatalogs(stored.catalogs, stored.hiddenCatalogIds)
    };
  });
  const [auth, setAuth] = useState(() => authClient.session);
  const [traktConnected, setTraktConnected] = useState(() => traktClient.isConnected);
  const [deviceCode, setDeviceCode] = useState<TraktDeviceCode | null>(null);
  const [busy, setBusy] = useState("Loading ARVIO");
  const [toast, setToast] = useState<string | null>(null);

  const hero = selected ?? continueWatching[0] ?? categories[0]?.items[0] ?? null;

  // Refs so stable callbacks always read the latest values without re-creating.
  const addonsRef = useRef(addons);
  useEffect(() => {
    addonsRef.current = addons;
  }, [addons]);

  const deviceCodeRef = useRef(deviceCode);
  useEffect(() => {
    deviceCodeRef.current = deviceCode;
  }, [deviceCode]);

  const persistAddons = useCallback(async (next: InstalledAddon[]) => {
    setAddons(next);
    saveLocalAddons(next);
    await saveCloudAddons(authClient, next).catch(() => undefined);
  }, []);

  const refreshData = useCallback(async () => {
    setBusy("Syncing catalogs");
    try {
      const localAddons = loadLocalAddons();
      const cloud = authClient.session ? await pullCloudPayload(authClient).catch(() => null) : null;
      const mergedAddons = cloud?.addons?.length ? cloud.addons : localAddons;
      const addonState = mergedAddons.map((addon) => ({
        ...addon,
        enabled: !settings.disabledAddonIds.includes(addon.id) && addon.enabled !== false
      }));
      setAddons(addonState);
      saveLocalAddons(mergedAddons);

      const effectiveCatalogs = mergeCatalogs(settings.catalogs, settings.hiddenCatalogIds);
      const [homeRows, historyRows, traktRows, playbackRows, loadedIptv] = await Promise.all([
        loadHomeCategories(settings.language, effectiveCatalogs),
        authClient.session ? getContinueWatching(authClient).catch(() => []) : Promise.resolve([]),
        traktClient.isConnected ? traktClient.watchlist().catch(() => []) : Promise.resolve([]),
        traktClient.isConnected ? traktClient.playback().catch(() => []) : Promise.resolve([]),
        loadIptvSnapshot(
          settings.iptvPlaylists,
          settings.favoriteChannelIds,
          settings.favoriteGroupIds,
          settings.hiddenGroupIds,
          settings.groupOrder
        )
      ]);

      const cloudCw = historyRows.map(historyToItem);
      const traktCw = playbackRows.map(traktPlaybackToMedia);
      const cw = dedupeMedia([...cloudCw, ...traktCw]);
      setContinueWatching(cw);
      setWatchlist(await hydrateTraktItems(traktRows.map(traktItemToMedia)));
      setCategories(cw.length ? [{ id: "continue_watching", title: "Continue Watching", items: cw }, ...homeRows] : homeRows);
      setIptvSnapshot(loadedIptv);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to load ARVIO");
    } finally {
      setBusy("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.language,
    settings.iptvPlaylists,
    settings.catalogs,
    settings.hiddenCatalogIds,
    settings.disabledAddonIds,
    settings.favoriteChannelIds,
    settings.favoriteGroupIds,
    settings.hiddenGroupIds,
    settings.groupOrder
  ]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    saveStored(settingsKey, settings);
    savePlaylists(settings.iptvPlaylists);
    void saveCloudSettings(authClient, settings, addons).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setResults(await searchMedia(query, settings.language).catch(() => []));
    }, 260);
    return () => clearTimeout(handle);
  }, [query, settings.language]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const openDetails = useCallback(async (item: MediaItem) => {
    setBusy("Opening details");
    const detailed = await getDetails(item).catch(() => item);
    setSelected(detailed);
    setBusy("Finding sources");
    const found = await getStreams(addonsRef.current, detailed).catch(() => []);
    setStreams(found);
    setBusy("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeDetails = useCallback(() => setSelected(null), []);

  const playStream = useCallback((stream: StreamSource) => {
    if (!stream.url) {
      setToast("This source is not web-playable yet. Browser playback needs a direct HTTP/HLS URL.");
      return;
    }
    setActiveStream(stream);
  }, []);

  const playChannel = useCallback((channel: IptvChannel) => {
    setActiveChannel(channel);
    setActiveStream({
      source: channel.name,
      addonName: "Live TV",
      quality: "Live",
      size: "",
      url: channel.streamUrl,
      description: channel.group
    });
  }, []);

  const closePlayer = useCallback(() => {
    setActiveStream(null);
    setActiveChannel(null);
  }, []);

  const installAddon = useCallback(async (url: string) => {
    const addon = await installAddonManifest(url);
    const next = [addon, ...addonsRef.current.filter((candidate) => candidate.id !== addon.id)];
    await persistAddons(next);
  }, [persistAddons]);

  const removeAddon = useCallback(async (addon: InstalledAddon) => {
    const next = addonsRef.current.filter((candidate) => candidate.id !== addon.id);
    await persistAddons(next);
  }, [persistAddons]);

  const setAddonsState = useCallback(async (next: InstalledAddon[]) => {
    await persistAddons(next);
    setSettings((prev) => ({
      ...prev,
      disabledAddonIds: next.filter((addon) => addon.enabled === false).map((addon) => addon.id)
    }));
  }, [persistAddons]);

  const signIn = useCallback(async (email: string, password: string, mode: "sign-in" | "sign-up") => {
    const session = mode === "sign-up" ? await authClient.signUp(email, password) : await authClient.signIn(email, password);
    setAuth(session);
    await refreshData();
  }, [refreshData]);

  const signOut = useCallback(() => {
    authClient.signOut();
    setAuth(null);
  }, []);

  const beginTrakt = useCallback(async () => {
    setDeviceCode(await traktClient.beginDeviceLink());
  }, []);

  const pollTrakt = useCallback(async () => {
    const code = deviceCodeRef.current;
    if (!code) return;
    await traktClient.pollDeviceToken(code.device_code);
    setTraktConnected(true);
    setDeviceCode(null);
    await refreshData();
  }, [refreshData]);

  const disconnectTrakt = useCallback(() => {
    traktClient.disconnect();
    setTraktConnected(false);
  }, []);

  const value = useMemo<AppStore>(() => ({
    section,
    setSection,
    categories,
    continueWatching,
    watchlist,
    hero,
    selected,
    streams,
    activeStream,
    activeChannel,
    addons,
    iptvSnapshot,
    query,
    setQuery,
    results,
    settings,
    setSettings,
    updateSettings,
    auth,
    traktConnected,
    deviceCode,
    busy,
    toast,
    setToast,
    refreshData,
    openDetails,
    closeDetails,
    playStream,
    playChannel,
    closePlayer,
    installAddon,
    removeAddon,
    setAddonsState,
    signIn,
    signOut,
    beginTrakt,
    pollTrakt,
    disconnectTrakt
  }), [
    section, categories, continueWatching, watchlist, hero, selected, streams, activeStream, activeChannel,
    addons, iptvSnapshot, query, results, settings, auth, traktConnected, deviceCode, busy, toast,
    updateSettings, refreshData, openDetails, closeDetails, playStream, playChannel, closePlayer,
    installAddon, removeAddon, setAddonsState, signIn, signOut, beginTrakt, pollTrakt, disconnectTrakt
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
