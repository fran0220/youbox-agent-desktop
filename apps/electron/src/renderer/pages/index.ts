/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as CanvasPage } from './CanvasPage'
export { default as GameStudioPage } from './GameStudioPage'
export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'
// Settings pages
export {
  SettingsNavigator,
  AppSettingsPage,
  AiSettingsPage,
  AppearanceSettingsPage,
  InputSettingsPage,
  WorkspaceSettingsPage,
  PermissionsSettingsPage,
  LabelsSettingsPage,
  ShortcutsPage,
  PreferencesPage,
} from './settings'
