import { Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { TeamListItem } from '../../../src/shared/types.js'
import type { CommandPreset, RoleTemplate } from '../api.js'
import { CliAvatar } from './CliAvatar.js'

interface TeamDialogProps {
  busy: boolean
  commandPresets: CommandPreset[]
  members: TeamListItem[]
  onAdd: (input: {
    commandPresetId: string
    description: string
    name: string
    roleTemplateId: string | null
  }) => Promise<void>
  onClose: () => void
  onDelete: (memberId: string) => Promise<void>
  roleTemplates: RoleTemplate[]
}

/** Manages real worker membership and supports a reusable custom role contract. */
export const TeamDialog = ({
  busy,
  commandPresets,
  members,
  onAdd,
  onClose,
  onDelete,
  roleTemplates,
}: TeamDialogProps) => {
  const usableTemplates = useMemo(
    () => roleTemplates.filter((template) => template.roleType !== 'orchestrator'),
    [roleTemplates]
  )
  const [templateId, setTemplateId] = useState(usableTemplates[0]?.id ?? '__custom')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [presetId, setPresetId] = useState('claude')
  const [error, setError] = useState<string | null>(null)
  const selectedTemplate = usableTemplates.find((template) => template.id === templateId)

  /** Switches role presets and primes the editable member name. */
  const selectTemplate = (value: string) => {
    setTemplateId(value)
    const template = usableTemplates.find((item) => item.id === value)
    setName(template?.name ?? '')
    setDescription(template?.description ?? '')
  }

  /** Creates a worker from a preset or the supplied custom behavior contract. */
  const submit = async () => {
    const resolvedName = name.trim() || selectedTemplate?.name || ''
    const resolvedDescription = description.trim() || selectedTemplate?.description || ''
    if (!resolvedName || !resolvedDescription) {
      setError('成员名称和角色说明不能为空。')
      return
    }
    setError(null)
    await onAdd({
      commandPresetId: presetId,
      description: resolvedDescription,
      name: resolvedName,
      roleTemplateId: selectedTemplate?.id ?? null,
    })
    setName('')
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section
        className="ac-modal ac-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-title"
      >
        <header>
          <div>
            <span className="ac-eyebrow">CLI TEAM</span>
            <h2 id="team-title">角色与团队成员</h2>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="ac-team-editor">
          <div className="ac-team-editor__members">
            <h3>当前成员</h3>
            {members.map((member) => (
              <div className="ac-member-row" key={member.id}>
                <CliAvatar label={member.name} presetId={member.commandPresetId} />
                <div>
                  <strong>{member.name}</strong>
                  <small>
                    {member.status === 'working'
                      ? '工作中'
                      : member.status === 'idle'
                        ? '空闲'
                        : '已停止'}
                  </small>
                </div>
                <button
                  type="button"
                  title={`删除 ${member.name}`}
                  onClick={() => onDelete(member.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="ac-team-editor__form">
            <h3>添加成员</h3>
            <label className="ac-field">
              <span>角色模板</span>
              <select value={templateId} onChange={(event) => selectTemplate(event.target.value)}>
                {usableTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
                <option value="__custom">自定义角色</option>
              </select>
            </label>
            <label className="ac-field">
              <span>成员名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={selectedTemplate?.name ?? '例如：数据工程师'}
              />
            </label>
            <label className="ac-field">
              <span>行为契约</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="说明职责、边界、工作方式与完成标准"
              />
            </label>
            <label className="ac-field">
              <span>CLI 基座</span>
              <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
                {commandPresets.map((preset) => (
                  <option key={preset.id} value={preset.id} disabled={!preset.available}>
                    {preset.displayName}
                    {preset.available ? '' : '（不可用）'}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="ac-form-error">{error}</p> : null}
            <button
              type="button"
              className="ac-button ac-button--primary"
              disabled={busy}
              onClick={submit}
            >
              <Plus size={15} /> 添加真实 CLI 成员
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
