import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createStitchMcpClient } from '../../src/server/stitch-mcp-client.js'

let activeServer: Server | null = null
const outputDirs: string[] = []
const originalEndpoint = process.env.STITCH_MCP_ENDPOINT
const originalKey = process.env.STITCH_API_KEY

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer?.close(() => resolve()))
    activeServer = null
  }
  for (const directory of outputDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
  process.env.STITCH_MCP_ENDPOINT = originalEndpoint
  process.env.STITCH_API_KEY = originalKey
})

/** Reads the small JSON-RPC request bodies emitted by the test client. */
const readRequestBody = async (request: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    id?: number
    method: string
    params?: { name?: string }
  }
}

describe('Stitch MCP client', () => {
  test('generates and revises a real MCP DESKTOP screen while saving immutable artifacts', async () => {
    const calls: string[] = []
    activeServer = createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/screen.html') {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<!doctype html><title>Stitch screen</title>')
        return
      }
      if (request.method === 'GET' && request.url === '/screen.png') {
        response.writeHead(200, { 'content-type': 'image/png' })
        response.end(Buffer.from([137, 80, 78, 71]))
        return
      }

      const body = await readRequestBody(request)
      calls.push(body.method === 'tools/call' ? `tool:${body.params?.name}` : body.method)
      response.setHeader('content-type', 'application/json')
      response.setHeader('mcp-session-id', 'test-session')
      if (body.method === 'notifications/initialized') {
        response.writeHead(202)
        response.end('')
        return
      }
      if (body.method === 'initialize') {
        response.end(JSON.stringify({ id: body.id, jsonrpc: '2.0', result: {} }))
        return
      }
      if (body.params?.name === 'create_project') {
        response.end(
          JSON.stringify({
            id: body.id,
            jsonrpc: '2.0',
            result: { structuredContent: { projectId: 'project-1' } },
          })
        )
        return
      }
      const address = activeServer?.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server port')
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: '2.0',
          result: {
            structuredContent: {
              outputComponents: [
                {
                  design: {
                    screens: [
                      {
                        htmlCode: { downloadUrl: `http://127.0.0.1:${address.port}/screen.html` },
                        name: 'projects/project-1/screens/screen-1',
                        screenshot: { downloadUrl: `http://127.0.0.1:${address.port}/screen.png` },
                      },
                    ],
                  },
                },
              ],
            },
          },
        })
      )
    })
    await new Promise<void>((resolve) => activeServer?.listen(0, '127.0.0.1', () => resolve()))
    const address = activeServer.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    process.env.STITCH_MCP_ENDPOINT = `http://127.0.0.1:${address.port}/mcp`
    process.env.STITCH_API_KEY = 'test-key'
    const outputDirectory = mkdtempSync(join(tmpdir(), 'agent-company-stitch-'))
    outputDirs.push(outputDirectory)

    const client = createStitchMcpClient()
    const result = await client.generate({
      outputDirectory,
      projectTitle: 'Student Admin',
      prompt: 'Design a desktop student management dashboard',
    })
    const revision = await client.revise({
      outputDirectory,
      projectId: result.projectId,
      prompt: 'Make the primary action green',
      screenId: result.screenId,
    })

    expect(calls).toEqual([
      'initialize',
      'notifications/initialized',
      'tool:create_project',
      'tool:generate_screen_from_text',
      'tool:edit_screens',
    ])
    expect(result).toMatchObject({ projectId: 'project-1', screenId: 'screen-1' })
    expect(result.artifacts).toHaveLength(2)
    expect(
      readFileSync(join(outputDirectory, result.artifacts[0]?.split('/').pop() ?? ''), 'utf8')
    ).toContain('Stitch screen')
    expect(revision).toMatchObject({ projectId: 'project-1', screenId: 'screen-1' })
    expect(revision.artifacts).toHaveLength(2)
    expect(revision.artifacts[0]).not.toBe(result.artifacts[0])
  })
})
