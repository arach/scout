//! Bounded asynchronous host probes and notification delivery. Child ownership
//! and all restart decisions remain on the supervisor thread.
use super::{
    health_observations,
    health_sweep::{Condition, Observation},
    Config,
};
use std::{
    sync::mpsc::{self, Receiver, SyncSender},
    thread,
};

pub enum Job {
    Observe {
        slow: bool,
        now: u128,
        base_pid: u32,
    },
    Notify {
        condition: Condition,
        runtime_up: bool,
    },
}
pub enum Result {
    Observed {
        observation: Observation,
        base_pid: u32,
    },
    Notified {
        id: String,
        since: u128,
        delivered: bool,
    },
}
pub struct Worker {
    jobs: SyncSender<Job>,
    results: Receiver<Result>,
    observation_pending: bool,
    pub notification_pending: bool,
}
impl Worker {
    pub fn start(config: Config) -> Option<Self> {
        let mut collector = health_observations::Collector::default();
        Self::start_with(move |job| match job {
            Job::Observe {
                slow,
                now,
                base_pid,
            } => {
                if let Err(error) = super::maintain_health_sweep_logs(&config) {
                    eprintln!("[scoutd] health sweep log maintenance: {error}");
                }
                let observation =
                    collector.observe(&config, super::fetch_health(&config).body, slow, now);
                if super::health_sweep::disk_level(observation.disk) == 0 {
                    super::prepare_health_reserve(&config);
                }
                Result::Observed {
                    observation,
                    base_pid,
                }
            }
            Job::Notify {
                condition,
                runtime_up,
            } => Result::Notified {
                delivered: health_observations::notify(&config, &condition, runtime_up),
                id: condition.condition,
                since: condition.since,
            },
        })
    }
    pub(super) fn start_with(
        mut execute: impl FnMut(Job) -> Result + Send + 'static,
    ) -> Option<Self> {
        // At most one observation and one notification can be outstanding.
        let (jobs, work) = mpsc::sync_channel(2);
        let (send, results) = mpsc::sync_channel(2);
        thread::Builder::new()
            .name("scoutd-health".into())
            .spawn(move || {
                while let Ok(job) = work.recv() {
                    if super::SHUTDOWN_REQUESTED.load(super::Ordering::SeqCst) {
                        break;
                    }
                    if send.send(execute(job)).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| eprintln!("[scoutd] health worker unavailable: {e}"))
            .ok()?;
        Some(Self {
            jobs,
            results,
            observation_pending: false,
            notification_pending: false,
        })
    }
    pub fn observe(&mut self, slow: bool, now: u128, base_pid: u32) {
        if !self.observation_pending
            && self
                .jobs
                .try_send(Job::Observe {
                    slow,
                    now,
                    base_pid,
                })
                .is_ok()
        {
            self.observation_pending = true;
        }
    }
    pub fn notify(&mut self, condition: Condition, runtime_up: bool) -> bool {
        if self.notification_pending {
            return false;
        }
        self.notification_pending = self
            .jobs
            .try_send(Job::Notify {
                condition,
                runtime_up,
            })
            .is_ok();
        self.notification_pending
    }
    pub fn poll(&mut self) -> Option<Result> {
        let result = self.results.try_recv().ok()?;
        match &result {
            Result::Observed { .. } => self.observation_pending = false,
            Result::Notified { .. } => self.notification_pending = false,
        }
        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    #[test]
    fn held_probes_and_delivery_do_not_block_supervision_or_grow_the_queue() {
        let (release, wait) = mpsc::channel();
        let mut worker = Worker::start_with(move |_| {
            wait.recv().unwrap();
            Result::Observed {
                observation: Observation::default(),
                base_pid: 42,
            }
        })
        .unwrap();
        let started = Instant::now();
        worker.observe(true, 0, 42);
        for _ in 0..1000 {
            worker.observe(true, 0, 42);
            assert!(worker.poll().is_none());
        }
        let condition = Condition {
            condition: "disk".into(),
            cause: "low".into(),
            action: "free space".into(),
            since: 0,
            escalated: true,
            notified_at: Some(0),
            notify_after: 0,
        };
        assert!(worker.notify(condition.clone(), false));
        assert!(!worker.notify(condition, false));
        assert!(started.elapsed() < Duration::from_millis(200));
        // Dropping the worker never joins an in-flight host operation. A blocked
        // worker cannot consume launchd's child-shutdown allowance.
        drop(worker);
        assert!(started.elapsed() < Duration::from_millis(200));
        release.send(()).unwrap();
    }
}
