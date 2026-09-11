import { describe, it, expect } from 'vitest'
import {
  addDaysToDateKey,
  isValidTimeString,
  minutesToTime,
  timeToMinutes,
} from './availability'

// sdd/patient-self-scheduling PR 4 (tasks.md 4.1/4.2): funciones puras usadas
// por WeeklyScheduleEditor y BlockoutEditor -- conversión "HH:MM" <-> minutos
// (mismo shape que TherapistAvailability.startMinute/endMinute del backend)
// y aritmética de fecha calendario para bloqueos de día completo/rango.
describe('availability utils', () => {
  it('timeToMinutes convierte HH:MM a minutos desde medianoche', () => {
    expect(timeToMinutes('09:00')).toBe(540)
    expect(timeToMinutes('00:30')).toBe(30)
  })

  it('minutesToTime convierte minutos a HH:MM con padding', () => {
    expect(minutesToTime(540)).toBe('09:00')
    expect(minutesToTime(5)).toBe('00:05')
  })

  it('addDaysToDateKey avanza días respetando el rollover de mes', () => {
    expect(addDaysToDateKey('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysToDateKey('2026-06-01', 1)).toBe('2026-06-02')
  })

  it('isValidTimeString valida el formato HH:MM 24h', () => {
    expect(isValidTimeString('23:59')).toBe(true)
    expect(isValidTimeString('24:00')).toBe(false)
    expect(isValidTimeString('9:00')).toBe(false)
  })
})
