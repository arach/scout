// Presentation only. Unavailable/stale observations never become zero or live work.
function fresh(snapshot, now) {
    return !!snapshot.updatedAt && now - snapshot.updatedAt < 90000;
}
function validCount(snapshot, key, errorKey, now) {
    if (!fresh(snapshot, now) || (snapshot.errors || {})[errorKey]) return "—";
    var value = snapshot[key];
    return typeof value === "number" && isFinite(value) && value >= 0 ? String(value) : "—";
}
function capacities(snapshot, fullAt, now) {
    if (!fullAt || now - fullAt >= 90000 || (snapshot.errors || {}).budgets) return [];
    var groups = {};
    (snapshot.budgets || []).forEach(function(row) {
        var current = groups[row.provider];
        if (!current) groups[row.provider] = {used: row.used, known: budgetKnown(row, now)};
        else {
            current.known = current.known && budgetKnown(row, now);
            if (typeof row.used === "number" && row.used > current.used) current.used = row.used;
        }
    });
    return Object.keys(groups).slice(0, 4).map(function(key) {
        var row = groups[key];
        var known = row.known;
        return {provider: key, remaining: known ? Math.max(0, Math.min(100, 100 - row.used)) : null};
    });
}
function budgetKnown(row, now) {
    return typeof row.used === "number" && isFinite(row.used) &&
        typeof row.capturedAt === "number" && isFinite(row.capturedAt) && row.capturedAt > 0 &&
        row.capturedAt <= now + 5000 && now - row.capturedAt < 900000;
}
function fullReady(snapshot, fullAt, now, loadError, domain) {
    return !loadError && !!fullAt && now - fullAt < 90000 && !(snapshot.errors || {})[domain];
}
function work(snapshot, fullAt, now) {
    if (!fullAt || now - fullAt >= 90000 || (snapshot.errors || {}).work) return [];
    return (snapshot.activeWork || []).slice(0, 2);
}
