import { setupI18n, i18n, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

const UI_LANG_QUERY_PARAM = 'uiLang'

let documentLangListenerAttached = false

function syncDocumentLanguage(lang: string | undefined): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang ?? 'en'
}

function attachDocumentLanguageListener(): void {
  if (documentLangListenerAttached) return
  documentLangListenerAttached = true
  i18n.on('languageChanged', (lang) => {
    syncDocumentLanguage(lang)
  })
}

export function readUiLangFromQuery(): LanguageCode | undefined {
  if (typeof window === 'undefined') return undefined
  const candidate = new URLSearchParams(window.location.search).get(UI_LANG_QUERY_PARAM)
  if (!candidate) return undefined
  if (!SUPPORTED_LANGUAGE_CODES.includes(candidate as LanguageCode)) return undefined
  return candidate as LanguageCode
}

/**
 * Initialize renderer i18n. Main window relies on LanguageDetector; browser
 * sub-windows pass `initialLanguage` from the main process (separate session).
 */
export function bootstrapRendererI18n(options?: { initialLanguage?: string }): void {
  setupI18n([LanguageDetector, initReactI18next])
  attachDocumentLanguageListener()

  const fromQuery = readUiLangFromQuery()
  const initial = options?.initialLanguage ?? fromQuery
  if (initial && SUPPORTED_LANGUAGE_CODES.includes(initial as LanguageCode)) {
    // Synchronous — bundled resources load inline; sub-windows must be
    // correct before the first React paint (no shared localStorage).
    i18n.language = initial
    i18n.resolvedLanguage = initial
  }

  syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)
}

/** Register a global hook for main-process executeJavaScript language updates. */
export function registerWindowLanguageHook(onChange: (lang: string) => void): void {
  if (typeof window === 'undefined') return
  ;(window as Window & { __craftChangeLanguage?: (lang: string) => void }).__craftChangeLanguage = (
    lang: string,
  ) => {
    if (!SUPPORTED_LANGUAGE_CODES.includes(lang as LanguageCode)) return
    void i18n.changeLanguage(lang)
    onChange(lang)
  }
}