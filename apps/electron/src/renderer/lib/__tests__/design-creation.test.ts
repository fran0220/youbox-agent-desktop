import { describe, expect, it } from 'bun:test'
import {
  BLANK_DESIGN_TEMPLATE_ID,
  NONE_DESIGN_SYSTEM_ID,
  buildBlankDesignProjectCreateInput,
  buildDesignProjectCreateInput,
  createInitialDesignCreationState,
  selectDesignCreationSystem,
  selectDesignCreationTemplate,
} from '../design-creation'

describe('design creation picker state', () => {
  it('defaults to blank template and no design system', () => {
    expect(createInitialDesignCreationState()).toEqual({
      templateId: BLANK_DESIGN_TEMPLATE_ID,
      designSystemId: NONE_DESIGN_SYSTEM_ID,
    })
  })

  it('updates template and design-system selections independently', () => {
    const initial = createInitialDesignCreationState()
    const withTemplate = selectDesignCreationTemplate(initial, 'html-ppt')
    const withSystem = selectDesignCreationSystem(withTemplate, 'stripe')

    expect(withTemplate).toEqual({
      templateId: 'html-ppt',
      designSystemId: NONE_DESIGN_SYSTEM_ID,
    })
    expect(withSystem).toEqual({
      templateId: 'html-ppt',
      designSystemId: 'stripe',
    })
    expect(initial).toEqual({
      templateId: BLANK_DESIGN_TEMPLATE_ID,
      designSystemId: NONE_DESIGN_SYSTEM_ID,
    })
  })

  it('builds create input with null ids for blank and none selections', () => {
    expect(buildDesignProjectCreateInput('Untitled design', createInitialDesignCreationState())).toEqual({
      name: 'Untitled design',
      templateId: null,
      designSystemId: null,
    })
    expect(buildDesignProjectCreateInput('Deck', {
      templateId: 'html-ppt',
      designSystemId: 'stripe',
    })).toEqual({
      name: 'Deck',
      templateId: 'html-ppt',
      designSystemId: 'stripe',
    })
  })

  it('builds one-click blank create input without picker sentinels', () => {
    expect(buildBlankDesignProjectCreateInput('Untitled design')).toEqual({
      name: 'Untitled design',
      templateId: null,
      designSystemId: null,
    })
  })
})
