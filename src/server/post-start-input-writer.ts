import { basename } from 'node:path'

import type { AgentManager } from './agent-manager.js'

const INTERACTIVE_COMMANDS = new Set(['claude', 'codex', 'gemini', 'opencode'])
const READY_CHECK_INTERVAL_MS = 50
const READY_TIMEOUT_MS = 3000
const MIN_SUBMIT_AFTER_PASTE_DELAY_MS = 600
const MAX_SUBMIT_AFTER_PASTE_DELAY_MS = 1500
const PASTE_CHARS_PER_DELAY_MS = 4
const PASTE_ACK_CHECK_INTERVAL_MS = 50
const PASTE_ACK_SETTLE_DELAY_MS = 100
const PASTE_ACK_TIMEOUT_MS = 3000
const COMMANDS_WITH_BRACKETED_PASTE = new Set(['claude', 'codex', 'opencode'])
const CLAUDE_TRUST_TIMEOUT_MS = 5000
const CLAUDE_TRUST_POLL_INTERVAL_MS = 50
const CLAUDE_TRUST_MARKER = 'Yes,Itrustthisfolder'
const CLAUDE_BYPASS_MARKER = 'Yes,Iaccept'
const ANSI_CSI_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[a-zA-Z]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\][^\\u0007]*\\u0007`, 'g')

/** Removes terminal cursor/style controls while preserving the user-visible prompt text. */
const stripTerminalControls = (output: string) =>
  output.replace(ANSI_OSC_PATTERN, '').replace(ANSI_CSI_PATTERN, '')

/** Compacts cursor-positioned TUI words so safety choices can be matched reliably. */
const compactTerminalText = (output: string) => stripTerminalControls(output).replace(/\s+/gu, '')

export const toBracketedPasteSubmission = (text: string) => `\u001b[200~${text}\u001b[201~`

const getSubmitAfterPasteDelayMs = (text: string) =>
  Math.min(
    MAX_SUBMIT_AFTER_PASTE_DELAY_MS,
    Math.max(MIN_SUBMIT_AFTER_PASTE_DELAY_MS, Math.ceil(text.length / PASTE_CHARS_PER_DELAY_MS))
  )

export const isInteractiveAgentCommand = (command: string) =>
  INTERACTIVE_COMMANDS.has(basename(command).toLowerCase())

const getCommandName = (command: string) => basename(command).toLowerCase()

const hasGeminiPromptReady = (output: string) => /\bType your message\b/u.test(output)

export const hasInteractivePromptReady = (output: string, command = '') => {
  const commandName = getCommandName(command)
  const visibleOutput = stripTerminalControls(output)
  return (
    /(?:^|[\r\n])\s*[❯›]\s*/u.test(visibleOutput) ||
    (commandName === 'gemini' && hasGeminiPromptReady(visibleOutput))
  )
}

export const hasBracketedPasteAcknowledgement = (output: string, baselineLength: number) =>
  /\[Pasted text #\d+/u.test(output.slice(baselineLength))

const isClaudeCommand = (command: string) => getCommandName(command) === 'claude'
const usesBracketedPaste = (command: string) =>
  COMMANDS_WITH_BRACKETED_PASTE.has(getCommandName(command))
const canTimeoutBeforePromptReady = (command: string) => getCommandName(command) !== 'gemini'
const isWritableRunStatus = (status: string | undefined) =>
  status === undefined || status === 'starting' || status === 'running'

const writeIfRunWritable = (agentManager: AgentManager, runId: string, text: string) => {
  let run: ReturnType<AgentManager['getRun']>
  try {
    run = agentManager.getRun(runId)
  } catch {
    return false
  }
  if (!isWritableRunStatus(run.status)) return false
  agentManager.writeInput(runId, text)
  return true
}

/**
 * Confirms Claude's one-time workspace trust prompt for the exact local folder
 * the user selected in Agent Company. Startup guidance waits for the normal
 * prompt after this confirmation so it cannot be pasted into the safety menu.
 */
export const prepareInteractiveAgentRun = async (
  agentManager: AgentManager,
  runId: string,
  command: string
): Promise<void> => {
  if (!isClaudeCommand(command)) return
  const startedAt = Date.now()
  let inspectedOutputLength = 0
  while (Date.now() - startedAt < CLAUDE_TRUST_TIMEOUT_MS) {
    let run: ReturnType<AgentManager['getRun']>
    try {
      run = agentManager.getRun(runId)
    } catch {
      return
    }
    if (!isWritableRunStatus(run.status)) return
    const visibleOutput = compactTerminalText(run.output.slice(inspectedOutputLength))
    if (visibleOutput.includes(CLAUDE_BYPASS_MARKER)) {
      // The bypass warning defaults to "No"; move once to the explicit accept choice.
      await new Promise((resolve) => setTimeout(resolve, 350))
      if (!writeIfRunWritable(agentManager, runId, '\u001b[B')) return
      await new Promise((resolve) => setTimeout(resolve, 180))
      if (!writeIfRunWritable(agentManager, runId, '\r')) return
      inspectedOutputLength = run.output.length
    } else if (visibleOutput.includes(CLAUDE_TRUST_MARKER)) {
      // The folder-trust prompt defaults to "Yes" for the user-selected workspace.
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (!writeIfRunWritable(agentManager, runId, '\r')) return
      inspectedOutputLength = run.output.length
    } else if (hasInteractivePromptReady(run.output.slice(inspectedOutputLength), command)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, CLAUDE_TRUST_POLL_INTERVAL_MS))
  }
}

const submitPastedInteractiveInput = (
  agentManager: AgentManager,
  runId: string,
  text: string,
  baselineLength: number,
  waitForPasteAck: boolean
) => {
  const pastedAt = Date.now()
  const minDelay = getSubmitAfterPasteDelayMs(text)
  let acknowledgedAt: number | null = null

  const getWritableOutput = () => {
    try {
      const run = agentManager.getRun(runId)
      return isWritableRunStatus(run.status) ? run.output : null
    } catch {
      return null
    }
  }

  const submit = () => {
    try {
      writeIfRunWritable(agentManager, runId, '\r')
    } catch {
      // The PTY may have exited between paste and submit.
    }
  }

  const trySubmit = () => {
    if (!waitForPasteAck) {
      submit()
      return
    }

    const output = getWritableOutput()
    if (output === null) {
      return
    }
    if (acknowledgedAt === null && hasBracketedPasteAcknowledgement(output, baselineLength)) {
      acknowledgedAt = Date.now()
    }

    const elapsed = Date.now() - pastedAt
    const ackSettled =
      acknowledgedAt !== null && Date.now() - acknowledgedAt >= PASTE_ACK_SETTLE_DELAY_MS
    if ((ackSettled && elapsed >= minDelay) || elapsed >= PASTE_ACK_TIMEOUT_MS) {
      submit()
      return
    }
    setTimeout(trySubmit, PASTE_ACK_CHECK_INTERVAL_MS)
  }

  setTimeout(trySubmit, minDelay)
}

export const createPostStartInputWriter = (
  agentManager: AgentManager,
  command: string
): ((runId: string, text: string) => void) => {
  if (!isInteractiveAgentCommand(command)) {
    return (runId, text) => {
      writeIfRunWritable(agentManager, runId, `${text}\n`)
    }
  }

  return (runId, text) => {
    const startedAt = Date.now()
    let isInitialAttempt = true
    const tryWrite = () => {
      let output: string | null
      try {
        const run = agentManager.getRun(runId)
        output = isWritableRunStatus(run.status) ? run.output : null
      } catch {
        return
      }
      if (output === null) return
      if (
        hasInteractivePromptReady(output, command) ||
        (canTimeoutBeforePromptReady(command) && Date.now() - startedAt >= READY_TIMEOUT_MS)
      ) {
        const baselineLength = output.length
        const input = usesBracketedPaste(command) ? toBracketedPasteSubmission(text) : text
        try {
          if (!writeIfRunWritable(agentManager, runId, input)) return
        } catch (error) {
          if (isInitialAttempt) throw error
          return
        }
        submitPastedInteractiveInput(
          agentManager,
          runId,
          text,
          baselineLength,
          isClaudeCommand(command)
        )
        return
      }
      setTimeout(tryWrite, READY_CHECK_INTERVAL_MS)
    }
    try {
      tryWrite()
    } finally {
      isInitialAttempt = false
    }
  }
}
