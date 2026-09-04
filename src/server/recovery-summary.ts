import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'
import type { ProjectWorkflowState } from '../shared/workflow-types.js'

import { getHiveTeamRules } from './hive-team-guidance.js'
import type { RecoveryMessage } from './message-log-store.js'
import { wrapSystemMessage } from './system-message.js'
import { TASKS_RELATIVE_PATH } from './tasks-file.js'

const TASKS_HEAD_LIMIT = 1536

const formatUserInputs = (messages: RecoveryMessage[]) => {
  const userInputs = messages.filter((message) => message.type === 'user_input')
  return userInputs.length > 0
    ? userInputs.slice(-5).map((message) => `- user: ${message.text}`)
    : ['- （项目尚无 user_input）']
}

/**
 * Formats the database-backed lifecycle state for a restarted CLI agent. This
 * state is authoritative because `.hive/tasks.md` can lag behind a Web gate
 * transition or an interrupted manager run.
 */
const formatWorkflowState = (workflow: ProjectWorkflowState) => [
  `- stage: ${workflow.stage}`,
  `- active_thread: ${workflow.activeThread}`,
  `- requirements_frozen: ${workflow.requirementsFrozen}`,
  `- architecture_status: ${workflow.architectureStatus}`,
  `- ui_status: ${workflow.uiStatus}`,
  '- 以上数据库流程状态为权威事实；若与 `.hive/tasks.md` 冲突，必须按这里的状态继续并同步修正任务文件。',
]

const formatTaskEvents = (messages: RecoveryMessage[], agent: AgentSummary) => {
  const taskEvents = messages.filter(
    (message): message is Extract<RecoveryMessage, { type: 'send' | 'report' | 'status' }> => {
      if (agent.role === 'orchestrator') {
        if (message.type === 'send') return message.from === agent.id
        return message.type === 'report' || message.type === 'status'
      }
      if (message.type === 'send') return message.to === agent.id || message.from === agent.id
      return (message.type === 'report' || message.type === 'status') && message.from === agent.id
    }
  )
  return taskEvents.length > 0
    ? taskEvents.slice(-8).map((message) => {
        if (message.type === 'send') return `- send -> ${message.to}: ${message.text}`
        if (message.type === 'status') return `- status <- ${message.from}: ${message.text}`
        const status = message.status ? ` [${message.status}]` : ''
        return `- report <- ${message.from}${status}: ${message.text}`
      })
    : ['- （最近没有任务事件）']
}

const getOpenTaskTargets = (agent: AgentSummary, workers: AgentSummary[]) =>
  agent.role === 'orchestrator' ? workers : [agent]

const formatOpenTasks = (
  messages: RecoveryMessage[],
  agent: AgentSummary,
  workers: AgentSummary[]
) => {
  const targetAgents = getOpenTaskTargets(agent, workers).filter(
    (target) => target.role !== 'orchestrator'
  )
  const targetIds = new Set(targetAgents.map((target) => target.id))
  const queues = new Map<string, Array<Extract<RecoveryMessage, { type: 'send' }>>>()

  for (const message of messages) {
    if (message.type === 'send' && targetIds.has(message.to)) {
      const queue = queues.get(message.to) ?? []
      queue.push(message)
      queues.set(message.to, queue)
      continue
    }

    if (message.type === 'report' && targetIds.has(message.from)) {
      queues.get(message.from)?.shift()
    }
  }

  const lines: string[] = []
  for (const target of targetAgents) {
    const queue = queues.get(target.id) ?? []
    for (const task of queue.slice(-8)) {
      lines.push(`- ${target.name}: ${task.text}`)
    }
    if (target.pendingTaskCount > queue.length) {
      lines.push(
        `- ${target.name}: ${target.pendingTaskCount - queue.length} 个 pending 无可恢复详情`
      )
    }
  }

  return lines.length > 0 ? lines : ['- （当前没有未完成任务）']
}

const formatWorkers = (workers: AgentSummary[]) => {
  if (workers.length === 0) return ['- 当前没有其他 worker']
  return workers.map(
    (worker) =>
      `- ${worker.name} (${worker.role}, ${worker.status}, pending_task_count: ${worker.pendingTaskCount})`
  )
}

const getTaskSectionTitle = (agent: AgentSummary) =>
  agent.role === 'orchestrator' ? '## 你已派出的任务' : '## 最近派给你的任务'

export const buildRecoverySummary = ({
  agent,
  allTaskMessages,
  messages,
  tasksContent,
  workers,
  workspace,
  workflow,
}: {
  agent: AgentSummary
  allTaskMessages?: RecoveryMessage[]
  messages: RecoveryMessage[]
  tasksContent: string
  workers: AgentSummary[]
  workspace: WorkspaceSummary
  workflow: ProjectWorkflowState
}) =>
  wrapSystemMessage(
    [
      `你是 ${workspace.name} 的 ${agent.name}（${agent.role}）。`,
      '你刚被 Hive 重启了，且无法通过原生 session resume 恢复。下面是接力上下文。',
      '',
      '## 最近与 user 的对话',
      ...formatUserInputs(messages),
      '',
      '## 当前权威流程状态（数据库）',
      ...formatWorkflowState(workflow),
      '',
      getTaskSectionTitle(agent),
      ...formatTaskEvents(messages, agent),
      '',
      '## 当前未完成任务',
      ...formatOpenTasks(allTaskMessages ?? messages, agent, workers),
      '',
      `## 当前 ${TASKS_RELATIVE_PATH} 状态`,
      tasksContent.slice(0, TASKS_HEAD_LIMIT) || '(空)',
      '',
      '## 当前活跃 worker',
      ...formatWorkers(workers),
      '',
      agent.role === 'orchestrator' ? '## Hive worker 派单规则' : '## Hive worker 边界',
      ...getHiveTeamRules(agent),
      '',
      agent.role === 'orchestrator'
        ? '请基于最近一条 user 指令和权威流程状态继续。若 stage=development 且前后端没有未完成派单，必须立即通过 Bash/Shell 工具实际执行 team send；以命令返回的 dispatch_id 为成功依据，禁止只打印命令文本。'
        : '请基于此继续。如果不确定，问 user。',
    ].join('\n')
  )
