import fs from 'node:fs'
import path from 'node:path'

import { ChromeVisualBrowser, findChrome } from '../vendor/archify/bin/visual-check.mjs'

const APP_URL = process.env.AGENT_COMPANY_QA_URL || 'http://127.0.0.1:5180/'
const WORKSPACE_PATH = process.env.AGENT_COMPANY_QA_WORKSPACE || ''
const PROJECT_NAME = process.env.AGENT_COMPANY_QA_PROJECT || '学生信息管理平台'
const OUTPUT_DIRECTORY = path.resolve('docs', 'qa')

/** Evaluates browser JavaScript and returns its JSON-serializable value. */
const evaluate = async (browser, sessionId, expression, awaitPromise = false) => {
  const response = await browser.cdp.send(
    'Runtime.evaluate',
    { awaitPromise, expression, returnByValue: true },
    sessionId
  )
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        'Browser evaluation failed'
    )
  }
  return response.result?.value
}

/** Waits until a visible text fragment appears, keeping asynchronous React polling deterministic. */
const waitForText = async (browser, sessionId, text, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await evaluate(
      browser,
      sessionId,
      `document.body.innerText.includes(${JSON.stringify(text)})`
    )
    if (found) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for visible text: ${text}`)
}

/** Activates a visible control through the browser's standard HTMLElement click path. */
const clickControl = async (browser, sessionId, label) => {
  const clicked = await evaluate(
    browser,
    sessionId,
    `(function () {
      const label = ${JSON.stringify(label)};
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], input, textarea, select'));
      const target = candidates.find((element) => {
        const text = (element.textContent || '').replaceAll(String.fromCharCode(10), ' ').replaceAll(String.fromCharCode(13), ' ').trim();
        return text === label || text.startsWith(label) || element.getAttribute('title') === label || element.getAttribute('aria-label') === label;
      });
      if (!target) return false;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    })()`
  )
  if (!clicked) throw new Error(`Visible control not found: ${label}`)
}

/** Fills a field through its native value setter and input event so React receives the change. */
const fillByPlaceholder = async (browser, sessionId, placeholder, value) => {
  const filled = await evaluate(
    browser,
    sessionId,
    `(function () {
      const target = document.querySelector('[placeholder=${JSON.stringify(placeholder)}]') ||
        (${JSON.stringify(placeholder.includes('student-admin'))} ? document.querySelectorAll('.ac-modal input')[1] : null);
      if (!target) return false;
      const setter = Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
      setter.call(target, ${JSON.stringify(value)});
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  )
  if (!filled) throw new Error(`Field not found: ${placeholder}`)
}

/** Captures a fixed desktop viewport as durable QA evidence. */
const capture = async (browser, sessionId, name) => {
  const screenshot = await browser.cdp.send(
    'Page.captureScreenshot',
    { captureBeyondViewport: false, format: 'png', fromSurface: true },
    sessionId,
    20_000
  )
  if (!screenshot.data) throw new Error('Chrome returned an empty screenshot')
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true })
  fs.writeFileSync(path.join(OUTPUT_DIRECTORY, name), Buffer.from(screenshot.data, 'base64'))
}

/** Exercises the desktop shell with real pointer and keyboard input. */
const run = async () => {
  const chromePath = findChrome()
  if (!chromePath) throw new Error('Chrome is unavailable for desktop QA')
  const browser = new ChromeVisualBrowser(chromePath)
  try {
    const sessionId = await browser.sessionPromise
    await browser.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { deviceScaleFactor: 1, height: 1000, mobile: false, width: 1600 },
      sessionId
    )
    await browser.cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source:
          "window.__agentCompanyQaErrors=[];addEventListener('error',e=>window.__agentCompanyQaErrors.push(String(e.error||e.message)));addEventListener('unhandledrejection',e=>window.__agentCompanyQaErrors.push(String(e.reason)));",
      },
      sessionId
    )
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId)
    const navigation = await browser.cdp.send('Page.navigate', { url: APP_URL }, sessionId)
    if (navigation.errorText) throw new Error(navigation.errorText)
    await loaded
    await waitForText(browser, sessionId, 'Agent Company')
    await capture(browser, sessionId, '01-shell.png')

    const hasProject = await evaluate(
      browser,
      sessionId,
      `document.body.innerText.includes(${JSON.stringify(PROJECT_NAME)})`
    )
    if (!hasProject) {
      if (!WORKSPACE_PATH)
        throw new Error('AGENT_COMPANY_QA_WORKSPACE is required to create a project')
      const firstProjectButton = await evaluate(
        browser,
        sessionId,
        `document.body.innerText.includes('创建第一个项目')`
      )
      await clickControl(browser, sessionId, firstProjectButton ? '创建第一个项目' : '新建项目')
      await waitForText(browser, sessionId, '创建软件项目')
      await fillByPlaceholder(browser, sessionId, '例如：学生信息管理平台', PROJECT_NAME)
      await fillByPlaceholder(
        browser,
        sessionId,
        'D:\\project\\agent-company-workspace\\项目名称',
        WORKSPACE_PATH
      )
      await clickControl(browser, sessionId, '创建并启动部门经理')
      await waitForText(browser, sessionId, '需求已经聊清楚了吗？', 60_000)
    }

    const hasArchitectureExample = await evaluate(
      browser,
      sessionId,
      `document.body.innerText.includes('内置示例 · Agent Company 运行时架构')`
    )
    if (hasArchitectureExample) {
      throw new Error('A new project rendered the retired Agent Company architecture demo')
    }
    await clickControl(browser, sessionId, '执行流程')
    await new Promise((resolve) => setTimeout(resolve, 250))
    await clickControl(browser, sessionId, '规划流程')
    await clickControl(browser, sessionId, '管理团队')
    await waitForText(browser, sessionId, '角色与团队成员')
    await capture(browser, sessionId, '02-team-dialog.png')
    await clickControl(browser, sessionId, '关闭')

    const requirement =
      '开发一个桌面端学生信息管理平台：支持学生列表、新增、编辑、删除和按姓名搜索；请先由产品经理一次只追问一个关键问题。'
    const requirementExists = await evaluate(
      browser,
      sessionId,
      `document.body.innerText.includes(${JSON.stringify(requirement)})`
    )
    if (!requirementExists) {
      await fillByPlaceholder(browser, sessionId, '描述需求、反馈方案或要求修改…', requirement)
      await clickControl(browser, sessionId, '发送')
      await waitForText(browser, sessionId, requirement)
    }
    await capture(browser, sessionId, '03-requirement-sent.png')

    const errors = await evaluate(browser, sessionId, 'window.__agentCompanyQaErrors || []')
    const alert = await evaluate(
      browser,
      sessionId,
      `document.querySelector('[role="alert"]')?.innerText || ''`
    )
    if (errors.length > 0) throw new Error(`Browser runtime errors: ${errors.join(' | ')}`)
    if (alert) throw new Error(`Application alert: ${alert}`)
    process.stdout.write(
      `${JSON.stringify({ errors, project: PROJECT_NAME, screenshots: ['01-shell.png', '02-team-dialog.png', '03-requirement-sent.png'] }, null, 2)}\n`
    )
  } finally {
    await browser.close()
  }
}

await run()
