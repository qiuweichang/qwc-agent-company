import { ExternalLink, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { getWorkspaceArtifactUrl } from '../api.js'

interface ArtifactFrameProps {
  path: string
  title: string
  workspaceId?: string
}

const isImageArtifact = (path: string) => /\.(?:png|jpe?g|webp|svg)$/i.test(path)

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

  const embeddedSource = `${source}${source.includes('?') ? '&' : '?'}embed=1`
  return (
    <section className="ac-artifact" aria-label={title}>
      <div className="ac-artifact__head">
        <span className="ac-artifact__kind">ARCHIFY · HTML</span>
        <strong>{title}</strong>
        <button
          type="button"
          className="ac-icon-button"
          title="在新窗口查看完整演示图"
          onClick={() => window.open(standaloneSource, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink size={15} />
        </button>
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
