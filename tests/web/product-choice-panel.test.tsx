// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  parseProductChoicePrompt,
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
  test('parses scheme headings from an existing product-manager reply', () => {
    const parsed = parseProductChoicePrompt(`下面是当前问题：

**方案 A · 极简档案**
适合只展示核心数据。

**方案 B · 标准档案（推荐）**
适合完整展示与筛选。

👇 请回复：A) 或 B)`)

    expect(parsed?.options).toEqual([
      { description: '', id: 'A', label: '极简档案', recommended: false },
      { description: '', id: 'B', label: '标准档案（推荐）', recommended: true },
    ])
  })

  test('uses Markdown choice headings without treating nested details as peer choices', () => {
    const parsed = parseProductChoicePrompt(`**1) 单一角色**
1. 只允许管理员访问
2. 采用固定首页

**2) 多角色（推荐）**
1. 管理员和访客权限分离
2. 首页按权限展示`)

    expect(parsed?.options.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: '1', label: '单一角色' },
      { id: '2', label: '多角色（推荐）' },
    ])
  })

  test('parses numbered options that wrap their labels in Markdown', () => {
    const parsed = parseProductChoicePrompt(`请选择展示方式：
1) **静态统计看板**：固定指标
2) **可筛选看板**：支持条件组合
3) **实时大屏**：自动刷新`)

    expect(parsed?.options).toHaveLength(3)
    expect(parsed?.options[1]).toMatchObject({
      description: '支持条件组合',
      id: '2',
      label: '可筛选看板',
    })
  })

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
