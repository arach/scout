/** Negative control: imports must not start any apparatus. Never a transport positive. */
import {fstatSync} from "node:fs";
export async function checkInertImports() {
  const descriptors = () => {
    const entries: Array<[number, number, number, number]> = [];
    // Fresh isolated probe; bounded inventory includes the whole reservation prefix.
    for (let fd = 0; fd < 4096; fd++) {
      try {const s = fstatSync(fd); entries.push([fd, s.dev, s.ino, s.mode]);}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error;}
    }
    return entries;
  };
  const before = descriptors(), exitListeners = process.listenerCount("exit");
  const modules = ["witness", "reservations", "pair", "pressure", "apparatus-contract", "prepare-contract", "reuse-contention", "runner-witness", "walk-retainers"];
  for (const name of modules) await import(new URL(`./${name}.ts`, import.meta.url).href);
  await import("../extension-channel-checkpoint-command.ts");
  await import("../extension-channel-fence-inventory.ts");
  await import("../extension-channel-qualification.ts");
  const {readDescriptorReservations} = await import("./reservations.ts");
  let refused = false;
  try {readDescriptorReservations();} catch (error) {refused = String(error).includes("requires explicit descriptor reservation startup");}
  const after = descriptors();
  if (!refused || JSON.stringify(before) !== JSON.stringify(after) || process.listenerCount("exit") !== exitListeners)
    throw Error(`apparatus import is not inert: ${JSON.stringify({before, after, refused, exitListenersBefore:exitListeners, exitListenersAfter:process.listenerCount("exit")})}`);
  console.log(JSON.stringify({event:"apparatus-import-inert", before:before.length, after:after.length, identical:true, readerRefused:true, exitListenerDelta:0, modules}));
}
if (import.meta.main) await checkInertImports();
