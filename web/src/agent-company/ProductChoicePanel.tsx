import { Check, LockKeyhole } from 'lucide-react'
import { useId, useState } from 'react'

export interface ProductChoiceOption {
  description: string
  id: string
  label: string
  recommended: boolean
}

export interface ProductChoicePrompt {
  displayText: string
  options: ProductChoiceOption[]
}

const CHOICE_LINE_PATTERN = /^\s*[-*•]\s*(?:\*\*)?([A-H]|\d{1,2})[.)、:：-]\s*(.+?)\s*$/iu
const REPLY_HINT_PATTERN = /(?:直接回复|请选择|回复.+即可|选择.+继续)/u

/** Removes lightweight Markdown markers that are no longer needed inside native form controls. */
const cleanChoiceText = (value: string) => value.replaceAll('**', '').replaceAll('`', '').trim()

/** Splits an option into a concise title and its supporting explanation. */
const splitChoiceText = (value: string) => {
  const cleaned = cleanChoiceText(value)
  const separatorIndex = cleaned.search(/[：:]/u)
  if (separatorIndex < 0) return { description: '', label: cleaned }
  return {
    description: cleaned.slice(separatorIndex + 1).trim(),
    label: cleaned.slice(0, separatorIndex).trim(),
  }
}

/**
 * Extracts A/B/C or numbered choices from a product-manager reply. At least two
 * options are required so ordinary Markdown lists never turn into an input form.
 */
export const parseProductChoicePrompt = (text: string): ProductChoicePrompt | null => {
  const lines = text.split(/\r?\n/u)
  const parsed = lines.flatMap((line, index) => {
    const match = line.match(CHOICE_LINE_PATTERN)
    if (!match) return []
    const id = match[1]?.toUpperCase()
    const rawChoice = match[2]
    if (!id || !rawChoice) return []
    const content = splitChoiceText(rawChoice)
    return [{ ...content, id, lineIndex: index }]
  })
  if (parsed.length < 2) return null

  const recommendation = text.match(
    /推荐[\s\S]{0,28}?(?:\*\*)?([A-H]|\d{1,2})(?=[\s（(：:.、])/iu
  )?.[1]
  const choiceLines = new Set(parsed.map((option) => option.lineIndex))
  const displayText = lines
    .filter((line, index) => !choiceLines.has(index) && !REPLY_HINT_PATTERN.test(line))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()

  return {
    displayText,
    options: parsed.map(({ description, id, label }) => ({
      description,
      id,
      label,
      recommended: recommendation?.toUpperCase() === id,
    })),
  }
}

interface ProductChoicePanelProps {
  busy: boolean
  onSubmit: (response: string) => Promise<boolean>
  onSubmitAndFreeze: (response: string) => Promise<void>
  prompt: ProductChoicePrompt
}

/**
 * Presents the current product decision as a native single-choice form. It keeps
 * the decision local until confirmation, then sends one concise answer upstream.
 */
export const ProductChoicePanel = ({
  busy,
  onSubmit,
  onSubmitAndFreeze,
  prompt,
}: ProductChoicePanelProps) => {
  const groupName = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = prompt.options.find((option) => option.id === selectedId) ?? null

  /** Builds the concise product-manager reply shared by both confirmation paths. */
  const buildSelectionResponse = () => (selected ? `选择 ${selected.id}：${selected.label}` : null)

  /** Converts the selected card into the short, unambiguous reply expected by the CLI agent. */
  const confirmSelection = async () => {
    const response = buildSelectionResponse()
    if (!response) return
    await onSubmit(response)
  }

  /** Sends the final selection before freezing requirements so the specification includes it. */
  const confirmSelectionAndFreeze = async () => {
    const response = buildSelectionResponse()
    if (!response) return
    await onSubmitAndFreeze(response)
  }

  return (
    <fieldset className="ac-product-choice" disabled={busy}>
      <legend>请选择一项</legend>
      <div className="ac-product-choice__options">
        {prompt.options.map((option) => (
          <label
            className={`ac-product-choice__option ${selectedId === option.id ? 'is-selected' : ''}`}
            key={option.id}
          >
            <input
              type="radio"
              name={groupName}
              value={option.id}
              checked={selectedId === option.id}
              onChange={() => setSelectedId(option.id)}
            />
            <span className="ac-product-choice__key">{option.id}</span>
            <span className="ac-product-choice__copy">
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
            {option.recommended ? <em>推荐</em> : null}
          </label>
        ))}
      </div>
      <div className="ac-product-choice__actions">
        <span>{selected ? `已选择 ${selected.id}` : '选择后即可确认'}</span>
        <div className="ac-product-choice__action-buttons">
          <button
            type="button"
            className="is-secondary"
            disabled={!selected || busy}
            onClick={() => void confirmSelection()}
          >
            <Check size={14} />
            确认选择
          </button>
          <button
            type="button"
            disabled={!selected || busy}
            onClick={() => void confirmSelectionAndFreeze()}
          >
            <LockKeyhole size={13} />
            确认并封板
          </button>
        </div>
      </div>
    </fieldset>
  )
}

/**
 * Offers requirement sealing after a product-manager reply that has no structured
 * choices. The composer stays available so users can keep discussing instead.
 */
export const RequirementFreezeAction = ({
  busy,
  onFreeze,
}: {
  busy: boolean
  onFreeze: () => Promise<void>
}) => (
  <div className="ac-requirement-freeze-action">
    <span>如果需求已经明确，可以直接结束需求澄清；如需补充，继续在下方回复即可。</span>
    <button type="button" disabled={busy} onClick={() => void onFreeze()}>
      <LockKeyhole size={13} />
      确认并封板
    </button>
  </div>
)
