import { describe, expect, test } from 'vitest'

import { createSpawnEnv } from '../../src/server/agent-manager.js'

describe('createSpawnEnv', () => {
  test('keeps only the explicit PATH spelling for Windows PTYs', () => {
    const originalPath = process.env.PATH
    const originalMixedCasePath = process.env.Path
    process.env.Path = 'C:\\stale-path'
    delete process.env.PATH

    try {
      const env = createSpawnEnv({ PATH: 'C:\\agent-bin;C:\\Program Files\\nodejs' }, 'win32')
      expect(env.PATH).toBe('C:\\agent-bin;C:\\Program Files\\nodejs')
      expect(env.Path).toBeUndefined()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      if (originalMixedCasePath === undefined) delete process.env.Path
      else process.env.Path = originalMixedCasePath
    }
  })
})
