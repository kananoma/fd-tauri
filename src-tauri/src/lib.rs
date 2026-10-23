use globset::{GlobBuilder, GlobMatcher};
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    path: String,
    pattern: String,
    and_patterns: Vec<String>,
    exclude_patterns: Vec<String>,
    extension: Option<String>,
    is_glob: bool,
    full_path: bool,
    hidden: bool,
    no_ignore: bool,
    unrestricted: bool,
    follow: bool,
    case_sensitive: bool,
    file_type: String,
    min_depth: Option<usize>,
    max_depth: Option<usize>,
    min_size: Option<String>,
    max_size: Option<String>,
    changed_after: Option<u64>,
    changed_before: Option<u64>,
    empty_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub size: u64,
    pub modified: Option<u64>,
    pub is_dir: bool,
    pub is_symlink: bool,
}

enum PatternMatcher {
    Regex(Regex),
    Glob(GlobMatcher),
}

impl PatternMatcher {
    fn new(pattern: &str, is_glob: bool, case_sensitive: bool) -> Result<Self, String> {
        let pattern = pattern.trim();
        if is_glob {
            let glob = GlobBuilder::new(pattern)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|e| format!("無効な Glob パターン '{pattern}' です: {e}"))?;
            Ok(Self::Glob(glob.compile_matcher()))
        } else {
            let re = RegexBuilder::new(pattern)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|e| format!("無効な正規表現 '{pattern}' です: {e}"))?;
            Ok(Self::Regex(re))
        }
    }

    fn is_match(&self, text: &str) -> bool {
        match self {
            Self::Regex(re) => re.is_match(text),
            Self::Glob(m) => m.is_match(text),
        }
    }
}

// 人間が入力しやすいサイズ文字列 (例: "10MB", "500kb", "1.5GB", "1024") をバイト数へ変換
fn parse_size_str(s: &str) -> Result<u64, String> {
    let s = s.trim().to_uppercase();
    if s.is_empty() {
        return Err("サイズ指定が空です".to_string());
    }

    let (num_part, unit_part) = if let Some(idx) = s.find(|c: char| c.is_alphabetic()) {
        (&s[..idx], &s[idx..])
    } else {
        (s.as_str(), "B")
    };

    let num: f64 = num_part
        .trim()
        .parse()
        .map_err(|_| format!("サイズ数値 '{num_part}' を解析できません"))?;
    if num < 0.0 {
        return Err("サイズには0以上の数値を指定してください".to_string());
    }

    let multiplier = match unit_part.trim() {
        "B" | "" => 1.0,
        "K" | "KB" | "KIB" => 1024.0,
        "M" | "MB" | "MIB" => 1024.0 * 1024.0,
        "G" | "GB" | "GIB" => 1024.0 * 1024.0 * 1024.0,
        "T" | "TB" | "TIB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        other => {
            return Err(format!(
                "未対応の単位 '{other}' です (B, KB, MB, GB, TB が利用可能)"
            ))
        }
    };

    Ok((num * multiplier).round() as u64)
}

#[tauri::command]
async fn search_files(args: SearchArgs) -> Result<Vec<SearchResultItem>, String> {
    tokio::task::spawn_blocking(move || execute_search(args))
        .await
        .map_err(|e| format!("検索タスクの実行に失敗しました: {e}"))?
}

fn execute_search(args: SearchArgs) -> Result<Vec<SearchResultItem>, String> {
    let mut matchers = Vec::new();
    if !args.pattern.trim().is_empty() {
        matchers.push(PatternMatcher::new(
            &args.pattern,
            args.is_glob,
            args.case_sensitive,
        )?);
    }

    for and_p in &args.and_patterns {
        let trimmed = and_p.trim();
        if !trimmed.is_empty() {
            matchers.push(PatternMatcher::new(
                trimmed,
                args.is_glob,
                args.case_sensitive,
            )?);
        }
    }

    let target_ext = args
        .extension
        .as_ref()
        .map(|e| e.trim().trim_start_matches('.').to_string())
        .filter(|e| !e.is_empty());

    let min_size_bytes = args
        .min_size
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(parse_size_str)
        .transpose()?;

    let max_size_bytes = args
        .max_size
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(parse_size_str)
        .transpose()?;

    let include_hidden = args.hidden || args.unrestricted;
    let ignore_filters = !(args.no_ignore || args.unrestricted);

    let mut builder = WalkBuilder::new(&args.path);
    builder
        .hidden(!include_hidden)
        .ignore(ignore_filters)
        .git_ignore(ignore_filters)
        .git_global(ignore_filters)
        .git_exclude(ignore_filters)
        .follow_links(args.follow)
        .parents(ignore_filters);

    // 1. 検索深度の設定
    if let Some(min_d) = args.min_depth {
        builder.min_depth(Some(min_d));
    }
    if let Some(max_d) = args.max_depth {
        builder.max_depth(Some(max_d));
    }

    // 2. 除外パターンの設定 (--exclude / -E)
    if !args.exclude_patterns.is_empty() {
        let mut ov_builder = OverrideBuilder::new(&args.path);
        let _ = ov_builder.case_insensitive(!args.case_sensitive);
        for pat in &args.exclude_patterns {
            let trimmed = pat.trim();
            if !trimmed.is_empty() {
                let rule = if trimmed.starts_with('!') {
                    trimmed.to_string()
                } else {
                    format!("!{trimmed}")
                };
                ov_builder
                    .add(&rule)
                    .map_err(|e| format!("無効な除外パターン '{trimmed}' です: {e}"))?;
            }
        }
        let ov = ov_builder
            .build()
            .map_err(|e| format!("除外パターンの構築に失敗しました: {e}"))?;
        builder.overrides(ov);
    }

    let mut results = Vec::new();

    for entry_result in builder.build() {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };

        if entry.depth() == 0 {
            continue;
        }

        let ft = entry.file_type();
        let is_symlink = ft.as_ref().map_or(false, |t| t.is_symlink());
        let is_dir = ft.as_ref().map_or(false, |t| t.is_dir());
        let is_file = ft.as_ref().map_or(false, |t| t.is_file());

        match args.file_type.as_str() {
            "file" => {
                if !is_file {
                    continue;
                }
            }
            "directory" => {
                if !is_dir {
                    continue;
                }
            }
            "symlink" => {
                if !is_symlink {
                    continue;
                }
            }
            _ => {}
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy();

        if let Some(ref ext) = target_ext {
            let file_ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let is_match = if args.case_sensitive {
                file_ext == ext
            } else {
                file_ext.eq_ignore_ascii_case(ext)
            };
            if !is_match {
                continue;
            }
        }

        let target_text = if args.full_path {
            path.to_string_lossy()
        } else {
            file_name.clone()
        };

        let all_matched = matchers.iter().all(|m| m.is_match(&target_text));
        if !all_matched {
            continue;
        }

        let (size, modified) = match entry.metadata() {
            Ok(meta) => {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                let len = if is_dir { 0 } else { meta.len() };
                (len, mtime)
            }
            Err(_) => (0, None),
        };

        // 3. サイズによる絞り込み (--size)
        if min_size_bytes.is_some() || max_size_bytes.is_some() {
            if is_dir {
                continue; // フォルダはサイズ判定から除外
            }
            if let Some(min_s) = min_size_bytes {
                if size < min_s {
                    continue;
                }
            }
            if let Some(max_s) = max_size_bytes {
                if size > max_s {
                    continue;
                }
            }
        }

        // 4. 更新日時による絞り込み (--changed-within / --changed-before)
        if let Some(after) = args.changed_after {
            match modified {
                Some(m) if m >= after => {}
                _ => continue,
            }
        }
        if let Some(before) = args.changed_before {
            match modified {
                Some(m) if m <= before => {}
                _ => continue,
            }
        }

        // 5. 空のファイル・ディレクトリ絞り込み (--empty)
        if args.empty_only {
            let is_empty = if is_dir {
                std::fs::read_dir(path)
                    .map(|mut r| r.next().is_none())
                    .unwrap_or(false)
            } else {
                size == 0
            };
            if !is_empty {
                continue;
            }
        }

        let path_buf = PathBuf::from(path);
        let dir = path_buf
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        results.push(SearchResultItem {
            path: path.to_string_lossy().to_string(),
            name: file_name.to_string(),
            dir,
            size,
            modified,
            is_dir,
            is_symlink,
        });
    }

    Ok(results)
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command as StdCommand;

        let path = path.trim().replace('/', "\\");
        let path = path.strip_prefix(r"\\?\").unwrap_or(&path);

        StdCommand::new("explorer.exe")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|e| format!("エクスプローラーを開けませんでした: {e}"))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let _ = path;
        Err("この機能は Windows のみ対応しています".into())
    }
}

#[tauri::command]
fn resolve_directory_path(path: String) -> String {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        path
    } else if let Some(parent) = p.parent() {
        parent.to_string_lossy().to_string()
    } else {
        path
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            search_files,
            open_in_explorer,
            resolve_directory_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
