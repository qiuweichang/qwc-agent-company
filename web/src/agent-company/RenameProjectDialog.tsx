import { PencilLine, X } from 'lucide-react'
import { useState } from 'react'

/** Collects and validates a project display-name update without changing its filesystem path. */
export const RenameProjectDialog = ({
  busy,
  currentName,
  onClose,
  onRename,
}: {
  busy: boolean
  currentName: string
  onClose: () => void
  onRename: (name: string) => Promise<void>
}) => {
  const [name, setName] = useState(currentName)

  /** Submits only a meaningful trimmed name and keeps the dialog open on server errors. */
  const submit = async () => {
    const nextName = name.trim()
    if (!nextName || nextName === currentName) return
    await onRename(nextName)
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section className="ac-modal ac-rename-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>修改项目名称</h2>
            <p>仅修改 Agent Company 中的显示名称，不重命名磁盘目录。</p>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <label className="ac-field">
          <span>项目名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <footer>
          <button type="button" className="ac-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="ac-button ac-button--primary"
            disabled={busy || !name.trim() || name.trim() === currentName}
            onClick={() => void submit()}
          >
            <PencilLine size={14} /> 保存名称
          </button>
        </footer>
      </section>
    </div>
  )
}
