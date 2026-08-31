import { AlertTriangle, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import type { WorkspaceSummary } from '../../../src/shared/types.js'

/**
 * Requires the exact project name before allowing an irreversible project, document and history
 * deletion. The safe default remains cancellation and the destructive button starts disabled.
 */
export const DeleteProjectDialog = ({
  busy,
  onClose,
  onDelete,
  workspace,
}: {
  busy: boolean
  onClose: () => void
  onDelete: () => Promise<void>
  workspace: WorkspaceSummary
}) => {
  const [confirmation, setConfirmation] = useState('')
  const confirmed = confirmation === workspace.name

  /** Delegates the irreversible operation only after the exact-name guard succeeds. */
  const submit = async () => {
    if (!confirmed || busy) return
    await onDelete()
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section
        className="ac-modal ac-delete-project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
      >
        <header>
          <div>
            <span className="ac-delete-project-modal__icon" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 id="delete-project-title">永久删除项目</h2>
              <p>此操作不可撤销。</p>
            </div>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="ac-delete-project-modal__body">
          <p>
            删除 <strong>{workspace.name}</strong> 后，下列内容会被关联清理：
          </p>
          <ul>
            <li>项目目录内的前后端代码、设计图、架构图和全部文档</li>
            <li>规划流程、执行流程、派单、汇报和对话记录</li>
            <li>全部成员配置、CLI 会话、运行记录和项目流程状态</li>
          </ul>
          <div className="ac-delete-project-modal__path">
            <span>将删除目录</span>
            <code>{workspace.path}</code>
          </div>
          <label className="ac-field">
            <span>
              输入项目名称 <strong>{workspace.name}</strong> 以确认
            </span>
            <input
              // biome-ignore lint/a11y/noAutofocus: focusing the exact-name guard keeps the destructive action disabled and keyboard-safe
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={workspace.name}
            />
          </label>
        </div>
        <footer>
          <button type="button" className="ac-button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="ac-button ac-button--danger"
            disabled={!confirmed || busy}
            onClick={() => void submit()}
          >
            <Trash2 size={14} /> {busy ? '正在删除…' : '永久删除项目'}
          </button>
        </footer>
      </section>
    </div>
  )
}
