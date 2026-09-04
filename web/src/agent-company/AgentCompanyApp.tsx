import {
  Archive,
  Check,
  ChevronDown,
  Circle,
  FileCode2,
  LayoutDashboard,
  MessageSquareText,
  Pencil,
  Plus,
  Rocket,
  Send,
  Settings,
  Settings2,
  Sparkles,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEPARTMENT_MANAGER_NAME,
  PRODUCT_MANAGER_NAME,
} from '../../../src/shared/agent-company-labels.js'
import type { MemberPlan, MemberPlanItem } from '../../../src/shared/project-operations.js'
import type { TeamListItem, WorkspaceSummary } from '../../../src/shared/types.js'
import type {
  ConversationEntry,
  ProjectWorkflowState,
  WorkflowAction,
  WorkflowThread,
} from '../../../src/shared/workflow-types.js'
import {
  type CommandPreset,
  createRoleTemplate,
  createWorker,
  createWorkspace,
  deleteRoleTemplate,
  deleteWorker,
  deleteWorkspace,
  getActiveWorkspaceId,
  getProjectWorkflow,
  getStitchStatus,
  initializeUiSession,
  listCommandPresets,
  listConversation,
  listMemberPlans,
  listRoleTemplates,
  listTerminalRuns,
  listWorkers,
  listWorkspaces,
  type RoleTemplate,
  renameWorkspace,
  type StitchStatus,
  saveActiveWorkspaceId,
  saveStitchConfiguration,
  sendProjectMessage,
  transitionProjectWorkflow,
  updateRoleTemplate,
} from '../api.js'
import { WorkspaceTerminalPanels } from '../WorkspaceTerminalPanels.js'
import { ArtifactFrame, orderConversationArtifacts } from './ArtifactFrame.js'
import { CliAvatar } from './CliAvatar.js'
import { DeleteProjectDialog } from './DeleteProjectDialog.js'
import { DeploymentDialog } from './DeploymentDialog.js'
import { type ContextMember, MemberContextDrawer } from './MemberContextDrawer.js'
import { MessageJumpRail } from './MessageJumpRail.js'
import {
  ProductChoicePanel,
  parseProductChoicePrompt,
  RequirementFreezeAction,
} from './ProductChoicePanel.js'
import { ProjectArchivePanel } from './ProjectArchivePanel.js'
import { ProjectDialog } from './ProjectDialog.js'
import { RenameProjectDialog } from './RenameProjectDialog.js'
import { RoleConfigDialog } from './RoleConfigDialog.js'
import { SettingsDialog } from './SettingsDialog.js'
import { StagePopover } from './StagePopover.js'
import { TeamDialog } from './TeamDialog.js'
import './agent-company.css'

const DEFAULT_ROLE_IDS = [
  'product_manager',
  'architect',
  'ui_designer',
  'frontend_engineer',
  'backend_engineer',
  'test_engineer',
] as const

const initialWorkflow = (workspaceId: string): ProjectWorkflowState => ({
  activeThread: 'planning',
  architectureStatus: 'not_ready',
  requirementsFrozen: false,
  stage: 'requirements',
  uiStatus: 'not_ready',
  updatedAt: Date.now(),
  workspaceId,
})

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)

const actorTone = (entry: ConversationEntry) => {
  if (entry.type === 'user_input') return 'user'
  if (entry.type === 'system') return 'system'
  if (entry.actorName.includes('架构')) return 'architect'
  if (entry.actorName.includes('UI')) return 'designer'
  if (entry.actorName.includes('产品')) return 'product'
  return 'agent'
}

const hasRoleArtifact = (entries: ConversationEntry[], roleHint: string) =>
  entries.some((entry) => entry.actorName.includes(roleHint) && entry.artifacts.length > 0)

/** Builds a project-specific first hypothesis so the PM asks a focused question, not for a rewrite. */
const buildProjectKickoff = (projectName: string) => {
  if (/(警务|公安|警情|治安)/u.test(projectName)) {
    return `我先基于「${projectName}」做了初步判断：它大概率面向公安指挥和管理人员，用于汇总警情态势、警力分布、事件点位与设备状态，帮助值班人员快速识别风险并安排处置优先级。后续需要重点澄清使用场景、数据来源、刷新频率和处置闭环。\n\n第一个关键问题：主要使用者是谁，他们看到异常警情后最先需要做出的一个决策是什么？`
  }
  if (/(交通|运输|物流|公交|道路)/u.test(projectName)) {
    return `我先基于「${projectName}」做了初步判断：它大概率用于汇总关键运输指标、发现异常并辅助调度决策，后续需要澄清数据来源、刷新频率和核心指标，而不是先讨论页面颜色。\n\n第一个关键问题：谁会在什么工作场景中查看这个大屏，他们最需要据此做出的一个决策是什么？`
  }
  if (/(大屏|看板|数据|分析|监控)/u.test(projectName)) {
    return `我先基于「${projectName}」做了初步判断：它大概率用于汇总关键业务指标、发现异常并辅助实时决策，后续需要澄清数据来源、刷新频率和核心指标，而不是先讨论页面颜色。\n\n第一个关键问题：谁会在什么工作场景中查看这个大屏，他们最需要据此做出的一个决策是什么？`
  }
  if (/(管理|平台|系统|后台)/u.test(projectName)) {
    return `我先基于「${projectName}」做了初步判断：这是一个围绕业务对象和操作流程的管理工具，需求重点会落在使用者、核心数据、权限边界和可验收流程。\n\n第一个关键问题：最主要的使用者是谁，他每天最需要完成的一个核心任务是什么？`
  }
  return `我先基于项目名称「${projectName}」梳理了初步方向，接下来会用一次一个问题的方式验证目标用户、核心场景和成功标准，不需要你重新写一遍完整需求。\n\n第一个关键问题：这个项目首先要帮助哪类用户解决哪个最紧迫的问题？`
}

/** Converts a hidden assignment prompt into the one-line public activity shown in conversation. */
const summarizeDispatch = (entry: ConversationEntry) => {
  if (entry.text.startsWith('已向 ')) return entry.text
  const recipient = entry.recipientName ?? '团队成员'
  const normalized = entry.text.replace(/\s+/g, ' ').trim()
  const withoutRolePreamble = normalized.replace(/^你是本项目的[^。.!！]*[。.!！]\s*/, '')
  const taskMatch = withoutRolePreamble.match(
    /(?:任务内容|目标|请立即|请)[:：]?\s*([^。；;]{4,80})/
  )
  const task = (taskMatch?.[1] ?? withoutRolePreamble).slice(0, 72).trim()
  return `已向 ${recipient} 派发：${task || '开始执行新任务'}`
}

/**
 * Main desktop application for the local software-company workflow. It polls
 * Runtime state because CLI agents report asynchronously through their PTYs.
 */
export const AgentCompanyApp = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [thread, setThread] = useState<WorkflowThread>('planning')
  const [workflow, setWorkflow] = useState<ProjectWorkflowState | null>(null)
  const [entries, setEntries] = useState<ConversationEntry[]>([])
  const [workers, setWorkers] = useState<TeamListItem[]>([])
  const [terminalRuns, setTerminalRuns] = useState<Awaited<ReturnType<typeof listTerminalRuns>>>([])
  const [memberPlans, setMemberPlans] = useState<MemberPlan[]>([])
  const [orchestratorRunning, setOrchestratorRunning] = useState(false)
  const [roleTemplates, setRoleTemplates] = useState<RoleTemplate[]>([])
  const [commandPresets, setCommandPresets] = useState<CommandPreset[]>([])
  const [stitchStatus, setStitchStatus] = useState<StitchStatus>({
    configured: false,
    endpointOrigin: null,
  })
  const [recipient, setRecipient] = useState('产品经理')
  const [draft, setDraft] = useState('')
  /** Keeps immediate feedback visible between message submission and the next Runtime status poll. */
  const [pendingRecipient, setPendingRecipient] = useState<{
    name: string
    since: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showProjectDialog, setShowProjectDialog] = useState(false)
  const [showTeamDialog, setShowTeamDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showRoleDialog, setShowRoleDialog] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [showDeploymentDialog, setShowDeploymentDialog] = useState(false)
  const [renamingWorkspace, setRenamingWorkspace] = useState<WorkspaceSummary | null>(null)
  const [deletingWorkspace, setDeletingWorkspace] = useState<WorkspaceSummary | null>(null)
  const [selectedMember, setSelectedMember] = useState<ContextMember | null>(null)
  const messageRefs = useRef<Map<number, HTMLElement>>(new Map())

  const activeWorkspace =
    workspaces?.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  /** Loads identity, presets and the last selected project after obtaining the UI cookie. */
  useEffect(() => {
    let cancelled = false
    void initializeUiSession()
      .then(async () => {
        const [projects, savedId, templates, presets, stitch] = await Promise.all([
          listWorkspaces(),
          getActiveWorkspaceId(),
          listRoleTemplates(),
          listCommandPresets(),
          getStitchStatus(),
        ])
        if (cancelled) return
        setWorkspaces(projects)
        setRoleTemplates(templates)
        setCommandPresets(presets)
        setStitchStatus(stitch)
        setActiveWorkspaceId(
          projects.some((workspace) => workspace.id === savedId)
            ? savedId
            : (projects[0]?.id ?? null)
        )
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Refreshes conversation, lifecycle and PTY summaries without overlapping polls. */
  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkflow(null)
      setEntries([])
      setWorkers([])
      setTerminalRuns([])
      setMemberPlans([])
      return
    }
    let cancelled = false
    let timer: number | undefined
    const refresh = async () => {
      try {
        const [nextWorkflow, nextEntries, nextWorkers, runs, plans] = await Promise.all([
          getProjectWorkflow(activeWorkspaceId),
          listConversation(activeWorkspaceId, thread),
          listWorkers(activeWorkspaceId),
          listTerminalRuns(activeWorkspaceId),
          listMemberPlans(activeWorkspaceId),
        ])
        if (!cancelled) {
          setWorkflow(nextWorkflow)
          setEntries(nextEntries)
          setWorkers(nextWorkers)
          setTerminalRuns(runs)
          setMemberPlans(plans)
          setOrchestratorRunning(
            runs.some(
              (run) =>
                run.agent_id === `${activeWorkspaceId}:orchestrator` &&
                ['running', 'starting'].includes(run.status)
            )
          )
          setPendingRecipient((current) => {
            if (!current) return null
            const targetWorker = nextWorkers.find((worker) => worker.name === current.name)
            const targetRun = runs.find((run) =>
              current.name === DEPARTMENT_MANAGER_NAME
                ? run.agent_id === `${activeWorkspaceId}:orchestrator`
                : run.agent_id === targetWorker?.id
            )
            const targetActive = ['running', 'starting'].includes(targetRun?.status ?? '')
            const targetFinished = nextEntries.some(
              (entry) =>
                entry.actorName === current.name &&
                entry.createdAt >= current.since &&
                ['report', 'status'].includes(entry.type)
            )
            const targetFailed = targetRun?.status === 'error'
            return targetActive || targetFinished || targetFailed ? null : current
          })
          setError(null)
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!cancelled) timer = window.setTimeout(refresh, 1400)
      }
    }
    void refresh()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [activeWorkspaceId, thread])

  const recipients = useMemo(() => {
    const preferred =
      thread === 'planning'
        ? [DEPARTMENT_MANAGER_NAME, '产品经理', '架构师', 'UI 设计师']
        : [DEPARTMENT_MANAGER_NAME, '前端工程师', '后端工程师', '测试工程师']
    const memberNames = workers.map((worker) => worker.name)
    return Array.from(new Set([...preferred, ...memberNames]))
  }, [thread, workers])

  /** Selects and persists a project without altering its lifecycle stage. */
  const selectWorkspace = useCallback(async (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
    setShowArchive(false)
    await saveActiveWorkspaceId(workspaceId)
  }, [])

  /** Updates the project display name in SQLite and refreshes both rail and topbar immediately. */
  const renameProject = async (name: string) => {
    if (!renamingWorkspace) return
    setBusy(true)
    try {
      const renamed = await renameWorkspace(renamingWorkspace.id, name)
      setWorkspaces(
        (current) =>
          current?.map((workspace) => (workspace.id === renamed.id ? renamed : workspace)) ?? []
      )
      setRenamingWorkspace(null)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Permanently removes the selected project's files and Runtime records, then selects a sibling. */
  const deleteProject = async () => {
    if (!deletingWorkspace) return
    const target = deletingWorkspace
    const remaining = (workspaces ?? []).filter((workspace) => workspace.id !== target.id)
    const deletedIndex = (workspaces ?? []).findIndex((workspace) => workspace.id === target.id)
    const nextWorkspace =
      remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)] ?? null
    setBusy(true)
    try {
      await deleteWorkspace(target.id)
      setWorkspaces(remaining)
      setDeletingWorkspace(null)
      if (target.id === activeWorkspaceId) {
        setActiveWorkspaceId(nextWorkspace?.id ?? null)
        setSelectedMember(null)
        setShowArchive(false)
        setShowDeploymentDialog(false)
        await saveActiveWorkspaceId(nextWorkspace?.id ?? null)
      }
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Creates the workspace and its focused six-role team without starting a CLI.
   * The planning screen provides the first project hypothesis locally; keeping every
   * member idle prevents a late department-manager kickoff from duplicating the
   * product manager's first user-directed assignment.
   */
  const createProject = async (input: { name: string; path: string }) => {
    setBusy(true)
    try {
      const workspace = await createWorkspace({
        autostart_orchestrator: false,
        command_preset_id: 'claude',
        name: input.name,
        path: input.path,
      })
      const defaults = roleTemplates.filter((template) =>
        DEFAULT_ROLE_IDS.includes(template.id as (typeof DEFAULT_ROLE_IDS)[number])
      )
      await Promise.all(
        defaults.map((template) =>
          createWorker(workspace.id, {
            autostart: false,
            command_preset_id:
              commandPresets.find((preset) => preset.command === template.defaultCommand)?.id ??
              'claude',
            description: template.description,
            name: template.name,
            role: template.roleType === 'orchestrator' ? 'custom' : template.roleType,
          })
        )
      )
      setWorkspaces((current) => [...(current ?? []), workspace])
      await selectWorkspace(workspace.id)
      setWorkflow(initialWorkflow(workspace.id))
      setShowProjectDialog(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Adds a preset or custom role and persists custom contracts for later reuse. */
  const addMember = async (input: {
    commandPresetId: string
    description: string
    name: string
    roleTemplateId: string | null
  }) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const sourceTemplate = roleTemplates.find((template) => template.id === input.roleTemplateId)
      let role =
        sourceTemplate?.roleType === 'orchestrator'
          ? 'custom'
          : (sourceTemplate?.roleType ?? 'custom')
      if (!sourceTemplate) {
        const customTemplate = await createRoleTemplate({
          defaultCommand:
            commandPresets.find((preset) => preset.id === input.commandPresetId)?.command ??
            'claude',
          description: input.description,
          name: input.name,
          roleType: 'custom',
        })
        setRoleTemplates((current) => [...current, customTemplate])
        role = customTemplate.roleType === 'orchestrator' ? 'custom' : customTemplate.roleType
      }
      const result = await createWorker(activeWorkspaceId, {
        autostart: false,
        command_preset_id: input.commandPresetId,
        description: input.description,
        name: input.name,
        role,
      })
      setWorkers((current) => [...current, result.worker])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Deletes the explicitly selected worker and its pending runtime state. */
  const removeMember = async (memberId: string) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      await deleteWorker(activeWorkspaceId, memberId)
      setWorkers((current) => current.filter((member) => member.id !== memberId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Persists a reusable custom role and refreshes the dedicated role editor. */
  const createRole = async (input: Parameters<typeof createRoleTemplate>[0]) => {
    setBusy(true)
    try {
      const created = await createRoleTemplate(input)
      setRoleTemplates((current) => [...current, created])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Updates one user-defined role contract without changing existing member sessions. */
  const updateRole = async (
    templateId: string,
    input: Parameters<typeof updateRoleTemplate>[1]
  ) => {
    setBusy(true)
    try {
      const updated = await updateRoleTemplate(templateId, input)
      setRoleTemplates((current) =>
        current.map((template) => (template.id === templateId ? updated : template))
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Removes one user-defined role after the server enforces built-in role protection. */
  const removeRole = async (templateId: string) => {
    setBusy(true)
    try {
      await deleteRoleTemplate(templateId)
      setRoleTemplates((current) => current.filter((template) => template.id !== templateId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Saves Stitch settings and immediately reflects readiness in the left-bottom settings screen. */
  const saveStitch = async (input: Parameters<typeof saveStitchConfiguration>[0]) => {
    setBusy(true)
    try {
      setStitchStatus(await saveStitchConfiguration(input))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      throw reason
    } finally {
      setBusy(false)
    }
  }

  /**
   * Re-runs backend CLI discovery so newly installed Codex or Claude commands become
   * selectable without reloading the page. Returns the launchable preset count.
   */
  const detectCliDependencies = async () => {
    setBusy(true)
    try {
      const detectedPresets = await listCommandPresets()
      setCommandPresets(detectedPresets)
      setError(null)
      return detectedPresets.filter((preset) => preset.available).length
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      throw reason
    } finally {
      setBusy(false)
    }
  }

  /**
   * Persists one user response for the requested recipient and mirrors it locally
   * so both composer replies and structured choices share identical semantics.
   * The optional freeze flag tells the PM to finalize the specification instead
   * of asking another question. Returns true only when Runtime accepts the message.
   */
  const submitProjectResponse = async (
    text: string,
    targetRecipient: string,
    options: { freezeRequirements?: boolean } = {}
  ) => {
    if (!activeWorkspaceId || !text.trim()) return false
    const normalizedText = text.trim()
    const sentAt = Date.now()
    setPendingRecipient({ name: targetRecipient, since: sentAt })
    setBusy(true)
    try {
      await sendProjectMessage(activeWorkspaceId, {
        ...(options.freezeRequirements ? { freezeRequirements: true } : {}),
        recipient: targetRecipient,
        text: normalizedText,
        thread,
      })
      setEntries((current) => [
        ...current,
        {
          actorId: null,
          actorName: '你',
          actorRole: 'user',
          artifacts: [],
          createdAt: sentAt,
          id: -sentAt,
          status: null,
          text: normalizedText,
          thread,
          type: 'user_input',
        },
      ])
      return true
    } catch (reason) {
      setPendingRecipient(null)
      setError(reason instanceof Error ? reason.message : String(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Sends the free-form composer text and clears it only after Runtime acceptance. */
  const sendMessage = async () => {
    const accepted = await submitProjectResponse(draft, recipient)
    if (accepted) setDraft('')
  }

  /** Sends a structured decision directly to the product manager without using the composer. */
  const submitProductChoice = async (response: string) => {
    setRecipient('产品经理')
    return submitProjectResponse(response, '产品经理')
  }

  /** Applies a server-validated gate transition and switches to its canonical thread. */
  const applyWorkflowAction = async (action: WorkflowAction) => {
    if (!activeWorkspaceId) return
    setBusy(true)
    try {
      const next = await transitionProjectWorkflow(activeWorkspaceId, action)
      setWorkflow(next)
      setThread(next.activeThread)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Persists the final choice first, then advances the workflow only when delivery succeeds. */
  const submitProductChoiceAndFreeze = async (response: string) => {
    setRecipient('产品经理')
    const accepted = await submitProjectResponse(response, '产品经理', {
      freezeRequirements: true,
    })
    if (accepted) await applyWorkflowAction('freeze_requirements')
  }

  /** Ends a free-form PM interview while still recording an explicit user confirmation. */
  const confirmRequirementsAndFreeze = async () => {
    await submitProductChoiceAndFreeze('需求已确认，不再继续提问，请整理并封板需求。')
  }

  /** Preserves multiline authoring while Enter sends the current project message. */
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const hasArchitectureArtifact = hasRoleArtifact(entries, '架构')
  const hasUiArtifact = hasRoleArtifact(entries, 'UI')
  const teamMembers: ContextMember[] = activeWorkspaceId
    ? [
        {
          commandPresetId: 'claude',
          id: `${activeWorkspaceId}:orchestrator`,
          name: DEPARTMENT_MANAGER_NAME,
          roleLabel: '流程编排',
          status:
            orchestratorRunning &&
            (entries.length > 0 || memberPlans.some((plan) => plan.items.length))
              ? 'working'
              : 'idle',
        },
        ...workers.map((worker) => {
          const failed = terminalRuns.some(
            (run) => run.agent_id === worker.id && run.status === 'error'
          )
          return {
            commandPresetId: worker.commandPresetId ?? 'claude',
            id: worker.id,
            name: worker.name,
            roleLabel:
              worker.role === 'coder'
                ? '开发'
                : worker.role === 'reviewer'
                  ? '审查'
                  : worker.role === 'tester'
                    ? '测试'
                    : '自定义角色',
            status: worker.status === 'stopped' && !failed ? ('idle' as const) : worker.status,
          }
        }),
      ]
    : []
  const runningMembers = teamMembers.filter((member) => member.status === 'working')
  const processingMemberNames = Array.from(
    new Set([
      ...runningMembers.map((member) => member.name),
      ...(pendingRecipient ? [pendingRecipient.name] : []),
    ])
  )
  const idleMembers = teamMembers.filter((member) => member.status === 'idle')
  const stoppedMembers = teamMembers.filter((member) => member.status === 'stopped')
  const plansByMember = useMemo(
    () => new Map(memberPlans.map((plan) => [plan.agentId, plan.items])),
    [memberPlans]
  )
  const executionBlocked =
    thread === 'execution' &&
    workflow !== null &&
    ['requirements', 'solution'].includes(workflow.stage)
  /** Keeps only the latest unanswered product choice interactive; historical decisions stay read-only. */
  const latestProductChoiceEntryId = useMemo(() => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.type === 'user_input') return null
      if (entry.actorName.includes('产品') && parseProductChoicePrompt(entry.text)) return entry.id
    }
    return null
  }, [entries])
  /** Anchors requirement sealing to the latest visible product-manager response. */
  const latestProductManagerEntryId = useMemo(() => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.type === 'user_input') return null
      if (entry.actorName === PRODUCT_MANAGER_NAME && entry.type !== 'dispatch') return entry.id
    }
    return null
  }, [entries])

  if (workspaces === null) {
    return (
      <div className="ac-loading">
        <Sparkles size={20} />
        <span>正在连接本地 Runtime…</span>
      </div>
    )
  }

  return (
    <div className="ac-shell">
      <aside className="ac-projects">
        <div className="ac-brand">
          <span className="ac-brand__mark">
            <Sparkles size={17} />
          </span>
          <div>
            <strong>Agent Company</strong>
            <small>个人 AI 软件公司</small>
          </div>
        </div>
        <div className="ac-projects__label">项目</div>
        <div className="ac-project-list">
          {workspaces.map((workspace) => (
            <div
              className={`ac-project-row ${workspace.id === activeWorkspaceId ? 'is-active' : ''}`}
              key={workspace.id}
            >
              <button type="button" onClick={() => void selectWorkspace(workspace.id)}>
                <LayoutDashboard size={15} />
                <span>{workspace.name}</span>
              </button>
              <div className="ac-project-actions">
                <button
                  type="button"
                  className="ac-project-edit"
                  onClick={() => setRenamingWorkspace(workspace)}
                  aria-label={`修改项目名称 ${workspace.name}`}
                  title="修改项目名称"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="ac-project-delete"
                  onClick={() => setDeletingWorkspace(workspace)}
                  aria-label={`删除项目 ${workspace.name}`}
                  title="删除项目"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="ac-new-project" onClick={() => setShowProjectDialog(true)}>
          <Plus size={15} /> 新建项目
        </button>
        <div className="ac-projects__spacer" />
        <button type="button" className="ac-rail-action" onClick={() => setShowRoleDialog(true)}>
          <UserCog size={16} />
          <span>角色配置</span>
        </button>
        <button
          type="button"
          className="ac-rail-action ac-rail-action--settings"
          onClick={() => setShowSettingsDialog(true)}
        >
          <Settings size={16} />
          <span>设置</span>
          <i className={stitchStatus.configured ? 'is-ready' : ''} />
        </button>
        <div className="ac-local-note">
          <span className="ac-status-dot is-running" /> 仅本机
        </div>
      </aside>

      <main className="ac-main">
        {activeWorkspace ? (
          <>
            <header className="ac-topbar">
              <div>
                <h1>{activeWorkspace.name}</h1>
                <span className="ac-mono">{activeWorkspace.path}</span>
              </div>
              <div className="ac-topbar__actions">
                {workflow?.stage === 'complete' ? (
                  <button
                    type="button"
                    className="ac-deploy-button"
                    onClick={() => setShowDeploymentDialog(true)}
                  >
                    <Rocket size={14} /> 部署
                  </button>
                ) : null}
                {workflow ? <StagePopover workflow={workflow} /> : null}
              </div>
            </header>
            <div className="ac-thread-tabs">
              <button
                type="button"
                className={!showArchive && thread === 'planning' ? 'is-active' : ''}
                onClick={() => {
                  setThread('planning')
                  setShowArchive(false)
                  setRecipient('产品经理')
                }}
              >
                <MessageSquareText size={15} />
                规划流程<span>需求 · 架构 · UI 确认</span>
              </button>
              <button
                type="button"
                className={!showArchive && thread === 'execution' ? 'is-active' : ''}
                onClick={() => {
                  setThread('execution')
                  setShowArchive(false)
                  setRecipient(DEPARTMENT_MANAGER_NAME)
                }}
              >
                <FileCode2 size={15} />
                执行流程<span>开发 · 测试 · 验收</span>
              </button>
              <button
                type="button"
                className={showArchive ? 'is-active' : ''}
                onClick={() => setShowArchive(true)}
              >
                <Archive size={15} />
                归档文件<span>设计 · 代码 · 文档</span>
              </button>
            </div>

            {showArchive ? (
              <ProjectArchivePanel workspaceId={activeWorkspace.id} />
            ) : (
              <div className="ac-conversation-shell">
                <MessageJumpRail entries={entries} messageRefs={messageRefs} />
                <section className="ac-conversation">
                  {executionBlocked ? (
                    <div className="ac-flow-blocked">
                      <FileCode2 size={24} />
                      <strong>请先处理规划流程</strong>
                      <p>需求封板并确认架构与 UI 方案后，执行流程才会开放。</p>
                      <button
                        type="button"
                        onClick={() => {
                          setThread('planning')
                          setRecipient('产品经理')
                        }}
                      >
                        返回规划流程
                      </button>
                    </div>
                  ) : null}
                  {!executionBlocked && thread === 'planning' && entries.length === 0 ? (
                    <div className="ac-welcome-message">
                      <div className="ac-message__meta">
                        <span className="ac-avatar ac-avatar--product">产</span>
                        <div>
                          <strong>产品经理</strong>
                          <small>已完成项目初步分析</small>
                        </div>
                      </div>
                      <p>{buildProjectKickoff(activeWorkspace.name)}</p>
                    </div>
                  ) : null}
                  {!executionBlocked
                    ? entries.map((entry) => {
                        const choicePrompt =
                          entry.id === latestProductChoiceEntryId
                            ? parseProductChoicePrompt(entry.text)
                            : null
                        return (
                          <article
                            className={`ac-message ac-message--${actorTone(entry)} ${entry.type === 'dispatch' ? 'ac-message--dispatch' : ''}`}
                            key={entry.id}
                            ref={(node) => {
                              if (node) messageRefs.current.set(entry.id, node)
                              else messageRefs.current.delete(entry.id)
                            }}
                          >
                            <div className="ac-message__meta">
                              <span className={`ac-avatar ac-avatar--${actorTone(entry)}`}>
                                {entry.actorName.slice(0, 1)}
                              </span>
                              <div>
                                <strong>{entry.actorName}</strong>
                                <small>
                                  {entry.actorRole} · {formatTime(entry.createdAt)}
                                </small>
                              </div>
                              {entry.status ? (
                                <span className="ac-message__status">{entry.status}</span>
                              ) : null}
                            </div>
                            <p>
                              {entry.type === 'dispatch'
                                ? summarizeDispatch(entry)
                                : (choicePrompt?.displayText ?? entry.text)}
                            </p>
                            {choicePrompt ? (
                              <ProductChoicePanel
                                busy={busy}
                                onSubmit={submitProductChoice}
                                onSubmitAndFreeze={submitProductChoiceAndFreeze}
                                prompt={choicePrompt}
                              />
                            ) : null}
                            {orderConversationArtifacts(entry.artifacts).map((artifact) => (
                              <ArtifactFrame
                                key={artifact}
                                path={artifact}
                                title={artifact.split(/[\\/]/).pop() ?? artifact}
                                workspaceId={activeWorkspace.id}
                              />
                            ))}
                            {thread === 'planning' &&
                            workflow?.stage === 'requirements' &&
                            entry.id === latestProductManagerEntryId &&
                            !choicePrompt ? (
                              <RequirementFreezeAction
                                busy={busy}
                                onFreeze={confirmRequirementsAndFreeze}
                              />
                            ) : null}
                          </article>
                        )
                      })
                    : null}
                  {!executionBlocked && processingMemberNames.length > 0 ? (
                    <div className="ac-processing-notice" role="status" aria-live="polite">
                      <span className="ac-processing-notice__pulse" aria-hidden="true" />
                      <div>
                        <strong>{processingMemberNames.join('、')} 正在处理</strong>
                        <p>点击右侧对应成员，可查看持续更新的 CLI 执行上下文。</p>
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            )}

            {!showArchive && !executionBlocked ? (
              <div className="ac-action-dock">
                {workflow ? (
                  <WorkflowGate
                    hasArchitectureArtifact={hasArchitectureArtifact}
                    hasUiArtifact={hasUiArtifact}
                    onAction={applyWorkflowAction}
                    workflow={workflow}
                  />
                ) : null}
                <footer className="ac-composer">
                  <div className="ac-composer__recipient">
                    <span>发送给</span>
                    <select
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                    >
                      {recipients.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={
                      thread === 'planning'
                        ? '描述需求、反馈方案或要求修改…'
                        : '补充实现目标、测试条件或验收反馈…'
                    }
                  />
                  <div className="ac-composer__foot">
                    <span>Enter 发送 · Shift+Enter 换行</span>
                    <button
                      type="button"
                      disabled={busy || !draft.trim()}
                      onClick={() => void sendMessage()}
                    >
                      <Send size={15} />
                      发送
                    </button>
                  </div>
                </footer>
              </div>
            ) : null}
          </>
        ) : (
          <section className="ac-empty">
            <span className="ac-brand__mark">
              <Sparkles size={22} />
            </span>
            <h1>组建你的个人 AI 软件公司</h1>
            <p>从需求澄清到真实功能验收，规划和实现分在线程中推进。</p>
            <button
              type="button"
              className="ac-button ac-button--primary"
              onClick={() => setShowProjectDialog(true)}
            >
              <Plus size={15} />
              创建第一个项目
            </button>
          </section>
        )}
      </main>

      <aside className="ac-team">
        <header>
          <div>
            <Users size={16} />
            <strong>团队成员</strong>
            <span>{teamMembers.length}</span>
          </div>
          <button
            type="button"
            className="ac-icon-button"
            disabled={!activeWorkspace}
            onClick={() => setShowTeamDialog(true)}
            title="管理团队"
          >
            <Settings2 size={15} />
          </button>
        </header>
        <div className="ac-team-overview">
          <span>
            <i className="is-running" />
            {runningMembers.length} 运行中
          </span>
          <span>
            <i />
            {idleMembers.length} 空闲
          </span>
          <span>
            <i className="is-stopped" />
            {stoppedMembers.length} 已停止
          </span>
        </div>
        <TeamGroup
          label="运行中"
          members={runningMembers}
          onSelect={setSelectedMember}
          plans={plansByMember}
        />
        <TeamGroup
          label="空闲"
          members={idleMembers}
          onSelect={setSelectedMember}
          plans={plansByMember}
        />
        <TeamGroup
          label="已停止"
          members={stoppedMembers}
          onSelect={setSelectedMember}
          plans={plansByMember}
        />
      </aside>

      {error ? (
        <div className="ac-error-toast" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      ) : null}
      {showProjectDialog ? (
        <ProjectDialog
          busy={busy}
          onClose={() => setShowProjectDialog(false)}
          onCreate={createProject}
        />
      ) : null}
      {showTeamDialog ? (
        <TeamDialog
          busy={busy}
          commandPresets={commandPresets}
          members={workers}
          onAdd={addMember}
          onClose={() => setShowTeamDialog(false)}
          onDelete={removeMember}
          roleTemplates={roleTemplates}
        />
      ) : null}
      {showSettingsDialog ? (
        <SettingsDialog
          busy={busy}
          commandPresets={commandPresets}
          onClose={() => setShowSettingsDialog(false)}
          onDetectCli={detectCliDependencies}
          onSaveStitch={saveStitch}
          stitchStatus={stitchStatus}
        />
      ) : null}
      {showRoleDialog ? (
        <RoleConfigDialog
          busy={busy}
          commandPresets={commandPresets}
          onClose={() => setShowRoleDialog(false)}
          onCreate={createRole}
          onDelete={removeRole}
          onUpdate={updateRole}
          templates={roleTemplates}
        />
      ) : null}
      {selectedMember && activeWorkspaceId ? (
        <MemberContextDrawer
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          runs={terminalRuns}
          workspaceId={activeWorkspaceId}
        />
      ) : null}
      {activeWorkspaceId ? (
        <WorkspaceTerminalPanels
          hidden
          terminalRuns={terminalRuns}
          workspaceId={activeWorkspaceId}
        />
      ) : null}
      {renamingWorkspace ? (
        <RenameProjectDialog
          busy={busy}
          currentName={renamingWorkspace.name}
          onClose={() => setRenamingWorkspace(null)}
          onRename={renameProject}
        />
      ) : null}
      {deletingWorkspace ? (
        <DeleteProjectDialog
          busy={busy}
          onClose={() => setDeletingWorkspace(null)}
          onDelete={deleteProject}
          workspace={deletingWorkspace}
        />
      ) : null}
      {showDeploymentDialog && activeWorkspaceId ? (
        <DeploymentDialog
          onClose={() => setShowDeploymentDialog(false)}
          workspaceId={activeWorkspaceId}
        />
      ) : null}
    </div>
  )
}

/** Groups member cards by runtime status and opens the member's full CLI context on click. */
const TeamGroup = ({
  label,
  members,
  onSelect,
  plans,
}: {
  label: string
  members: ContextMember[]
  onSelect: (member: ContextMember) => void
  plans: Map<string, MemberPlanItem[]>
}) => {
  if (members.length === 0) return null
  return (
    <section className="ac-team-group">
      <h3>
        {label} <span>{members.length}</span>
      </h3>
      <div className="ac-team-list">
        {members.map((member) => {
          const memberPlan = plans.get(member.id) ?? []
          return (
            <button
              type="button"
              className="ac-team-card"
              key={member.id}
              onClick={() => onSelect(member)}
            >
              <div className="ac-team-card__identity">
                <CliAvatar label={member.name} presetId={member.commandPresetId} size="large" />
                <div>
                  <strong>{member.name}</strong>
                  <small>{member.roleLabel}</small>
                  <span className={`ac-member-state ac-member-state--${member.status}`}>
                    <i />
                    {member.status === 'working'
                      ? '运行中'
                      : member.status === 'idle'
                        ? '空闲'
                        : '已停止'}
                  </span>
                </div>
              </div>
              {memberPlan.length > 0 ? (
                <ol className="ac-member-plan" aria-label={`${member.name} 的计划`}>
                  {memberPlan.map((item) => (
                    <li className={`is-${item.status}`} key={item.id}>
                      <i />
                      <span title={item.label}>{item.label}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="ac-member-plan ac-member-plan--empty" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Renders only the actions valid for the current lifecycle stage. */
const WorkflowGate = ({
  hasArchitectureArtifact,
  hasUiArtifact,
  onAction,
  workflow,
}: {
  hasArchitectureArtifact: boolean
  hasUiArtifact: boolean
  onAction: (action: WorkflowAction) => Promise<void>
  workflow: ProjectWorkflowState
}) => {
  // The expansion state belongs to the fixed action dock so users can reclaim
  // conversation space without changing any workflow or approval state.
  const [isSolutionGateExpanded, setIsSolutionGateExpanded] = useState(true)

  if (workflow.stage === 'requirements') return null
  if (workflow.stage === 'solution') {
    const ready = workflow.architectureStatus === 'approved' && workflow.uiStatus === 'approved'
    const approvedCount = [workflow.architectureStatus, workflow.uiStatus].filter(
      (status) => status === 'approved'
    ).length
    return (
      <section className={`ac-gate ac-gate--stack ${isSolutionGateExpanded ? '' : 'is-collapsed'}`}>
        <div className="ac-gate__title">
          <div>
            <span className="ac-eyebrow">USER APPROVAL</span>
            <strong>方案确认门</strong>
          </div>
          <div className="ac-gate__title-actions">
            {ready ? (
              <button
                type="button"
                className="ac-button ac-button--primary"
                onClick={() => void onAction('start_development')}
              >
                开启执行流程
              </button>
            ) : null}
            <button
              type="button"
              className="ac-gate__toggle"
              aria-controls="solution-approval-details"
              aria-expanded={isSolutionGateExpanded}
              onClick={() => setIsSolutionGateExpanded((current) => !current)}
            >
              <ChevronDown
                aria-hidden="true"
                className={isSolutionGateExpanded ? 'is-expanded' : ''}
                size={14}
              />
              {isSolutionGateExpanded ? '收起' : '展开'}
            </button>
          </div>
        </div>
        {isSolutionGateExpanded ? (
          <div id="solution-approval-details">
            <ApprovalGate
              title="架构方案"
              available={hasArchitectureArtifact}
              status={workflow.architectureStatus}
              onApprove={() => onAction('approve_architecture')}
              onRevise={() => onAction('request_architecture_revision')}
            />
            <ApprovalGate
              title="UI 设计方案"
              available={hasUiArtifact}
              status={workflow.uiStatus}
              onApprove={() => onAction('approve_ui')}
              onRevise={() => onAction('request_ui_revision')}
            />
          </div>
        ) : (
          <p className="ac-gate__summary">已确认 {approvedCount}/2，展开后可查看方案状态。</p>
        )}
      </section>
    )
  }
  if (workflow.stage === 'development') {
    return (
      <section className="ac-gate">
        <div>
          <span className="ac-eyebrow">IMPLEMENTATION</span>
          <strong>开发目标完成后进入验收</strong>
          <p>测试人员将在执行流程启动真实应用并执行浏览器点击与全流程测试。</p>
        </div>
        <button
          type="button"
          className="ac-button ac-button--primary"
          onClick={() => void onAction('start_acceptance')}
        >
          进入全流程验收
        </button>
      </section>
    )
  }
  if (workflow.stage === 'acceptance') {
    return (
      <section className="ac-gate">
        <div>
          <span className="ac-eyebrow">ACCEPTANCE</span>
          <strong>确认所有真实功能测试证据</strong>
          <p>失败或未验证的核心路径必须修复并复验，不能用计划或 mock 替代。</p>
        </div>
        <button
          type="button"
          className="ac-button ac-button--primary"
          onClick={() => void onAction('complete_project')}
        >
          <Check size={15} />
          验收并完成项目
        </button>
      </section>
    )
  }
  return (
    <section className="ac-gate ac-gate--complete">
      <Check size={18} />
      <div>
        <strong>项目已完成</strong>
        <p>需求、方案、实现和全流程验收记录均保留在对应线程。</p>
      </div>
    </section>
  )
}

/** A single user confirmation gate tied to a reported real artifact. */
const ApprovalGate = ({
  available,
  onApprove,
  onRevise,
  status,
  title,
}: {
  available: boolean
  onApprove: () => Promise<void>
  onRevise: () => Promise<void>
  status: ProjectWorkflowState['architectureStatus']
  title: string
}) => (
  <div className="ac-approval-row">
    <div>
      <span className={`ac-approval-icon ${status === 'approved' ? 'is-approved' : ''}`}>
        {status === 'approved' ? <Check size={14} /> : <Circle size={8} />}
      </span>
      <div>
        <strong>{title}</strong>
        <small>
          {status === 'approved'
            ? '用户已确认'
            : available
              ? '产物已就绪，等待确认'
              : '等待成员提交产物'}
        </small>
      </div>
    </div>
    <div>
      <button type="button" disabled={!available} onClick={() => void onRevise()}>
        要求修改
      </button>
      <button
        type="button"
        disabled={!available || status === 'approved'}
        className="is-primary"
        onClick={() => void onApprove()}
      >
        确认通过
      </button>
    </div>
  </div>
)
