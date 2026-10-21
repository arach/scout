import { RuntimeHttpClient } from './http-client.ts';
export class ScoutCliError extends Error {}
export type ScoutCommandContext = {
  env: NodeJS.ProcessEnv; cwd: string; isTty: boolean;
  stdout(text: string): void; stderr(text: string): void;
  output: { mode: 'plain' | 'json'; writeText(text: string): void; writeValue<T>(value: T, render?: (value:T)=>string): void };
};
let selected: RuntimeHttpClient | undefined;
export function selectRuntimeClient(client: RuntimeHttpClient | undefined) { selected = client; }
export function resolveScoutBrokerUrl() {
  const url = selected?.origin ?? process.env.OPENSCOUT_BROKER_URL;
  if (!url) throw new ScoutCliError('select a runtime with OPENSCOUT_BROKER_URL or --config brokerUrl');
  return url;
}
export const runtimeClient = () => selected ?? new RuntimeHttpClient({ brokerUrl: resolveScoutBrokerUrl() });
/** Selected-runtime calls get the explicit proof; peer public calls never do. */
export const runtimeFetch: typeof fetch = (async (input: any, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  if ([...headers.keys()].some(key => key.startsWith('x-openscout-'))) {
    // Offline access commands supplied their own user/device proof; never replace
    // that scoped identity with the administrator context of the local client.
    return fetch(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20_000) });
  }
  const client = selected?.origin === url.origin ? selected : new RuntimeHttpClient({ brokerUrl: url.origin });
  const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
  return Response.json(await client.request(url.pathname + url.search, body, init.signal ?? undefined));
}) as typeof fetch;
