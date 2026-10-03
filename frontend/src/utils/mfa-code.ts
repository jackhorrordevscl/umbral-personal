export function normalizeMfaCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}
