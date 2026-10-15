//! Linux: /proc/meminfo for the system, /proc/<pid>/status for each process.

use super::{Proc, Snapshot};
use std::collections::HashMap;
use std::fs;

pub fn snapshot() -> Snapshot {
    let mut s = Snapshot { platform: "linux", ..Default::default() };
    let info = meminfo();
    let kb = |k: &str| info.get(k).copied().unwrap_or(0) * 1024;

    s.total = kb("MemTotal");
    s.used = s.total.saturating_sub(kb("MemAvailable"));
    s.wired = kb("SUnreclaim") + kb("KernelStack") + kb("PageTables");
    s.cached = (kb("Buffers") + kb("Cached") + kb("SReclaimable")).saturating_sub(kb("Shmem"));
    s.free = kb("MemFree");
    s.swap_total = kb("SwapTotal");
    s.swap_used = s.swap_total.saturating_sub(kb("SwapFree"));
    s.pressure = pressure();

    let users = passwd();
    let my_uid = status_field(&fs::read_to_string("/proc/self/status").unwrap_or_default(), "Uid").unwrap_or(0);
    s.me = users.get(&my_uid).cloned().unwrap_or_else(|| std::env::var("USER").unwrap_or_default());
    s.processes = processes(&users);
    s
}

fn meminfo() -> HashMap<String, u64> {
    fs::read_to_string("/proc/meminfo")
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            Some((k.to_string(), v.split_whitespace().next()?.parse().ok()?))
        })
        .collect()
}

/// Pressure stall information: share of time tasks waited on memory over the last 10s.
fn pressure() -> Option<String> {
    let text = fs::read_to_string("/proc/pressure/memory").ok()?;
    let avg10: f64 = text.lines().next()?.split_whitespace().find_map(|p| p.strip_prefix("avg10=")?.parse().ok())?;
    Some(if avg10 > 30.0 { "critical" } else if avg10 > 5.0 { "warning" } else { "normal" }.into())
}

fn passwd() -> HashMap<u64, String> {
    fs::read_to_string("/etc/passwd")
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            Some((f.get(2)?.parse().ok()?, f.first()?.to_string()))
        })
        .collect()
}

fn status_field(status: &str, key: &str) -> Option<u64> {
    status.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix(':')?.split_whitespace().next()?.parse().ok())
}

fn processes(users: &HashMap<u64, String>) -> Vec<Proc> {
    let mut out = Vec::new();
    let Ok(dir) = fs::read_dir("/proc") else { return out };
    for e in dir.flatten() {
        let Ok(pid) = e.file_name().to_string_lossy().parse::<u32>() else { continue };
        let base = e.path();
        let Ok(status) = fs::read_to_string(base.join("status")) else { continue };
        let name = status.lines().find_map(|l| l.strip_prefix("Name:")).unwrap_or("?").trim().to_string();
        let rss = status_field(&status, "VmRSS").unwrap_or(0) * 1024;
        if rss == 0 {
            continue; // kernel threads
        }
        let anon = status_field(&status, "RssAnon").unwrap_or(0) * 1024;
        let uid = status_field(&status, "Uid").unwrap_or(0);
        let path = fs::read_link(base.join("exe"))
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| name.clone());
        out.push(Proc {
            pid,
            name,
            path,
            user: users.get(&uid).cloned().unwrap_or_else(|| uid.to_string()),
            footprint: anon,
            resident: rss,
        });
    }
    out
}
