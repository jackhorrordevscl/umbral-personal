import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Node 22+ ships its own experimental `localStorage` global (requires
// --localstorage-file, otherwise it's just `undefined`). vitest's jsdom
// environment only overrides an already-existing global if its name is on
// a hardcoded allowlist, and `localStorage` isn't on it, so Node's broken
// global wins over jsdom's real implementation. Pull the working one
// straight from the jsdom instance vitest exposes as `globalThis.jsdom`.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window
if (jsdomWindow?.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomWindow.localStorage,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// Issue #159: jsdom no implementa el layout real (getClientRects,
// elementFromPoint) que ProseMirror (usado por Tiptap/RichTextEditor)
// consulta al despachar transacciones (ej. al hacer scroll a la selección
// tras escribir). Sin estos stubs, cada tecla escrita en el editor lanza una
// excepción no capturada que aborta la transacción antes de emitir
// "update" -- el texto queda insertado en el DOM pero onChange nunca se
// llama. No afecta ningún otro test: solo agrega los métodos si faltan.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return this } }) as DOMRect
}
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}
