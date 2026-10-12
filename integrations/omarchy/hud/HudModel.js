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
        if (!groups[row.provider] || (typeof row.used === "number" &&
            (typeof groups[row.provider].used !== "number" || row.used > groups[row.provider].used))) groups[row.provider] = row;
    });
    return Object.keys(groups).slice(0, 4).map(function(key) {
        var row = groups[key];
        var known = typeof row.used === "number" && isFinite(row.used);
        return {provider: key, remaining: known ? Math.max(0, Math.min(100, 100 - row.used)) : null};
    });
}
function work(snapshot, fullAt, now) {
    if (!fullAt || now - fullAt >= 90000 || (snapshot.errors || {}).work) return [];
    return (snapshot.activeWork || []).slice(0, 2);
}
