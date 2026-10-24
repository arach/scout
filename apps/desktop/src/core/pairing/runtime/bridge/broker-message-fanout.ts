import {watchScoutMessages} from "../../../../../../../packages/cli/src/lib/core/broker/service.ts";
import {createTransportWatchFanout} from "@openscout/runtime/pairing-security/transport";

/** Same runtime fanout/registry as web, using this bridge's broker client. */
export const watchSharedScoutMessages = createTransportWatchFanout(watchScoutMessages);
