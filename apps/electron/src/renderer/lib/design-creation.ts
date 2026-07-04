import type { DesignProjectCreateInput } from '@craft-agent/shared/protocol'

export const BLANK_DESIGN_TEMPLATE_ID = '__blank__'
export const NONE_DESIGN_SYSTEM_ID = '__none__'

export interface DesignCreationState {
  templateId: string
  designSystemId: string
}

export function createInitialDesignCreationState(): DesignCreationState {
  return {
    templateId: BLANK_DESIGN_TEMPLATE_ID,
    designSystemId: NONE_DESIGN_SYSTEM_ID,
  }
}

export function selectDesignCreationTemplate(state: DesignCreationState, templateId: string): DesignCreationState {
  return { ...state, templateId }
}

export function selectDesignCreationSystem(state: DesignCreationState, designSystemId: string): DesignCreationState {
  return { ...state, designSystemId }
}

export function buildDesignProjectCreateInput(
  name: string,
  state: DesignCreationState,
): DesignProjectCreateInput {
  return {
    name,
    templateId: state.templateId === BLANK_DESIGN_TEMPLATE_ID ? null : state.templateId,
    designSystemId: state.designSystemId === NONE_DESIGN_SYSTEM_ID ? null : state.designSystemId,
  }
}

export function buildBlankDesignProjectCreateInput(name: string): DesignProjectCreateInput {
  return buildDesignProjectCreateInput(name, createInitialDesignCreationState())
}
