import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  ACTIVITY_CHANNEL,
  ACTIVITY_STORAGE_KEY,
  IDLE_TIMEOUT,
  IDLE_WARNING_SECONDS,
  useIdleTimeout,
} from './useIdleTimeout'

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
    const other = new FakeBroadcastChannel(ACTIVITY_CHANNEL)

    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)
    act(() => other.postMessage(Date.now()))
    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)

    expect(onWarn).not.toHaveBeenCalled()
    expect(onRemoteActivity).toHaveBeenCalledTimes(1)
  })

  it('publica la actividad local a las demás pestañas, con throttle', () => {
    renderHook(() => useIdleTimeout({ onWarn: vi.fn() }))
    const other = new FakeBroadcastChannel(ACTIVITY_CHANNEL)
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
        new StorageEvent('storage', { key: ACTIVITY_STORAGE_KEY }),
      )
    })
    vi.advanceTimersByTime(IDLE_TIMEOUT - 1000)

    expect(onWarn).not.toHaveBeenCalled()
    expect(onRemoteActivity).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('click'))
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).not.toBeNull()
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

  describe('inactividad con temporizadores congelados (issue #367)', () => {
    const MIN = 60 * 1000
    const NOW = new Date('2026-10-08T12:00:00Z').getTime()

    const setVisibility = (state: DocumentVisibilityState) =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)

    // Simula el regreso a la app: el reloj avanza sin que corran los timers.
    const returnAfter = (
      ms: number,
      event: 'visibilitychange' | 'pageshow',
    ) => {
      vi.setSystemTime(NOW + ms)
      act(() => {
        if (event === 'visibilitychange') {
          document.dispatchEvent(new Event('visibilitychange'))
        } else {
          window.dispatchEvent(new Event('pageshow'))
        }
      })
    }

    beforeEach(() => {
      vi.setSystemTime(NOW)
      localStorage.clear()
      localStorage.setItem(ACTIVITY_STORAGE_KEY, String(NOW))
      setVisibility('visible')
    })

    afterEach(() => {
      vi.restoreAllMocks()
      localStorage.clear()
    })

    it.each(['visibilitychange', 'pageshow'] as const)(
      'avisa al volver tras 9 min (%s)',
      (event) => {
        const onWarn = vi.fn()
        const onExpire = vi.fn()
        renderHook(() => useIdleTimeout({ onWarn, onExpire }))

        returnAfter(9 * MIN, event)

        expect(onWarn).toHaveBeenCalled()
        expect(onExpire).not.toHaveBeenCalled()
      },
    )

    it.each(['visibilitychange', 'pageshow'] as const)(
      'expira directo al volver tras 11 min (%s)',
      (event) => {
        const onWarn = vi.fn()
        const onExpire = vi.fn()
        renderHook(() => useIdleTimeout({ onWarn, onExpire }))

        returnAfter(IDLE_TIMEOUT + IDLE_WARNING_SECONDS * 1000 + 1000, event)

        expect(onExpire).toHaveBeenCalledTimes(1)
        expect(onWarn).not.toHaveBeenCalled()
      },
    )

    it('no hace nada al volver tras 3 min', () => {
      const onWarn = vi.fn()
      const onExpire = vi.fn()
      renderHook(() => useIdleTimeout({ onWarn, onExpire }))

      returnAfter(3 * MIN, 'visibilitychange')

      expect(onWarn).not.toHaveBeenCalled()
      expect(onExpire).not.toHaveBeenCalled()
    })

    it('ignora visibilitychange cuando la pestaña pasa a oculta', () => {
      const onWarn = vi.fn()
      renderHook(() => useIdleTimeout({ onWarn, onExpire: vi.fn() }))
      setVisibility('hidden')

      returnAfter(9 * MIN, 'visibilitychange')

      expect(onWarn).not.toHaveBeenCalled()
    })

    it('una marca más reciente de otra pestaña evita el aviso', () => {
      const onWarn = vi.fn()
      const onExpire = vi.fn()
      renderHook(() => useIdleTimeout({ onWarn, onExpire }))
      localStorage.setItem(ACTIVITY_STORAGE_KEY, String(NOW + 8 * MIN))

      returnAfter(9 * MIN, 'visibilitychange')

      expect(onWarn).not.toHaveBeenCalled()
      expect(onExpire).not.toHaveBeenCalled()
    })

    it('al montar con una marca vieja expira; con una intermedia avisa', () => {
      vi.setSystemTime(NOW + 30 * MIN)
      const onExpire = vi.fn()
      renderHook(() => useIdleTimeout({ onWarn: vi.fn(), onExpire }))
      expect(onExpire).toHaveBeenCalledTimes(1)

      localStorage.setItem(
        ACTIVITY_STORAGE_KEY,
        String(NOW + 30 * MIN - 9 * MIN),
      )
      const onWarn = vi.fn()
      renderHook(() => useIdleTimeout({ onWarn, onExpire: vi.fn() }))
      expect(onWarn).toHaveBeenCalledTimes(1)
    })

    it.each([null, 'abc', ''])(
      'una marca ausente o inválida (%s) no expira y se reescribe',
      (value) => {
        localStorage.removeItem(ACTIVITY_STORAGE_KEY)
        if (value !== null) localStorage.setItem(ACTIVITY_STORAGE_KEY, value)
        const onWarn = vi.fn()
        const onExpire = vi.fn()
        renderHook(() => useIdleTimeout({ onWarn, onExpire }))

        returnAfter(0, 'pageshow')

        expect(onWarn).not.toHaveBeenCalled()
        expect(onExpire).not.toHaveBeenCalled()
        expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe(String(NOW))
      },
    )

    it('la actividad local persiste la marca, con throttle', () => {
      renderHook(() => useIdleTimeout({ onWarn: vi.fn(), onExpire: vi.fn() }))
      localStorage.removeItem(ACTIVITY_STORAGE_KEY)

      vi.setSystemTime(NOW + 5000)
      window.dispatchEvent(new Event('mousemove'))
      expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe(String(NOW + 5000))

      vi.setSystemTime(NOW + 5100)
      window.dispatchEvent(new Event('mousemove'))
      expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe(String(NOW + 5000))
    })

    it('extend refresca la marca guardada', () => {
      const { result } = renderHook(() =>
        useIdleTimeout({ onWarn: vi.fn(), onExpire: vi.fn() }),
      )
      vi.setSystemTime(NOW + 9 * MIN)

      act(() => result.current.extend())

      expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe(String(NOW + 9 * MIN))
    })

    it('si localStorage lanza, no falla y mantiene el temporizador', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      const onWarn = vi.fn()
      const onExpire = vi.fn()

      expect(() => {
        renderHook(() => useIdleTimeout({ onWarn, onExpire }))
        window.dispatchEvent(new Event('click'))
        returnAfter(20 * MIN, 'visibilitychange')
      }).not.toThrow()
      expect(onExpire).not.toHaveBeenCalled()

      vi.advanceTimersByTime(IDLE_TIMEOUT)
      expect(onWarn).toHaveBeenCalled()
    })
  })
})
