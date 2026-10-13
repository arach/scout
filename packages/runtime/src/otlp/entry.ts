// Must stay the first import: materializes OPENSCOUT_INSTANCE before any module reads paths/ports.
import "../instance-bootstrap.js";
import { mainOtlp } from "./standalone.js";

await mainOtlp(process.argv.slice(2));
