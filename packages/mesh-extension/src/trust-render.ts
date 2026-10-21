export const renderMeshPeers = (peers: any[]) => peers.map(p=>`${p.keyId}  ${p.label ?? ''}  ${p.tier}`).join('\n') || 'No trusted peers';
export const renderMeshPeerGrant = (p:any,prefix='Granted') => `${prefix}: ${p.label ?? p.nodeId ?? p.keyId} (${p.keyId}, ${p.tier})`;
export const renderMeshPeerRevoked = (key:string) => `Revoked: ${key}`;
export const renderMeshEnrollmentSessions = (items:any[]) => items.map(v=>`${v.id ?? v.enrollmentId} ${v.state ?? ''} ${(v.sasWords ?? v.words ?? []).join(' ')}`).join('\n') || 'No enrollment sessions';
export const renderMeshEnrollmentWords = (value:any) => `Compare these words on both machines before confirming:\n${(value.words ?? []).join(' ')}\nLocal: ${value.local?.fingerprint ?? value.localFingerprint ?? ''}\nPeer: ${value.remote?.fingerprint ?? value.peerFingerprint ?? ''}\nscout mesh enroll --confirm-sas "${(value.words ?? []).join(' ')}"`;
