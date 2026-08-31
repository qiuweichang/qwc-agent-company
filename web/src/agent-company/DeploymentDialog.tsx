import { ExternalLink, Rocket, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ProjectDeployment } from '../../../src/shared/project-operations.js'
import { deployProject, getProjectDeployment, stopProjectDeployment } from '../api.js'

/** Manages one delivered project's local Windows frontend/backend deployment. */
export const DeploymentDialog = ({
  onClose,
  workspaceId,
}: {
  onClose: () => void
  workspaceId: string
}) => {
  const [deployment, setDeployment] = useState<ProjectDeployment | null>(null)
  const [frontendPort, setFrontendPort] = useState('')
  const [backendPort, setBackendPort] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getProjectDeployment(workspaceId)
      .then((value) => {
        if (!cancelled) setDeployment(value)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  /** Generates scripts and starts both services, using random free ports when fields are blank. */
  const deploy = async () => {
    setBusy(true)
    try {
      setDeployment(
        await deployProject(workspaceId, {
          ...(backendPort ? { backendPort: Number(backendPort) } : {}),
          ...(frontendPort ? { frontendPort: Number(frontendPort) } : {}),
        })
      )
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Stops the exact process ids created by the current workspace deployment. */
  const stop = async () => {
    setBusy(true)
    try {
      setDeployment(await stopProjectDeployment(workspaceId))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ac-modal-backdrop" role="presentation">
      <section className="ac-modal ac-deployment-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>本地部署</h2>
            <p>生成 Windows 一键部署脚本，并让前端代理准确指向本次后端端口。</p>
          </div>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="ac-deployment-ports">
          <label className="ac-field">
            <span>前端端口</span>
            <input
              type="number"
              min="1024"
              max="65535"
              value={frontendPort}
              onChange={(event) => setFrontendPort(event.target.value)}
              placeholder="留空随机分配"
            />
          </label>
          <label className="ac-field">
            <span>后端端口</span>
            <input
              type="number"
              min="1024"
              max="65535"
              value={backendPort}
              onChange={(event) => setBackendPort(event.target.value)}
              placeholder="留空随机分配"
            />
          </label>
        </div>
        {deployment ? (
          <section className={`ac-deployment-state ac-deployment-state--${deployment.status}`}>
            <strong>{deployment.status === 'running' ? '部署运行中' : '部署已停止'}</strong>
            <a href={deployment.frontendUrl} target="_blank" rel="noreferrer">
              前端 · {deployment.frontendUrl} <ExternalLink size={12} />
            </a>
            <a href={deployment.backendUrl} target="_blank" rel="noreferrer">
              后端 · {deployment.backendUrl} <ExternalLink size={12} />
            </a>
          </section>
        ) : null}
        {error ? <p className="ac-form-error">{error}</p> : null}
        <footer>
          {deployment?.status === 'running' ? (
            <button type="button" className="ac-button" disabled={busy} onClick={() => void stop()}>
              <Square size={13} /> 停止部署
            </button>
          ) : null}
          <button
            type="button"
            className="ac-button ac-button--primary"
            disabled={busy}
            onClick={() => void deploy()}
          >
            <Rocket size={14} /> {deployment ? '重新部署' : '分配端口并部署'}
          </button>
        </footer>
      </section>
    </div>
  )
}
