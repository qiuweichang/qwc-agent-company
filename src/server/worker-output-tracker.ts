import type { PtyOutputBus } from './pty-output-bus.js'
import { TerminalStateMirror } from './terminal-state-mirror.js'

interface TrackedRun {
  fatalErrorDetected: boolean
  mirror: TerminalStateMirror
  recentOutput: string
  runId: string
  unsubscribe: () => void
}

interface FatalCliRun {
  agentId: string
  reason: string
  runId: string
  workspaceId: string
}

interface WorkerOutputTrackerOptions {
  /** Stops a live PTY after the interactive CLI reports an unrecoverable login/quota failure. */
  onFatalRun?: (run: FatalCliRun) => void
}

const FATAL_OUTPUT_TAIL_LIMIT = 4096
const ANSI_CSI_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\][^\\u0007]*\\u0007`, 'g')

/** Matches the final Claude/Codex authentication failure after built-in retries are exhausted. */
export const hasFatalCliAuthenticationError = (output: string) => {
  const compact = output
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(/\s+/gu, '')
  return /Pleaserun\/login.{0,160}APIError:401/u.test(compact)
}

export interface WorkerOutputTracker {
  attach: (workspaceId: string, agentId: string, runId: string, initialOutput: string) => void
  closeAll: () => void
  detach: (workspaceId: string, agentId: string) => void
  getLastPtyLine: (workspaceId: string, agentId: string) => string | null
}

const trackerKey = (workspaceId: string, agentId: string) => `${workspaceId}:${agentId}`

/**
 * Maintains a headless terminal mirror per active agent run so the team-list
 * endpoint can report each worker's last output line without requiring a
 * connected UI viewer. Created on run start (via `attach`) and torn down on
 * run exit (via `detach`).
 */
export const createWorkerOutputTracker = (
  outputBus: PtyOutputBus,
  options: WorkerOutputTrackerOptions = {}
): WorkerOutputTracker => {
  const tracked = new Map<string, TrackedRun>()

  const disposeEntry = (entry: TrackedRun) => {
    entry.unsubscribe()
    entry.mirror.dispose()
  }

  return {
    attach(workspaceId, agentId, runId, initialOutput) {
      const key = trackerKey(workspaceId, agentId)
      const existing = tracked.get(key)
      if (existing) {
        if (existing.runId === runId) return
        disposeEntry(existing)
      }
      const mirror = new TerminalStateMirror()
      const entry: TrackedRun = {
        fatalErrorDetected: false,
        mirror,
        recentOutput: '',
        runId,
        unsubscribe: () => {},
      }
      const trackChunk = (chunk: string) => {
        entry.recentOutput = `${entry.recentOutput}${chunk}`.slice(-FATAL_OUTPUT_TAIL_LIMIT)
        if (
          !entry.fatalErrorDetected &&
          hasFatalCliAuthenticationError(entry.recentOutput)
        ) {
          entry.fatalErrorDetected = true
          options.onFatalRun?.({
            agentId,
            reason: 'CLI authentication or usage quota is unavailable',
            runId,
            workspaceId,
          })
        }
      }
      if (initialOutput.length > 0) {
        mirror.write(initialOutput)
        trackChunk(initialOutput)
      }
      const unsubscribe = outputBus.subscribe(runId, (chunk) => {
        mirror.write(chunk)
        trackChunk(chunk)
      })
      entry.unsubscribe = unsubscribe
      tracked.set(key, entry)
    },
    closeAll() {
      for (const entry of tracked.values()) disposeEntry(entry)
      tracked.clear()
    },
    detach(workspaceId, agentId) {
      const key = trackerKey(workspaceId, agentId)
      const entry = tracked.get(key)
      if (!entry) return
      disposeEntry(entry)
      tracked.delete(key)
    },
    getLastPtyLine(workspaceId, agentId) {
      const entry = tracked.get(trackerKey(workspaceId, agentId))
      return entry ? entry.mirror.lastPtyLine() : null
    },
  }
}
