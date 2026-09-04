import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const ARTIFACT_REFERENCE_PATTERN =
  /(?:^|[\s`"'[(（])((?:docs[\\/](?:architecture|design)[\\/])[^\s`"'<>|，。；：)）\]]+?\.(?:html?|png|jpe?g|webp|svg|json|md))/gimu
const MARKDOWN_ARTIFACT_LINK_PATTERN =
  /\]\(\s*<?([^\s)>]+?\.(?:html?|png|jpe?g|webp|svg|json|md))>?(?:\s+["'][^)]*["'])?\s*\)/gimu

/** Returns true when a resolved file remains inside the selected project workspace. */
const isInsideWorkspace = (workspaceRoot: string, artifactPath: string) => {
  const relativePath = relative(workspaceRoot, artifactPath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

/**
 * Resolves a report or Markdown reference to a real project file. Returning the
 * canonical workspace-relative path keeps the browser endpoint portable while
 * the real-path containment check prevents linked files from escaping the project.
 */
const resolveArtifactReference = (
  workspaceRoot: string,
  referenceBase: string,
  reference: string
): string | null => {
  const cleanReference = reference.trim().replaceAll('\\', '/').split(/[?#]/u, 1)[0]
  if (!cleanReference) return null
  const candidatePath = isAbsolute(cleanReference)
    ? cleanReference
    : resolve(referenceBase, cleanReference)
  if (!existsSync(candidatePath)) return null
  const realArtifactPath = realpathSync(candidatePath)
  if (!isInsideWorkspace(workspaceRoot, realArtifactPath) || !statSync(realArtifactPath).isFile()) {
    return null
  }
  return relative(workspaceRoot, realArtifactPath).split(sep).join('/')
}

/**
 * Reads visual files registered by a reported Markdown deliverable. Stitch
 * commonly records several generated screens in DESIGN.md while the final team
 * report names only that index document, so these links must join the report's
 * artifact list for the conversation to render the actual prototypes.
 */
const discoverMarkdownArtifacts = (
  workspaceRoot: string,
  markdownArtifact: string
): string[] => {
  const markdownPath = resolveArtifactReference(workspaceRoot, workspaceRoot, markdownArtifact)
  if (!markdownPath) return []
  const absoluteMarkdownPath = resolve(workspaceRoot, markdownPath)
  if (!/\.md$/iu.test(absoluteMarkdownPath)) return []

  const markdown = readFileSync(absoluteMarkdownPath, 'utf8')
  const discovered: string[] = []
  for (const match of markdown.matchAll(MARKDOWN_ARTIFACT_LINK_PATTERN)) {
    const reference = match[1]
    if (!reference) continue
    const artifact = resolveArtifactReference(
      workspaceRoot,
      dirname(absoluteMarkdownPath),
      reference
    )
    if (artifact) discovered.push(artifact)
  }
  return discovered
}

/**
 * Adds real design and architecture files mentioned in an agent report to its
 * declared artifact list. This keeps display reliable when a CLI member creates
 * Stitch/Archify output but forgets one of the repeated --artifact flags.
 */
export const mergeReportedArtifactPaths = (
  workspacePath: string,
  declaredArtifacts: string[],
  reportText: string
) => {
  const merged = new Set(
    declaredArtifacts.map((artifact) => artifact.trim().replaceAll('\\', '/')).filter(Boolean)
  )
  const workspaceRoot = realpathSync(workspacePath)

  for (const match of reportText.matchAll(ARTIFACT_REFERENCE_PATTERN)) {
    const reference = match[1]
    if (!reference) continue
    const artifact = resolveArtifactReference(workspaceRoot, workspaceRoot, reference)
    if (artifact) merged.add(artifact)
  }

  // Iterate over a snapshot because discovered links are deliverables, not
  // additional Markdown indexes that should recursively expand without bound.
  for (const artifact of [...merged]) {
    if (!/\.md$/iu.test(artifact)) continue
    for (const linkedArtifact of discoverMarkdownArtifacts(workspaceRoot, artifact)) {
      merged.add(linkedArtifact)
    }
  }

  return [...merged]
}
