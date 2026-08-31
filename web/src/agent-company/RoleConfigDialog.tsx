import { Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { RoleTemplate, RoleTemplateInput } from '../api.js'

interface RoleConfigDialogProps {
  busy: boolean
  onClose: () => void
  onCreate: (input: RoleTemplateInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, input: RoleTemplateInput) => Promise<void>
  templates: RoleTemplate[]
}

const EMPTY_ROLE: RoleTemplateInput = {
  description: '',
  name: '',
  roleType: 'custom',
}

/** Provides a dedicated role-contract editor instead of coupling templates to team membership. */
export const RoleConfigDialog = ({
  busy,
  onClose,
  onCreate,
  onDelete,
  onUpdate,
  templates,
}: RoleConfigDialogProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null)
  const [draft, setDraft] = useState<RoleTemplateInput>(EMPTY_ROLE)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = templates.find((template) => template.id === selectedId) ?? null

  useEffect(() => {
    if (creating) return
    if (!selected) {
      setDraft(EMPTY_ROLE)
      return
    }
    setDraft({
      description: selected.description,
      name: selected.name,
      roleType: selected.roleType,
    })
  }, [creating, selected])

  /** Opens a blank custom role contract without mutating the persisted list. */
  const beginCreate = () => {
    setCreating(true)
    setSelectedId(null)
    setDraft(EMPTY_ROLE)
    setError(null)
  }

  /** Validates and persists either a new custom role or edits to an existing custom role. */
  const save = async () => {
    if (!draft.name.trim() || !draft.description.trim()) {
      setError('角色名称与行为契约不能为空。')
      return
    }
    setError(null)
    const input = {
      ...draft,
      description: draft.description.trim(),
      name: draft.name.trim(),
    }
    if (creating) {
      await onCreate(input)
      setCreating(false)
      return
    }
    if (selected && !selected.isBuiltin) await onUpdate(selected.id, input)
  }

  /** Deletes only user-created roles; built-in company roles remain protected. */
  const remove = async () => {
    if (!selected || selected.isBuiltin) return
    await onDelete(selected.id)
    setSelectedId(templates.find((item) => item.id !== selected.id)?.id ?? null)
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section className="ac-modal ac-role-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>角色配置</h2>
            <p>角色是可复用的职责与行为契约，团队成员再选择 Claude 或 Codex 运行。</p>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="ac-role-layout">
          <aside>
            <button type="button" className="ac-new-role" onClick={beginCreate}>
              <Plus size={14} /> 新建自定义角色
            </button>
            {templates.map((template) => (
              <button
                type="button"
                className={template.id === selectedId ? 'is-active' : ''}
                key={template.id}
                onClick={() => {
                  setCreating(false)
                  setSelectedId(template.id)
                  setError(null)
                }}
              >
                <strong>{template.name}</strong>
                <small>{template.isBuiltin ? '系统预设 · 只读' : '自定义角色'}</small>
              </button>
            ))}
          </aside>
          <div className="ac-role-form">
            <label className="ac-field">
              <span>角色名称</span>
              <input
                value={draft.name}
                disabled={selected?.isBuiltin}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="例如：数据工程师"
              />
            </label>
            <label className="ac-field">
              <span>角色类型</span>
              <select
                value={draft.roleType}
                disabled={selected?.isBuiltin}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    roleType: event.target.value as RoleTemplateInput['roleType'],
                  }))
                }
              >
                <option value="custom">自定义</option>
                <option value="coder">开发</option>
                <option value="reviewer">审查</option>
                <option value="tester">测试</option>
                <option value="orchestrator">部门经理</option>
              </select>
            </label>
            <label className="ac-field ac-field--grow">
              <span>行为契约</span>
              <textarea
                value={draft.description}
                disabled={selected?.isBuiltin}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="说明职责、能力、边界、执行方式与完成标准。可引用项目内的技能 Markdown。"
              />
            </label>
            {selected?.isBuiltin ? (
              <p className="ac-settings-note">
                系统预设角色只读；可新建自定义角色覆盖自己的工作方式。
              </p>
            ) : null}
            {error ? <p className="ac-form-error">{error}</p> : null}
            <div className="ac-role-actions">
              {!creating && selected && !selected.isBuiltin ? (
                <button type="button" className="ac-button ac-button--danger" onClick={remove}>
                  <Trash2 size={14} /> 删除角色
                </button>
              ) : null}
              <button
                type="button"
                className="ac-button ac-button--primary"
                disabled={busy || selected?.isBuiltin}
                onClick={save}
              >
                <Save size={14} /> {creating ? '创建角色' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
