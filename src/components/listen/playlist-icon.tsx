import {
  BookOpen, Brain, Briefcase, Car, Coffee, Disc, Drum, Dumbbell, Flame, Footprints, Guitar, Headphones, Heart, House,
  Leaf, ListMusic, Mic, Moon, Mountain, Music, Piano, Plane, Radio, Sparkles, Star, Sun, Waves, Zap, type LucideIcon,
} from "lucide-react";
import type { PlaylistIcon } from "@/lib/listen";
import { cn } from "@/lib/utils";
import { Artwork } from "./player-bar";

export const playlistIcons: Record<PlaylistIcon, LucideIcon> = {
  "list-music": ListMusic, music: Music, headphones: Headphones, mic: Mic, radio: Radio, disc: Disc, guitar: Guitar,
  piano: Piano, drum: Drum, heart: Heart, star: Star, sparkles: Sparkles, flame: Flame, zap: Zap, sun: Sun, moon: Moon,
  coffee: Coffee, brain: Brain, "book-open": BookOpen, briefcase: Briefcase, dumbbell: Dumbbell, footprints: Footprints,
  car: Car, plane: Plane, leaf: Leaf, mountain: Mountain, waves: Waves, house: House,
};

/** A playlist's square: the icon Luke picked, else its first item's artwork, else a list icon. */
export function PlaylistCover({
  playlist,
  className,
}: {
  playlist: { icon: string | null; artworkUrl?: string | null };
  className?: string;
}) {
  const Icon = playlist.icon ? playlistIcons[playlist.icon as PlaylistIcon] : null;
  if (!Icon && playlist.artworkUrl) return <Artwork episode={{ artworkUrl: playlist.artworkUrl }} className={className} />;
  const Shown = Icon ?? ListMusic;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-muted", Icon ? "text-foreground" : "text-icon", className)} aria-hidden>
      <Shown className="size-1/2" />
    </span>
  );
}
