/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * YouBox-only credentials step. Upstream credential props stay in the interface
 * for rebase compatibility, but the product path only starts YouBox PKCE auth.
 */

import { useTranslation } from "react-i18next"
import { ExternalLink } from "lucide-react"
import type { ApiSetupMethod } from "./APISetupStep"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import {
  type ApiKeyStatus,
  type OAuthStatus,
} from "../apisetup"
import type { ApiKeySubmitData } from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

export type CredentialStatus = ApiKeyStatus | OAuthStatus

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onBack: () => void
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
  // Device flow (Copilot)
  copilotDeviceCode?: { userCode: string; verificationUri: string }
  // Edit mode (pre-fill existing connection values)
  editInitialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    customApi?: CustomEndpointApi
  }
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onStartOAuth,
  onBack,
}: CredentialsStepProps) {
  const { t } = useTranslation()
  const isYouBoxGateway = apiSetupMethod === 'youbox_gateway'

  return (
    <StepFormLayout
      title={t("onboarding.credentials.connectYouBox")}
      description={t("onboarding.credentials.connectYouBoxDesc")}
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          {isYouBoxGateway && (
            <ContinueButton
              onClick={() => onStartOAuth?.('youbox_gateway')}
              className="gap-2"
              loading={status === 'validating'}
              loadingText={t("onboarding.credentials.waitingForAuth")}
            >
              <ExternalLink className="size-4" />
              {t("onboarding.credentials.signInYouBox")}
            </ContinueButton>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-foreground-2 p-4 text-sm text-muted-foreground">
          <p>{t("onboarding.credentials.youboxInstructions")}</p>
        </div>
        {!isYouBoxGateway && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
            YouBox Agent only supports YouBox sign-in.
          </div>
        )}
        {status === 'error' && errorMessage && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
            {errorMessage}
          </div>
        )}
        {status === 'success' && (
          <div className="rounded-lg bg-success/10 text-success text-sm p-3">
            {t("onboarding.credentials.youboxConnected")}
          </div>
        )}
      </div>
    </StepFormLayout>
  )
}
