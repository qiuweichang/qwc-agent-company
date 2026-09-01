import { createContext, type ReactNode, useContext } from 'react'

const messages = {
  'common.stopped': '终端已停止',
  'terminal.statusConnecting': '正在连接终端',
  'terminal.statusRunning': '终端运行中',
  'terminalPanels.aria': '项目终端会话',
  'toast.dismissAria': '关闭通知',
} as const

export type TranslationKey = keyof typeof messages

interface I18nApi {
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nApi | null>(null)

/** Supplies the small Chinese message set used by the desktop-only Agent Company UI. */
export const I18nProvider = ({ children }: { children: ReactNode }) => (
  <I18nContext.Provider value={{ t: (key) => messages[key] }}>{children}</I18nContext.Provider>
)

/** Returns the local UI translator and fails fast when the provider is missing. */
export const useI18n = (): I18nApi => {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}
