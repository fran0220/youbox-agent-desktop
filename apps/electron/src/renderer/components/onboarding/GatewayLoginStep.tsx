import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@craft-agent/ui'
import { OriginCoworksSymbol } from '@/components/icons/OriginCoworksSymbol'
import { StepFormLayout } from './primitives'
import type { LoginStatus } from './OnboardingWizard'

export interface GatewayLoginSubmitData {
  username: string
  password: string
}

interface GatewayLoginStepProps {
  loginStatus: LoginStatus
  errorMessage?: string
  onSubmit: (data: GatewayLoginSubmitData) => void
  onFeishuLogin?: () => void
}

export function GatewayLoginStep({
  loginStatus,
  errorMessage,
  onSubmit,
  onFeishuLogin,
}: GatewayLoginStepProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [usernameError, setUsernameError] = useState<string | undefined>()
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [pendingMethod, setPendingMethod] = useState<'password' | 'feishu' | null>(null)

  const isSubmitting = loginStatus === 'waiting'
  const isPasswordSubmitting = isSubmitting && pendingMethod !== 'feishu'
  const isFeishuSubmitting = isSubmitting && pendingMethod === 'feishu'

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const u = username.trim()
      const p = password
      let valid = true
      if (!u) {
        setUsernameError(t('onboarding.gatewayLogin.usernameRequired'))
        valid = false
      } else {
        setUsernameError(undefined)
      }
      if (!p) {
        setPasswordError(t('onboarding.gatewayLogin.passwordRequired'))
        valid = false
      } else {
        setPasswordError(undefined)
      }
      if (!valid) return
      setPendingMethod('password')
      onSubmit({ username: u, password: p })
    },
    [username, password, onSubmit, t],
  )

  const handleFeishuLogin = useCallback(() => {
    setPendingMethod('feishu')
    onFeishuLogin?.()
  }, [onFeishuLogin])

  const displayError =
    errorMessage && loginStatus === 'error' ? errorMessage : undefined

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center rounded-full bg-foreground/5">
          <OriginCoworksSymbol className="size-10 text-foreground" />
        </div>
      }
      title={t('onboarding.gatewayLogin.title')}
      description={t('onboarding.gatewayLogin.description')}
      actions={
        <form onSubmit={handleSubmit} className="flex w-full max-w-[320px] flex-col gap-4">
          <div className="flex flex-col gap-2 text-left">
            <Label htmlFor="gateway-username">{t('onboarding.gatewayLogin.username')}</Label>
            <Input
              id="gateway-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                if (usernameError) setUsernameError(undefined)
              }}
              disabled={isSubmitting}
              aria-invalid={!!usernameError}
            />
            {usernameError ? (
              <p className="text-sm text-destructive" role="alert">{usernameError}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 text-left">
            <Label htmlFor="gateway-password">{t('onboarding.gatewayLogin.password')}</Label>
            <Input
              id="gateway-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (passwordError) setPasswordError(undefined)
              }}
              disabled={isSubmitting}
              aria-invalid={!!passwordError}
            />
            {passwordError ? (
              <p className="text-sm text-destructive" role="alert">{passwordError}</p>
            ) : null}
          </div>
          {displayError ? (
            <p className="text-sm text-destructive text-center" role="alert">
              {displayError}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
            size="lg"
          >
            {isPasswordSubmitting ? (
              <>
                <Spinner className="mr-2" />
                {t('onboarding.gatewayLogin.signingIn')}
              </>
            ) : (
              <>
                <LogIn className="mr-2 size-4" />
                {t('onboarding.gatewayLogin.signIn')}
              </>
            )}
          </Button>
          {onFeishuLogin ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>{t('onboarding.gatewayLogin.or')}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                className="w-full rounded-lg"
                size="lg"
                onClick={handleFeishuLogin}
              >
                {isFeishuSubmitting ? (
                  <>
                    <Spinner className="mr-2" />
                    {t('onboarding.gatewayLogin.feishuSigningIn')}
                  </>
                ) : (
                  <>
                    <LogIn className="mr-2 size-4" />
                    {t('onboarding.gatewayLogin.feishuSignIn')}
                  </>
                )}
              </Button>
            </>
          ) : null}
        </form>
      }
    />
  )
}
