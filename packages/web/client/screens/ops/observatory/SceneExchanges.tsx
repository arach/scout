import { useId } from "react";
import type { FloorExchange } from "../floor-exchanges.ts";
import { floorCharacterName } from "../floor-character-name.ts";
import type { Scene } from "./scene-model.ts";
import type { Pick } from "./scene-interaction.ts";
import styles from "./ObservatoryFloor.module.css";

/** One quiet path per actual exchange, bounded when nothing is being inspected. */
export function SceneExchanges({ scene, exchanges, focus, onOpen }: {
  scene: Scene; exchanges: FloorExchange[]; focus: Pick | null;
  onOpen: (pair: [string, string]) => void;
}) {
  const marker = useId();
  const actors = new Map(scene.islands.flatMap(island => island.actors.map(actor => [actor.lane.id, { ...actor, x: island.x + actor.x, y: island.y + actor.y, island: island.id }] as const)));
  const relevant = (id: string) => {
    const actor = actors.get(id);
    return !!focus && !!actor && (focus.kind === "actor" ? id === focus.id : actor.island === focus.island && (focus.kind === "island" || actor.room === focus.id));
  };
  const visible = exchanges.filter(edge => actors.has(edge.from) && actors.has(edge.to) && (!focus || relevant(edge.from) || relevant(edge.to))).slice(0, focus ? 24 : 12);
  return <svg className={styles.exchanges} width="1" height="1" aria-label="Recent communication">
    <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="currentColor" /></marker></defs>
    {visible.map(edge => {
      const last = edge.messages.at(-1)!;
      const a = actors.get(last.from)!, b = actors.get(last.to)!;
      const path = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 60} ${b.x} ${b.y}`;
      const label = `Messages between ${floorCharacterName(a.lane).label} and ${floorCharacterName(b.lane).label}`;
      return <g key={edge.id} role="button" tabIndex={0} aria-label={label} data-scene-ui="true" data-emphasized={!!focus || undefined} onClick={() => onOpen([edge.from, edge.to])} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen([edge.from, edge.to]); } }}>
        <title>{label}</title><path className={styles.exchangeLine} d={path} markerEnd={`url(#${marker})`} /><path className={styles.exchangeHit} d={path} />
      </g>;
    })}
  </svg>;
}
