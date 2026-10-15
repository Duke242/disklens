//! The disk that holds the home folder: capacity and free space.

use serde::Serialize;
use std::path::Path;
use sysinfo::Disks;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    pub used: u64,
    pub volumes: Vec<Volume>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
}

pub fn info(home: &Path) -> DiskInfo {
    let disks = Disks::new_with_refreshed_list();
    let home_s = home.to_string_lossy().to_lowercase();
    // The disk whose mount point is the longest prefix of the home folder.
    let best = disks
        .list()
        .iter()
        .filter(|d| home_s.starts_with(&d.mount_point().to_string_lossy().to_lowercase()))
        .max_by_key(|d| d.mount_point().as_os_str().len());
    let mut out = DiskInfo::default();
    if let Some(d) = best {
        out.name = d.name().to_string_lossy().into_owned();
        out.mount = d.mount_point().to_string_lossy().into_owned();
        out.total = d.total_space();
        out.available = d.available_space();
        out.used = out.total.saturating_sub(out.available);
    }
    let mut seen = std::collections::HashSet::new();
    out.volumes = disks
        .list()
        .iter()
        .filter(|d| d.total_space() > 1_000_000_000 && !d.is_removable() || d.mount_point() == Path::new(&out.mount))
        .filter(|d| seen.insert(d.mount_point().to_path_buf()))
        .map(|d| Volume {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            available: d.available_space(),
        })
        .collect();
    out
}
