//! A memory snapshot in one shape for every OS. Fields a platform can't measure are left at zero.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub platform: &'static str,
    pub total: u64,
    /// What the OS calls "used" (Activity Monitor's Memory Used, Linux's total − available).
    pub used: u64,
    /// Kernel, driver and (on macOS) GPU memory owned by no process.
    pub wired: u64,
    pub compressed: u64,
    /// File cache the OS can reclaim instantly.
    pub cached: u64,
    pub free: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    /// "normal" | "warning" | "critical", when the OS reports it.
    pub pressure: Option<String>,
    pub gpu_in_use: Option<u64>,
    pub me: String,
    pub processes: Vec<Proc>,
    pub models: Vec<OllamaModel>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub path: String,
    pub user: String,
    /// Memory charged to the process (macOS footprint, Linux anonymous RSS, Windows working set).
    pub footprint: u64,
    /// Resident size, including shared libraries and memory-mapped files.
    pub resident: u64,
}

#[derive(Serialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
}

pub fn snapshot() -> Snapshot {
    #[cfg(target_os = "macos")]
    let mut s = macos::snapshot();
    #[cfg(target_os = "linux")]
    let mut s = linux::snapshot();
    #[cfg(target_os = "windows")]
    let mut s = windows::snapshot();
    s.models = ollama_loaded();
    s
}

/// Models Ollama currently holds in memory, from its local API. Empty if Ollama isn't running.
fn ollama_loaded() -> Vec<OllamaModel> {
    let addr: SocketAddr = "127.0.0.1:11434".parse().unwrap();
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else { return vec![] };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    if stream.write_all(b"GET /api/ps HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() {
        return vec![];
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    let Some((_, body)) = response.split_once("\r\n\r\n") else { return vec![] };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else { return vec![] };
    json["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| Some(OllamaModel { name: m["name"].as_str()?.to_string(), size: m["size"].as_u64().unwrap_or(0) }))
                .collect()
        })
        .unwrap_or_default()
}

#[allow(dead_code)]
pub(crate) fn run(cmd: &str, args: &[&str]) -> String {
    std::process::Command::new(cmd)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn snapshot_is_sane() {
        let s = super::snapshot();
        assert!(s.total > 0, "total memory should be known");
        assert!(s.used > 0 && s.used <= s.total, "used {} of {}", s.used, s.total);
        assert!(!s.me.is_empty(), "current user should be known");
        assert!(s.processes.len() > 5, "should see processes, got {}", s.processes.len());
        assert!(s.processes.iter().any(|p| p.footprint > 0), "some process should have a footprint");
        // Every process the current user runs (e.g. this test) should be attributed to them.
        assert!(s.processes.iter().any(|p| p.user.eq_ignore_ascii_case(&s.me)), "no processes for {}", s.me);
    }
}
