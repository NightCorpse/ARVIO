"use client";

import { BadgeCheck, Bookmark, Clapperboard, Play, Trash2, UserCircle, X } from "lucide-react";
import { config } from "@/lib/config";
import { saveProgress } from "@/lib/cloud";
import { authClient, traktClient, useApp } from "@/lib/store";
import { MediaCard } from "@/components/media/MediaCard";
import type { MediaItem, StreamSource } from "@/lib/types";

export function DetailsDrawer() {
  const { selected: item, streams, closeDetails, openDetails, playStream } = useApp();
  if (!item) return null;
  return <DetailsDrawerView item={item} streams={streams} onClose={closeDetails} onOpen={openDetails} onPlay={playStream} />;
}

function DetailsDrawerView({ item, streams, onClose, onOpen, onPlay }: {
  item: MediaItem;
  streams: StreamSource[];
  onClose: () => void;
  onOpen: (item: MediaItem) => void;
  onPlay: (stream: StreamSource) => void;
}) {
  const playableCount = streams.filter((stream) => Boolean(stream.url)).length;
  return (
    <aside className="details-drawer">
      <button className="close" onClick={onClose} aria-label="Close"><X size={22} /></button>
      <div className="detail-backdrop" style={{ backgroundImage: item.backdrop ? `url(${item.backdrop})` : undefined }} />
      <div className="detail-body">
        <p className="eyebrow">{item.mediaType === "tv" ? "Series" : "Movie"} {item.rating ? `• ${item.rating}` : ""}</p>
        <h2>{item.title}</h2>
        <p>{item.overview || "No overview available."}</p>
        <div className="chips">
          {item.year && <span>{item.year}</span>}
          {item.duration && <span>{item.duration}</span>}
          <span>{playableCount}/{streams.length} web playable</span>
        </div>
        <div className="detail-actions">
          <button className="primary" onClick={() => streams[0] && onPlay(streams[0])}><Play size={18} fill="currentColor" /> Play best</button>
          <button className="secondary text-button" onClick={() => traktClient.addToWatchlist({ mediaType: item.mediaType, tmdbId: item.id }).catch(() => undefined)}><Bookmark size={18} /> Watchlist</button>
          <button className="secondary text-button" onClick={() => traktClient.removeFromWatchlist({ mediaType: item.mediaType, tmdbId: item.id }).catch(() => undefined)}><Trash2 size={18} /> Remove</button>
          <button className="secondary text-button" onClick={() => {
            void saveProgress(authClient, {
              media_type: item.mediaType,
              show_tmdb_id: item.id,
              title: item.title,
              progress: 1,
              duration_seconds: 1,
              position_seconds: 1,
              backdrop_path: item.backdrop?.replace(config.backdropBase, "") ?? null,
              poster_path: item.image?.replace(config.imageBase, "") ?? null
            }).catch(() => undefined);
            void traktClient.scrobble("stop", { mediaType: item.mediaType, tmdbId: item.id, progress: 100 }).catch(() => undefined);
          }}><BadgeCheck size={18} /> Watched</button>
        </div>
        <div className="source-list">
          {streams.length === 0 && <p className="empty">No web-playable sources found from installed addons yet.</p>}
          {streams.map((stream, index) => (
            <button key={`${stream.addonId}-${index}`} className="source-row" onClick={() => onPlay(stream)}>
              <div>
                <strong>{stream.source}</strong>
                <span>{stream.addonName} {stream.description ? `• ${stream.description}` : ""}</span>
              </div>
              <span className="quality">{stream.quality || "HD"}</span>
            </button>
          ))}
        </div>
        {item.trailerUrl && (
          <a className="trailer-link" href={item.trailerUrl} target="_blank" rel="noreferrer">
            <Play size={18} fill="currentColor" /> Watch trailer
          </a>
        )}
        {item.seasons?.length ? (
          <section className="detail-section">
            <h3>Seasons</h3>
            <div className="mini-strip">
              {item.seasons.map((season) => (
                <article className="mini-card" key={season.id}>
                  {season.poster ? <img src={season.poster} alt="" /> : <Clapperboard size={28} />}
                  <strong>{season.name}</strong>
                  <span>{season.episodeCount ?? 0} episodes</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {item.cast?.length ? (
          <section className="detail-section">
            <h3>Cast</h3>
            <div className="mini-strip">
              {item.cast.map((person) => (
                <article className="mini-card person" key={person.id}>
                  {person.image ? <img src={person.image} alt="" /> : <UserCircle size={30} />}
                  <strong>{person.name}</strong>
                  <span>{person.character || "Cast"}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {item.related?.length ? (
          <section className="detail-section related">
            <h3>More Like This</h3>
            <div className="rail-strip compact">
              {item.related.map((related) => <MediaCard key={`related-${related.mediaType}-${related.id}`} item={related} onOpen={onOpen} />)}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
