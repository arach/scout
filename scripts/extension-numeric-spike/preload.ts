/** Explicit proof-process startup entry, selected only with --preload.
 * Library imports use reservations.ts, which performs no apparatus I/O.
 */
import { initializeDescriptorReservations } from "./reservations.ts";
initializeDescriptorReservations();
