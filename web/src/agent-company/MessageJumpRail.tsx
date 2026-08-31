import type { RefObject } from 'react'

import type { ConversationEntry } from '../../../src/shared/workflow-types.js'

interface MessageJumpRailProps {
  entries: ConversationEntry[]
  messageRefs: RefObject<Map<number, HTMLElement>>
}

/** Provides Codex-style landmarks for jumping directly to every user-authored message. */
export const MessageJumpRail = ({ entries, messageRefs }: MessageJumpRailProps) => {
  const userEntries = entries.filter((entry) => entry.type === 'user_input')
  if (userEntries.length === 0) return null
  return (
    <nav className="ac-message-jump" aria-label="用户消息快速跳转">
      {userEntries.map((entry, index) => (
        <button
          type="button"
          key={entry.id}
          title={`跳转到第 ${index + 1} 条用户消息`}
          onClick={() =>
            messageRefs.current?.get(entry.id)?.scrollIntoView({ behavior: 'auto', block: 'start' })
          }
        >
          <span />
        </button>
      ))}
    </nav>
  )
}
