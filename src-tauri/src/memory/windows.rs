//! Windows: totals and per-process memory from the `sysinfo` crate.

use super::{Proc, Snapshot};
use sysinfo::{ProcessesToUpdate, System, Users};

pub fn snapshot() -> Snapshot {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let users = Users::new_with_refreshed_list();

    let mut s = Snapshot { platform: "windows", ..Default::default() };
    s.total = sys.total_memory();
    s.used = sys.used_memory();
    s.free = sys.total_memory().saturating_sub(sys.used_memory());
    s.swap_total = sys.total_swap();
    s.swap_used = sys.used_swap();
    s.me = std::env::var("USERNAME").unwrap_or_default();

    s.processes = sys
        .processes()
        .iter()
        .map(|(pid, p)| {
            let user = p
                .user_id()
                .and_then(|uid| users.get_user_by_id(uid))
                .map(|u| u.name().to_string())
                .unwrap_or_else(|| "SYSTEM".into());
            let path = p.exe().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
            Proc {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().trim_end_matches(".exe").to_string(),
                path,
                user,
                footprint: p.memory(),
                resident: p.memory(),
            }
        })
        .filter(|p| p.footprint > 0)
        .collect();
    s
}
