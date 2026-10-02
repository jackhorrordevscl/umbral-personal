import { describe, it, expect } from 'vitest'
import { getPostLoginPath, toFromPath } from './redirect'

describe('toFromPath', () => {
  it('conserva path, query y hash', () => {
    expect(
      toFromPath({ pathname: '/patients/p1', search: '?tab=notes', hash: '#n2' }),
    ).toBe('/patients/p1?tab=notes#n2')
  })

  it('tolera search y hash ausentes', () => {
    expect(toFromPath({ pathname: '/calendar' })).toBe('/calendar')
  })
})

describe('getPostLoginPath', () => {
  it('usa state.from si es una ruta interna', () => {
    expect(getPostLoginPath({ from: '/patients/p1?tab=notes' })).toBe(
      '/patients/p1?tab=notes',
    )
  })

  it.each([
    ['sin state', null],
    ['state sin from', {}],
    ['from no string', { from: 42 }],
    ['from relativo', { from: 'patients' }],
    ['from absoluto externo', { from: 'https://evil.example/' }],
    ['from protocol-relative', { from: '//evil.example/' }],
    ['from con barra invertida', { from: '/\\evil.example' }],
    ['from /login', { from: '/login' }],
    ['from /login con query', { from: '/login?x=1' }],
  ])('cae a /dashboard: %s', (_label, state) => {
    expect(getPostLoginPath(state)).toBe('/dashboard')
  })
})
