"use client";

import { ListVideo, Play } from "lucide-react";
import { useApp } from "@/lib/store";
import { MediaRail } from "@/components/media/MediaRail";

export function HomeScreen() {
  const { hero, categories, openDetails } = useApp();

  return (
    <div className="screen">
      {hero && (
        <section className="hero" style={{ backgroundImage: hero.backdrop ? `url(${hero.backdrop})` : undefined }}>
          <div className="hero-copy">
            <p className="eyebrow">{hero.mediaType === "tv" ? "Series" : "Movie"} {hero.year ? `• ${hero.year}` : ""}</p>
            <h2>{hero.title}</h2>
            <p>{hero.overview || hero.subtitle || "Continue from your ARVIO library."}</p>
            <div className="hero-actions">
              <button className="primary" onClick={() => openDetails(hero)}><Play size={20} fill="currentColor" /> Play</button>
              <button className="secondary" onClick={() => openDetails(hero)}><ListVideo size={20} /> Sources</button>
            </div>
          </div>
        </section>
      )}
      {categories.map((category) => (
        <MediaRail key={category.id} category={category} onOpen={openDetails} />
      ))}
    </div>
  );
}
