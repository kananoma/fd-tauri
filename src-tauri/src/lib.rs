use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tokio::process::Command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    path: String,
    pattern: String,
    extension: Option<String>,
    hidden: bool,
    case_sensitive: bool,
}

// 追加: 検索結果の1件を表す構造体
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub path: String,          // フルパス
    pub name: String,          // ファイル名
    pub dir: String,           // 親フォルダの絶対パス
    pub size: u64,             // ファイルサイズ (バイト)
    pub modified: Option<u64>, // 更新日時 (UNIXエポックミリ秒)
}

#[tauri::command]
async fn search_files(args: SearchArgs) -> Result<Vec<SearchResultItem>, String> {
    let mut cmd = Command::new("fd");
    cmd.arg("--absolute-path");

    if args.case_sensitive {
        cmd.arg("-s");
    } else {
        cmd.arg("-i");
    }

    if args.hidden {
        cmd.arg("-H");
    }

    // 拡張子指定があれば -e オプションを付加
    if let Some(ref ext) = args.extension {
        let trimmed = ext.trim().trim_start_matches('.');
        if !trimmed.is_empty() {
            cmd.arg("-e").arg(trimmed);
        }
    }

    cmd.arg(&args.pattern).arg(&args.path);

    // Avoid a flashing console window when spawning fd on Windows.
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().await.map_err(|e| {
        format!("fd を実行できませんでした: {e}。fd がインストールされ PATH に通っているか確認してください。")
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // 各ファイルのメタデータ（サイズ、更新日時、親ディレクトリ、ファイル名）を取得
    let results: Vec<SearchResultItem> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let path_buf = PathBuf::from(line);

            let name = path_buf
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| line.to_string());

            let dir = path_buf
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            // ファイルサイズ・更新日時を取得
            let (size, modified) = match std::fs::metadata(&path_buf) {
                Ok(meta) => {
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64);
                    (meta.len(), mtime)
                }
                Err(_) => (0, None),
            };

            SearchResultItem {
                path: line.to_string(),
                name,
                dir,
                size,
                modified,
            }
        })
        .collect();

    // fd exits with 1 when there are no matches; treat that as an empty result.
    if !output.status.success() && output.status.code() != Some(1) && results.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        return Err(if message.is_empty() {
            format!(
                "fd がエラー終了しました (exit code: {:?})",
                output.status.code()
            )
        } else {
            message.to_string()
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

        // fd / dialog のパスを explorer が解釈できる形式にする。
        let path = path.trim().replace('/', "\\");
        let path = path.strip_prefix(r"\\?\").unwrap_or(&path);

        // Command::arg だと Windows の引用符処理で
        // `/select,"C:\..."` が壊れて既定のエクスプローラーだけが開く。
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
