use silverbullet_server::runtime::RuntimeSnapshot;
use std::path::Path;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

pub(crate) fn process_identity(pid: u32) -> Option<(u32, u64)> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    system
        .process(Pid::from_u32(pid))
        .map(|process| (pid, process.start_time()))
}

pub(crate) struct Metrics {
    system: System,
    sampled: Option<Instant>,
    cached: Option<RuntimeSnapshot>,
    identity: Option<(u32, u64)>,
}
impl Default for Metrics {
    fn default() -> Self {
        Self {
            system: System::new(),
            sampled: None,
            cached: None,
            identity: None,
        }
    }
}
impl Metrics {
    pub(crate) fn snapshot(
        &mut self,
        status: &str,
        identity: Option<(u32, u64)>,
        profile: Option<&Path>,
    ) -> RuntimeSnapshot {
        if self.identity == identity
            && self
                .sampled
                .is_some_and(|time| time.elapsed() < Duration::from_secs(2))
        {
            if let Some(cached) = &self.cached {
                if cached.status == status {
                    return cached.clone();
                }
            }
        }
        let baseline = self.identity == identity && self.sampled.is_some();
        let (cpu_percent, memory_bytes) = if status == "stopped" {
            (Some(0.0), Some(0))
        } else if let Some(identity) = identity {
            // No `.with_tasks()`: on Linux, sysinfo would otherwise list each
            // thread as a child "process" carrying its owner's full RSS and
            // CPU, so summing the tree counts every process once per thread.
            self.system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_memory().with_cpu(),
            );
            let rows = self
                .system
                .processes()
                .iter()
                .filter(|(_, process)| process.thread_kind().is_none())
                .map(|(pid, process)| ProcessSample {
                    pid: pid.as_u32(),
                    parent: process.parent().map(|pid| pid.as_u32()),
                    start: process.start_time(),
                    cpu: process.cpu_usage(),
                    memory: process.memory(),
                })
                .collect::<Vec<_>>();
            aggregate(&rows, identity, baseline)
        } else {
            (None, None)
        };
        let snapshot = RuntimeSnapshot {
            status: status.into(),
            cpu_percent,
            memory_bytes,
            disk_bytes: profile.and_then(disk_bytes),
        };
        self.sampled = Some(Instant::now());
        self.identity = identity;
        self.cached = Some(snapshot.clone());
        snapshot
    }
}

fn disk_bytes(path: &Path) -> Option<u64> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if metadata.is_symlink() {
        return Some(0);
    }
    if metadata.is_file() {
        return Some(metadata.len());
    }
    let mut total = 0u64;
    for entry in std::fs::read_dir(path).ok()? {
        total = total.checked_add(disk_bytes(&entry.ok()?.path())?)?;
    }
    Some(total)
}

struct ProcessSample {
    pid: u32,
    parent: Option<u32>,
    start: u64,
    cpu: f32,
    memory: u64,
}
fn aggregate(
    rows: &[ProcessSample],
    identity: (u32, u64),
    baseline: bool,
) -> (Option<f32>, Option<u64>) {
    if !rows.iter().any(|row| (row.pid, row.start) == identity) {
        return (None, None);
    }
    let mut selected = std::collections::HashSet::from([identity.0]);
    loop {
        let before = selected.len();
        for row in rows {
            if row.start >= identity.1
                && row.parent.is_some_and(|parent| selected.contains(&parent))
            {
                selected.insert(row.pid);
            }
        }
        if selected.len() == before {
            break;
        }
    }
    let included = rows
        .iter()
        .filter(|row| selected.contains(&row.pid))
        .collect::<Vec<_>>();
    (
        baseline.then(|| included.iter().map(|row| row.cpu).sum()),
        Some(included.iter().map(|row| row.memory).sum()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn process_tree_checks_identity_and_cpu_baseline() {
        let rows = vec![
            ProcessSample {
                pid: 10,
                parent: None,
                start: 100,
                cpu: 12.0,
                memory: 50,
            },
            ProcessSample {
                pid: 11,
                parent: Some(10),
                start: 101,
                cpu: 23.0,
                memory: 70,
            },
            ProcessSample {
                pid: 12,
                parent: Some(11),
                start: 102,
                cpu: 34.0,
                memory: 90,
            },
            ProcessSample {
                pid: 13,
                parent: None,
                start: 100,
                cpu: 99.0,
                memory: 999,
            },
        ];
        assert_eq!(aggregate(&rows, (10, 100), true), (Some(69.0), Some(210)));
        assert_eq!(aggregate(&rows, (10, 100), false), (None, Some(210)));
        assert_eq!(aggregate(&rows, (10, 99), true), (None, None));
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn threads_do_not_multiply_memory() {
        let stop = std::sync::Arc::new(std::sync::Barrier::new(9));
        let threads = (0..8)
            .map(|_| {
                let stop = stop.clone();
                std::thread::spawn(move || {
                    stop.wait();
                })
            })
            .collect::<Vec<_>>();
        let pid = std::process::id();
        let identity = process_identity(pid);
        let snapshot = Metrics::default().snapshot("running", identity, None);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        let own = system.process(Pid::from_u32(pid)).unwrap().memory();
        stop.wait();
        threads
            .into_iter()
            .for_each(|thread| thread.join().unwrap());
        assert!(snapshot.memory_bytes.unwrap() < own * 2);
    }
    #[test]
    fn disk_counts_nested_files_without_following_links() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("nested")).unwrap();
        std::fs::write(root.path().join("one"), [0; 7]).unwrap();
        std::fs::write(root.path().join("nested/two"), [0; 11]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.path(), root.path().join("loop")).unwrap();
        assert_eq!(disk_bytes(root.path()), Some(18));
        assert_eq!(disk_bytes(&root.path().join("missing")), None);
    }
}
