import { CheckCircle2, KeyRound, PlugZap, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'

import type { CommandPreset, StitchConfigurationInput, StitchStatus } from '../api.js'

interface SettingsDialogProps {
  busy: boolean
  commandPresets: CommandPreset[]
  onClose: () => void
  onDetectCli: () => Promise<number>
  onSaveStitch: (input: StitchConfigurationInput) => Promise<void>
  stitchStatus: StitchStatus
}

/** Centralizes integrations and runtime dependencies away from the project conversation. */
export const SettingsDialog = ({
  busy,
  commandPresets,
  onClose,
  onDetectCli,
  onSaveStitch,
  stitchStatus,
}: SettingsDialogProps) => {
  const [endpoint, setEndpoint] = useState(stitchStatus.endpointOrigin ?? '')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  /** Tracks the manual discovery request independently from unrelated settings saves. */
  const [detectingCli, setDetectingCli] = useState(false)
  /** Keeps the latest successful discovery result visible without changing preset data. */
  const [cliDetectionSummary, setCliDetectionSummary] = useState<string | null>(null)

  /** Saves a credential update while leaving the existing secret untouched when the field is blank. */
  const save = async () => {
    setSaved(false)
    try {
      await onSaveStitch({ apiKey: apiKey.trim() || undefined, endpoint: endpoint.trim() })
      setApiKey('')
      setSaved(true)
    } catch {
      // The application-level error banner owns the message; this dialog only prevents false success.
    }
  }

  /** Explicitly removes the locally stored Stitch credential and endpoint. */
  const clear = async () => {
    setSaved(false)
    try {
      await onSaveStitch({ clearApiKey: true, endpoint: '' })
      setEndpoint('')
      setApiKey('')
    } catch {
      // Preserve the entered values so the user can correct a failed request without retyping.
    }
  }

  /** Re-runs Runtime-side CLI discovery and reports how many bases can be launched. */
  const detectCli = async () => {
    setDetectingCli(true)
    setCliDetectionSummary(null)
    try {
      const availableCount = await onDetectCli()
      setCliDetectionSummary(
        availableCount > 0 ? `检测完成，可接入 ${availableCount} 个 CLI` : '检测完成，未发现可接入的 CLI'
      )
    } catch {
      // The application-level error banner provides the actionable request failure.
    } finally {
      setDetectingCli(false)
    }
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section className="ac-modal ac-settings-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>设置</h2>
            <p>配置本地 CLI、设计能力与外部 MCP 依赖。</p>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="ac-settings-layout">
          <nav aria-label="设置分类">
            <button type="button" className="is-active">
              <PlugZap size={15} /> 能力与依赖
            </button>
          </nav>
          <div className="ac-settings-content">
            <section>
              <h3>Stitch MCP</h3>
              <p>UI 设计师通过真实 Stitch MCP 生成与修订桌面设计稿。</p>
              <div className={`ac-integration-state ${stitchStatus.configured ? 'is-ready' : ''}`}>
                <span
                  className={`ac-status-dot ${stitchStatus.configured ? 'is-running' : 'is-warning'}`}
                />
                <strong>{stitchStatus.configured ? '已配置' : '尚未配置'}</strong>
                <small>{stitchStatus.endpointOrigin ?? '等待填写 endpoint 与 API key'}</small>
              </div>
              <label className="ac-field">
                <span>MCP Endpoint</span>
                <input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="https://…/mcp"
                  spellCheck={false}
                />
              </label>
              <label className="ac-field">
                <span>API Key</span>
                <div className="ac-secret-field">
                  <KeyRound size={15} />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      stitchStatus.configured ? '留空则保留现有密钥' : '输入本地使用的密钥'
                    }
                  />
                </div>
              </label>
              <p className="ac-settings-note">
                密钥仅保存在本机 Runtime SQLite，不会显示在对话中。
              </p>
              <div className="ac-settings-actions">
                <button type="button" className="ac-button" disabled={busy} onClick={clear}>
                  清除配置
                </button>
                <button
                  type="button"
                  className="ac-button ac-button--primary"
                  disabled={busy || !endpoint.trim()}
                  onClick={save}
                >
                  保存 Stitch 配置
                </button>
                {saved ? (
                  <span className="ac-saved-state">
                    <CheckCircle2 size={14} /> 已保存
                  </span>
                ) : null}
              </div>
            </section>

            <section>
              <div className="ac-settings-section-heading">
                <div>
                  <h3>CLI 基座</h3>
                  <p>成员头像与上下文均按实际启动的 CLI 类型显示。</p>
                </div>
                <button
                  type="button"
                  className="ac-button ac-cli-detect-button"
                  disabled={busy || detectingCli}
                  onClick={detectCli}
                >
                  <RefreshCw size={14} className={detectingCli ? 'is-spinning' : ''} />
                  {detectingCli ? '正在检测' : '检测 CLI'}
                </button>
              </div>
              <div className="ac-cli-dependency-list">
                {commandPresets.map((preset) => (
                  <div key={preset.id}>
                    <img src={`/cli-icons/${preset.id}.png`} alt="" />
                    <span>
                      <strong>{preset.displayName}</strong>
                      <small>{preset.command}</small>
                    </span>
                    <em className={preset.available ? 'is-ready' : ''}>
                      {preset.available ? '可用' : '未找到'}
                    </em>
                  </div>
                ))}
              </div>
              {cliDetectionSummary ? (
                <p className="ac-cli-detection-summary" aria-live="polite">
                  <CheckCircle2 size={13} /> {cliDetectionSummary}
                </p>
              ) : null}
            </section>

            <section>
              <h3>内置能力</h3>
              <div className="ac-builtins">
                <span>Archify · 架构演示图</span>
                <span>matt-skills · grill-me / to-spec</span>
                <span>cc-hardness · 预设研发角色</span>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
