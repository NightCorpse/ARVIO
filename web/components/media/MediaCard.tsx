"use client";

import { Clapperboard } from "lucide-react";
import type { MediaItem } from "@/lib/types";

export function MediaCard({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  return (
    <button className="media-card" onClick={() => onOpen(item)}>
      <div className="poster">
        {item.image ? <img src={item.image} alt="" /> : <Clapperboard size={42} />}
        {item.progress ? <span className="progress" style={{ width: `${item.progress}%` }} /> : null}
      </div>
      <strong>{item.title}</strong>
      <span>{item.subtitle || item.year || (item.mediaType === "tv" ? "TV Series" : "Movie")}</span>
    </button>
  );
}
