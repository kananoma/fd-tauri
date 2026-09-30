import { FormEvent, MouseEvent, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

type SearchArgs = {
  path: string;
  pattern: string;
  hidden: boolean;
  caseSensitive: boolean;
};

function splitDisplayPath(filePath: string): { dir: string; name: string } {
  const normalized = filePath.replace(/\//g, "\\");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (idx === -1) {
    return { dir: "", name: filePath };
  }
  return {
    dir: filePath.slice(0, idx + 1),
    name: filePath.slice(idx + 1),
  };
}

type ResultItemProps = {
  filePath: string;
  copied: boolean;
  onCopy: (filePath: string) => void;
  onError: (message: string) => void;
};

function ResultItem({ filePath, copied, onCopy, onError }: ResultItemProps) {
  const { dir, name } = splitDisplayPath(filePath);

  async function handleOpen() {
    try {
      await openPath(filePath);
    } catch (e) {
      onError(typeof e === "string" ? e : String(e));
    }
  }

  async function handleReveal(event: MouseEvent) {
    event.stopPropagation();
    try {
      await invoke("open_in_explorer", { path: filePath });
    } catch (e) {
      onError(typeof e === "string" ? e : String(e));
    }
  }

  async function handleCopy(event: MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(filePath);
      onCopy(filePath);
    } catch (e) {
      onError(typeof e === "string" ? e : String(e));
    }
  }

  return (
    <li
      className="group flex cursor-pointer items-center gap-2 px-2 py-1 transition hover:bg-sky-50"
      title="ダブルクリックで開く"
      onDoubleClick={handleOpen}
    >
      <div className="min-w-0 flex-1 font-mono text-sm text-zinc-700">
        {dir ? <span className="break-all text-zinc-500">{dir}</span> : null}
        <span className="break-all font-bold text-zinc-900">{name}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 opacity-80 group-hover:opacity-100">
        <button
          type="button"
          onClick={handleReveal}
          onDoubleClick={(e) => e.stopPropagation()}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-sky-300 hover:bg-white hover:text-sky-700"
        >
          フォルダを開く
        </button>
        <button
          type="button"
          onClick={handleCopy}
          onDoubleClick={(e) => e.stopPropagation()}
          className="min-w-16 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-sky-300 hover:bg-white hover:text-sky-700"
        >
          {copied ? "コピー完了!" : "コピー"}
        </button>
      </div>
    </li>
  );
}

function App() {
  const [path, setPath] = useState("C:\\");
  const [pattern, setPattern] = useState("");
  const [hidden, setHidden] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const args: SearchArgs = {
      path,
      pattern,
      hidden,
      caseSensitive,
    };

    try {
      const found = await invoke<string[]>("search_files", { args });
      setResults(found);
      setHasSearched(true);
    } catch (e) {
      setResults([]);
      setHasSearched(true);
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleBrowse() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: path || undefined,
        title: "検索ディレクトリを選択",
      });
      if (typeof selected === "string") {
        setPath(selected);
      }
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  }

  function handleCopied(filePath: string) {
    setCopiedPath(filePath);
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
    }
    copyTimer.current = setTimeout(() => {
      setCopiedPath(null);
    }, 1500);
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-800">
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <form
          onSubmit={handleSearch}
          className="shrink-0 rounded-lg border border-zinc-200 bg-white p-2"
        >
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-zinc-700">
                検索ディレクトリ
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.currentTarget.value)}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-800"
                >
                  参照...
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-zinc-700">
                検索キーワード
              </span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.currentTarget.value)}
                placeholder="例: *.rs / README / config"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-700">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.currentTarget.checked)}
                  className="size-4 rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                />
                隠しファイルを含める (-H)
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-700">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
                  className="size-4 rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                />
                大文字小文字を区別する (-s)
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-w-28 items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-400"
            >
              {loading ? "検索中..." : "検索"}
            </button>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-2 py-1.5">
            <h2 className="text-sm font-medium text-zinc-800">検索結果</h2>
            <span className="text-sm text-zinc-500">
              {hasSearched ? `${results.length} 件` : "未検索"}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasSearched ? (
              <p className="px-2 py-4 text-center text-sm text-zinc-400">
                キーワードを入力して検索してください
              </p>
            ) : results.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-zinc-400">
                該当するファイルはありません
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {results.map((item) => (
                  <ResultItem
                    key={item}
                    filePath={item}
                    copied={copiedPath === item}
                    onCopy={handleCopied}
                    onError={setError}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
