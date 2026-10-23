/** Explicit proof-process bootstrap. Imports never start the apparatus.
 * The plain first child is observed separately, never a measured collection.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { initializeDescriptorReservations } from "./reservations.ts";

type Observation = {
  ref: WeakRef<object>;
  seen: Set<WeakRef<object>>;
  registry: FinalizationRegistry<WeakRef<object>>;
};
type Startup = { ready: boolean; promise?: Promise<void>; observation?: Observation };
const key = Symbol.for("scout.numeric-witness.sentinel-startup.v1");
const reservationKey = Symbol.for("scout.numeric-witness.descriptor-reservations.v1");
const globals = globalThis as typeof globalThis & { [key]?: Startup; [reservationKey]?: unknown };

/** Only weak observations escape this frame, after exit AND close. */
async function sentinel(): Promise<Observation> {
  const seen = new Set<WeakRef<object>>();
  const registry = new FinalizationRegistry<WeakRef<object>>(ref => seen.add(ref));
  let ref: WeakRef<object> | undefined, count = 0;
  let child: ChildProcess | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rawSpawn = Bun.spawn;
  try {
    Bun.spawn = ((...args: unknown[]) => {
      const native = Reflect.apply(rawSpawn, Bun, args);
      count++;
      ref = new WeakRef(native);
      registry.register(native, ref);
      return native;
    }) as typeof Bun.spawn;
    try {
      child = spawn(process.execPath, ["--eval", ""], {stdio: "ignore", env: {PATH: process.env.PATH}});
    } finally { Bun.spawn = rawSpawn; }
    if (count !== 1 || !ref) throw Error("sentinel native subprocess observation failed");
    const exited = new Promise<number | null>((resolve, reject) => {
      child!.once("exit", resolve);
      child!.once("error", reject);
    });
    const closed = new Promise<void>(resolve => child!.once("close", () => resolve()));
    const lifecycle = Promise.all([exited, closed]);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("sentinel lifecycle timed out")), 3000);
    });
    const [code] = await Promise.race([lifecycle, timeout]);
    if (code !== 0) throw Error("sentinel child failed");
    return {ref, seen, registry};
  } finally {
    Bun.spawn = rawSpawn;
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    child = null;
  }
}

export async function startNumericWitnessProcess(): Promise<void> {
  const supported = typeof Bun !== "undefined" && Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4"
    && (process.platform === "darwin" && process.arch === "arm64" || process.platform === "linux" && process.arch === "x64");
  if (!supported) return;
  let state = globals[key];
  if (!state) {
    if (globals[reservationKey]) throw Error("sentinel startup requires uninitialized descriptor reservations");
    state = {ready: false};
    globals[key] = state;
    const startup = state;
    startup.promise = (async () => {
      startup.observation = await sentinel();
      console.log(JSON.stringify({event: "sentinel-ready", protocol: "sentinel-first/v1", spawnCount: 1, exitCode: 0, closeObserved: true, measured: false}));
      initializeDescriptorReservations();
      startup.ready = true;
    })();
  }
  if (!state.promise) throw Error("sentinel startup reentered");
  await state.promise; // A rejected startup stays rejected; never retry the child.
}

export function requireNumericWitnessStartup(): void {
  // Preserve the existing reader refusal pinned by inert-import tests.
  if (!globals[key]?.ready) throw Error("numeric spike requires explicit descriptor reservation startup");
}

/** Read only after a measured verdict. Never poll or wait for this target. */
export function numericWitnessSentinelStatus() {
  requireNumericWitnessStartup();
  const observation = globals[key]!.observation!;
  return {protocol: "sentinel-first/v1", spawnCount: 1, exitCode: 0, closeObserved: true,
    alive: observation.ref.deref() !== undefined, callback: observation.seen.has(observation.ref), measured: false};
}
