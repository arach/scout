/** Process-startup test apparatus. No candidate, native-library or FFI imports.
 * Preload in proof processes, before test-created asynchronous descriptor work.
 * A changed prefix refuses; this is not an OS-wide descriptor-allocation lock.
 */
import { constants, closeSync, fstatSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReclaimIdentity, ReclaimVictim, WitnessEvent } from "../../packages/cli/src/cli/extension-descriptor-witness.ts";

import type { ApparatusControl } from "./apparatus-contract.ts";
const FRONTIER = 128;
export function reservationIdentity(fd: number): ReclaimIdentity | null {
  try { const s = fstatSync(fd); return {dev:s.dev, ino:s.ino, file:s.isFile(), socket:s.isSocket(), fifo:s.isFIFO()}; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EBADF") return null; throw error; }
}
const same = (a: ReclaimIdentity | null, b: ReclaimIdentity | null) => a !== null && b !== null
  && a.dev === b.dev && a.ino === b.ino && a.file === b.file && a.socket === b.socket && a.fifo === b.fifo;
// Deliberately escaped ONLY by the retained-pin negative control. Never a
// positive root, never part of the scaffold/channel; cleared by its caller.
let escapedSetupPin: object[] | undefined;
export function setupPinEscaped() { return escapedSetupPin !== undefined; }
export function clearEscapedSetupPin() { escapedSetupPin = undefined; }

type End = {fd:number; close():void};
type Pair = {parent:End; child:End};
export class DescriptorReservations {
  readonly root = mkdtempSync(join(tmpdir(), "scout-reservations-"));
  readonly baseline = new Map<number, ReclaimIdentity>();
  readonly owned = new Map<number, ReclaimVictim>();
  readonly active = new Map<number, ReclaimIdentity>();
  readonly slots: readonly [number,number,number,number];
  readonly controlResidues: ReclaimVictim[] = [];
  #serial = 0;
  #busy = false;
  #tainted = false;
  constructor() {
    try {
      // Snapshot before opening guards. Each open is an owned regular file;
      // bounded fill establishes a prefix, never searches for a reuse outcome.
      for (let fd=0; fd<=FRONTIER; fd++) { const id=reservationIdentity(fd); if(id) this.baseline.set(fd,id); }
      for (let n=0; n<=FRONTIER; n++) {
        const victim=this.#open();
        if(victim.fd>FRONTIER) { closeSync(victim.fd); break; }
        this.owned.set(victim.fd,victim);
      }
      const choices=[...this.owned.keys()].filter(fd=>fd>=8).sort((a,b)=>a-b).slice(-4);
      if(choices.length!==4) throw Error("channel reservation startup failed");
      this.slots=choices as [number,number,number,number];
      this.audit();
    } catch(error) {this.dispose();throw error;}
  }
  #open(): ReclaimVictim {
    // Fixed audited platform open flags; avoid any FFI priming at startup.
    const cloexec=process.platform==="darwin" ? 0x1000000 : 0x80000;
    const fd=openSync(join(this.root,`guard-${this.#serial++}`),constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|cloexec);
    const identity=reservationIdentity(fd);
    if(!identity?.file) throw Error("channel reservation identity failed");
    return {fd,identity};
  }
  #release(fd:number) {
    const file=this.owned.get(fd);
    if(!file || !same(file.identity,reservationIdentity(fd))) throw Error("channel reservation prefix changed");
    closeSync(fd);this.owned.delete(fd);
  }
  #reclaim(fd:number) {
    if(reservationIdentity(fd)!==null) throw Error("former pipe number was not reclaimed");
    const victim=this.#open();
    this.owned.set(victim.fd,victim); // Own even an unexpected result; never close a foreign FD.
    if(victim.fd!==fd) throw Error("former pipe number was not reclaimed");
    this.active.delete(fd);
    return victim;
  }
  audit() {
    for(let fd=0; fd<=this.slots[3]; fd++) {
      const expected=this.owned.get(fd)?.identity ?? this.active.get(fd) ?? this.baseline.get(fd);
      if(!expected || !same(expected,reservationIdentity(fd))) throw Error("channel reservation prefix changed");
    }
  }
  begin(emit:(e:WitnessEvent)=>void) {
    if(this.#busy || this.#tainted) throw Error("channel reservation process unavailable");
    this.audit();this.#busy=true;
    emit({event:"reservation-startup",stage:"module-initialization",frontier:FRONTIER,slots:this.slots,
      inherited:[...this.baseline].map(([fd,identity])=>({fd,identity})),guards:[...this.owned.values()],candidatePrimed:false});
  }
  prepare(compile:()=>void,flags:(fd:number)=>number,emit:(e:WitnessEvent)=>void,control?:ApparatusControl) {
    const plant=(event:string)=>{
      const fd=[...this.owned.keys()].find(fd=>fd>=8 && fd<this.slots[0]);
      if(fd===undefined) throw Error("channel reservation control setup failed");
      const old=this.owned.get(fd)!;
      if(!same(old.identity,reservationIdentity(fd))) throw Error("channel reservation prefix changed");
      closeSync(fd);
      const replacement=this.#open();this.controlResidues.push(replacement);
      if(replacement.fd!==fd) throw Error("channel reservation control setup failed");
      // Deliberately KEEP the old expected identity. Never adopt/repair residue.
      emit({event,iteration:0,fd,expected:old.identity,actual:replacement.identity});
    };
    if(control==="low-prefix-interference") plant("prefix-interference-planted");
    this.audit();
    compile(); // One compile-only seam call, while EVERY low guard stays occupied.
    if(control==="compile-residue") plant("compile-residue-planted");
    this.verifyGuardFlags(flags); // libc flag helper loads outside the hole window too.
    this.audit();
    emit({event:"post-prepare-prefix-audit",slots:this.slots,intact:true,compilationSeparated:true});
  }
  end(success:boolean) {this.#busy=false;if(!success)this.#tainted=true;}
  victims(former:readonly number[]) {
    return former.map(fd=>{
      const victim=this.owned.get(fd);
      if(!victim || !same(victim.identity,reservationIdentity(fd))) throw Error("former pipe number was not reclaimed");
      return victim;
    });
  }
  handoff = (victims:ReclaimVictim[]) => {
    for(const victim of victims) if(!same(this.owned.get(victim.fd)?.identity??null,victim.identity)
      || !same(victim.identity,reservationIdentity(victim.fd))) throw Error("former pipe number was not reclaimed");
  };
  /** The sole strong setup roots live in THIS synchronous frame. The caller
   * supplies WeakRefs only; no target is returned or stored on this instance. */
  allocate<T extends Pair>(factory:()=>T, refs:readonly WeakRef<object>[], iteration:number,
    emit:(e:WitnessEvent)=>void, control?:ApparatusControl, clearControlSeed?:()=>void):T {
    const pins:object[]=[];
    for(const ref of refs) {const target=ref.deref();if(target!==undefined)pins.push(target); }
    try {
      clearControlSeed?.();
      emit({event:"setup-pin-acquired",iteration,count:pins.length});
      this.audit();
      if(control==="above-frontier-churn") {
        const file=this.#open();
        if(file.fd<=this.slots[3]) throw Error("channel reservation prefix changed");
        closeSync(file.fd);emit({event:"above-frontier-churn",iteration,fd:file.fd,identity:file.identity});
      }
      if(control==="released-guard" && iteration===1) {
        const extra=[...this.owned.keys()].find(fd=>fd>=8 && fd<this.slots[0]);
        if(extra===undefined) throw Error("channel reservation control setup failed");
        this.#release(extra);emit({event:"guard-released",iteration,fd:extra});
      }
      const occupied=control==="occupied-parent" && iteration===1;
      for(const fd of this.slots) if(!(occupied && fd===this.slots[3])) this.#release(fd);
      const pair=factory(); // Exactly ONE genuine factory call; no await/search/remapping.
      this.active.set(pair.parent.fd,reservationIdentity(pair.parent.fd)!);
      this.active.set(pair.child.fd,reservationIdentity(pair.child.fd)!);
      // The occupied-T control must reach the original iteration-1 reuse
      // assertion, not a synthetic failure here. It still checks actual ports.
      emit({event:"reservation-allocation-observed",iteration,ports:[pair.parent.fd,pair.child.fd],slots:this.slots,occupied,observed:this.slots.map(fd=>({fd,identity:reservationIdentity(fd)}))});
      if(!occupied && (pair.parent.fd!==this.slots[3] || pair.child.fd!==this.slots[2]))
        throw Error("channel reservation placement failed");
      for(const fd of this.slots.slice(0,2)) this.#reclaim(fd);
      emit({event:"reservation-placement",iteration,ports:[pair.parent.fd,pair.child.fd],slots:this.slots,occupied});
      return pair;
    } finally {
      if(control==="retained-setup-pin" && iteration===1) {
        if(!pins.length) throw Error("channel reservation control setup failed");
        escapedSetupPin=pins;emit({event:"setup-pin-escaped",iteration,count:pins.length,seedCleared:true});
      } else pins.length=0;
      emit({event:"setup-pin-cleared",iteration,pinCleared:escapedSetupPin!==pins});
    }
  }
  observeClose<T extends Pair>(pair:T, emit:(e:WitnessEvent)=>void, control?:ApparatusControl) {
    const ports=[pair.parent.fd,pair.child.fd];
    const closed=(fd:number, code?:number)=>{
      if(code!==undefined && code!==0) throw Error("former pipe number was not reclaimed");
      const victim=this.#reclaim(fd);
      emit({event:"close-to-victim",fd,closeResult:code??0,identity:victim.identity});
    };
    const driver=(pair.parent as unknown as {driver?:{close(fd:number):number}}).driver;
    if(driver) {
      const original=driver.close;
      driver.close=fd=>{
        if(!ports.includes(fd)) throw Error("channel reservation unexpected close");
        if(control==="suppressed-close" && fd===pair.child.fd) {
          emit({event:"source-close-suppressed",fd,identity:reservationIdentity(fd)});
          closed(fd,0);return 0;
        }
        const result=original(fd);closed(fd,result);return result;
      };
      return ()=>{driver.close=original;};
    }
    // Blocking spike's owners use real closeSync rather than an adapter driver.
    const parent=pair.parent.close,child=pair.child.close;
    pair.parent.close=()=>{parent();closed(pair.parent.fd);};
    pair.child.close=()=>{child();closed(pair.child.fd);};
    return ()=>{pair.parent.close=parent;pair.child.close=child;};
  }
  verifyGuardFlags(flags:(fd:number)=>number) {
    for(const {fd} of this.owned.values()) if(flags(fd)!==1) throw Error("CLOEXEC copy discipline failed");
  }
  dispose() {
    for(const {fd,identity} of this.owned.values()) if(same(identity,reservationIdentity(fd))) closeSync(fd);
    for(const {fd,identity} of this.controlResidues) if(same(identity,reservationIdentity(fd))) closeSync(fd);
    this.owned.clear();rmSync(this.root,{recursive:true,force:true});
  }
}
// Preloading and importing share this instance, including in a test realm.
const key=Symbol.for("scout.numeric-witness.descriptor-reservations.v1");
const globals=globalThis as typeof globalThis & {[key]?:DescriptorReservations};
/** Explicit proof startup only. Never called by a reader or an env switch. */
export function initializeDescriptorReservations(): DescriptorReservations | undefined {
  const supported=typeof Bun!=="undefined" && Bun.revision==="0d9b296af33f2b851fcbf4df3e9ec89751734ba4"
    && (process.platform==="darwin" && process.arch==="arm64" || process.platform==="linux" && process.arch==="x64");
  if (!supported) return undefined;
  if (!globals[key]) {
    const reservations = new DescriptorReservations();
    globals[key] = reservations;
    process.once("exit", () => reservations.dispose());
  }
  return globals[key];
}
/** Fail closed before startup; never reserve descriptors as a read side effect. */
export function readDescriptorReservations(): DescriptorReservations {
  const reservations = globals[key];
  if (!reservations) throw Error("numeric spike requires explicit descriptor reservation startup");
  return reservations;
}
