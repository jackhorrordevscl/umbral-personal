import { getPublicScheduleTracker } from './public-schedule-throttler.guard';

// sdd/patient-self-scheduling PR 3 (tasks.md 3.2, design.md Decision 7 "Rate
// limiting"): mismo criterio de testeo que getLoginTracker
// (auth.module.ts/rate-limit-login.e2e-spec.ts) -- la función pura que decide
// el tracker se prueba directo, sin necesidad de levantar el guard completo
// (que requiere options/storageService/reflector reales de @nestjs/throttler).
describe('getPublicScheduleTracker', () => {
  it('usa ip:therapistId cuando el body no trae email (GET availability)', () => {
    const tracker = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
    });
    expect(tracker).toBe('10.0.0.5:therapist-1');
  });

  // Triangulación: terapeuta distinto -> tracker distinto, no hardcodeado.
  it('un therapistId distinto produce un tracker distinto', () => {
    const tracker = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-2' },
    });
    expect(tracker).toBe('10.0.0.5:therapist-2');
  });

  it('usa ip:therapistId:sha256(email) cuando el body trae patient.email (POST book)', () => {
    const tracker = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'Paciente@Ejemplo.cl' } },
    });

    expect(tracker).toMatch(/^10\.0\.0\.5:therapist-1:[a-f0-9]{64}$/);
    // El email en texto plano jamás debe aparecer en el tracker (spec.md
    // "Throttling does not leak email in logs" -- el tracker es lo que
    // @nestjs/throttler usa como clave, y potencialmente lo que termina en
    // logs de storage/debug).
    expect(tracker).not.toContain('Paciente@Ejemplo.cl');
    expect(tracker).not.toContain('paciente@ejemplo.cl');
  });

  it('normaliza el email (case-insensitive) antes de hashear: mismo email, distinto casing, mismo tracker', () => {
    const lower = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'paciente@ejemplo.cl' } },
    });
    const upper = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'PACIENTE@EJEMPLO.CL' } },
    });
    expect(lower).toBe(upper);
  });

  it('un email distinto produce un hash distinto (no siempre el mismo tracker)', () => {
    const first = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'uno@ejemplo.cl' } },
    });
    const second = getPublicScheduleTracker({
      ip: '10.0.0.5',
      params: { therapistId: 'therapist-1' },
      body: { patient: { email: 'dos@ejemplo.cl' } },
    });
    expect(first).not.toBe(second);
  });

  it('sin therapistId en params, cae a "unknown" en vez de romper', () => {
    const tracker = getPublicScheduleTracker({ ip: '10.0.0.5', params: {} });
    expect(tracker).toBe('10.0.0.5:unknown');
  });
});
