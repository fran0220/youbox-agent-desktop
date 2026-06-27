import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GatewayLoginStep } from "./GatewayLoginStep"
import type { LoginStatus } from "./OnboardingWizard"

interface ReauthScreenProps {
  onSubmitGatewayLogin: (data: { username: string; password: string }) => Promise<void>
  onReset: () => void
}

/**
 * Gateway re-login after an expired or revoked server session.
 * Local workspaces and config are preserved.
 */
export function ReauthScreen({ onSubmitGatewayLogin, onReset }: ReauthScreenProps) {
  const { t } = useTranslation()
  const [loginStatus, setLoginStatus] = useState<LoginStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

  const handleSubmit = useCallback(
    async (data: { username: string; password: string }) => {
      setLoginStatus('waiting')
      setErrorMessage(undefined)
      try {
        await onSubmitGatewayLogin(data)
        setLoginStatus('success')
      } catch (err) {
        setLoginStatus('error')
        setErrorMessage(err instanceof Error ? err.message : 'Sign in failed')
      }
    },
    [onSubmitGatewayLogin],
  )

  return (
    <div className="relative flex min-h-screen flex-col bg-foreground-2">
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      <div
        className="mx-auto mt-20 flex max-w-md items-start gap-3 rounded-lg border border-info/20 bg-info/5 px-4 py-3 text-sm text-foreground/80"
        role="status"
      >
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
        <div>
          <p className="font-medium text-foreground">{t("onboarding.reauth.title")}</p>
          <p className="mt-1 text-muted-foreground">{t("onboarding.reauth.expired")}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">{t("onboarding.reauth.preserved")}</p>
        </div>
      </div>

      <GatewayLoginStep
        loginStatus={loginStatus}
        errorMessage={errorMessage}
        onSubmit={handleSubmit}
      />

      <div className="absolute bottom-8 left-0 right-0 flex justify-center px-8">
        <Button
          variant="ghost"
          onClick={onReset}
          disabled={loginStatus === 'waiting'}
          className="max-w-[320px] w-full bg-foreground-2 shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
          size="sm"
        >
          {t("onboarding.reauth.resetApp")}
        </Button>
      </div>
    </div>
  )
}
