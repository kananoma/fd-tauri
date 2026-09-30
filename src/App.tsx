import { FormEvent, MouseEvent, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'

type SearchArgs = {
  path: string
  pattern: string
  extension: string // 追加
  hidden: boolean
  caseSensitive: boolean
}

type SearchResultItem = {
  path: string
  name: string
  dir: string
  size: number
  modified: number | null
}

// ファイルサイズを読みやすい単位に変換 (B, KB, MB, GB)
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// UNIXタイムスタンプを YYYY/MM/DD HH:mm:ss 形式に変換
function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

type ResultRowProps = {
  item: SearchResultItem
  copied: boolean
  onCopy: (filePath: string) => void
  onError: (message: string) => void
}

function ResultRow({ item, copied, onCopy, onError }: ResultRowProps) {
  async function handleOpen() {
    try {
      await openPath(item.path)
    } catch (e) {
      onError(typeof e === 'string' ? e : String(e))
    }
  }

  async function handleReveal(event: MouseEvent) {
    event.stopPropagation()
    try {
      await invoke('open_in_explorer', { path: item.path })
    } catch (e) {
      onError(typeof e === 'string' ? e : String(e))
    }
  }

  async function handleCopy(event: MouseEvent) {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(item.path)
      onCopy(item.path)
    } catch (e) {
      onError(typeof e === 'string' ? e : String(e))
    }
  }

  return (
    <tr
      className="group cursor-pointer border-b border-zinc-100 hover:bg-sky-50 transition"
      onDoubleClick={handleOpen}
      title="ダブルクリックで開く"
    >
      {/* ファイル名 */}
      <td className="px-3 py-2 font-mono font-bold text-zinc-900 whitespace-nowrap">{item.name}</td>
      {/* 親フォルダ */}
      <td className="px-3 py-2 font-mono text-zinc-500 truncate max-w-xs md:max-w-md" title={item.dir}>
        {item.dir}
      </td>
      {/* サイズ */}
      <td className="px-3 py-2 text-right font-mono text-zinc-600 whitespace-nowrap">{formatBytes(item.size)}</td>
      {/* 更新日時 */}
      <td className="px-3 py-2 text-right font-mono text-zinc-600 whitespace-nowrap">{formatDate(item.modified)}</td>
      {/* 操作ボタン */}
      <td className="px-3 py-2 text-center whitespace-nowrap">
        <div className="flex items-center justify-center gap-1.5 opacity-80 group-hover:opacity-100">
          <button
            type="button"
            onClick={handleReveal}
            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 transition hover:border-sky-300 hover:text-sky-700"
          >
            場所を開く
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="min-w-14 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 transition hover:border-sky-300 hover:text-sky-700"
          >
            {copied ? '完了!' : 'コピー'}
          </button>
        </div>
      </td>
    </tr>
  )
}

function App() {
  const [path, setPath] = useState('C:\\')
  const [pattern, setPattern] = useState('')
  const [extension, setExtension] = useState('') // 追加: 拡張子
  const [hidden, setHidden] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleSearch(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const args: SearchArgs = {
      path,
      pattern,
      extension,
      hidden,
      caseSensitive,
    }

    try {
      const found = await invoke<SearchResultItem[]>('search_files', { args })
      setResults(found)
      setHasSearched(true)
    } catch (e) {
      setResults([])
      setHasSearched(true)
      setError(typeof e === 'string' ? e : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleBrowse() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: path || undefined,
        title: '検索ディレクトリを選択',
      })
      if (typeof selected === 'string') {
        setPath(selected)
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e))
    }
  }

  function handleCopied(filePath: string) {
    setCopiedPath(filePath)
    if (copyTimer.current) {
      clearTimeout(copyTimer.current)
    }
    copyTimer.current = setTimeout(() => {
      setCopiedPath(null)
    }, 1500)
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-800">
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <form onSubmit={handleSearch} className="shrink-0 rounded-lg border border-zinc-200 bg-white p-2">
          <div className="grid gap-2 md:grid-cols-3">
            <label className="flex flex-col gap-1 md:col-span-1">
              <span className="text-sm font-medium text-zinc-700">検索ディレクトリ</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.currentTarget.value)}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-800"
                >
                  参照...
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-zinc-700">キーワード</span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.currentTarget.value)}
                placeholder="例: config / main / test"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>

            {/* 追加: 拡張子入力欄 (-e) */}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-zinc-700">拡張子 (-e)</span>
              <input
                type="text"
                value={extension}
                onChange={(e) => setExtension(e.currentTarget.value)}
                placeholder="例: rs / ts / png (ドットなし可)"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-zinc-700">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.currentTarget.checked)}
                  className="size-4 rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                />
                隠しファイルを含める (-H)
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-zinc-700">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
                  className="size-4 rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                />
                大文字小文字を区別 (-s)
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-w-28 items-center justify-center rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-400"
            >
              {loading ? '検索中...' : '検索'}
            </button>
          </div>
        </form>

        {error && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* テーブル形式の検索結果 */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2 bg-zinc-50">
            <h2 className="text-sm font-medium text-zinc-800">検索結果</h2>
            <span className="text-xs text-zinc-500">{hasSearched ? `${results.length} 件` : '未検索'}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!hasSearched ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-400">検索条件を入力して検索してください</p>
            ) : results.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-400">該当するファイルはありません</p>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-100 text-zinc-600 shadow-sm">
                  <tr>
                    <th className="px-3 py-2 font-semibold">ファイル名</th>
                    <th className="px-3 py-2 font-semibold">親フォルダ</th>
                    <th className="w-24 px-3 py-2 text-right font-semibold">サイズ</th>
                    <th className="w-36 px-3 py-2 text-right font-semibold">更新日時</th>
                    <th className="w-32 px-3 py-2 text-center font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item) => (
                    <ResultRow
                      key={item.path}
                      item={item}
                      copied={copiedPath === item.path}
                      onCopy={handleCopied}
                      onError={setError}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
