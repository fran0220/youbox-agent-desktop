/**
 * Canvas persistence helpers — pure scheduling/versioning logic behind the
 * canvas autosave loop (CanvasPage wires these to window.electronAPI.canvas*).
 *
 * - DebouncedSaver: trailing-edge debounce with explicit flush/cancel, used to
 *   coalesce node/edge/viewport churn into one canvas:update per ~500ms.
 * - CanvasEchoGuard: version-based self-origin guard. canvas:changed events
 *   caused by our own update must not re-hydrate the atoms (that would stomp
 *   in-flight local edits); external writes carry a higher version and pass.
 * - CanvasDocSaver: dirty-tracking autosaver on top of DebouncedSaver. Dirty
 *   is defined by serialized-JSON diff against the last persisted baseline, so
 *   selection-only churn never schedules a save; failed saves keep the doc
 *   dirty and retry once after a short delay.
 * - reconcileCanvasRemoteChange: canvas:changed handling — push dirty local
 *   edits first (last-write-wins), then let the version guard decide whether
 *   the fetched remote doc is genuinely newer and should re-hydrate.
 */

import type { CanvasDocMeta } from '@craft-agent/shared/protocol'

export const CANVAS_AUTOSAVE_DELAY_MS = 500
export const CANVAS_SAVE_RETRY_DELAY_MS = 2000

export interface DebouncedSaverScheduler {
  set(fn: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const defaultScheduler: DebouncedSaverScheduler = {
  set: (fn, delayMs) => setTimeout(fn, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class DebouncedSaver {
  private handle: unknown = null

  constructor(
    private readonly delayMs: number,
    private readonly onSave: () => void,
    private readonly scheduler: DebouncedSaverScheduler = defaultScheduler,
  ) {}

  get isPending(): boolean {
    return this.handle !== null
  }

  /** (Re)start the debounce window; the save fires delayMs after the last call */
  schedule(): void {
    if (this.handle !== null) this.scheduler.clear(this.handle)
    this.handle = this.scheduler.set(() => {
      this.handle = null
      this.onSave()
    }, this.delayMs)
  }

  /** Run a pending save immediately (no-op when nothing is scheduled) */
  flush(): void {
    if (this.handle === null) return
    this.scheduler.clear(this.handle)
    this.handle = null
    this.onSave()
  }

  /** Drop a pending save without running it */
  cancel(): void {
    if (this.handle === null) return
    this.scheduler.clear(this.handle)
    this.handle = null
  }
}

export class CanvasEchoGuard {
  private lastKnownVersion: number

  constructor(initialVersion = 0) {
    this.lastKnownVersion = initialVersion
  }

  get version(): number {
    return this.lastKnownVersion
  }

  /** Record the version returned by our own canvas:update (monotonic) */
  noteLocalVersion(version: number): void {
    if (version > this.lastKnownVersion) this.lastKnownVersion = version
  }

  /** True when a fetched doc is genuinely newer than everything we produced/saw */
  shouldApplyRemote(remoteVersion: number): boolean {
    return remoteVersion > this.lastKnownVersion
  }

  /** Re-baseline after hydrating from a fetched doc */
  reset(version: number): void {
    this.lastKnownVersion = version
  }
}

export interface CanvasDocSaverOptions<TState> {
  delayMs: number
  retryDelayMs?: number
  /** Serialize the current local state into its wire shape */
  serialize: () => TState
  /** Persist the state; resolves with the new doc version */
  save: (state: TState) => Promise<number>
  onSaved: (version: number) => void
  onError?: (err: unknown) => void
  scheduler?: DebouncedSaverScheduler
}

/**
 * Dirty-tracking autosaver. "Dirty" means the serialized JSON differs from the
 * last successfully persisted (or currently in-flight) baseline, so changes
 * that do not affect the wire shape (e.g. node selection) never save. A failed
 * save leaves the baseline untouched (the doc stays dirty) and retries once.
 */
export class CanvasDocSaver<TState> {
  private readonly debounce: DebouncedSaver
  private readonly scheduler: DebouncedSaverScheduler
  private readonly retryDelayMs: number
  private lastSavedJson: string | null = null
  private inflightJson: string | null = null
  private inflight: Promise<void> | null = null
  private retryHandle: unknown = null
  private retriesRemaining = 1
  private disposed = false

  constructor(private readonly opts: CanvasDocSaverOptions<TState>) {
    this.scheduler = opts.scheduler ?? defaultScheduler
    this.retryDelayMs = opts.retryDelayMs ?? CANVAS_SAVE_RETRY_DELAY_MS
    this.debounce = new DebouncedSaver(opts.delayMs, () => this.doSave(), this.scheduler)
  }

  /** Re-baseline after hydrating from a fetched doc; enables saving */
  baseline(state: TState): void {
    this.debounce.cancel()
    this.cancelRetry()
    this.lastSavedJson = JSON.stringify(state)
    this.retriesRemaining = 1
  }

  private get baselineJson(): string | null {
    return this.inflightJson ?? this.lastSavedJson
  }

  /** True when the current serialized state differs from the saved baseline */
  get isDirty(): boolean {
    if (this.baselineJson === null) return false // not hydrated yet
    return JSON.stringify(this.opts.serialize()) !== this.baselineJson
  }

  get isPending(): boolean {
    return this.debounce.isPending
  }

  /** Debounced save; no-op for changes that do not alter the wire shape */
  schedule(): void {
    if (this.disposed || !this.isDirty) return
    this.cancelRetry()
    this.retriesRemaining = 1
    this.debounce.schedule()
  }

  /** Save now when dirty; returns true when a save was actually issued */
  flush(): boolean {
    this.debounce.cancel()
    this.cancelRetry()
    return this.doSave()
  }

  /** Resolves once no save is in flight (a retry timer may still be pending) */
  async settle(): Promise<void> {
    while (this.inflight) await this.inflight
  }

  /** Stop all future saves/retries (unmount); an in-flight save may still land */
  dispose(): void {
    this.disposed = true
    this.debounce.cancel()
    this.cancelRetry()
  }

  private doSave(): boolean {
    if (this.disposed || this.baselineJson === null) return false
    const state = this.opts.serialize()
    const json = JSON.stringify(state)
    if (json === this.baselineJson) return false
    this.inflightJson = json
    const attempt = this.opts
      .save(state)
      .then(
        (version) => {
          this.lastSavedJson = json
          this.retriesRemaining = 1
          this.opts.onSaved(version)
        },
        (err) => {
          this.opts.onError?.(err)
          if (!this.disposed && this.retriesRemaining > 0) {
            this.retriesRemaining -= 1
            this.scheduleRetry()
          }
        },
      )
      .finally(() => {
        if (this.inflight === attempt) this.inflight = null
        if (this.inflightJson === json) this.inflightJson = null
      })
    this.inflight = attempt
    return true
  }

  private scheduleRetry(): void {
    if (this.retryHandle !== null) return
    this.retryHandle = this.scheduler.set(() => {
      this.retryHandle = null
      this.doSave()
    }, this.retryDelayMs)
  }

  private cancelRetry(): void {
    if (this.retryHandle === null) return
    this.scheduler.clear(this.retryHandle)
    this.retryHandle = null
  }
}

/**
 * Handle an external canvas:changed event. Dirty local edits win
 * (last-write-wins): they are pushed first, and only then does the version
 * guard decide whether the fetched remote doc is newer than everything we
 * produced. Selection-only local churn is not dirty, so external edits are
 * never swallowed by a pending-but-empty save.
 */
export async function reconcileCanvasRemoteChange<TState, TDoc extends { version: number }>(opts: {
  saver: CanvasDocSaver<TState>
  guard: CanvasEchoGuard
  fetchDoc: () => Promise<TDoc | null>
  applyDoc: (doc: TDoc) => void
  isDisposed?: () => boolean
}): Promise<void> {
  const { saver, guard, fetchDoc, applyDoc, isDisposed } = opts
  saver.flush()
  await saver.settle()
  const doc = await fetchDoc()
  if (isDisposed?.() || !doc) return
  // Edits made while fetching (or left dirty by a failed flush) still win;
  // the saver/retry or a later changed event will reconcile them.
  if (saver.isDirty) return
  if (!guard.shouldApplyRemote(doc.version)) return
  applyDoc(doc)
}

/** Doc opened when entering canvas mode without an explicit doc id */
export function mostRecentCanvasDoc(docs: readonly CanvasDocMeta[]): CanvasDocMeta | null {
  let best: CanvasDocMeta | null = null
  for (const doc of docs) {
    if (!best || doc.updatedAt > best.updatedAt) best = doc
  }
  return best
}
