import { Check, ChevronDown, Circle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ProjectWorkflowState } from '../../../src/shared/workflow-types.js'

const STAGES = [
  ['requirements', '需求澄清'],
  ['solution', '方案设计'],
  ['development', '开发实现'],
  ['acceptance', '测试验证'],
  ['complete', '交付完成'],
] as const

const STAGE_INDEX: Record<ProjectWorkflowState['stage'], number> = {
  acceptance: 3,
  complete: 4,
  development: 2,
  requirements: 0,
  solution: 1,
}

/** Moves the lifecycle overview into a compact header control while keeping every stage inspectable. */
export const StagePopover = ({ workflow }: { workflow: ProjectWorkflowState }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeIndex = STAGE_INDEX[workflow.stage]
  const activeLabel = STAGES[activeIndex]?.[1] ?? '需求澄清'

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="ac-stage-control" ref={rootRef}>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="ac-status-dot is-running" />
        <span>
          <small>当前阶段</small>
          <strong>{activeLabel}</strong>
        </span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="ac-stage-popover" role="dialog" aria-label="项目所有阶段">
          {STAGES.map(([key, label], index) => {
            const completed = workflow.stage === 'complete' || index < activeIndex
            const active = workflow.stage !== 'complete' && index === activeIndex
            return (
              <div className={active ? 'is-active' : completed ? 'is-complete' : ''} key={key}>
                <span>{completed ? <Check size={13} /> : <Circle size={9} />}</span>
                <div>
                  <strong>{label}</strong>
                  <small>{completed ? '已完成' : active ? '进行中' : '待完成'}</small>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
