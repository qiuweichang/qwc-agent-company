import { ExternalLink, FileText, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { getWorkspaceArtifactUrl } from '../api.js'

interface ArtifactFrameProps {
  path: string
  title: string
  workspaceId?: string
}

const isImageArtifact = (path: string) => /\.(?:png|jpe?g|webp|svg)$/i.test(path)

/**
 * Identifies artifacts that can safely use the interactive diagram iframe.
 * Text documents remain first-class deliverables, but rendering them as HTML
 * produces a blank frame and incorrectly exposes Archify zoom controls.
 */
const isHtmlArtifact = (path: string) => /\.html?$/i.test(path)

/**
 * Places generated prototype screenshots before supporting HTML and Markdown
 * files. Agents often report DESIGN.md first, but the conversation's primary
 * design evidence is the visual Stitch output rather than the index document.
 */
export const orderConversationArtifacts = (artifacts: string[]): string[] =>
  artifacts
    .map((path, index) => ({
      index,
      path,
      priority: isImageArtifact(path) ? 0 : isHtmlArtifact(path) ? 1 : 2,
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ path }) => path)

/**
 * Renders an agent-reported visual artifact. HTML diagrams stay sandboxed in an
 * iframe; host-side zoom controls remain available in embedded Archify mode.
 */
export const ArtifactFrame = ({ path, title, workspaceId }: ArtifactFrameProps) => {
  const [zoom, setZoom] = useState(1)
  const source = workspaceId ? getWorkspaceArtifactUrl(workspaceId, path) : path
  // Resolve against the current origin before opening a new tab. Some desktop
  // browser hosts otherwise treat a root-relative popup URL as the app root.
  const standaloneSource = new URL(source, window.location.href).toString()

  if (isImageArtifact(path)) {
    return (
      <figure className="ac-artifact ac-artifact--image">
        <img alt={title} src={source} />
        <figcaption>{title}</figcaption>
      </figure>
    )
  }

  if (!isHtmlArtifact(path)) {
    return (
      <a
        className="ac-artifact-file"
        href={standaloneSource}
        rel="noopener noreferrer"
        target="_blank"
        title={`打开 ${title}`}
      >
        <span className="ac-artifact-file__icon" aria-hidden="true">
          <FileText size={18} />
        </span>
        <span className="ac-artifact-file__copy">
          <strong>{title}</strong>
          <small>说明文档 · 点击在新窗口查看</small>
        </span>
        <ExternalLink size={15} aria-hidden="true" />
      </a>
    )
  }

  const embeddedSource = `${source}${source.includes('?') ? '&' : '?'}embed=1`
  return (
    <section className="ac-artifact" aria-label={title}>
      <div className="ac-artifact__head">
        <span className="ac-artifact__kind">
          {/stitch-/iu.test(path) ? 'STITCH · HTML' : 'ARCHIFY · HTML'}
        </span>
        <strong>{title}</strong>
        <a
          className="ac-icon-button"
          title="在新窗口查看完整演示图"
          aria-label="在新窗口查看完整演示图"
          href={standaloneSource}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink size={15} />
        </a>
      </div>
      <div className="ac-artifact__viewport">
        <iframe
          title={title}
          src={embeddedSource}
          style={{ transform: `scale(${zoom})` }}
          sandbox="allow-scripts allow-same-origin allow-downloads"
        />
        <div className="ac-artifact__controls" aria-label="演示图控制" role="toolbar">
          <button type="button" title="适配画布" onClick={() => setZoom(1)}>
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            title="缩小"
            onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            title="放大"
            onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
          >
            <Plus size={14} />
          </button>
          <button type="button" title="重置" onClick={() => setZoom(1)}>
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
    </section>
  )
}
