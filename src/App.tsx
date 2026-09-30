import { FormEvent, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SearchArgs = {
  path: string;
  pattern: string;
  hidden: boolean;
  caseSensitive: boolean;
};

function App() {
  const [path, setPath] = useState("C:\\");
  const [pattern, setPattern] = useState("");
  const [hidden, setHidden] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

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

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-800">

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
        <form
          onSubmit={handleSearch}
          className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">
                検索ディレクトリ
              </span>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.currentTarget.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>

            <label className="flex flex-col gap-1.5">
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

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
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
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-medium text-zinc-800">検索結果</h2>
            <span className="text-sm text-zinc-500">
              {hasSearched ? `${results.length} 件` : "未検索"}
            </span>
          </div>

          <div className="max-h-[55vh] overflow-y-auto">
            {!hasSearched ? (
              <p className="px-4 py-10 text-center text-sm text-zinc-400">
                キーワードを入力して検索してください
              </p>
            ) : results.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-zinc-400">
                該当するファイルはありません
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {results.map((item) => (
                  <li
                    key={item}
                    className="px-4 py-2 font-mono text-sm text-zinc-700 transition hover:bg-sky-50"
                  >
                    {item}
                  </li>
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
