import {watchScoutMessages} from "../../../broker/service.ts";
import {createTransportWatchFanout} from "@openscout/runtime/pairing-security/transport";

/** One broker source; synchronous delivery is grouped by genuine boot domain. */
export function createBrokerMessageFanout(watch = watchScoutMessages) {
  return createTransportWatchFanout(watch);
}
export const watchSharedScoutMessages = createBrokerMessageFanout();
