import type { ReactNode } from 'react'

import { I18nProvider } from './i18n.js'
import { Toaster } from './ui/toast.js'
import { ToastProvider } from './ui/useToast.js'

export const AppProviders = ({ children }: { children: ReactNode }) => (
  <I18nProvider>
    <ToastProvider>
      {children}
      <Toaster />
    </ToastProvider>
  </I18nProvider>
)
