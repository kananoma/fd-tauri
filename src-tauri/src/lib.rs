use globset::{GlobBuilder, GlobMatcher};
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
    and_pattern: Option<String>, // --and PATTERN
    extension: Option<String>,   // -e
    is_glob: bool,               // -g, --glob (false: 正規表現)
    full_path: bool,             // -p, --full-path
    hidden: bool,                // -H, --hidden
    no_ignore: bool,             // -I, --no-ignore
    unrestricted: bool,          // -u, --unrestricted (-H -I と同義)
    follow: bool,                // -L, --follow (シンボリックリンク先を追跡)
    case_sensitive: bool,        // -s
    file_type: String,           // -t, --type ("all", "file", "directory", "symlink")
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

// 正規表現と Glob のどちらでも同一インターフェースでマッチング可能にする Enum
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

#[tauri::command]
async fn search_files(args: SearchArgs) -> Result<Vec<SearchResultItem>, String> {
    tokio::task::spawn_blocking(move || execute_search(args))
        .await
        .map_err(|e| format!("検索タスクの実行に失敗しました: {e}"))?
}

fn execute_search(args: SearchArgs) -> Result<Vec<SearchResultItem>, String> {
    // 1. パターンマッチャー（基本パターン + --and パターン）の構築
    let mut matchers = Vec::new();
    if !args.pattern.trim().is_empty() {
        matchers.push(PatternMatcher::new(
            &args.pattern,
            args.is_glob,
            args.case_sensitive,
        )?);
    }
    if let Some(ref and_p) = args.and_pattern {
        if !and_p.trim().is_empty() {
            matchers.push(PatternMatcher::new(
                and_p,
                args.is_glob,
                args.case_sensitive,
            )?);
        }
    }

    // 2. 拡張子の前処理 (-e)
    let target_ext = args
        .extension
        .as_ref()
        .map(|e| e.trim().trim_start_matches('.').to_string())
        .filter(|e| !e.is_empty());

    // 3. 検索範囲フラグの解決 (-u は -H と -I の両方を有効化)
    let include_hidden = args.hidden || args.unrestricted;
    let ignore_filters = !(args.no_ignore || args.unrestricted);

    // 4. ignore::WalkBuilder の設定
    let mut builder = WalkBuilder::new(&args.path);
    builder
        .hidden(!include_hidden) // -H, --hidden
        .ignore(ignore_filters) // -I, --no-ignore (.ignore)
        .git_ignore(ignore_filters) // -I, --no-ignore (.gitignore)
        .git_global(ignore_filters) // グローバル gitignore
        .git_exclude(ignore_filters) // .git/info/exclude
        .follow_links(args.follow) // -L, --follow
        .parents(ignore_filters);

    let mut results = Vec::new();

    // 5. ディレクトリ走査
    for entry_result in builder.build() {
        let entry = match entry_result {
            Ok(e) => e,
            Err(_) => continue,
        };

        // 検索ルートディレクトリ自身（depth 0）は除外
        if entry.depth() == 0 {
            continue;
        }

        let ft = entry.file_type();
        let is_symlink = ft.as_ref().map_or(false, |t| t.is_symlink());
        let is_dir = ft.as_ref().map_or(false, |t| t.is_dir());
        let is_file = ft.as_ref().map_or(false, |t| t.is_file());

        // -t, --type による絞り込み
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
            _ => {} // "all" の場合は制限なし
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy();

        // 拡張子フィルタ (-e)
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

        // -p, --full-path に応じて判定対象テキストを切り替え
        let target_text = if args.full_path {
            path.to_string_lossy()
        } else {
            file_name.clone()
        };

        // メインパターンおよび --and パターンの全条件一致（AND）チェック
        let all_matched = matchers.iter().all(|m| m.is_match(&target_text));
        if !all_matched {
            continue;
        }

        // メタデータ（サイズ・更新日時）の取得
        let (size, modified) = match entry.metadata() {
            Ok(meta) => {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64);
                // ディレクトリの場合はサイズを表示しない（0扱い）
                let len = if is_dir { 0 } else { meta.len() };
                (len, mtime)
            }
            Err(_) => (0, None),
        };

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![search_files, open_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
