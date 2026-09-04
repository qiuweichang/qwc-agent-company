import { basename } from 'node:path'

import type { AgentManager } from './agent-manager.js'

const INTERACTIVE_COMMANDS = new Set(['claude', 'codex', 'gemini', 'opencode'])
const READY_CHECK_INTERVAL_MS = 50
const READY_TIMEOUT_MS = 3000
const CODEX_INITIAL_BATCH_SETTLE_DELAY_MS = 300
const MIN_SUBMIT_AFTER_PASTE_DELAY_MS = 600
const MAX_SUBMIT_AFTER_PASTE_DELAY_MS = 1500
const PASTE_CHARS_PER_DELAY_MS = 4
const PASTE_ACK_CHECK_INTERVAL_MS = 50
const PASTE_ACK_SETTLE_DELAY_MS = 100
const PASTE_ACK_TIMEOUT_MS = 3000
const CODEX_SECOND_SUBMIT_DELAY_MS = 500
const CODEX_FINAL_SUBMIT_RETRY_DELAY_MS = 1500
const COMMANDS_WITH_BRACKETED_PASTE = new Set(['claude', 'codex', 'opencode'])
// Cold Windows starts can take several seconds before either CLI paints its trust menu.
const CLI_TRUST_TIMEOUT_MS = 15000
const CLI_TRUST_POLL_INTERVAL_MS = 50
// Codex paints an apparently writable splash prompt before its trust dialog on first use.
const CODEX_TRUST_GRACE_PERIOD_MS = 2000
const CLAUDE_TRUST_MARKER = 'Yes,Itrustthisfolder'
const CLAUDE_BYPASS_MARKER = 'Yes,Iaccept'
const CODEX_TRUST_MARKER = 'Doyoutrustthecontentsofthisdirectory?'
const CODEX_TRUST_CONFIRMATION = '1.Yes,continue'
const ANSI_CSI_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;?]*[a-zA-Z]`, 'g')
const ANSI_OSC_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\][^\\u0007]*\\u0007`, 'g')

interface PendingInteractiveInput {
  /** CLI command whose prompt and paste semantics control this queue. */
  command: string
  /** Prompts collected before the CLI reaches its first writable prompt. */
  pendingTexts: string[]
  /** Output offset after the previous submit; later messages must wait for a fresh prompt. */
  readyAfterOutputLength: number | null
  /** Prevents concurrent readiness loops from writing into the same TUI prompt. */
  scheduled: boolean
}

/**
 * Per-manager input queues merge startup guidance and the first worker dispatch.
 * Both messages are normally scheduled within the same event-loop turn; without
 * this queue two independent writers can paste over each other in Codex's TUI.
 */
const pendingInteractiveInputs = new WeakMap<AgentManager, Map<string, PendingInteractiveInput>>()

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

/**
 * Detects the durable completion footer emitted after a Claude or Codex turn.
 * Their TUIs keep a visible `❯` input row while the model is busy, so the prompt
 * glyph alone cannot prove that a queued follow-up can be submitted safely.
 */
export const hasInteractiveTurnCompleted = (output: string) =>
  /\b[A-Z][A-Za-z-]{2,24}\s+for\s+\d+(?:ms|s|m|h)\b/u.test(stripTerminalControls(output))

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
const isCodexCommand = (command: string) => getCommandName(command) === 'codex'
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
 * Confirms a supported CLI's one-time workspace trust prompt for the exact local
 * folder the user selected in Agent Company. Startup guidance waits for the normal
 * prompt after confirmation so it cannot be pasted into a safety menu.
 */
export const prepareInteractiveAgentRun = async (
  agentManager: AgentManager,
  runId: string,
  command: string
): Promise<void> => {
  if (!isClaudeCommand(command) && !isCodexCommand(command)) return
  const startedAt = Date.now()
  let inspectedOutputLength = 0
  let codexReadyObservedAt: number | null = null
  let codexTrustConfirmed = false
  while (Date.now() - startedAt < CLI_TRUST_TIMEOUT_MS) {
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
    } else if (
      visibleOutput.includes(CODEX_TRUST_MARKER) &&
      visibleOutput.includes(CODEX_TRUST_CONFIRMATION)
    ) {
      // Codex defaults to "Yes, continue". This only approves the workspace path the user
      // already selected for the project; arbitrary folders are never accepted here.
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (!writeIfRunWritable(agentManager, runId, '\r')) return
      inspectedOutputLength = run.output.length
      codexTrustConfirmed = true
    } else if (hasInteractivePromptReady(run.output.slice(inspectedOutputLength), command)) {
      if (!isCodexCommand(command) || codexTrustConfirmed) return

      // A fresh Codex process briefly exposes its main prompt before checking directory
      // trust. Keep observing that first prompt so dispatch text cannot land in the menu.
      codexReadyObservedAt ??= Date.now()
      if (Date.now() - codexReadyObservedAt >= CODEX_TRUST_GRACE_PERIOD_MS) return
    }
    await new Promise((resolve) => setTimeout(resolve, CLI_TRUST_POLL_INTERVAL_MS))
  }
}

const submitPastedInteractiveInput = (
  agentManager: AgentManager,
  runId: string,
  text: string,
  baselineLength: number,
  waitForPasteAck: boolean,
  repeatSubmit: boolean,
  onSubmitted: () => void
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

    if (!repeatSubmit) {
      onSubmitted()
      return
    }

    // Codex can use the first Enter to accept a large bracketed-paste block without submitting it.
    // On Windows, a resumed TUI can also ignore the immediate confirmation while it renders the
    // accepted block. Two bounded retries cover both states; Enter is harmless once Codex is busy.
    setTimeout(() => {
      try {
        writeIfRunWritable(agentManager, runId, '\r')
      } catch {
        // The run may have exited after completing a very short task.
      }

      setTimeout(() => {
        try {
          writeIfRunWritable(agentManager, runId, '\r')
        } finally {
          onSubmitted()
        }
      }, CODEX_FINAL_SUBMIT_RETRY_DELAY_MS)
    }, CODEX_SECOND_SUBMIT_DELAY_MS)
  }

  const trySubmit = () => {
    if (!waitForPasteAck) {
      submit()
      return
    }

    const output = getWritableOutput()
    if (output === null) {
      onSubmitted()
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
    let managerQueues = pendingInteractiveInputs.get(agentManager)
    if (!managerQueues) {
      managerQueues = new Map()
      pendingInteractiveInputs.set(agentManager, managerQueues)
    }
    let pendingInput = managerQueues.get(runId)
    if (!pendingInput) {
      pendingInput = {
        command,
        pendingTexts: [],
        readyAfterOutputLength: null,
        scheduled: false,
      }
      managerQueues.set(runId, pendingInput)
    }
    pendingInput.pendingTexts.push(text)
    if (pendingInput.scheduled) return
    pendingInput.scheduled = true

    const startedAt = Date.now()
    let isInitialAttempt = true
    let promptReadyAt: number | null = null
    const tryWrite = () => {
      let output: string | null
      try {
        const run = agentManager.getRun(runId)
        output = isWritableRunStatus(run.status) ? run.output : null
      } catch {
        managerQueues?.delete(runId)
        return
      }
      if (output === null) {
        managerQueues?.delete(runId)
        return
      }
      const promptOutput =
        pendingInput.readyAfterOutputLength === null
          ? output
          : output.slice(pendingInput.readyAfterOutputLength)
      const requiresCompletedTurn =
        pendingInput.readyAfterOutputLength !== null &&
        (isClaudeCommand(pendingInput.command) || isCodexCommand(pendingInput.command))
      const promptIsReady =
        hasInteractivePromptReady(promptOutput, pendingInput.command) &&
        (!requiresCompletedTurn || hasInteractiveTurnCompleted(promptOutput))
      const canUseInitialTimeout =
        pendingInput.readyAfterOutputLength === null &&
        canTimeoutBeforePromptReady(pendingInput.command) &&
        Date.now() - startedAt >= READY_TIMEOUT_MS
      if (promptIsReady || canUseInitialTimeout) {
        if (promptReadyAt === null) promptReadyAt = Date.now()
        const settleDelay =
          getCommandName(pendingInput.command) === 'codex' ? CODEX_INITIAL_BATCH_SETTLE_DELAY_MS : 0
        if (Date.now() - promptReadyAt < settleDelay) {
          setTimeout(tryWrite, READY_CHECK_INTERVAL_MS)
          return
        }
        const baselineLength = output.length
        const batchedText = pendingInput.pendingTexts.splice(0).join('\n\n')
        const input = usesBracketedPaste(pendingInput.command)
          ? toBracketedPasteSubmission(batchedText)
          : batchedText
        try {
          if (!writeIfRunWritable(agentManager, runId, input)) return
        } catch (error) {
          if (isInitialAttempt) throw error
          return
        }
        submitPastedInteractiveInput(
          agentManager,
          runId,
          batchedText,
          baselineLength,
          isClaudeCommand(pendingInput.command),
          getCommandName(pendingInput.command) === 'codex',
          () => {
            pendingInput.scheduled = false
            pendingInput.readyAfterOutputLength = baselineLength
            if (pendingInput.pendingTexts.length === 0) return
            const deferredText = pendingInput.pendingTexts.splice(0).join('\n\n')
            createPostStartInputWriter(agentManager, pendingInput.command)(runId, deferredText)
          }
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
