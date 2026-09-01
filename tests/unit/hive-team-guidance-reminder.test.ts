import { describe, expect, test } from 'vitest'

import {
  buildProtocolDoc,
  buildWorkerReminderTail,
  ORCHESTRATOR_REMINDER_TAIL,
} from '../../src/server/hive-team-guidance.js'

describe('ORCHESTRATOR_REMINDER_TAIL', () => {
  test('wraps the reminder in a hive-system-reminder XML envelope', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL.startsWith('<hive-system-reminder>')).toBe(true)
    expect(ORCHESTRATOR_REMINDER_TAIL.endsWith('</hive-system-reminder>')).toBe(true)
  })

  test('names the role and the exact dispatch verb so a post-/compact agent can re-anchor', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Hive Department Manager')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('team send "<worker-name>" "<task>"')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('team cancel --dispatch <id> "<reason>"')
  })

  test('forbids the CLI built-in subagent escape hatch', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Never call')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Task')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Explore')
  })
})

describe('buildWorkerReminderTail', () => {
  test('wraps the reminder in a hive-system-reminder XML envelope', () => {
    const tail = buildWorkerReminderTail('disp-1234')
    expect(tail.startsWith('<hive-system-reminder>')).toBe(true)
    expect(tail.endsWith('</hive-system-reminder>')).toBe(true)
  })

  test('interpolates the dispatch_id into the team-report syntax line', () => {
    const tail = buildWorkerReminderTail('disp-abc')
    expect(tail).toContain('team report "<result>" --dispatch disp-abc')
    expect(tail).toContain('team report --stdin --dispatch disp-abc')
  })

  test('includes the Windows PowerShell UTF-8 setup beside stdin reporting guidance', () => {
    const tail = buildWorkerReminderTail('disp-utf8')
    expect(tail).toContain('$OutputEncoding = $utf8')
    expect(tail).toContain('[Console]::OutputEncoding = $utf8')
  })

  test('different dispatch_ids produce different reminder bodies', () => {
    const left = buildWorkerReminderTail('disp-1')
    const right = buildWorkerReminderTail('disp-2')
    expect(left).not.toEqual(right)
    expect(left).toContain('disp-1')
    expect(left).not.toContain('disp-2')
    expect(right).toContain('disp-2')
    expect(right).not.toContain('disp-1')
  })

  test('names the role and forbids nested subagents', () => {
    const tail = buildWorkerReminderTail('disp-x')
    expect(tail).toContain('Hive Worker')
    expect(tail).toContain('Do not launch nested CLI subagents')
  })
})

describe('buildProtocolDoc', () => {
  test('renders both orchestrator and worker rule sections', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('## Department Manager rules')
    expect(doc).toContain('## Worker rules')
    expect(doc).toContain('## `team` CLI — department manager')
    expect(doc).toContain('## `team` CLI — worker')
    expect(doc).toContain('team cancel --dispatch <id> "<reason>"')
  })

  test('mentions the .hive/PROTOCOL.md cat-recover path explicitly', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('`cat .hive/PROTOCOL.md`')
  })

  test('documents the Windows PowerShell UTF-8 setup for non-ASCII stdin bodies', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('### Windows PowerShell UTF-8 setup')
    expect(doc).toContain('$OutputEncoding = $utf8')
  })

  test('starts with an H1 heading so a tail of the file is still self-identifying', () => {
    const doc = buildProtocolDoc()
    expect(doc.split('\n')[0]).toBe('# Hive Team Protocol')
  })

  test('renders rule entries as a bulleted list (one bullet per rule, not a single paragraph)', () => {
    const doc = buildProtocolDoc()
    // Both sections should yield at least 3 bullets each (current rule counts
    // are 7 / 6; locking in "at least 3" tolerates future rule edits while
    // still catching the regression where renderRules collapsed bullets).
    const orchSection =
      doc.split('## Department Manager rules')[1]?.split('## Worker rules')[0] ?? ''
    const workerSection = doc.split('## Worker rules')[1] ?? ''
    expect(
      orchSection.split('\n').filter((line) => line.startsWith('- ')).length
    ).toBeGreaterThanOrEqual(3)
    expect(
      workerSection.split('\n').filter((line) => line.startsWith('- ')).length
    ).toBeGreaterThanOrEqual(3)
  })
})
