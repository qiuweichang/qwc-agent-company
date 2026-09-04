import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const ARTIFACT_REFERENCE_PATTERN =
  /(?:^|[\s`"'[(（])((?:docs[\\/](?:architecture|design)[\\/])[^\s`"'<>|，。；：)）\]]+?\.(?:html?|png|jpe?g|webp|svg|json|md))/gimu

/** Returns true when a resolved file remains inside the selected project workspace. */
const isInsideWorkspace = (workspaceRoot: string, artifactPath: string) => {
  const relativePath = relative(workspaceRoot, artifactPath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath)
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
    const reference = match[1]?.replaceAll('\\', '/')
    if (!reference) continue
    const candidatePath = resolve(workspaceRoot, reference)
    if (!existsSync(candidatePath)) continue
    const realArtifactPath = realpathSync(candidatePath)
    if (!isInsideWorkspace(workspaceRoot, realArtifactPath) || !statSync(realArtifactPath).isFile()) {
      continue
    }
    merged.add(relative(workspaceRoot, realArtifactPath).split(sep).join('/'))
  }

  return [...merged]
}
