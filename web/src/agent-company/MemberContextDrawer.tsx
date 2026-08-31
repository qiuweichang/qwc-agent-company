import { Clock3, FileText, TerminalSquare, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { TeamListItem } from '../../../src/shared/types.js'
import type { ConversationEntry } from '../../../src/shared/workflow-types.js'
import {
  getMemberProcessContext,
  type HistoricalTerminalRun,
  type MemberProcessContext,
  type TerminalRunSummary,
} from '../api.js'
import { CliAvatar } from './CliAvatar.js'

export interface ContextMember {
  commandPresetId: string
  id: string
  name: string
  roleLabel: string
  status: TeamListItem['status']
}

interface MemberContextDrawerProps {
  member: ContextMember
  onClose: () => void
  runs: TerminalRunSummary[]
  workspaceId: string
}

const formatDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(timestamp)

const ESCAPE_CHARACTER = String.fromCharCode(27)
const BELL_CHARACTER = String.fromCharCode(7)
const ANSI_SEQUENCE = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, 'g')
const OSC_SEQUENCE = new RegExp(`${ESCAPE_CHARACTER}\\][^${BELL_CHARACTER}]*${BELL_CHARACTER}`, 'g')

/** Removes terminal control sequences while preserving the complete human-readable CLI transcript. */
const stripTerminalControls = (value: string) =>
  value.replace(ANSI_SEQUENCE, '').replace(OSC_SEQUENCE, '').replace(/\r/g, '')

/** Shows durable assignments and reports together with the member's current full PTY context. */
export const MemberContextDrawer = ({
  member,
  onClose,
  runs,
  workspaceId,
}: MemberContextDrawerProps) => {
  const [dispatches, setDispatches] = useState<MemberProcessContext['dispatches']>([])
  const [messages, setMessages] = useState<ConversationEntry[]>([])
  const [historicalRuns, setHistoricalRuns] = useState<HistoricalTerminalRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const run = runs.find((item) => item.agent_id === member.id)
  const runId = run?.run_id
  const effectiveStatus = runId ? 'working' : member.status

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    /** Refreshes durable assignments and reports while the drawer stays open. */
    const loadHistory = async () => {
      try {
        const context = await getMemberProcessContext(workspaceId, member.id)
        if (!cancelled) {
          setMessages(context.messages.sort((left, right) => left.createdAt - right.createdAt))
          setDispatches(context.dispatches.sort((left, right) => left.createdAt - right.createdAt))
          setHistoricalRuns(context.runs)
          setError(null)
          setLoading(false)
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setLoading(false)
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(loadHistory, 1400)
      }
    }
    void loadHistory()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [member.id, workspaceId])

  const completedTerminalRuns = historicalRuns
    .filter((terminalRun) => terminalRun.runId !== runId)
    .sort((left, right) => right.startedAt - left.startedAt)

  const history = useMemo(
    () =>
      [
        ...dispatches.map((dispatch) => ({
          id: `dispatch-${dispatch.id}`,
          kind: 'dispatch' as const,
          text: dispatch.text,
          timestamp: dispatch.createdAt,
          title: `收到派单 · ${dispatch.status}`,
        })),
        ...messages.map((message) => ({
          id: `message-${message.id}`,
          kind: message.type === 'report' ? ('report' as const) : ('message' as const),
          text: message.text,
          timestamp: message.createdAt,
          title: message.type === 'report' ? '任务汇报' : '上下文记录',
        })),
      ].sort((left, right) => left.timestamp - right.timestamp),
    [dispatches, messages]
  )

  return (
    <div className="ac-drawer-backdrop" role="presentation">
      <aside
        className="ac-context-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${member.name} 的上下文历史`}
      >
        <header>
          <CliAvatar label={member.name} presetId={member.commandPresetId} size="large" />
          <div>
            <h2>{member.name}</h2>
            <p>
              {member.roleLabel} · {member.commandPresetId === 'codex' ? 'Codex CLI' : 'Claude CLI'}
            </p>
          </div>
          <span className={`ac-member-state ac-member-state--${effectiveStatus}`}>
            {effectiveStatus === 'working'
              ? '运行中'
              : effectiveStatus === 'idle'
                ? '空闲'
                : '已停止'}
          </span>
          <button type="button" className="ac-icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="ac-context-drawer__tabs">
          <strong>上下文历史</strong>
          <span>{history.length} 条持久记录</span>
        </div>

        <div className="ac-context-drawer__body">
          {loading ? <p className="ac-context-empty">正在加载成员上下文…</p> : null}
          {error ? <p className="ac-form-error">{error}</p> : null}
          {runId ? (
            <section className="ac-terminal-context ac-terminal-context--live">
              <div>
                <span className="ac-live-pulse" aria-hidden="true" />
                <TerminalSquare size={15} />
                <strong>当前 CLI 实时执行</strong>
                <span>{run?.status ?? 'running'} · 自动跟随输出</span>
              </div>
              <div
                className="ac-live-terminal-slot"
                id={`worker-pty-${runId}`}
                aria-label={`${member.name} 的实时 CLI 输出`}
              />
            </section>
          ) : null}
          {completedTerminalRuns.map((terminalRun) => (
            <section className="ac-terminal-context" key={terminalRun.runId}>
              <div>
                <TerminalSquare size={15} />
                <strong>历史 CLI 会话</strong>
                <span>{terminalRun.status}</span>
              </div>
              <pre>
                {stripTerminalControls(terminalRun.output) || '该会话没有可读取的终端输出。'}
              </pre>
            </section>
          ))}
          {history.map((item) => (
            <article className={`ac-context-entry ac-context-entry--${item.kind}`} key={item.id}>
              <header>
                {item.kind === 'dispatch' ? <FileText size={14} /> : <Clock3 size={14} />}
                <strong>{item.title}</strong>
                <time>{formatDateTime(item.timestamp)}</time>
              </header>
              <pre>{item.text}</pre>
            </article>
          ))}
          {!loading && !runId && historicalRuns.length === 0 && history.length === 0 ? (
            <p className="ac-context-empty">这个成员还没有派单、汇报或 CLI 会话记录。</p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
