#!/usr/bin/env bun

import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

type ConfigModule = typeof import('@craft-agent/shared/config')

const VALIDATION_ROOT = '/tmp/mission-design-validation'
const DEFAULT_NAME = 'Validation Workspace B'
const DEFAULT_SLUG = 'workspace-b'

function assertInsideValidationRoot(configDir: string): void {
  if (!isAbsolute(configDir)) {
    throw new Error(`--config-dir must be absolute, got ${configDir}`)
  }

  const resolved = resolve(configDir)
  const validationRoot = realpathSync(VALIDATION_ROOT)
  const parent = resolve(resolved, '..')
  const realParent = existsSync(parent) ? realpathSync(parent) : parent

  if (realParent !== validationRoot && !realParent.startsWith(`${validationRoot}${sep}`)) {
    throw new Error(
      `Refusing to seed workspaces outside ${VALIDATION_ROOT}; got ${resolved}. ` +
      'Set --config-dir to the isolated validation config, never a real user config.',
    )
  }
}

function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`--slug must be lowercase URL-safe text, got ${slug}`)
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'config-dir': { type: 'string' },
      name: { type: 'string', default: DEFAULT_NAME },
      slug: { type: 'string', default: DEFAULT_SLUG },
      activate: { type: 'boolean', default: false },
    },
  })

  const configDir = resolve(values['config-dir'] ?? process.env.CRAFT_CONFIG_DIR ?? '')
  const name = values.name ?? DEFAULT_NAME
  const slug = values.slug ?? DEFAULT_SLUG

  assertInsideValidationRoot(configDir)
  assertSafeSlug(slug)

  const configPath = join(configDir, 'config.json')
  if (!existsSync(configPath)) {
    throw new Error(`Missing isolated config at ${configPath}. Launch the validation app once first.`)
  }

  mkdirSync(join(configDir, 'workspaces'), { recursive: true })
  process.env.CRAFT_CONFIG_DIR = configDir

  const config: ConfigModule = await import('@craft-agent/shared/config')
  const workspaceRoot = join(configDir, 'workspaces', slug)
  const workspace = config.addWorkspace({ rootPath: workspaceRoot, name })

  if (values.activate) {
    config.setActiveWorkspace(workspace.id)
  }

  const workspaces = config.getWorkspaces().map(ws => ({
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    rootPath: ws.rootPath,
  }))

  console.log(JSON.stringify({
    createdOrUpdated: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      rootPath: workspace.rootPath,
    },
    activeWorkspaceId: config.loadStoredConfig()?.activeWorkspaceId ?? null,
    workspaceCount: workspaces.length,
    workspaces,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
