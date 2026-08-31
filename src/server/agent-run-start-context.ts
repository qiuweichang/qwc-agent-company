import type { WorkspaceSummary } from '../shared/types.js'
import type { AgentRunSnapshot } from './agent-manager.js'
import type { PersistedAgentRun } from './agent-run-store.js'
import type { AgentSessionStorePort } from './agent-runtime-ports.js'
import type { AgentTokenRegistry } from './agent-tokens.js'
import type { LiveRunRegistry } from './live-run-registry.js'

export type PersistedRunStatus = PersistedAgentRun['status']

export interface AgentRunStarterStorePort {
  insertAgentRun: (
    runId: string,
    agentId: string,
    startedAt: number,
    pid: number | null,
    status?: PersistedRunStatus,
    exitCode?: number | null,
    endedAt?: number | null
  ) => void
  updatePersistedRun: (
    runId: string,
    status: PersistedRunStatus,
    exitCode: number | null,
    endedAt: number | null,
    output?: string
  ) => void
}

export interface AgentRunExitContext {
  agentId: string
  /** Reads the final PTY buffer before the manager clears a completed run. */
  getRunSnapshot: (runId: string) => AgentRunSnapshot
  handledRunExits: Set<string>
  onAgentExit: (workspaceId: string, agentId: string) => void
  registry: LiveRunRegistry
  sessionStore: AgentSessionStorePort
  startConfig: { resumedSessionId?: string | null }
  store: AgentRunStarterStorePort
  token: string
  tokenRegistry: AgentTokenRegistry
  workspace: WorkspaceSummary
}
