import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIdleTimeout } from './useIdleTimeout'

const IDLE_TIMEOUT = 8 * 60 * 1000

// Bus en memoria: cada instancia recibe lo que publican las demás del mismo
// canal, como las pestañas reales (una instancia no recibe sus propios mensajes).
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  closed = false
  name: string
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
  postMessage(data: unknown) {
    FakeBroadcastChannel.instances
      .filter((c) => c !== this && c.name === this.name && !c.closed)
      .forEach((c) => c.onmessage?.({ data }))
  }
  close() {
    this.closed = true
  }
}

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('avisa al vencer la inactividad', () => {
    const onWarn = vi.fn()
    renderHook(() => useIdleTimeout({ onWarn }))

    vi.advanceTimersByTime(IDLE_TIMEOUT)

    expect(onWarn).toHaveBeenCalledTimes(1)
  })

  it.each(['wheel', 'scroll'])(
    'reinicia el temporizador con %s, también el de un contenedor interno (fase de captura)',
    (type) => {
      const onWarn = vi.fn()
      renderHook(() => useIdleTimeout({ onWarn }))
      const inner = document.createElement('main')
      document.body.appendChild(inner)

      vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)
      // scroll no burbujea: solo llega a window si se escucha en captura.
      inner.dispatchEvent(new Event(type, { bubbles: false }))
      vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)

      expect(onWarn).not.toHaveBeenCalled()
      inner.remove()
    },
  )

  it('la actividad de otra pestaña reinicia el temporizador y se notifica', () => {
    const onWarn = vi.fn()
    const onRemoteActivity = vi.fn()
    renderHook(() => useIdleTimeout({ onWarn, onRemoteActivity }))
    const other = new FakeBroadcastChannel('umbral-activity')

    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)
    act(() => other.postMessage(Date.now()))
    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)

    expect(onWarn).not.toHaveBeenCalled()
    expect(onRemoteActivity).toHaveBeenCalledTimes(1)
  })

  it('publica la actividad local a las demás pestañas, con throttle', () => {
    renderHook(() => useIdleTimeout({ onWarn: vi.fn() }))
    const other = new FakeBroadcastChannel('umbral-activity')
    const received = vi.fn()
    other.onmessage = received

    window.dispatchEvent(new Event('mousemove'))
    window.dispatchEvent(new Event('mousemove'))
    expect(received).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    window.dispatchEvent(new Event('mousemove'))
    expect(received).toHaveBeenCalledTimes(2)
  })

  it('sin BroadcastChannel usa el evento storage', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const onWarn = vi.fn()
    const onRemoteActivity = vi.fn()
    renderHook(() => useIdleTimeout({ onWarn, onRemoteActivity }))

    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'umbral:last-activity' }),
      )
    })
    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)

    expect(onWarn).not.toHaveBeenCalled()
    expect(onRemoteActivity).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('click'))
    expect(localStorage.getItem('umbral:last-activity')).not.toBeNull()
    localStorage.clear()
  })

  it('cierra el canal y deja de escuchar al desmontar', () => {
    const onWarn = vi.fn()
    const { unmount } = renderHook(() => useIdleTimeout({ onWarn }))

    unmount()
    vi.advanceTimersByTime(IDLE_TIMEOUT)

    expect(FakeBroadcastChannel.instances[0].closed).toBe(true)
    expect(onWarn).not.toHaveBeenCalled()
  })
})
