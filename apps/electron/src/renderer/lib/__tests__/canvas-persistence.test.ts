import { describe, expect, it } from 'bun:test'
import type { CanvasDocMeta } from '@craft-agent/shared/protocol'
import {
  CANVAS_SAVE_RETRY_DELAY_MS,
  CanvasDocSaver,
  CanvasEchoGuard,
  DebouncedSaver,
  mostRecentCanvasDoc,
  reconcileCanvasRemoteChange,
  type DebouncedSaverScheduler,
} from '../canvas-persistence'

/** Deterministic scheduler: timers fire only when advance() reaches them */
function manualScheduler() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()

  const scheduler: DebouncedSaverScheduler = {
    set: (fn, delayMs) => {
      const id = nextId++
      timers.set(id, { at: now + delayMs, fn })
      return id
    },
    clear: (handle) => {
      timers.delete(handle as number)
    },
  }

  const advance = (ms: number) => {
    now += ms
    const due = [...timers.entries()]
      .filter(([, t]) => t.at <= now)
      .sort((a, b) => a[1].at - b[1].at)
    for (const [id, t] of due) {
      timers.delete(id)
      t.fn()
    }
  }

  return { scheduler, advance, pendingCount: () => timers.size }
}

describe('DebouncedSaver', () => {
  it('fires once, delayMs after the last schedule() call', () => {
    const { scheduler, advance } = manualScheduler()
    let saves = 0
    const saver = new DebouncedSaver(500, () => saves++, scheduler)

    saver.schedule()
    advance(300)
    expect(saves).toBe(0)

    saver.schedule() // restarts the window
    advance(300)
    expect(saves).toBe(0)

    advance(200)
    expect(saves).toBe(1)
    expect(saver.isPending).toBe(false)

    advance(1000)
    expect(saves).toBe(1)
  })

  it('flush() runs a pending save immediately and clears the timer', () => {
    const { scheduler, advance, pendingCount } = manualScheduler()
    let saves = 0
    const saver = new DebouncedSaver(500, () => saves++, scheduler)

    saver.schedule()
    expect(saver.isPending).toBe(true)
    saver.flush()
    expect(saves).toBe(1)
    expect(saver.isPending).toBe(false)
    expect(pendingCount()).toBe(0)

    advance(1000)
    expect(saves).toBe(1)
  })

  it('flush() is a no-op when nothing is scheduled', () => {
    const { scheduler } = manualScheduler()
    let saves = 0
    const saver = new DebouncedSaver(500, () => saves++, scheduler)

    saver.flush()
    expect(saves).toBe(0)
  })

  it('cancel() drops a pending save without running it', () => {
    const { scheduler, advance } = manualScheduler()
    let saves = 0
    const saver = new DebouncedSaver(500, () => saves++, scheduler)

    saver.schedule()
    saver.cancel()
    expect(saver.isPending).toBe(false)
    advance(1000)
    expect(saves).toBe(0)
  })

  it('can schedule again after a flush', () => {
    const { scheduler, advance } = manualScheduler()
    let saves = 0
    const saver = new DebouncedSaver(500, () => saves++, scheduler)

    saver.schedule()
    saver.flush()
    saver.schedule()
    advance(500)
    expect(saves).toBe(2)
  })
})

describe('CanvasEchoGuard', () => {
  it('skips the echo of our own update but applies newer external versions', () => {
    const guard = new CanvasEchoGuard()
    guard.reset(3) // hydrated at version 3

    // Our save returned version 4 → the resulting changed event is an echo
    guard.noteLocalVersion(4)
    expect(guard.shouldApplyRemote(4)).toBe(false)
    expect(guard.shouldApplyRemote(3)).toBe(false)

    // Another window wrote version 5 → reconcile
    expect(guard.shouldApplyRemote(5)).toBe(true)
  })

  it('noteLocalVersion is monotonic (stale responses cannot lower the floor)', () => {
    const guard = new CanvasEchoGuard(0)
    guard.noteLocalVersion(7)
    guard.noteLocalVersion(5) // out-of-order response
    expect(guard.version).toBe(7)
    expect(guard.shouldApplyRemote(6)).toBe(false)
    expect(guard.shouldApplyRemote(8)).toBe(true)
  })

  it('reset re-baselines after hydrating a fetched doc', () => {
    const guard = new CanvasEchoGuard(10)
    guard.reset(2)
    expect(guard.version).toBe(2)
    expect(guard.shouldApplyRemote(3)).toBe(true)
  })
})

type TestState = { nodes: string[] }

function makeSaver(opts: {
  scheduler: DebouncedSaverScheduler
  serialize: () => TestState
  save: (state: TestState) => Promise<number>
  onSaved?: (version: number) => void
  onError?: (err: unknown) => void
}) {
  return new CanvasDocSaver<TestState>({
    delayMs: 500,
    serialize: opts.serialize,
    save: opts.save,
    onSaved: opts.onSaved ?? (() => {}),
    onError: opts.onError,
    scheduler: opts.scheduler,
  })
}

describe('CanvasDocSaver', () => {
  it('selection-only changes (identical serialization) never schedule a save', () => {
    const { scheduler, pendingCount } = manualScheduler()
    let attempts = 0
    const state: TestState = { nodes: ['a'] }
    const saver = makeSaver({
      scheduler,
      serialize: () => state,
      save: () => {
        attempts++
        return Promise.resolve(1)
      },
    })
    saver.baseline(state)

    // Atom sub fires for a selection toggle, but the wire shape is unchanged
    saver.schedule()
    expect(saver.isDirty).toBe(false)
    expect(saver.isPending).toBe(false)
    expect(pendingCount()).toBe(0)

    expect(saver.flush()).toBe(false)
    expect(attempts).toBe(0)
  })

  it('saves a genuinely dirty state on flush and re-baselines on success', async () => {
    const { scheduler } = manualScheduler()
    const saved: TestState[] = []
    const versions: number[] = []
    const saver = makeSaver({
      scheduler,
      serialize: () => ({ nodes: ['a', 'b'] }),
      save: (state) => {
        saved.push(state)
        return Promise.resolve(2)
      },
      onSaved: (v) => versions.push(v),
    })
    saver.baseline({ nodes: ['a'] })

    expect(saver.isDirty).toBe(true)
    expect(saver.flush()).toBe(true)
    await saver.settle()
    expect(saved).toEqual([{ nodes: ['a', 'b'] }])
    expect(versions).toEqual([2])
    expect(saver.isDirty).toBe(false)

    // Nothing new to save afterwards
    expect(saver.flush()).toBe(false)
    expect(saved.length).toBe(1)
  })

  it('debounces scheduled dirty changes into one save', async () => {
    const { scheduler, advance } = manualScheduler()
    let attempts = 0
    const saver = makeSaver({
      scheduler,
      serialize: () => ({ nodes: ['a', 'b'] }),
      save: () => {
        attempts++
        return Promise.resolve(2)
      },
    })
    saver.baseline({ nodes: ['a'] })

    saver.schedule()
    saver.schedule()
    expect(saver.isPending).toBe(true)
    advance(500)
    await saver.settle()
    expect(attempts).toBe(1)
  })

  it('a failed save keeps the doc dirty and retries once after a delay', async () => {
    const { scheduler, advance } = manualScheduler()
    let attempts = 0
    const errors: unknown[] = []
    const versions: number[] = []
    const saver = makeSaver({
      scheduler,
      serialize: () => ({ nodes: ['a', 'b'] }),
      save: () => {
        attempts++
        return attempts === 1 ? Promise.reject(new Error('io')) : Promise.resolve(2)
      },
      onSaved: (v) => versions.push(v),
      onError: (err) => errors.push(err),
    })
    saver.baseline({ nodes: ['a'] })

    expect(saver.flush()).toBe(true)
    await saver.settle()
    expect(attempts).toBe(1)
    expect(errors.length).toBe(1)
    // Baseline must not advance on failure — the edits are still dirty
    expect(saver.isDirty).toBe(true)

    advance(CANVAS_SAVE_RETRY_DELAY_MS)
    await saver.settle()
    expect(attempts).toBe(2)
    expect(versions).toEqual([2])
    expect(saver.isDirty).toBe(false)
  })

  it('retries are bounded when saves keep failing', async () => {
    const { scheduler, advance, pendingCount } = manualScheduler()
    let attempts = 0
    const saver = makeSaver({
      scheduler,
      serialize: () => ({ nodes: ['a', 'b'] }),
      save: () => {
        attempts++
        return Promise.reject(new Error('io'))
      },
      onError: () => {},
    })
    saver.baseline({ nodes: ['a'] })

    saver.flush()
    await saver.settle()
    expect(attempts).toBe(1)

    advance(CANVAS_SAVE_RETRY_DELAY_MS)
    await saver.settle()
    expect(attempts).toBe(2)

    // The single retry also failed: no further timers, no infinite loop
    advance(CANVAS_SAVE_RETRY_DELAY_MS * 5)
    await saver.settle()
    expect(attempts).toBe(2)
    expect(pendingCount()).toBe(0)
    expect(saver.isDirty).toBe(true)
  })

  it('dispose() stops retries after unmount while the final flush still runs', async () => {
    const { scheduler, advance, pendingCount } = manualScheduler()
    let attempts = 0
    const saver = makeSaver({
      scheduler,
      serialize: () => ({ nodes: ['a', 'b'] }),
      save: () => {
        attempts++
        return Promise.reject(new Error('io'))
      },
      onError: () => {},
    })
    saver.baseline({ nodes: ['a'] })

    expect(saver.flush()).toBe(true)
    saver.dispose()
    await saver.settle()
    expect(attempts).toBe(1)
    expect(pendingCount()).toBe(0)

    advance(CANVAS_SAVE_RETRY_DELAY_MS * 2)
    expect(attempts).toBe(1)
    // In-memory state stays consistent: the edits are still marked dirty
    expect(saver.isDirty).toBe(true)
  })

  it('does nothing before the first baseline (pre-hydration blur flush)', () => {
    const { scheduler, pendingCount } = manualScheduler()
    let attempts = 0
    const saver = makeSaver({
      scheduler,
      serialize: () => ({ nodes: ['stale'] }),
      save: () => {
        attempts++
        return Promise.resolve(1)
      },
    })

    saver.schedule()
    expect(saver.flush()).toBe(false)
    expect(attempts).toBe(0)
    expect(pendingCount()).toBe(0)
  })
})

describe('reconcileCanvasRemoteChange', () => {
  function setup(opts: {
    serialize: () => TestState
    baseline: TestState
    saveVersion?: number
    remoteVersion: number
    initialVersion?: number
  }) {
    const { scheduler } = manualScheduler()
    const guard = new CanvasEchoGuard()
    guard.reset(opts.initialVersion ?? 1)
    const saved: TestState[] = []
    const saver = makeSaver({
      scheduler,
      serialize: opts.serialize,
      save: (state) => {
        saved.push(state)
        return Promise.resolve(opts.saveVersion ?? 2)
      },
      onSaved: (v) => guard.noteLocalVersion(v),
    })
    saver.baseline(opts.baseline)
    const applied: number[] = []
    const remoteDoc = { version: opts.remoteVersion }
    return { guard, saver, saved, applied, remoteDoc }
  }

  it('fetches and applies the remote doc when only selection changed locally', async () => {
    // Selection-only churn: serialization matches the baseline, so the flush
    // must not swallow the external change (the old pending-saver early return)
    const { guard, saver, saved, applied, remoteDoc } = setup({
      serialize: () => ({ nodes: ['a'] }),
      baseline: { nodes: ['a'] },
      remoteVersion: 2,
    })
    saver.schedule()

    await reconcileCanvasRemoteChange({
      saver,
      guard,
      fetchDoc: () => Promise.resolve(remoteDoc),
      applyDoc: (doc) => applied.push(doc.version),
    })

    expect(saved.length).toBe(0)
    expect(applied).toEqual([2])
  })

  it('pushes dirty local edits first and skips the echo of that save', async () => {
    const { guard, saver, saved, applied, remoteDoc } = setup({
      serialize: () => ({ nodes: ['a', 'b'] }),
      baseline: { nodes: ['a'] },
      saveVersion: 2,
      remoteVersion: 2, // the changed event was caused by our own pending edits
    })
    saver.schedule()

    await reconcileCanvasRemoteChange({
      saver,
      guard,
      fetchDoc: () => Promise.resolve(remoteDoc),
      applyDoc: (doc) => applied.push(doc.version),
    })

    expect(saved).toEqual([{ nodes: ['a', 'b'] }])
    expect(applied).toEqual([])
  })

  it('applies a remote doc newer than a just-flushed dirty save (version guard decides)', async () => {
    const { guard, saver, saved, applied, remoteDoc } = setup({
      serialize: () => ({ nodes: ['a', 'b'] }),
      baseline: { nodes: ['a'] },
      saveVersion: 2,
      remoteVersion: 3, // external write landed after our save
    })
    saver.schedule()

    await reconcileCanvasRemoteChange({
      saver,
      guard,
      fetchDoc: () => Promise.resolve(remoteDoc),
      applyDoc: (doc) => applied.push(doc.version),
    })

    expect(saved).toEqual([{ nodes: ['a', 'b'] }])
    expect(applied).toEqual([3])
  })

  it('skips stale remote versions and null docs, and respects isDisposed', async () => {
    const stale = setup({
      serialize: () => ({ nodes: ['a'] }),
      baseline: { nodes: ['a'] },
      remoteVersion: 1, // not newer than what we hydrated
    })
    await reconcileCanvasRemoteChange({
      saver: stale.saver,
      guard: stale.guard,
      fetchDoc: () => Promise.resolve(stale.remoteDoc),
      applyDoc: (doc) => stale.applied.push(doc.version),
    })
    expect(stale.applied).toEqual([])

    const disposed = setup({
      serialize: () => ({ nodes: ['a'] }),
      baseline: { nodes: ['a'] },
      remoteVersion: 5,
    })
    await reconcileCanvasRemoteChange({
      saver: disposed.saver,
      guard: disposed.guard,
      fetchDoc: () => Promise.resolve(disposed.remoteDoc),
      applyDoc: (doc) => disposed.applied.push(doc.version),
      isDisposed: () => true,
    })
    expect(disposed.applied).toEqual([])

    const missing = setup({
      serialize: () => ({ nodes: ['a'] }),
      baseline: { nodes: ['a'] },
      remoteVersion: 5,
    })
    await reconcileCanvasRemoteChange({
      saver: missing.saver,
      guard: missing.guard,
      fetchDoc: () => Promise.resolve(null),
      applyDoc: (doc: { version: number }) => missing.applied.push(doc.version),
    })
    expect(missing.applied).toEqual([])
  })
})

describe('mostRecentCanvasDoc', () => {
  const meta = (id: string, updatedAt: number): CanvasDocMeta => ({
    id,
    name: id,
    createdAt: 0,
    updatedAt,
    version: 1,
  })

  it('returns null for an empty list', () => {
    expect(mostRecentCanvasDoc([])).toBeNull()
  })

  it('picks the doc with the highest updatedAt regardless of order', () => {
    const docs = [meta('a', 100), meta('c', 300), meta('b', 200)]
    expect(mostRecentCanvasDoc(docs)?.id).toBe('c')
  })
})
