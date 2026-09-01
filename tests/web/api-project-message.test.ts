import { afterEach, describe, expect, test, vi } from 'vitest'

import { sendProjectMessage } from '../../web/src/api.js'

afterEach(() => vi.restoreAllMocks())

describe('project message api client', () => {
  test('uses the public snake_case freeze flag for a final PM decision', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendProjectMessage('workspace-1', {
      freezeRequirements: true,
      recipient: '产品经理',
      text: '选择 B：分阶段接入',
      thread: 'planning',
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/workspaces/workspace-1/user-input')
    expect(JSON.parse(init?.body as string)).toEqual({
      freeze_requirements: true,
      recipient: '产品经理',
      text: '选择 B：分阶段接入',
      thread: 'planning',
    })
  })
})
