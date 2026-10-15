//! What counts as what: folder categories and cleanup rules, per operating system.
//! All paths are relative to the home folder and use `/` on every platform.

use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Category {
    Documents = 0,
    Other = 1,
    Code = 2,
    Sdks = 3,
    Ai = 4,
    Caches = 5,
}

impl Category {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Documents,
            2 => Self::Code,
            3 => Self::Sdks,
            4 => Self::Ai,
            5 => Self::Caches,
            _ => Self::Other,
        }
    }
}

pub fn category_folders() -> HashMap<&'static str, Category> {
    use Category::*;
    let mut m: HashMap<&'static str, Category> = [
        (".npm", Caches), (".gradle", Caches), (".cache", Caches), (".pnpm-store", Caches), (".yarn", Caches),
        (".bun", Caches), (".cargo", Caches), ("go/pkg", Caches), (".m2", Caches), (".nuget", Caches),
        (".gem", Caches), (".nvm", Caches), (".rustup", Caches), (".cocoapods", Caches),
        (".android", Sdks), (".expo", Sdks),
        (".ollama", Ai), (".lmstudio", Ai), (".cache/huggingface", Ai), (".cache/lm-studio", Ai),
        ("Documents", Documents), ("Pictures", Documents), ("Movies", Documents), ("Videos", Documents),
        ("Music", Documents), ("Downloads", Documents),
    ]
    .into_iter()
    .collect();
    if cfg!(target_os = "macos") {
        m.extend([
            ("Library/Caches", Caches), ("Library/pnpm", Caches), ("Library/Android", Sdks),
            ("Library/Developer", Sdks), ("Library/Mobile Documents", Documents), ("Library/CloudStorage", Documents),
        ]);
    } else if cfg!(target_os = "windows") {
        m.extend([
            ("AppData/Local/npm-cache", Caches), ("AppData/Local/pnpm", Caches), ("AppData/Local/Yarn", Caches),
            ("AppData/Local/pip", Caches), ("AppData/Local/Temp", Caches), ("AppData/Local/Android", Sdks),
            ("OneDrive", Documents),
        ]);
    } else {
        m.extend([("Android", Sdks), (".local/share/pnpm", Caches)]);
    }
    m
}

pub const MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "gif", "tiff", "raw", "cr2", "arw", "dng", "psd", "mp4", "mov", "m4v", "mkv",
    "avi", "mp3", "m4a", "wav", "aiff", "flac", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key",
    "pages", "numbers", "epub",
];
pub const MODEL_EXTENSIONS: &[&str] = &["gguf", "safetensors", "ckpt", "pt", "pth", "onnx", "mlmodel", "bin"];
pub const INSTALLER_EXTENSIONS: &[&str] = &["dmg", "pkg", "zip", "iso", "xip", "tar", "gz", "7z", "rar", "exe", "msi", "deb", "rpm", "appimage"];

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Kind {
    // Safe: regenerated automatically by the tool that made them.
    Npm, Pnpm, Yarn, Bun, Gradle, Maven, Cargo, GoMod, Homebrew, Cocoapods, Pip, Nuget, DerivedData,
    DeviceSupport, SimCaches, ToolCaches, Trash, NextTurbo, RustTarget, TempFiles,
    // Review: costs a re-download, or might contain work.
    Android, Ollama, HuggingFace, LmStudio, SimDevices, Archives, Docker, Worktrees, NodeModules,
    Installers, AppCaches, Playwright,
}

impl Kind {
    pub fn id(self) -> &'static str {
        use Kind::*;
        match self {
            Npm => "npm", Pnpm => "pnpm", Yarn => "yarn", Bun => "bun", Gradle => "gradle", Maven => "maven",
            Cargo => "cargo", GoMod => "gomod", Homebrew => "homebrew", Cocoapods => "cocoapods", Pip => "pip",
            Nuget => "nuget", DerivedData => "deriveddata", DeviceSupport => "devicesupport", SimCaches => "simcaches",
            ToolCaches => "toolcaches", Trash => "trash", NextTurbo => "nextturbo", RustTarget => "rusttarget",
            TempFiles => "temp", Android => "android", Ollama => "ollama", HuggingFace => "huggingface",
            LmStudio => "lmstudio", SimDevices => "simdevices", Archives => "archives", Docker => "docker",
            Worktrees => "worktrees", NodeModules => "nodemodules", Installers => "installers",
            AppCaches => "appcaches", Playwright => "playwright",
        }
    }

    pub fn safe(self) -> bool {
        use Kind::*;
        !matches!(
            self,
            Android | Ollama | HuggingFace | LmStudio | SimDevices | Archives | Docker | Worktrees | NodeModules
                | Installers | AppCaches | Playwright
        )
    }

    pub fn title(self) -> &'static str {
        use Kind::*;
        match self {
            Npm => "npm cache", Pnpm => "pnpm store", Yarn => "Yarn cache", Bun => "Bun cache",
            Gradle => "Gradle caches", Maven => "Maven repository", Cargo => "Cargo registry cache",
            GoMod => "Go module cache", Homebrew => "Homebrew downloads", Cocoapods => "CocoaPods cache",
            Pip => "pip cache", Nuget => "NuGet packages", DerivedData => "Xcode DerivedData",
            DeviceSupport => "Xcode device support files", SimCaches => "Simulator caches",
            ToolCaches => "Tool caches", Trash => "Trash", NextTurbo => "Next.js & Turbo build output",
            RustTarget => "Rust build output", TempFiles => "Temporary files",
            Android => "Android SDK & emulators", Ollama => "Ollama models", HuggingFace => "Hugging Face models",
            LmStudio => "LM Studio models", SimDevices => "iOS Simulator devices", Archives => "Xcode archives",
            Docker => "Docker images & containers", Worktrees => "worktrees",
            NodeModules => "node_modules in idle projects", Installers => "Installers & archives in Downloads",
            AppCaches => "Other app caches", Playwright => "Playwright browsers",
        }
    }

    pub fn detail(self) -> &'static str {
        use Kind::*;
        match self {
            Npm | Pnpm | Yarn | Bun | Cocoapods | Pip | Gradle | Maven | Cargo | GoMod | Nuget =>
                "Downloaded packages. The package manager re-downloads whatever a project needs on the next install.",
            Homebrew => "Old installer downloads. Installed tools are untouched.",
            DerivedData => "Xcode build products and indexes. Rebuilt on the next build (the first one is slower).",
            DeviceSupport => "Debug symbols copied from your iPhone/iPad. Re-copied next time you plug a device in.",
            SimCaches => "Simulator caches. Rebuilt automatically when a simulator boots.",
            ToolCaches => "Caches written by command-line tools. They refill on demand.",
            Trash => "Files already in the Trash.",
            NextTurbo => "Build output and build caches inside your JS projects. Recreated by the next build or dev server run.",
            RustTarget => "Cargo build output. Recreated by the next cargo build.",
            TempFiles => "Temporary files apps left behind. Files still in use are skipped.",
            Android => "Android SDK platforms, system images and emulator disks. Reinstall from Android Studio if you need them again.",
            Ollama => "Local language models. Removing one means re-downloading it with `ollama pull`.",
            HuggingFace => "Models and datasets downloaded by Python libraries.",
            LmStudio => "Models downloaded in LM Studio.",
            SimDevices => "Simulator devices and the apps/data on them. The script only deletes simulators for iOS versions you no longer have installed.",
            Archives => "App builds you archived for distribution. Keep any you may need to symbolicate crashes for.",
            Docker => "Docker's disk image. The script only prunes unused images, containers and build cache, never volumes.",
            Worktrees => "Extra checkouts of a repo created by coding agents. Make sure none hold unmerged work.",
            NodeModules => "Dependencies of projects untouched for 30+ days. `npm install` brings them back.",
            Installers => "Disk images, installers and archives in Downloads. Usually already installed or extracted.",
            AppCaches => "Caches kept by individual apps. Safe in principle, but some apps lose offline data or get slower for a while.",
            Playwright => "Browsers downloaded for test automation. `npx playwright install` brings them back.",
        }
    }
}

/// Exact home-relative folders each rule claims.
pub fn rule_folders() -> HashMap<&'static str, Kind> {
    use Kind::*;
    let mut m: HashMap<&'static str, Kind> = [
        (".npm", Npm), (".pnpm-store", Pnpm), (".yarn/berry/cache", Yarn), (".bun/install/cache", Bun),
        (".gradle/caches", Gradle), (".gradle/wrapper/dists", Gradle), (".m2/repository", Maven),
        (".cargo/registry", Cargo), ("go/pkg/mod", GoMod), (".nuget/packages", Nuget),
        (".android/avd", Android), (".ollama/models", Ollama), (".cache/huggingface", HuggingFace),
        (".lmstudio/models", LmStudio), (".cache/lm-studio/models", LmStudio),
    ]
    .into_iter()
    .collect();
    if cfg!(target_os = "macos") {
        m.extend([
            ("Library/pnpm/store", Pnpm), ("Library/Caches/pnpm", Pnpm), ("Library/Caches/Yarn", Yarn),
            ("Library/Caches/Homebrew", Homebrew), ("Library/Caches/CocoaPods", Cocoapods), ("Library/Caches/pip", Pip),
            ("Library/Caches/ms-playwright", Playwright),
            ("Library/Developer/Xcode/DerivedData", DerivedData),
            ("Library/Developer/Xcode/iOS DeviceSupport", DeviceSupport),
            ("Library/Developer/Xcode/watchOS DeviceSupport", DeviceSupport),
            ("Library/Developer/CoreSimulator/Caches", SimCaches),
            ("Library/Developer/CoreSimulator/Devices", SimDevices),
            ("Library/Developer/Xcode/Archives", Archives),
            ("Library/Android/sdk", Android), (".Trash", Trash),
            ("Library/Containers/com.docker.docker/Data", Docker),
        ]);
    } else if cfg!(target_os = "windows") {
        m.extend([
            ("AppData/Local/npm-cache", Npm), ("AppData/Local/pnpm/store", Pnpm), ("AppData/Local/pnpm-store", Pnpm),
            ("AppData/Local/Yarn/Cache", Yarn), ("AppData/Local/pip/Cache", Pip),
            ("AppData/Local/ms-playwright", Playwright), ("AppData/Local/Android/Sdk", Android),
            ("AppData/Local/Temp", TempFiles), ("AppData/Local/Docker/wsl", Docker),
        ]);
    } else {
        m.extend([
            (".cache/pip", Pip), (".cache/yarn", Yarn), (".cache/pnpm", Pnpm), (".local/share/pnpm/store", Pnpm),
            (".cache/ms-playwright", Playwright), ("Android/Sdk", Android), (".local/share/Trash", Trash),
        ]);
    }
    m
}

/// Folder whose direct children are each an app's cache ("Other app caches").
pub fn app_cache_parent() -> Option<&'static str> {
    if cfg!(target_os = "macos") { Some("Library/Caches") } else { None }
}

/// Folder whose direct children are command-line tool caches ("Tool caches").
pub fn tool_cache_parent() -> Option<&'static str> {
    if cfg!(target_os = "windows") { None } else { Some(".cache") }
}

// MARK: - Shell commands

pub fn windows() -> bool {
    cfg!(target_os = "windows")
}

/// Quote for the script's shell: POSIX single quotes, or PowerShell single quotes.
pub fn quote(s: &str) -> String {
    if windows() {
        format!("'{}'", s.replace('\'', "''"))
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

pub fn remove(path: &str) -> String {
    if windows() {
        format!("Remove-Item -LiteralPath {} -Recurse -Force -ErrorAction SilentlyContinue", quote(path))
    } else {
        format!("rm -rf {}", quote(path))
    }
}

pub fn empty_folder(path: &str) -> String {
    if windows() {
        format!("Get-ChildItem -LiteralPath {} -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue", quote(path))
    } else {
        format!("find {} -mindepth 1 -maxdepth 1 -exec rm -rf {{}} +", quote(path))
    }
}

pub fn echo(text: &str) -> String {
    if windows() { format!("Write-Host {}", quote(text)) } else { format!("echo {}", quote(text)) }
}
