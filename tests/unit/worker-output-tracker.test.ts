import { describe, expect, test, vi } from 'vitest'

import { createPtyOutputBus } from '../../src/server/pty-output-bus.js'
import {
  createWorkerOutputTracker,
  hasFatalCliAuthenticationError,
} from '../../src/server/worker-output-tracker.js'

describe('worker output tracker', () => {
  test('recognizes an exhausted interactive CLI login failure through ANSI controls', () => {
    expect(
      hasFatalCliAuthenticationError(
        '\u001b[31mPlease run /login\u001b[0m · API Error: 401 额度不足'
      )
    ).toBe(true)
    expect(hasFatalCliAuthenticationError('Retrying request after timeout')).toBe(false)
  })

  test('emits a fatal-run callback once when the terminal error arrives across chunks', () => {
    const bus = createPtyOutputBus()
    const onFatalRun = vi.fn()
    const tracker = createWorkerOutputTracker(bus, { onFatalRun })
    tracker.attach('workspace-1', 'agent-1', 'run-1', '')

    bus.publish('run-1', 'Please run /login · API ')
    bus.publish('run-1', 'Error: 401 额度不足')
    bus.publish('run-1', 'Please run /login · API Error: 401')

    expect(onFatalRun).toHaveBeenCalledTimes(1)
    expect(onFatalRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', runId: 'run-1', workspaceId: 'workspace-1' })
    )
    tracker.closeAll()
  })
})
