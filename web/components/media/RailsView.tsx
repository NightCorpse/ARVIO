"use client";

import type { Category, MediaItem } from "@/lib/types";
import { MediaRail } from "./MediaRail";

export function RailsView({ title, eyebrow, categories, onOpen }: {
  title: string;
  eyebrow?: string;
  categories: Category[];
  onOpen: (item: MediaItem) => void;
}) {
  return (
    <div className="screen">
      <section className="section-heading">
        <p className="eyebrow">{eyebrow ?? "Browse"}</p>
        <h2>{title}</h2>
      </section>
      {categories.map((category) => <MediaRail key={category.id} category={category} onOpen={onOpen} />)}
    </div>
  );
}
