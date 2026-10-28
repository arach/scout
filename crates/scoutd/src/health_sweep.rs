//! Clock-driven policy. Only the supervisor's retained Child may be restarted.
use serde::Serialize;
use std::{ffi::CString, os::unix::ffi::OsStrExt, path::Path};
const GIB: u64 = 1 << 30;
const GRACE: u128 = 120_000;
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub condition: &'static str,
    pub cause: String,
    pub action: &'static str,
    pub since: u128,
    pub escalated: bool,
}
#[derive(Default)]
pub struct Sweep {
    pub conditions: Vec<Condition>,
    attempts: u32,
    next_restart: u128,
    ready_since: Option<u128>,
}
impl Sweep {
    pub fn observe(&mut self, now: u128, health: Option<&str>, disk: Option<(u64, u64)>) -> bool {
        if let Some((free, total)) = disk {
            let critical = free < GIB || (free as u128 * 100 < total as u128 * 2);
            let low = critical || free < 2 * GIB || (free as u128 * 100 < total as u128 * 5);
            self.update(
                "disk",
                low.then(|| {
                    (
                        format!(
                            "{} disk space: {} MiB available",
                            if critical { "critical" } else { "low" },
                            free >> 20
                        ),
                        "Free disk space; inspect Scout logs before removing user data",
                        true,
                    )
                }),
                now,
            );
        }
        let value = health.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());
        let startup = value.as_ref().and_then(|v| v.get("startup"));
        let ready = startup
            .and_then(|s| s.get("mutationsAdmitted"))
            .and_then(|v| v.as_bool())
            == Some(true);
        if ready {
            self.update("startup-projection", None, now);
            let since = *self.ready_since.get_or_insert(now);
            // A momentarily ready child must not replenish its restart budget.
            if now.saturating_sub(since) >= 300_000 {
                self.attempts = 0;
                self.next_restart = 0;
            }
            return false;
        }
        self.ready_since = None;
        if startup
            .and_then(|s| s.get("phase"))
            .and_then(|v| v.as_str())
            != Some("degraded")
        {
            return false;
        }
        let cause = startup
            .and_then(|s| s.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("Startup projection is unavailable")
            .to_owned();
        let lower = cause.to_ascii_lowercase();
        let disk_failure = [
            "sqlite_full",
            "enospc",
            "database or disk is full",
            "no space left",
        ]
        .iter()
        .any(|s| lower.contains(s));
        let space = disk
            .map(|(free, total)| {
                free >= 2 * GIB && total > 0 && free as u128 * 100 >= total as u128 * 5
            })
            .unwrap_or(false);
        let exhausted = self.attempts >= if disk_failure { 1 } else { 3 };
        let action = if exhausted {
            "Repair the startup projection cause, then restart Scout"
        } else if disk_failure && !space {
            "Free at least 2 GiB and 5% disk space; Scout will restart its owned base child"
        } else {
            "Scout will restart its owned base child after the startup grace period"
        };
        self.update("startup-projection", Some((cause, action, exhausted)), now);
        let since = self
            .conditions
            .iter()
            .find(|c| c.condition == "startup-projection")
            .unwrap()
            .since;
        if exhausted
            || (disk_failure && !space)
            || now.saturating_sub(since) < GRACE
            || now < self.next_restart
        {
            return false;
        }
        self.attempts += 1;
        self.next_restart = now + (GRACE << (self.attempts - 1));
        true
    }
    fn update(&mut self, id: &'static str, value: Option<(String, &'static str, bool)>, now: u128) {
        let index = self.conditions.iter().position(|c| c.condition == id);
        match (index, value) {
            (Some(i), Some((cause, action, escalated))) => {
                let c = &mut self.conditions[i];
                c.cause = cause;
                c.action = action;
                c.escalated = escalated;
            }
            (None, Some((cause, action, escalated))) => self.conditions.push(Condition {
                condition: id,
                cause,
                action,
                since: now,
                escalated,
            }),
            (Some(i), None) => {
                self.conditions.remove(i);
            }
            _ => {}
        }
    }
}
/// Constant cost: no recursive directory walks.
pub fn disk_space(path: &Path) -> Option<(u64, u64)> {
    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return None;
    }
    let s = unsafe { stats.assume_init() };
    Some((
        (s.f_bavail as u64).saturating_mul(s.f_frsize as u64),
        (s.f_blocks as u64).saturating_mul(s.f_frsize as u64),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    const FULL: &str = r#"{"startup":{"phase":"degraded","error":"database or disk is full"}}"#;
    const OTHER: &str = r#"{"startup":{"phase":"degraded","error":"schema failed"}}"#;
    const READY: &str = r#"{"startup":{"mutationsAdmitted":true}}"#;
    const SPACE: Option<(u64, u64)> = Some((10 * GIB, 100 * GIB));
    #[test]
    fn disk_recovery_waits_for_space_and_restarts_once() {
        let mut s = Sweep::default();
        assert!(!s.observe(0, Some(FULL), Some((0, 100 * GIB))));
        assert!(!s.observe(120_000, Some(FULL), None));
        assert!(s.observe(120_001, Some(FULL), SPACE));
        assert!(!s.observe(500_000, Some(FULL), SPACE));
        assert!(s.conditions[0].escalated);
        s.observe(500_001, Some(READY), SPACE);
        assert!(s.conditions.is_empty());
    }
    #[test]
    fn other_errors_have_bounded_exponential_backoff() {
        let mut s = Sweep::default();
        s.observe(0, Some(OTHER), SPACE);
        for (now, restart) in [
            (119_999, false),
            (120_000, true),
            (239_999, false),
            (240_000, true),
            (479_999, false),
            (480_000, true),
            (960_000, false),
        ] {
            assert_eq!(s.observe(now, Some(OTHER), SPACE), restart);
        }
        assert!(s.conditions[0].escalated);
        s.observe(960_001, Some(READY), SPACE);
        assert!(s.conditions.is_empty());
    }
    #[test]
    fn unreachable_or_briefly_ready_does_not_replenish_budget() {
        let mut s = Sweep::default();
        s.observe(0, Some(FULL), SPACE);
        assert!(s.observe(120_000, Some(FULL), SPACE));
        s.observe(130_000, None, SPACE);
        assert_eq!(s.conditions.len(), 1);
        s.observe(140_000, Some(READY), SPACE);
        assert!(!s.observe(500_000, Some(FULL), SPACE));
        assert!(s.conditions[0].escalated);
    }
    #[test]
    fn disk_detects_changes_and_clears_without_runtime() {
        let mut s = Sweep::default();
        s.observe(10, None, Some((4 * GIB, 100 * GIB)));
        assert!(s.conditions[0].cause.starts_with("low"));
        s.observe(20, None, Some((GIB, 100 * GIB)));
        assert_eq!(s.conditions[0].since, 10);
        assert!(s.conditions[0].cause.starts_with("critical"));
        s.observe(30, None, SPACE);
        assert!(s.conditions.is_empty());
    }
}
