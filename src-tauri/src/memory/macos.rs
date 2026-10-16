//! macOS: Mach VM counters via `vm_stat`/`sysctl`, and per-process footprints from `top`,
//! which (being setuid root) can see every process, including root-owned daemons.

use super::{run, Proc, Snapshot};
use std::collections::HashMap;

pub fn snapshot() -> Snapshot {
    let mut s = Snapshot { platform: "macos", ..Default::default() };
    s.total = run("/usr/sbin/sysctl", &["-n", "hw.memsize"]).trim().parse().unwrap_or(0);

    let vm = run("/usr/bin/vm_stat", &[]);
    let page: u64 = vm
        .split("page size of ")
        .nth(1)
        .and_then(|r| r.split_whitespace().next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(16384);
    let mut pages: HashMap<String, u64> = HashMap::new();
    for line in vm.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if let Ok(n) = v.trim().trim_end_matches('.').parse::<u64>() {
                pages.insert(k.trim().trim_matches('"').to_string(), n * page);
            }
        }
    }
    let get = |k: &str| pages.get(k).copied().unwrap_or(0);
    s.wired = get("Pages wired down");
    s.compressed = get("Pages occupied by compressor");
    s.cached = get("File-backed pages") + get("Pages purgeable");
    s.free = get("Pages free");
    // Activity Monitor's "Memory Used": everything that isn't free or cache. That's more than
    // app + wired + compressed, because the kernel also holds pages outside those counters.
    s.used = s.total.saturating_sub(s.free + s.cached);

    let swap = run("/usr/sbin/sysctl", &["-n", "vm.swapusage"]);
    s.swap_total = parse_mb_field(&swap, "total");
    s.swap_used = parse_mb_field(&swap, "used");

    s.pressure = match run("/usr/sbin/sysctl", &["-n", "kern.memorystatus_vm_pressure_level"]).trim() {
        "2" => Some("warning".into()),
        "4" => Some("critical".into()),
        _ => Some("normal".into()),
    };

    let ioreg = run("/usr/sbin/ioreg", &["-r", "-c", "IOAccelerator", "-d", "1", "-w0"]);
    s.gpu_in_use = ioreg
        .split("\"In use system memory\"=")
        .skip(1)
        .filter_map(|r| r.split(|c: char| !c.is_ascii_digit()).next()?.parse::<u64>().ok())
        .reduce(|a, b| a + b);

    s.me = std::env::var("USER").unwrap_or_else(|_| run("/usr/bin/id", &["-un"]).trim().to_string());
    s.processes = processes();
    s
}

/// "total = 2048.00M  used = 1024.00M  free = ..." → bytes
fn parse_mb_field(text: &str, field: &str) -> u64 {
    text.split(&format!("{field} = "))
        .nth(1)
        .and_then(|r| r.split_whitespace().next())
        .and_then(|v| v.trim_end_matches('M').parse::<f64>().ok())
        .map(|mb| (mb * 1024.0 * 1024.0) as u64)
        .unwrap_or(0)
}

fn processes() -> Vec<Proc> {
    let top = run("/usr/bin/top", &["-l", "1", "-n", "10000", "-o", "mem", "-stats", "pid,mem,user"]);
    let mut footprints: HashMap<u32, (u64, String)> = HashMap::new();
    let mut in_table = false;
    for line in top.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.first() == Some(&"PID") {
            in_table = true;
            continue;
        }
        if in_table && parts.len() >= 3 {
            if let Ok(pid) = parts[0].parse() {
                footprints.insert(pid, (parse_top_size(parts[1]), parts[2].to_string()));
            }
        }
    }

    let ps = run("/bin/ps", &["-axo", "pid=,rss=,comm="]);
    let mut out = Vec::new();
    for line in ps.lines() {
        let mut it = line.trim_start().splitn(3, char::is_whitespace);
        let (Some(pid), Some(rss)) = (it.next(), it.next()) else { continue };
        let (Ok(pid), Ok(rss)) = (pid.parse::<u32>(), rss.trim().parse::<u64>()) else { continue };
        let path = it.next().unwrap_or("?").trim().to_string();
        let (footprint, user) = footprints.remove(&pid).unwrap_or((0, "?".into()));
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        out.push(Proc { pid, name, path, user, footprint, resident: rss * 1024 });
    }
    // kernel_task (pid 0) is reported by top but not ps.
    for (pid, (footprint, user)) in footprints {
        let name = if pid == 0 { "kernel_task".to_string() } else { format!("pid {pid}") };
        out.push(Proc { pid, name: name.clone(), path: name, user, footprint, resident: 0 });
    }
    out
}

/// top's compact sizes: "1740M", "1.2G", "525M+", "12K", "0B".
fn parse_top_size(raw: &str) -> u64 {
    let s = raw.trim_end_matches(['+', '-']);
    let (num, unit) = s.split_at(s.len().saturating_sub(1));
    let mult = match unit {
        "B" => 1.0,
        "K" => 1024.0,
        "M" => 1024.0 * 1024.0,
        "G" => 1024.0 * 1024.0 * 1024.0,
        "T" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return s.parse().unwrap_or(0),
    };
    (num.parse::<f64>().unwrap_or(0.0) * mult) as u64
}
