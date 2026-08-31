import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_TIMEOUT_MS = 120_000

type JsonRecord = Record<string, unknown>

export interface StitchGenerateInput {
  outputDirectory: string
  projectTitle: string
  prompt: string
}

export interface StitchReviseInput {
  outputDirectory: string
  projectId: string
  prompt: string
  screenId: string
}

export interface StitchGenerateResult {
  artifacts: string[]
  projectId: string
  screenId: string
}

/** Runtime-supplied Stitch credentials, allowing the desktop settings UI to override env defaults. */
export interface StitchMcpConfiguration {
  apiKey?: string | null
  endpoint?: string | null
}

/** Recursively returns the first non-empty string stored under the requested field. */
const findTextValue = (node: unknown, fieldName: string): string | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findTextValue(child, fieldName)
      if (result) return result
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const record = node as JsonRecord
  const direct = record[fieldName]
  if (typeof direct === 'string' && direct.trim()) return direct
  for (const value of Object.values(record)) {
    const result = findTextValue(value, fieldName)
    if (result) return result
  }
  return null
}

/** Finds a resource identifier from an explicit field or canonical MCP resource name. */
const findResourceId = (node: unknown, fieldName: string, segment: string): string | null => {
  const direct = findTextValue(node, fieldName)
  if (direct) return direct.slice(direct.lastIndexOf('/') + 1)
  const match = JSON.stringify(node).match(new RegExp(`${segment}/([A-Za-z0-9_-]+)`))
  return match?.[1] ?? null
}

/** Extracts the first generated Stitch screen from outputComponents[].design.screens[]. */
const findGeneratedScreen = (node: unknown): JsonRecord | null => {
  if (!node || typeof node !== 'object') return null
  const components = (node as JsonRecord).outputComponents
  if (!Array.isArray(components)) return null
  for (const component of components) {
    if (!component || typeof component !== 'object') continue
    const design = (component as JsonRecord).design
    if (!design || typeof design !== 'object') continue
    const screens = (design as JsonRecord).screens
    if (Array.isArray(screens) && screens[0] && typeof screens[0] === 'object') {
      return screens[0] as JsonRecord
    }
  }
  return null
}

/** Parses either an application/json response or matching SSE data event. */
const parseMcpResponse = (body: string, expectedId: number): JsonRecord => {
  const normalized = body.trim()
  if (normalized.startsWith('{')) return JSON.parse(normalized) as JsonRecord
  for (const line of normalized.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const candidate = JSON.parse(line.slice(5).trim()) as JsonRecord
    if (candidate.id === expectedId) return candidate
  }
  throw new Error('Stitch MCP returned an unrecognized response')
}

/** Converts an MCP tools/call result into its structured Stitch payload. */
const unwrapToolResult = (response: JsonRecord): JsonRecord => {
  if (response.error) throw new Error('Stitch MCP request failed')
  const result = response.result
  if (!result || typeof result !== 'object') throw new Error('Stitch MCP returned no tool result')
  const resultRecord = result as JsonRecord
  if (resultRecord.isError === true) throw new Error('Stitch tool reported an error')
  if (resultRecord.structuredContent && typeof resultRecord.structuredContent === 'object') {
    return resultRecord.structuredContent as JsonRecord
  }
  const content = resultRecord.content
  if (Array.isArray(content)) {
    const text = content
      .filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object')
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('')
      .trim()
    if (text) {
      try {
        return JSON.parse(text) as JsonRecord
      } catch {
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as JsonRecord
        return { text }
      }
    }
  }
  return resultRecord
}

/** Finds a signed download URL below htmlCode or screenshot at any response depth. */
const findNestedDownloadUrl = (node: unknown, parentField: string): string | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findNestedDownloadUrl(child, parentField)
      if (result) return result
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  const record = node as JsonRecord
  const parent = record[parentField]
  if (parent && typeof parent === 'object') {
    const url = findTextValue(parent, 'downloadUrl')
    if (url) return url
  }
  for (const value of Object.values(record)) {
    const result = findNestedDownloadUrl(value, parentField)
    if (result) return result
  }
  return null
}

/**
 * Creates a serialized Stitch MCP client. One session is deliberately reused
 * sequentially because request IDs and Mcp-Session-Id form shared mutable state.
 */
export const createStitchMcpClient = (configuration: StitchMcpConfiguration = {}) => {
  const endpoint = configuration.endpoint?.trim() || process.env.STITCH_MCP_ENDPOINT?.trim() || ''
  const apiKey = configuration.apiKey?.trim() || process.env.STITCH_API_KEY?.trim() || ''
  let sessionId: string | null = null
  let requestId = 1
  let operationQueue: Promise<unknown> = Promise.resolve()

  /** Sends one JSON-RPC request and records the server-issued MCP session ID. */
  const send = async (method: string, params: JsonRecord, notification = false) => {
    if (!endpoint || !apiKey) {
      throw new Error('Stitch MCP is not configured; set STITCH_MCP_ENDPOINT and STITCH_API_KEY')
    }
    const id = requestId++
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': MCP_PROTOCOL_VERSION,
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
          'x-goog-api-key': apiKey,
        },
        method: 'POST',
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403)
        throw new Error('Stitch credentials are invalid or unauthorized')
      if (response.status === 429) throw new Error('Stitch request quota has been reached')
      if (!response.ok) throw new Error(`Stitch MCP request failed with HTTP ${response.status}`)
      sessionId = response.headers.get('mcp-session-id') ?? sessionId
      if (notification) return {}
      return parseMcpResponse(await response.text(), id)
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Initializes the Streamable HTTP MCP session only when a tool call needs it. */
  const connect = async () => {
    if (sessionId) return
    await send('initialize', {
      capabilities: {},
      clientInfo: { name: 'agent-company', version: '0.1.0' },
      protocolVersion: MCP_PROTOCOL_VERSION,
    })
    await send('notifications/initialized', {}, true)
  }

  /** Calls one Stitch MCP tool and returns the normalized structured payload. */
  const callTool = async (name: string, args: JsonRecord) => {
    await connect()
    return unwrapToolResult(await send('tools/call', { arguments: args, name }))
  }

  /** Downloads one signed Stitch artifact without forwarding the API credential. */
  const download = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`Stitch artifact download failed with HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  /** Resolves export URLs and writes one immutable Stitch revision into the workspace. */
  const saveArtifacts = async (
    outputDirectory: string,
    projectId: string,
    screenId: string,
    source: JsonRecord
  ): Promise<StitchGenerateResult> => {
    let artifactPayload = source
    let htmlUrl = findNestedDownloadUrl(artifactPayload, 'htmlCode')
    let screenshotUrl = findNestedDownloadUrl(artifactPayload, 'screenshot')
    if (!htmlUrl) {
      artifactPayload = await callTool('get_screen', {
        name: `projects/${projectId}/screens/${screenId}`,
        projectId,
        screenId,
      })
      htmlUrl = findNestedDownloadUrl(artifactPayload, 'htmlCode')
      screenshotUrl = findNestedDownloadUrl(artifactPayload, 'screenshot')
    }
    if (!htmlUrl) throw new Error('Stitch did not return exportable HTML')

    const artifactId = randomUUID()
    await mkdir(outputDirectory, { recursive: true })
    const htmlName = `stitch-${artifactId}.html`
    await writeFile(join(outputDirectory, htmlName), await download(htmlUrl))
    const artifacts = [`docs/design/${htmlName}`]
    if (screenshotUrl) {
      const imageName = `stitch-${artifactId}.png`
      await writeFile(join(outputDirectory, imageName), await download(screenshotUrl))
      artifacts.push(`docs/design/${imageName}`)
    }
    return { artifacts, projectId, screenId }
  }

  /**
   * Creates a DESKTOP Stitch project, exports HTML plus an optional screenshot,
   * and returns workspace-relative artifact paths suitable for team report.
   */
  const generate = (input: StitchGenerateInput): Promise<StitchGenerateResult> => {
    const operation = operationQueue.then(async () => {
      const createResult = await callTool('create_project', { title: input.projectTitle })
      const projectId = findResourceId(createResult, 'projectId', 'projects')
      if (!projectId) throw new Error('Stitch did not return a project ID')
      const generationResult = await callTool('generate_screen_from_text', {
        deviceType: 'DESKTOP',
        projectId,
        prompt: input.prompt,
      })
      const screen = findGeneratedScreen(generationResult)
      const screenId =
        findResourceId(screen, 'name', 'screens') ??
        findResourceId(screen, 'screenId', 'screens') ??
        findTextValue(screen, 'id')
      if (!screenId) throw new Error('Stitch did not return a screen ID')
      return saveArtifacts(input.outputDirectory, projectId, screenId, screen ?? generationResult)
    })
    operationQueue = operation.catch(() => undefined)
    return operation
  }

  /**
   * Applies a DESKTOP edit to one existing Stitch screen and saves the returned
   * revision. Stitch may update the screen in place, so the original ID remains
   * the canonical fallback when edit_screens omits a design payload.
   */
  const revise = (input: StitchReviseInput): Promise<StitchGenerateResult> => {
    const operation = operationQueue.then(async () => {
      const editResult = await callTool('edit_screens', {
        deviceType: 'DESKTOP',
        projectId: input.projectId,
        prompt: input.prompt,
        selectedScreenIds: [input.screenId],
      })
      const screen = findGeneratedScreen(editResult)
      const revisedScreenId =
        findResourceId(screen, 'name', 'screens') ??
        findResourceId(screen, 'screenId', 'screens') ??
        findTextValue(screen, 'id') ??
        input.screenId
      return saveArtifacts(
        input.outputDirectory,
        input.projectId,
        revisedScreenId,
        screen ?? editResult
      )
    })
    operationQueue = operation.catch(() => undefined)
    return operation
  }

  return {
    configured: Boolean(endpoint && apiKey && URL.canParse(endpoint)),
    endpoint: endpoint && URL.canParse(endpoint) ? new URL(endpoint).origin : null,
    generate,
    revise,
  }
}
