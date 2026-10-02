import { exec, type ExecException } from 'child_process';
import {
  MIGRATIONS_COMMAND,
  MIGRATIONS_TIMEOUT_MS,
  runMigrations,
} from './run-migrations';

jest.mock('child_process', () => ({ exec: jest.fn() }));

type ExecCallback = (
  error: ExecException | null,
  stdout: string,
  stderr: string,
) => void;

const execMock = exec as unknown as jest.Mock;

function mockExecResult(
  error: Partial<ExecException> | null,
  stdout = '',
  stderr = '',
): void {
  execMock.mockImplementation(
    (_cmd: string, _opts: unknown, callback: ExecCallback) => {
      callback(error as ExecException | null, stdout, stderr);
    },
  );
}

describe('runMigrations', () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it('resuelve con stdout y stderr cuando prisma migrate deploy termina bien', async () => {
    mockExecResult(null, 'migraciones aplicadas', '');

    await expect(runMigrations('/app/backend')).resolves.toEqual({
      stdout: 'migraciones aplicadas',
      stderr: '',
    });
  });

  it('ejecuta el comando en el directorio indicado con el timeout por defecto', async () => {
    mockExecResult(null);

    await runMigrations('/app/backend');

    expect(execMock).toHaveBeenCalledWith(
      MIGRATIONS_COMMAND,
      { cwd: '/app/backend', timeout: MIGRATIONS_TIMEOUT_MS },
      expect.any(Function),
    );
  });

  it('rechaza con el mensaje de error y el stderr cuando el comando falla', async () => {
    mockExecResult({ message: 'exit 1' }, '', 'P3009 migración fallida');

    await expect(runMigrations('/app/backend')).rejects.toThrow(
      /exit 1[\s\S]*P3009 migración fallida/,
    );
  });

  it('rechaza indicando el timeout cuando el proceso fue terminado por exceder el límite', async () => {
    mockExecResult({ message: 'Command failed', killed: true });

    await expect(runMigrations('/app/backend', 5000)).rejects.toThrow(
      /superó el timeout de 5000 ms/,
    );
    expect(execMock).toHaveBeenCalledWith(
      MIGRATIONS_COMMAND,
      { cwd: '/app/backend', timeout: 5000 },
      expect.any(Function),
    );
  });
});
