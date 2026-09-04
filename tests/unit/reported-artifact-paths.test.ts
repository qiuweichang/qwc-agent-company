import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { mergeReportedArtifactPaths } from '../../src/server/reported-artifact-paths.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('mergeReportedArtifactPaths', () => {
  test('discovers existing Stitch visuals mentioned in a report and removes duplicates', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'agent-company-report-artifacts-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, 'docs', 'design'), { recursive: true })
    writeFileSync(join(workspacePath, 'docs', 'design', 'DESIGN.md'), '# Design', 'utf8')
    writeFileSync(join(workspacePath, 'docs', 'design', 'stitch-result.html'), '<!doctype html>')
    writeFileSync(join(workspacePath, 'docs', 'design', 'stitch-result.png'), 'image')

    const result = mergeReportedArtifactPaths(
      workspacePath,
      ['docs/design/DESIGN.md'],
      [
        '- docs/design/DESIGN.md：完整规范',
        '- docs/design/stitch-result.html',
        '- docs/design/stitch-result.png',
        '- docs/design/not-created.html',
      ].join('\n')
    )

    expect(result).toEqual([
      'docs/design/DESIGN.md',
      'docs/design/stitch-result.html',
      'docs/design/stitch-result.png',
    ])
  })
})
