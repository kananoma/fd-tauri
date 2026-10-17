import { FormEvent, MouseEvent, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

type SearchArgs = {
  path: string
  pattern: string
  andPatterns: string[]
  extension: string
  isGlob: boolean
  fullPath: boolean
  hidden: boolean
  noIgnore: boolean
  unrestricted: boolean
  follow: boolean
  caseSensitive: boolean
  fileType: string
}

type SearchResultItem = {
  path: string
  name: string
  dir: string
  size: number
  modified: number | null
  isDir: boolean
  isSymlink: boolean
}

type ColumnKey = 'type' | 'name' | 'dir' | 'size' | 'modified' | 'actions'

const COLUMN_CONFIG: { key: ColumnKey; label: string; align?: 'left' | 'right' | 'center' }[] = [
  { key: 'type', label: '種類', align: 'left' },
  { key: 'name', label: '名前', align: 'left' },
  { key: 'dir', label: '親フォルダ', align: 'left' },
  { key: 'size', label: 'サイズ', align: 'right' },
  { key: 'modified', label: '更新日時', align: 'right' },
  { key: 'actions', label: '操作', align: 'center' },
]

const MIN_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  type: 65,
  name: 120,
  dir: 120,
  size: 70,
  modified: 120,
  actions: 110,
}

function formatBytes(bytes: number, isDir: boolean): string {
  if (isDir) return '-'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

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
      {/* 1. 種類列 */}
      <td className="px-3 py-1.5 whitespace-nowrap overflow-hidden">
        {item.isDir ? (
          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
            📁 フォルダ
          </span>
        ) : item.isSymlink ? (
          <span className="inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
            🔗 リンク
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700">
            📄 ファイル
          </span>
        )}
      </td>

      {/* 2. 名前列 */}
      <td className="px-3 py-1.5 font-mono text-zinc-900 truncate" title={item.name}>
        <span className="font-semibold">{item.name}</span>
      </td>

      {/* 3. 親フォルダ列 */}
      <td className="px-3 py-1.5 font-mono text-zinc-500 truncate" title={item.dir}>
        {item.dir}
      </td>

      {/* 4. サイズ列 */}
      <td className="px-3 py-1.5 text-right font-mono text-zinc-600 whitespace-nowrap overflow-hidden">
        {formatBytes(item.size, item.isDir)}
      </td>

      {/* 5. 更新日時列 */}
      <td className="px-3 py-1.5 text-right font-mono text-zinc-600 whitespace-nowrap overflow-hidden">
        {formatDate(item.modified)}
      </td>

      {/* 6. 操作列 */}
      <td className="px-3 py-1.5 text-center whitespace-nowrap overflow-hidden">
        <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100">
          <button
            type="button"
            onClick={handleReveal}
            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 hover:border-sky-300 hover:text-sky-700"
          >
            場所を開く
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="min-w-14 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 hover:border-sky-300 hover:text-sky-700"
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
  const [andPatterns, setAndPatterns] = useState<string[]>([])
  const [extension, setExtension] = useState('')
  const [isGlob, setIsGlob] = useState(false)
  const [fullPath, setFullPath] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [noIgnore, setNoIgnore] = useState(false)
  const [unrestricted, setUnrestricted] = useState(false)
  const [follow, setFollow] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [fileType, setFileType] = useState('all')

  const [results, setResults] = useState<SearchResultItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 列幅の状態管理
  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>({
    type: 95,
    name: 240,
    dir: 300,
    size: 85,
    modified: 145,
    actions: 140,
  })

  // 列リサイズ用の参照
  const resizingRef = useRef<{
    colKey: ColumnKey
    startX: number
    startWidth: number
  } | null>(null)

  // フォルダドラッグ＆ドロップ用
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // ディレクトリパスの自動設定（ファイルがドロップされた場合も親フォルダを解決）
  const applyDroppedPath = async (rawPath: string) => {
    try {
      const resolved = await invoke<string>('resolve_directory_path', { path: rawPath })
      setPath(resolved)
    } catch {
      setPath(rawPath)
    }
  }

  // Tauri のネイティブウィンドウへのファイルドロップを監視
  useEffect(() => {
    let unlistenFn: (() => void) | null = null

    async function initDropListener() {
      try {
        const webview = getCurrentWebviewWindow()
        unlistenFn = await webview.onDragDropEvent((event) => {
          const payload = event.payload

          const isOverInputArea = (position?: { x: number; y: number }) => {
            if (!position || !dropZoneRef.current) return false
            const rect = dropZoneRef.current.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1
            const logicalX = position.x / dpr
            const logicalY = position.y / dpr
            return logicalX >= rect.left && logicalX <= rect.right && logicalY >= rect.top && logicalY <= rect.bottom
          }

          if (payload.type === 'enter' || payload.type === 'over') {
            setIsDraggingOver(isOverInputArea(payload.position))
          } else if (payload.type === 'drop') {
            const inArea = isOverInputArea(payload.position)
            setIsDraggingOver(false)
            if (inArea && payload.paths && payload.paths.length > 0) {
              applyDroppedPath(payload.paths[0])
            }
          } else if (payload.type === 'leave') {
            setIsDraggingOver(false)
          }
        })
      } catch (err) {
        console.warn('onDragDropEvent listener could not be registered:', err)
      }
    }

    initDropListener()

    return () => {
      if (unlistenFn) unlistenFn()
    }
  }, [])

  // 列リサイズの開始ハンドラ
  function handleResizeStart(colKey: ColumnKey, event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()

    resizingRef.current = {
      colKey,
      startX: event.clientX,
      startWidth: colWidths[colKey],
    }

    function handleMouseMove(e: globalThis.MouseEvent) {
      if (!resizingRef.current) return
      const deltaX = e.clientX - resizingRef.current.startX
      const targetKey = resizingRef.current.colKey
      const newWidth = Math.max(MIN_COLUMN_WIDTHS[targetKey], resizingRef.current.startWidth + deltaX)

      setColWidths((prev) => ({
        ...prev,
        [targetKey]: newWidth,
      }))
    }

    function handleMouseUp() {
      resizingRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function handleAddAndPattern() {
    setAndPatterns((prev) => [...prev, ''])
  }

  function handleUpdateAndPattern(index: number, value: string) {
    setAndPatterns((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  function handleRemoveAndPattern(index: number) {
    setAndPatterns((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const args: SearchArgs = {
      path,
      pattern,
      andPatterns: andPatterns.map((p) => p.trim()).filter((p) => p.length > 0),
      extension,
      isGlob,
      fullPath,
      hidden,
      noIgnore,
      unrestricted,
      follow,
      caseSensitive,
      fileType,
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
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedPath(null), 1500)
  }

  const totalTableWidth = Object.values(colWidths).reduce((sum, w) => sum + w, 0)

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-800">
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <form onSubmit={handleSearch} className="shrink-0 rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm">
          {/* 1段目: ディレクトリ & 検索パターン */}
          <div className="grid gap-2 md:grid-cols-3">
            <label className="flex flex-col gap-1 md:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-700">検索ディレクトリ</span>
                <span className="text-[10px] text-zinc-400">フォルダをD&D可</span>
              </div>
              {/* ドラッグ＆ドロップターゲットエリア */}
              <div
                ref={dropZoneRef}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDraggingOver(true)
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDraggingOver(false)
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0]
                    // @ts-expect-error Chromium/WebView2 attaches path
                    const p = file.path
                    if (p) applyDroppedPath(p)
                  }
                }}
                className={`flex gap-1.5 rounded transition ${
                  isDraggingOver ? 'ring-2 ring-sky-500 bg-sky-50/70 p-0.5' : ''
                }`}
              >
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.currentTarget.value)}
                  placeholder={isDraggingOver ? 'ここにフォルダをドロップ！' : 'ディレクトリのパス'}
                  className={`min-w-0 flex-1 rounded border border-zinc-300 px-2.5 py-1 text-sm outline-none transition focus:border-sky-500 ${
                    isDraggingOver ? 'border-sky-500 bg-sky-50 text-sky-800 font-medium' : 'bg-white'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="shrink-0 rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-sky-50"
                >
                  参照...
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-1 md:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-700">
                  {isGlob ? 'Glob パターン (-g)' : '正規表現パターン'}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleAddAndPattern}
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-800"
                  >
                    ＋ AND条件を追加
                  </button>
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] font-normal text-sky-700">
                    <input
                      type="checkbox"
                      checked={isGlob}
                      onChange={(e) => setIsGlob(e.currentTarget.checked)}
                      className="size-3 rounded"
                    />
                    Globモード
                  </label>
                </div>
              </div>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.currentTarget.value)}
                placeholder={isGlob ? '*.{rs,ts} / test_*' : '^[a-z]+_test|main'}
                className="rounded border border-zinc-300 px-2.5 py-1 text-sm outline-none focus:border-sky-500"
              />
            </label>
          </div>

          {/* --and 条件の入力欄エリア */}
          {andPatterns.length > 0 && (
            <div className="mt-2 rounded-md bg-zinc-50 p-2 border border-zinc-200">
              <div className="mb-1 text-[11px] font-semibold text-zinc-600">
                追加の必須パターン (--and) — すべてに一致するファイルを検索
              </div>
              <div className="flex flex-wrap gap-2">
                {andPatterns.map((andPat, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5"
                  >
                    <span className="text-[10px] font-bold text-zinc-400">AND #{index + 1}</span>
                    <input
                      type="text"
                      value={andPat}
                      onChange={(e) => handleUpdateAndPattern(index, e.currentTarget.value)}
                      placeholder="パターンを入力"
                      className="w-36 text-xs outline-none bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveAndPattern(index)}
                      className="flex size-4 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-red-600 text-xs"
                      title="条件を削除"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2段目: 拡張子 & 種別 & 各種フラグ */}
          <div className="mt-2.5 grid gap-2 md:grid-cols-4 items-end border-t border-zinc-100 pt-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-zinc-700">拡張子 (-e)</span>
              <input
                type="text"
                value={extension}
                onChange={(e) => setExtension(e.currentTarget.value)}
                placeholder="rs / json (ドット不要)"
                className="rounded border border-zinc-300 px-2.5 py-1 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-zinc-700">種別 (-t, --type)</span>
              <select
                value={fileType}
                onChange={(e) => setFileType(e.currentTarget.value)}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-sky-500"
              >
                <option value="all">すべて (All)</option>
                <option value="file">ファイル (File)</option>
                <option value="directory">ディレクトリ (Directory)</option>
                <option value="symlink">シンボリックリンク (Symlink)</option>
              </select>
            </label>

            <div className="md:col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-700">
              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.currentTarget.checked)}
                  className="rounded"
                />
                大文字小文字区別 (-s)
              </label>

              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={fullPath}
                  onChange={(e) => setFullPath(e.currentTarget.checked)}
                  className="rounded"
                />
                パス全体で一致 (-p)
              </label>

              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={hidden}
                  disabled={unrestricted}
                  onChange={(e) => setHidden(e.currentTarget.checked)}
                  className="rounded"
                />
                隠しファイル (-H)
              </label>

              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={noIgnore}
                  disabled={unrestricted}
                  onChange={(e) => setNoIgnore(e.currentTarget.checked)}
                  className="rounded"
                />
                無視ファイルも含める (-I)
              </label>

              <label
                className="inline-flex cursor-pointer items-center gap-1 font-semibold text-amber-700"
                title="隠しファイルと無視ファイルの両方を含めます"
              >
                <input
                  type="checkbox"
                  checked={unrestricted}
                  onChange={(e) => setUnrestricted(e.currentTarget.checked)}
                  className="rounded"
                />
                全対象 (-u)
              </label>

              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.currentTarget.checked)}
                  className="rounded"
                />
                リンク追跡 (-L)
              </label>
            </div>
          </div>

          <div className="mt-2.5 flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-w-28 items-center justify-center rounded bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:bg-sky-400"
            >
              {loading ? '検索中...' : '検索実行'}
            </button>
          </div>
        </form>

        {error && (
          <div role="alert" className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {error}
          </div>
        )}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1.5">
            <h2 className="text-xs font-semibold text-zinc-800">検索結果</h2>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-400">※ ヘッダー境界線をドラッグで列幅変更</span>
              <span className="text-xs text-zinc-500 font-medium">
                {hasSearched ? `${results.length} 件` : '未検索'}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!hasSearched ? (
              <p className="px-2 py-6 text-center text-xs text-zinc-400">検索条件を入力して検索してください</p>
            ) : results.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-zinc-400">該当するファイルはありません</p>
            ) : (
              <table
                className="table-fixed border-collapse text-left text-xs"
                style={{ width: '100%', minWidth: `${totalTableWidth}px` }}
              >
                <colgroup>
                  {COLUMN_CONFIG.map((col) => (
                    <col key={col.key} style={{ width: `${colWidths[col.key]}px` }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-100 text-zinc-600 shadow-sm">
                  <tr>
                    {COLUMN_CONFIG.map((col) => (
                      <th
                        key={col.key}
                        className={`relative border-r border-zinc-200 px-3 py-2 font-semibold select-none ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                        }`}
                      >
                        <span className="truncate">{col.label}</span>
                        {/* カラムリサイズハンドル */}
                        <div
                          onMouseDown={(e) => handleResizeStart(col.key, e)}
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-400 active:bg-sky-600 transition-colors z-20"
                          title="ドラッグして列幅を変更"
                        />
                      </th>
                    ))}
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
