import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Check, CreditCard } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import type { LlmAuthType, LlmProviderType } from "@craft-agent/shared/config/llm-connections"

/** Retained for upstream-compatible prop types; YouBox product builds render only YouBox. */
export type ProviderSegment = 'anthropic' | 'pi'

/**
 * API setup method for onboarding.
 * YouBox product path exposes only `youbox_gateway`; other upstream method names
 * are retained as inert compatibility types for easier upstream rebases.
 */
export type ApiSetupMethod =
  | 'youbox_gateway'
  | 'anthropic_api_key'
  | 'claude_oauth'
  | 'pi_chatgpt_oauth'
  | 'pi_copilot_oauth'
  | 'pi_api_key'

/**
 * Map ApiSetupMethod to the underlying runtime adapter.
 *
 * YouBox is the only product provider. Legacy upstream method IDs are inert
 * aliases and all resolve to the managed YouBox Gateway adapter.
 */
export function apiSetupMethodToConnectionTypes(_method: ApiSetupMethod): {
  providerType: LlmProviderType;
  authType: LlmAuthType;
} {
  return { providerType: 'pi_compat', authType: 'api_key_with_endpoint' };
}

interface ApiSetupOption {
  id: ApiSetupMethod
  name: string
  description: string
  icon: React.ReactNode
  providerType: LlmProviderType
}

const API_SETUP_ICONS: Record<ApiSetupMethod, React.ReactNode> = {
  youbox_gateway: <CreditCard className="size-4" />,
  claude_oauth: <CreditCard className="size-4" />,
  anthropic_api_key: <CreditCard className="size-4" />,
  pi_chatgpt_oauth: <CreditCard className="size-4" />,
  pi_copilot_oauth: <CreditCard className="size-4" />,
  pi_api_key: <CreditCard className="size-4" />,
}

interface APISetupStepProps {
  selectedMethod: ApiSetupMethod | null
  onSelect: (method: ApiSetupMethod) => void
  onContinue: () => void
  onBack: () => void
  /** Initial segment to show (defaults to 'anthropic') */
  initialSegment?: ProviderSegment
}

/**
 * Individual option button component
 */
function OptionButton({
  option,
  isSelected,
  onSelect,
}: {
  option: ApiSetupOption
  isSelected: boolean
  onSelect: (method: ApiSetupMethod) => void
}) {
  return (
    <button
      onClick={() => onSelect(option.id)}
      className={cn(
        "flex w-full items-start gap-4 rounded-xl p-4 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "hover:bg-foreground/[0.02] shadow-minimal",
        isSelected
          ? "bg-background"
          : "bg-foreground-2"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          isSelected ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {option.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{option.name}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {option.description}
        </p>
      </div>

      {/* Check */}
      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          isSelected
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/20"
        )}
      >
        {isSelected && <Check className="size-3" strokeWidth={3} />}
      </div>
    </button>
  )
}

/**
 * APISetupStep - YouBox-only gateway setup entry.
 */
export function APISetupStep({
  selectedMethod,
  onSelect,
  onContinue,
  onBack,
  initialSegment: _initialSegment = 'anthropic',
}: APISetupStepProps) {
  const { t } = useTranslation()

  const API_SETUP_OPTIONS: ApiSetupOption[] = [
    {
      id: 'youbox_gateway',
      name: t("onboarding.providerSelect.youbox"),
      description: t("onboarding.providerSelect.youboxDesc"),
      icon: API_SETUP_ICONS.youbox_gateway,
      providerType: 'pi_compat',
    },
  ]

  return (
    <StepFormLayout
      title={t("onboarding.credentials.connectYouBox")}
      description={t("onboarding.credentials.connectYouBoxDesc")}
      actions={
        <>
          <BackButton onClick={onBack} />
          <ContinueButton onClick={onContinue} disabled={!selectedMethod} />
        </>
      }
    >
      <div className="bg-foreground-2 rounded-[8px] p-4 mb-3">
        <p className="text-sm text-muted-foreground text-center">
          {t("onboarding.credentials.youboxInstructions")}
        </p>
      </div>

      <div className="space-y-3 min-h-[180px]">
        {API_SETUP_OPTIONS.map((option) => (
          <OptionButton
            key={option.id}
            option={option}
            isSelected={option.id === selectedMethod}
            onSelect={onSelect}
          />
        ))}
      </div>
    </StepFormLayout>
  )
}
