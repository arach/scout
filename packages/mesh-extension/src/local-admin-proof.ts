import { createHash, createHmac, randomBytes } from 'node:crypto';
/** Explicit user-supplied local-admin credential, never the runtime node key. */
export function localAdminProof(key: string, destinationKeyId: string) {
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(destinationKeyId)) throw new Error('invalid local administration credential context');
  return async (input: { method: string; path: string; body: string }) => {
    if ([input.method,input.path].some(v => /[\r\n]/.test(v))) throw new Error('invalid local administration request');
    const ts = Date.now(), nonce = randomBytes(16).toString('base64');
    const payload = ['local-admin:v1', input.method.toUpperCase(), input.path, createHash('sha256').update(input.body).digest('hex'), destinationKeyId, String(ts), nonce].join('\n');
    return { 'x-openscout-local-admin': createHmac('sha256', Buffer.from(key,'hex')).update(payload).digest('hex'), 'x-openscout-local-admin-ts': String(ts), 'x-openscout-local-admin-nonce': nonce };
  };
}
