mod disk;
mod memory;
mod storage;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    session: Mutex<Option<storage::Session>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Platform {
    os: &'static str,
    home: String,
    /// The path "Entire disk" scans.
    disk_root: String,
    full_disk_access: bool,
}

fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn disk_root() -> PathBuf {
    if cfg!(target_os = "macos") {
        // "/" is the sealed read-only system snapshot; everything writable lives on the Data volume.
        PathBuf::from("/System/Volumes/Data")
    } else if cfg!(windows) {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        PathBuf::from(format!("{drive}\\"))
    } else {
        PathBuf::from("/")
    }
}

/// Without Full Disk Access, macOS hides Mail, Messages, Safari, other apps' data, etc.
fn full_disk_access() -> bool {
    if cfg!(target_os = "macos") {
        std::fs::File::open("/Library/Application Support/com.apple.TCC/TCC.db").is_ok()
    } else {
        true
    }
}

#[tauri::command]
fn platform() -> Platform {
    Platform {
        os: std::env::consts::OS,
        home: home().to_string_lossy().into_owned(),
        disk_root: disk_root().to_string_lossy().into_owned(),
        full_disk_access: full_disk_access(),
    }
}

#[tauri::command]
fn disk_info() -> disk::DiskInfo {
    disk::info(&home())
}

#[tauri::command]
async fn start_scan(app: AppHandle, state: State<'_, AppState>, target: String) -> Result<storage::ScanSummary, String> {
    let root = match target.as_str() {
        "home" => home(),
        "disk" => disk_root(),
        path => PathBuf::from(path),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(previous) = state.cancel.lock().unwrap().replace(cancel.clone()) {
        previous.store(true, Ordering::Relaxed);
    }
    let emitter = app.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        storage::run_scan(root, home(), &cancel, &|p| {
            let _ = emitter.emit("scan-progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let summary = session.summary();
    *app.state::<AppState>().session.lock().unwrap() = Some(session);
    Ok(summary)
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    if let Some(c) = state.cancel.lock().unwrap().take() {
        c.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn storage_view(state: State<'_, AppState>, id: u32) -> Option<serde_json::Value> {
    let guard = state.session.lock().unwrap();
    guard.as_ref()?.view(id).and_then(|v| serde_json::to_value(v).ok())
}

#[tauri::command]
fn locate(state: State<'_, AppState>, id: u32) -> u32 {
    state.session.lock().unwrap().as_ref().map(|s| s.locate(id)).unwrap_or(0)
}

#[tauri::command]
fn cleanup_script(state: State<'_, AppState>, ids: Vec<String>) -> String {
    state.session.lock().unwrap().as_ref().map(|s| s.script(&ids)).unwrap_or_default()
}

#[tauri::command]
async fn memory_snapshot() -> memory::Snapshot {
    tauri::async_runtime::spawn_blocking(memory::snapshot).await.unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            platform,
            disk_info,
            start_scan,
            cancel_scan,
            storage_view,
            locate,
            cleanup_script,
            memory_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running DiskLens");
}
