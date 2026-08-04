import { describe, it, expect } from 'vitest'
import { formatRut, normalizeRut, validateRut } from './rut'

describe('formatRut', () => {
  it('agrega puntos de miles y guión antes del dígito verificador', () => {
    expect(formatRut('123456789')).toBe('12.345.678-9')
  })

  it('descarta caracteres que no son dígitos ni K', () => {
    expect(formatRut('12.345.678-9')).toBe('12.345.678-9')
  })

  it('con menos de 2 caracteres devuelve el valor limpio sin formatear', () => {
    expect(formatRut('1')).toBe('1')
  })
})

describe('normalizeRut', () => {
  it('saca puntos y pasa a mayúsculas', () => {
    expect(normalizeRut('12.345.678-9k')).toBe('12345678-9K')
  })
})

describe('validateRut', () => {
  it('acepta un RUT válido con dígito verificador numérico', () => {
    expect(validateRut('12.345.678-5')).toBe(true)
  })

  it('acepta un RUT válido con dígito verificador K', () => {
    expect(validateRut('1.000.005-K')).toBe(true)
  })

  it('rechaza un RUT con dígito verificador incorrecto', () => {
    expect(validateRut('12.345.678-9')).toBe(false)
  })

  it('rechaza un cuerpo no numérico', () => {
    expect(validateRut('ABC-5')).toBe(false)
  })
})
