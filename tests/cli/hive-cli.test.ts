import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { HIVE_USAGE, handleHiveInfoCommand, runHiveCommand } from '../../src/cli/hive.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('agent company cli', () => {
  test('prints help without starting the runtime', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(handleHiveInfoCommand(['--help'])).toBe(true)

    expect(logSpy).toHaveBeenCalledWith(HIVE_USAGE)
  })

  test('prints the local application version without starting the runtime', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string

    expect(handleHiveInfoCommand(['--version'])).toBe(true)

    expect(logSpy).toHaveBeenCalledWith(version)
  })

  test('rejects unknown arguments instead of ignoring them', async () => {
    await expect(runHiveCommand(['--bogus'])).rejects.toThrow('Unknown option: --bogus')
    await expect(runHiveCommand(['--port', '0', 'extra'])).rejects.toThrow(
      'Unknown argument: extra'
    )
  })

  test('starts the local server and prints its listening address', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await runHiveCommand(['--port', '0'])

    try {
      expect(result.port).toBeGreaterThan(0)
      expect(logSpy).toHaveBeenCalledWith(
        `Agent Company running at http://127.0.0.1:${result.port}`
      )
    } finally {
      await result.close()
    }
  })
})
