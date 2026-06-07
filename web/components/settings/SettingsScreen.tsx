"use client";

import { Captions, Eye, EyeOff, LogOut, Network, Plus, RotateCcw, Trash2, UserCircle } from "lucide-react";
import { useState } from "react";
import { mergeCatalogs, defaultCatalogs } from "@/lib/catalogs";
import { hasSupabaseConfig, hasTraktConfig } from "@/lib/config";
import { defaultSettings, useApp } from "@/lib/store";
import type { AppSettings, CatalogConfig } from "@/lib/types";

const settingsKey = "arvio.web.settings";

export function SettingsScreen() {
  const {
    auth, settings, traktConnected, deviceCode, addons,
    installAddon, setAddonsState, setSettings,
    signIn, signOut, beginTrakt, pollTrakt, disconnectTrakt
  } = useApp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const catalogs = mergeCatalogs(settings.catalogs, settings.hiddenCatalogIds);
  const [customCatalogUrl, setCustomCatalogUrl] = useState("");
  const [addonUrl, setAddonUrl] = useState("");

  const onSettings = (next: AppSettings) => setSettings(next);

  const updateCatalogs = (next: CatalogConfig[]) => onSettings({
    ...settings,
    catalogs: next,
    hiddenCatalogIds: next.filter((catalog) => !catalog.enabled).map((catalog) => catalog.id)
  });

  const moveCatalog = (id: string, offset: number) => {
    const index = catalogs.findIndex((catalog) => catalog.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= catalogs.length) return;
    const next = [...catalogs];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    updateCatalogs(next);
  };

  return (
    <div className="screen settings-grid">
      <section className="settings-panel">
        <p className="eyebrow">Cloud</p>
        <h2>ARVIO Account</h2>
        {!hasSupabaseConfig() && <p className="empty">Supabase env is missing. Add values in `web/.env.local` or deployment secrets.</p>}
        {auth ? (
          <div className="account-row">
            <UserCircle size={34} />
            <div><strong>{auth.email}</strong><span>{auth.userId}</span></div>
            <button className="secondary" onClick={signOut}><LogOut size={18} /> Sign out</button>
          </div>
        ) : (
          <div className="login-form">
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
            <div className="hero-actions">
              <button className="primary" onClick={() => signIn(email, password, "sign-in")}>Sign in</button>
              <button className="secondary" onClick={() => signIn(email, password, "sign-up")}>Create</button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-panel">
        <p className="eyebrow">Sync</p>
        <h2>Trakt</h2>
        {!hasTraktConfig() && <p className="empty">Trakt client id is missing.</p>}
        {traktConnected ? (
          <button className="secondary" onClick={disconnectTrakt}>Disconnect Trakt</button>
        ) : (
          <>
            <button className="primary" onClick={beginTrakt}>Start device link</button>
            {deviceCode && (
              <div className="device-code">
                <span>{deviceCode.user_code}</span>
                <p>Open {deviceCode.verification_url}</p>
                <button className="secondary" onClick={pollTrakt}>I approved it</button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="settings-panel">
        <p className="eyebrow">Playback</p>
        <h2>Preferences</h2>
        <label className="setting-row">
          <span>Auto play next episode</span>
          <input type="checkbox" checked={settings.autoPlayNext} onChange={(event) => onSettings({ ...settings, autoPlayNext: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Default subtitle</span>
          <input value={settings.defaultSubtitle} onChange={(event) => onSettings({ ...settings, defaultSubtitle: event.target.value })} />
        </label>
        <label className="setting-row">
          <span>Secondary subtitle</span>
          <input value={settings.secondarySubtitle} onChange={(event) => onSettings({ ...settings, secondarySubtitle: event.target.value })} />
        </label>
        <label className="setting-row">
          <span>Subtitle size</span>
          <input type="number" min={60} max={180} value={settings.subtitleSize} onChange={(event) => onSettings({ ...settings, subtitleSize: Number(event.target.value) })} />
        </label>
        <label className="setting-row">
          <span>Subtitle color</span>
          <input type="color" value={settings.subtitleColor} onChange={(event) => onSettings({ ...settings, subtitleColor: event.target.value })} />
        </label>
        <label className="setting-row">
          <span>Subtitle offset ms</span>
          <input type="number" value={settings.subtitleOffsetMs} onChange={(event) => onSettings({ ...settings, subtitleOffsetMs: Number(event.target.value) })} />
        </label>
        <label className="setting-row">
          <span>Remove hearing impaired subtitles</span>
          <input type="checkbox" checked={settings.removeHearingImpaired} onChange={(event) => onSettings({ ...settings, removeHearingImpaired: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>TMDB language</span>
          <input value={settings.language} onChange={(event) => onSettings({ ...settings, language: event.target.value })} />
        </label>
      </section>

      <section className="settings-panel wide-panel">
        <p className="eyebrow">Catalogs</p>
        <h2>Home Rows</h2>
        <div className="inline-form">
          <input value={customCatalogUrl} onChange={(event) => setCustomCatalogUrl(event.target.value)} placeholder="https://mdblist.com/lists/user/list" />
          <button className="primary" onClick={() => {
            if (!customCatalogUrl.trim()) return;
            const id = `custom_${crypto.randomUUID()}`;
            updateCatalogs([{ id, name: "Custom MDBList", sourceType: "mdblist", mediaType: "all", sourceUrl: customCatalogUrl.trim(), enabled: true }, ...catalogs]);
            setCustomCatalogUrl("");
          }}><Plus size={18} /> Add catalog</button>
          <button className="secondary text-button" onClick={() => updateCatalogs(defaultCatalogs)}><RotateCcw size={18} /> Reset</button>
        </div>
        <div className="settings-list">
          {catalogs.map((catalog) => (
            <div className="settings-list-row" key={catalog.id}>
              <button className="icon-button" onClick={() => updateCatalogs(catalogs.map((c) => c.id === catalog.id ? { ...c, enabled: !c.enabled } : c))}>
                {catalog.enabled ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
              <input value={catalog.name} onChange={(event) => updateCatalogs(catalogs.map((c) => c.id === catalog.id ? { ...c, name: event.target.value } : c))} />
              <span>{catalog.sourceType.toUpperCase()}</span>
              <button className="icon-button" onClick={() => moveCatalog(catalog.id, -1)}>↑</button>
              <button className="icon-button" onClick={() => moveCatalog(catalog.id, 1)}>↓</button>
              {!catalog.isPreinstalled && <button className="icon-button danger" onClick={() => updateCatalogs(catalogs.filter((c) => c.id !== catalog.id))}><Trash2 size={18} /></button>}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-panel wide-panel">
        <p className="eyebrow">Sources</p>
        <h2>Installed Addons</h2>
        <div className="inline-form">
          <input value={addonUrl} onChange={(event) => setAddonUrl(event.target.value)} placeholder="https://addon.example.com/manifest.json" />
          <button className="primary" onClick={async () => {
            if (!addonUrl.trim()) return;
            await installAddon(addonUrl);
            setAddonUrl("");
          }}><Plus size={18} /> Install</button>
        </div>
        <div className="settings-list">
          {addons.map((addon) => (
            <div className="settings-list-row" key={addon.id}>
              <button className="icon-button" onClick={() => setAddonsState(addons.map((a) => a.id === addon.id ? { ...a, enabled: a.enabled === false } : a))}>
                {addon.enabled === false ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <strong>{addon.name}</strong>
              <span>{addon.resources.join(", ") || "manifest"}</span>
              <span>{addon.catalogs.length} catalogs</span>
            </div>
          ))}
          {addons.length === 0 && <p className="empty">Install Stremio-compatible addons from the Addons page.</p>}
        </div>
      </section>

      <section className="settings-panel">
        <p className="eyebrow">Network</p>
        <h2>DNS & AI</h2>
        <label className="setting-row">
          <span><Network size={18} /> DNS provider</span>
          <select value={settings.dnsProvider} onChange={(event) => onSettings({ ...settings, dnsProvider: event.target.value as AppSettings["dnsProvider"] })}>
            <option value="system">System</option>
            <option value="cloudflare">Cloudflare</option>
            <option value="google">Google</option>
            <option value="quad9">Quad9</option>
          </select>
        </label>
        <label className="setting-row">
          <span><Captions size={18} /> AI subtitles</span>
          <input type="checkbox" checked={settings.aiSubtitlesEnabled} onChange={(event) => onSettings({ ...settings, aiSubtitlesEnabled: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>AI model</span>
          <select value={settings.aiSubtitleModel} onChange={(event) => onSettings({ ...settings, aiSubtitleModel: event.target.value as AppSettings["aiSubtitleModel"] })}>
            <option value="off">Off</option>
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
      </section>

      <section className="settings-panel">
        <p className="eyebrow">Profiles</p>
        <h2>Privacy & Data</h2>
        <label className="setting-row">
          <span>Skip profile selection</span>
          <input type="checkbox" checked={settings.skipProfileSelection} onChange={(event) => onSettings({ ...settings, skipProfileSelection: event.target.checked })} />
        </label>
        <button className="secondary text-button" onClick={() => {
          localStorage.removeItem(settingsKey);
          onSettings(defaultSettings);
        }}><Trash2 size={18} /> Clear web settings</button>
      </section>
    </div>
  );
}
