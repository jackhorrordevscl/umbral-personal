import { exec, type ExecException } from 'child_process';

export const MIGRATIONS_COMMAND = 'npx prisma migrate deploy';
export const MIGRATIONS_TIMEOUT_MS = 120_000;

export interface MigrationsResult {
  stdout: string;
  stderr: string;
}

// Corre `prisma migrate deploy` y espera a que termine. Rechaza si el comando
// falla o si supera el timeout (exec mata el proceso y reporta killed=true).
// main.ts la invoca ANTES de app.listen: nunca se debe servir tráfico con un
// esquema desactualizado.
export function runMigrations(
  cwd: string,
  timeoutMs: number = MIGRATIONS_TIMEOUT_MS,
): Promise<MigrationsResult> {
  return new Promise((resolve, reject) => {
    exec(
      MIGRATIONS_COMMAND,
      { cwd, timeout: timeoutMs },
      (error: ExecException | null, stdout: string, stderr: string) => {
        if (error) {
          const reason = error.killed
            ? `superó el timeout de ${timeoutMs} ms`
            : error.message;
          reject(
            new Error(
              `Falló "${MIGRATIONS_COMMAND}": ${reason}${stderr ? `\n${stderr}` : ''}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
