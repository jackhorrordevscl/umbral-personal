// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSnapshot(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}
