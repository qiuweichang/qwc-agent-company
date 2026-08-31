import { ChevronDown, File, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type {
  ArchiveCategory,
  ArchivedProjectFile,
} from '../../../src/shared/project-operations.js'
import { listProjectArchive, openArchivedFileLocation } from '../api.js'

const CATEGORY_LABELS: Record<ArchiveCategory, string> = {
  architecture: '架构设计',
  backend: '后端代码',
  documents: '需求与过程文档',
  frontend: '前端代码',
  other: '项目配置',
  scripts: '脚本与部署',
  tests: '测试与验收',
  ui_design: 'UI 设计图',
}

const formatSize = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.ceil(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`

/** Displays every project-owned artifact and source file grouped by delivery responsibility. */
export const ProjectArchivePanel = ({ workspaceId }: { workspaceId: string }) => {
  const [files, setFiles] = useState<ArchivedProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [expandedCategory, setExpandedCategory] = useState<ArchiveCategory | false | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally triggers a manual filesystem rescan.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listProjectArchive(workspaceId)
      .then((nextFiles) => {
        if (!cancelled) {
          setFiles(nextFiles)
          setError(null)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision, workspaceId])

  const groups = useMemo(() => {
    const grouped = new Map<ArchiveCategory, ArchivedProjectFile[]>()
    for (const file of files) {
      const group = grouped.get(file.category) ?? []
      group.push(file)
      grouped.set(file.category, group)
    }
    return Array.from(grouped.entries())
  }, [files])
  const activeCategory =
    expandedCategory === null ? (groups[0]?.[0] ?? null) : expandedCategory || null

  /** Requests a native Explorer window for the selected file's containing folder. */
  const openLocation = async (path: string) => {
    try {
      await openArchivedFileLocation(workspaceId, path)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <section className="ac-archive-panel" aria-label="归档文件">
      <header>
        <div>
          <h2>项目归档</h2>
          <p>需求、设计、代码、测试证据和 Windows 部署脚本按目录归档。</p>
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={14} /> 刷新文件
        </button>
      </header>
      {error ? <p className="ac-form-error">{error}</p> : null}
      {loading ? <p className="ac-context-empty">正在扫描项目文件…</p> : null}
      {!loading && groups.length === 0 ? (
        <p className="ac-context-empty">项目还没有可归档的文档或代码。</p>
      ) : null}
      <div className="ac-archive-groups">
        {groups.map(([category, categoryFiles]) => (
          <section
            className={`ac-archive-group ${activeCategory === category ? 'is-expanded' : ''}`}
            key={category}
          >
            <button
              type="button"
              className="ac-archive-group__toggle"
              aria-expanded={activeCategory === category}
              onClick={() => setExpandedCategory(activeCategory === category ? false : category)}
            >
              <strong>{CATEGORY_LABELS[category]}</strong>
              <span>{categoryFiles.length} 个文件</span>
              <ChevronDown size={15} />
            </button>
            {activeCategory === category ? (
              <div className="ac-archive-group__files">
                {categoryFiles.map((file) => (
                <article className="ac-archive-file" key={file.path}>
                  <File size={14} />
                  <div>
                    <strong>{file.path.split('/').at(-1)}</strong>
                    <small>{file.path}</small>
                  </div>
                  <span>{formatSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => void openLocation(file.path)}
                    aria-label={`在资源管理器中打开 ${file.path}`}
                    title="跳转到资源管理器"
                  >
                    <FolderOpen size={15} />
                  </button>
                </article>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </section>
  )
}
