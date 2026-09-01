// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  ProductChoicePanel,
  type ProductChoicePrompt,
  RequirementFreezeAction,
} from '../../web/src/agent-company/ProductChoicePanel.js'

afterEach(() => cleanup())

const prompt: ProductChoicePrompt = {
  displayText: '请选择数据接入方式',
  options: [
    { description: '先使用演示数据', id: 'A', label: '演示数据', recommended: false },
    { description: '先演示后接入', id: 'B', label: '分阶段接入', recommended: true },
  ],
}

describe('ProductChoicePanel', () => {
  test('submits the selected option without freezing when the user confirms normally', () => {
    const onSubmit = vi.fn(async () => true)
    const onSubmitAndFreeze = vi.fn(async () => {})
    render(
      <ProductChoicePanel
        busy={false}
        onSubmit={onSubmit}
        onSubmitAndFreeze={onSubmitAndFreeze}
        prompt={prompt}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: /分阶段接入/u }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))

    expect(onSubmit).toHaveBeenCalledWith('选择 B：分阶段接入')
    expect(onSubmitAndFreeze).not.toHaveBeenCalled()
  })

  test('submits the selected option through the freeze path when discussion should end', () => {
    const onSubmit = vi.fn(async () => true)
    const onSubmitAndFreeze = vi.fn(async () => {})
    render(
      <ProductChoicePanel
        busy={false}
        onSubmit={onSubmit}
        onSubmitAndFreeze={onSubmitAndFreeze}
        prompt={prompt}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: /演示数据/u }))
    fireEvent.click(screen.getByRole('button', { name: '确认并封板' }))

    expect(onSubmitAndFreeze).toHaveBeenCalledWith('选择 A：演示数据')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('keeps both confirmation paths disabled until an option is selected', () => {
    render(
      <ProductChoicePanel
        busy={false}
        onSubmit={vi.fn(async () => true)}
        onSubmitAndFreeze={vi.fn(async () => {})}
        prompt={prompt}
      />
    )

    expect(screen.getByRole('button', { name: '确认选择' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并封板' })).toBeDisabled()
  })
})

describe('RequirementFreezeAction', () => {
  test('allows sealing after an unstructured PM reply while explaining that chat can continue', () => {
    const onFreeze = vi.fn(async () => {})
    render(<RequirementFreezeAction busy={false} onFreeze={onFreeze} />)

    expect(screen.getByText(/继续在下方回复即可/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认并封板' }))
    expect(onFreeze).toHaveBeenCalledTimes(1)
  })
})
