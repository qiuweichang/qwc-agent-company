import { FolderOpen, X } from 'lucide-react'
import { useState } from 'react'

import { pickFolder } from '../api.js'

interface ProjectDialogProps {
  busy: boolean
  onClose: () => void
  onCreate: (input: { name: string; path: string }) => Promise<void>
}

const DEFAULT_WORKSPACE_ROOT = 'D:\\project\\agent-company-workspace'

/** Extracts the last directory segment from either a Windows or POSIX path. */
const getDirectoryDisplayName = (path: string) =>
  path
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() ?? ''

/** Converts a display name into a legal Windows directory segment while preserving Chinese text. */
const toProjectDirectoryName = (name: string) =>
  name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')

/** Returns the default dedicated directory for one personal project. */
const getDefaultProjectPath = (name: string) => {
  const directoryName = toProjectDirectoryName(name)
  return directoryName ? `${DEFAULT_WORKSPACE_ROOT}\\${directoryName}` : DEFAULT_WORKSPACE_ROOT
}

/** Collects the local workspace and project name used to create a real Runtime project. */
export const ProjectDialog = ({ busy, onClose, onCreate }: ProjectDialogProps) => {
  const [name, setName] = useState('')
  const [customPath, setCustomPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const path = customPath ?? getDefaultProjectPath(name)

  /** Opens the native folder picker exposed by the loopback Runtime. */
  const chooseFolder = async () => {
    const result = await pickFolder()
    if (result.path) {
      setCustomPath(result.path)
      if (!name) {
        setName(result.probe?.suggested_name || getDirectoryDisplayName(result.path))
      }
    } else if (result.error) {
      setError(result.error)
    }
  }

  /** Validates the minimum project identity before handing creation to the parent. */
  const submit = async () => {
    if (!name.trim() || !path.trim()) {
      setError('项目名称和本地目录都必须填写。')
      return
    }
    setError(null)
    await onCreate({ name: name.trim(), path: path.trim() })
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section
        className="ac-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <header>
          <div>
            <span className="ac-eyebrow">LOCAL PROJECT</span>
            <h2 id="new-project-title">创建软件项目</h2>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <p className="ac-modal__intro">
          将一个本地目录交给 Agent Company，并用 Claude CLI 组建默认产品研发团队。
        </p>
        <label className="ac-field">
          <span>项目名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：学生信息管理平台"
          />
        </label>
        <label className="ac-field">
          <span>本地目录</span>
          <div className="ac-field__row">
            <input
              className="ac-mono"
              value={path}
              onChange={(event) => setCustomPath(event.target.value)}
              placeholder={`${DEFAULT_WORKSPACE_ROOT}\\项目名称`}
            />
            <button type="button" className="ac-button ac-button--secondary" onClick={chooseFolder}>
              <FolderOpen size={15} /> 选择
            </button>
          </div>
          <small>默认目录会随项目名称更新：{DEFAULT_WORKSPACE_ROOT}\\项目名称</small>
        </label>
        <div className="ac-info-card">
          <strong>默认团队</strong>
          <span>产品经理、架构师、UI 设计师、前端、后端、测试；创建后可自由增删。</span>
        </div>
        {error ? <p className="ac-form-error">{error}</p> : null}
        <footer>
          <button type="button" className="ac-button ac-button--secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="ac-button ac-button--primary"
            disabled={busy}
            onClick={submit}
          >
            {busy ? '正在创建…' : '创建项目'}
          </button>
        </footer>
      </section>
    </div>
  )
}
