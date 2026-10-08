import { encryptAesGcm } from './aes-gcm';
import {
  buildKeyring,
  decryptTextWithKeyring,
  decryptWithKeyring,
  encryptTextWithKeyring,
  encryptWithKeyring,
  Keyring,
} from './keyring';
import {
  binaryCodec,
  computeExitCode,
  DatasetPort,
  formatReport,
  parseArgs,
  Row,
  runReencrypt,
  Stored,
  textCodec,
  ValueCodec,
} from './reencrypt';

const key0 = Buffer.alloc(32, 3);
const key1 = Buffer.alloc(32, 5);
const raw0 = key0.toString('base64');
const raw1 = key1.toString('base64');

const ringId0 = () => buildKeyring(raw0, undefined, undefined, 'TEST_KEY');
const ringActive1 = () => buildKeyring(raw0, `1:${raw1}`, '1', 'TEST_KEY');

const legacyBinary = (text: string, key = key0) =>
  encryptAesGcm(Buffer.from(text), key);
const legacyText = (text: string) =>
  `enc:v1:${encryptAesGcm(Buffer.from(text), key0).toString('base64')}`;

// Puerto en memoria: guarda los valores por id y registra las escrituras.
class FakePort implements DatasetPort {
  readonly values = new Map<string, Stored | null>();
  readonly writes: string[] = [];
  readConflict = new Set<string>();
  writeErrors = new Set<string>();
  readErrors = new Map<string, Error>();
  missing = new Set<string>();

  constructor(
    readonly dataset: DatasetPort['dataset'],
    readonly codec: ValueCodec,
    initial: Record<string, Stored | null>,
    readonly concurrency = 1,
  ) {
    for (const [id, value] of Object.entries(initial)) {
      this.values.set(id, value);
    }
  }

  async *list(): AsyncIterable<Row> {
    for (const id of [...this.values.keys()]) {
      await Promise.resolve();
      yield { id, key: `key/${id}` };
    }
  }

  read(row: Row): Promise<Stored | null> {
    const error = this.readErrors.get(row.id);
    if (error) return Promise.reject(error);
    if (this.missing.has(row.id)) {
      return Promise.reject(
        Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
      );
    }
    return Promise.resolve(this.values.get(row.id) ?? null);
  }

  writeIfUnchanged(row: Row, previous: Stored, next: Stored): Promise<boolean> {
    this.writes.push(row.id);
    if (this.writeErrors.has(row.id)) return Promise.reject(new Error('boom'));
    if (this.readConflict.has(row.id)) return Promise.resolve(false);
    if (this.values.get(row.id) !== previous) return Promise.resolve(false);
    this.values.set(row.id, next);
    return Promise.resolve(true);
  }

  isMissingError(err: unknown): boolean {
    return (err as { name?: string }).name === 'NoSuchKey';
  }
}

const binaryPort = (
  ring: Keyring,
  initial: Record<string, Stored | null>,
  dataset: DatasetPort['dataset'] = 'google',
) => new FakePort(dataset, binaryCodec(ring), initial);

const textPort = (ring: Keyring, initial: Record<string, Stored | null>) =>
  new FakePort('mfa', textCodec(ring), initial);

describe('runReencrypt', () => {
  it('reescribe un payload legacy al formato versionado con la clave activa', async () => {
    const ring = ringActive1();
    const port = binaryPort(ring, { a: legacyBinary('secreto') });

    const report = await runReencrypt([port], { apply: true });

    const stored = port.values.get('a') as Buffer;
    expect(decryptWithKeyring(stored, ring).toString()).toBe('secreto');
    expect(stored.subarray(0, 4)).toEqual(
      Buffer.from([0x55, 0x4b, 0x01, 0x01]),
    );
    expect(report.datasets[0]).toMatchObject({
      scanned: 1,
      reencrypted: 1,
      failed: 0,
    });
    expect(report.datasets[0].byKey).toEqual({ 'legacy(0)': 1 });
  });

  it('migra un payload versionado id 0 al id 1 tras la rotación', async () => {
    const before = ringId0();
    const after = ringActive1();
    const port = binaryPort(after, {
      a: encryptWithKeyring(Buffer.from('x'), before),
    });

    const report = await runReencrypt([port], { apply: true });

    const stored = port.values.get('a') as Buffer;
    expect(stored[3]).toBe(1);
    expect(decryptWithKeyring(stored, after).toString()).toBe('x');
    expect(report.datasets[0].byKey).toEqual({ '0': 1 });
    expect(report.datasets[0].reencrypted).toBe(1);
  });

  it('omite lo que ya está al día y una segunda corrida no escribe', async () => {
    const ring = ringActive1();
    const port = binaryPort(ring, {
      a: legacyBinary('uno'),
      b: encryptWithKeyring(Buffer.from('dos'), ring),
    });

    const first = await runReencrypt([port], { apply: true });
    expect(first.datasets[0]).toMatchObject({ upToDate: 1, reencrypted: 1 });
    expect(port.writes).toEqual(['a']);

    port.writes.length = 0;
    const second = await runReencrypt([port], { apply: true });

    expect(port.writes).toEqual([]);
    expect(second.datasets[0]).toMatchObject({ upToDate: 2, reencrypted: 0 });
  });

  it('reescribe un legacy aunque la clave activa sea la id 0', async () => {
    const ring = ringId0();
    const versioned = encryptWithKeyring(Buffer.from('v'), ring);
    const port = binaryPort(ring, {
      legacy: legacyBinary('l'),
      ver: versioned,
    });

    const report = await runReencrypt([port], { apply: true });

    expect(port.writes).toEqual(['legacy']);
    expect((port.values.get('legacy') as Buffer).subarray(0, 2)).toEqual(
      Buffer.from([0x55, 0x4b]),
    );
    expect(port.values.get('ver')).toBe(versioned);
    expect(report.datasets[0]).toMatchObject({ upToDate: 1, reencrypted: 1 });
  });

  it('cifra a enc:v2 el texto plano y el enc:v1 del MFA', async () => {
    const ring = ringActive1();
    const port = textPort(ring, {
      plain: 'JBSWY3DPEHPK3PXP',
      v1: legacyText('GEZDGNBVGY3TQOJQ'),
      v2: encryptTextWithKeyring(Buffer.from('MFRGGZDFMZTWQ2LK'), ring),
    });

    const report = await runReencrypt([port], { apply: true });

    for (const id of ['plain', 'v1']) {
      const stored = port.values.get(id) as string;
      expect(stored.startsWith('enc:v2:1:')).toBe(true);
    }
    expect(
      decryptTextWithKeyring(
        port.values.get('plain') as string,
        ring,
      ).toString(),
    ).toBe('JBSWY3DPEHPK3PXP');
    expect(
      decryptTextWithKeyring(port.values.get('v1') as string, ring).toString(),
    ).toBe('GEZDGNBVGY3TQOJQ');
    expect(port.writes.sort()).toEqual(['plain', 'v1']);
    expect(report.datasets[0].byKey).toEqual({
      plaintext: 1,
      'legacy(0)': 1,
      '1': 1,
    });
  });

  it('en dry-run no escribe nada y cuenta lo que reescribiría', async () => {
    const ring = ringActive1();
    const port = binaryPort(ring, { a: legacyBinary('x') });
    const before = port.values.get('a');

    const report = await runReencrypt([port], { apply: false });

    expect(port.writes).toEqual([]);
    expect(port.values.get('a')).toBe(before);
    expect(report.datasets[0]).toMatchObject({
      wouldReencrypt: 1,
      reencrypted: 0,
      failed: 0,
    });
  });

  it('aborta solo la fila cuyo round-trip no coincide', async () => {
    const ring = ringActive1();
    const real = binaryCodec(ring);
    let calls = 0;
    const faulty: ValueCodec = {
      ...real,
      encrypt: (plaintext) => {
        calls += 1;
        return real.encrypt(calls === 1 ? Buffer.from('otro') : plaintext);
      },
    };
    const port = new FakePort('google', faulty, {
      bad: legacyBinary('a'),
      good: legacyBinary('b'),
    });

    const report = await runReencrypt([port], { apply: true });

    expect(port.writes).toEqual(['good']);
    expect(report.datasets[0].failures).toEqual([
      { id: 'bad', reason: 'roundtrip-mismatch' },
    ]);
    expect(report.datasets[0].reencrypted).toBe(1);
    expect(computeExitCode(report, { apply: true })).toBe(1);
  });

  it('reporta fallo de GCM y objeto ausente y sigue con el resto', async () => {
    const ring = ringActive1();
    const port = binaryPort(
      ring,
      {
        corrupt: legacyBinary('x', Buffer.alloc(32, 99)),
        gone: legacyBinary('y'),
        ok: legacyBinary('z'),
      },
      'documents',
    );
    port.missing.add('gone');

    const report = await runReencrypt([port], { apply: true });

    expect(report.datasets[0].failures).toEqual([
      { id: 'corrupt', reason: 'decrypt-failed' },
      { id: 'gone', reason: 'missing-object' },
    ]);
    expect(report.datasets[0].reencrypted).toBe(1);
    expect(computeExitCode(report, { apply: true })).toBe(1);
  });

  it('reporta como read-failed un error de lectura que no es de objeto ausente', async () => {
    const port = binaryPort(ringActive1(), { a: legacyBinary('x') });
    port.readErrors.set('a', new Error('timeout'));

    const report = await runReencrypt([port], { apply: true });

    expect(report.datasets[0].failures).toEqual([
      { id: 'a', reason: 'read-failed' },
    ]);
  });

  it('reporta write-failed si la escritura lanza y sigue', async () => {
    const port = binaryPort(ringActive1(), {
      a: legacyBinary('x'),
      b: legacyBinary('y'),
    });
    port.writeErrors.add('a');

    const report = await runReencrypt([port], { apply: true });

    expect(report.datasets[0].failures).toEqual([
      { id: 'a', reason: 'write-failed' },
    ]);
    expect(report.datasets[0].reencrypted).toBe(1);
  });

  it('trata una escritura condicional con count 0 como cambio concurrente', async () => {
    const port = binaryPort(ringActive1(), {
      a: legacyBinary('x'),
      b: legacyBinary('y'),
    });
    port.readConflict.add('a');

    const report = await runReencrypt([port], { apply: true });

    expect(report.datasets[0]).toMatchObject({
      concurrent: 1,
      reencrypted: 1,
      failed: 0,
    });
    expect(computeExitCode(report, { apply: true })).toBe(0);
  });

  it('omite los blobs nulos o vacíos', async () => {
    const port = binaryPort(ringActive1(), {
      a: null,
      b: Buffer.alloc(0),
      c: legacyBinary('x'),
    });

    const report = await runReencrypt([port], { apply: true });

    expect(report.datasets[0]).toMatchObject({
      scanned: 3,
      skippedNull: 2,
      reencrypted: 1,
    });
    expect(port.writes).toEqual(['c']);
  });

  it('respeta --limit por dataset', async () => {
    const port = binaryPort(ringActive1(), {
      a: legacyBinary('1'),
      b: legacyBinary('2'),
      c: legacyBinary('3'),
    });

    const report = await runReencrypt([port], { apply: true, limit: 2 });

    expect(report.datasets[0].scanned).toBe(2);
    expect(port.writes).toEqual(['a', 'b']);
  });

  it('procesa con concurrencia sin perder filas', async () => {
    const ring = ringActive1();
    const initial: Record<string, Stored> = {};
    for (let i = 0; i < 12; i++) initial[`r${i}`] = legacyBinary(`v${i}`);
    const port = new FakePort('documents', binaryCodec(ring), initial, 5);

    const report = await runReencrypt([port], { apply: true });

    expect(report.datasets[0].reencrypted).toBe(12);
    expect(port.writes).toHaveLength(12);
  });

  it('solo corre los puertos recibidos (el filtro --only lo aplica el llamador)', async () => {
    const a = binaryPort(ringActive1(), { a: legacyBinary('x') }, 'google');

    const report = await runReencrypt([a], { apply: true });

    expect(report.datasets.map((d) => d.dataset)).toEqual(['google']);
  });
});

describe('runReencrypt con retireKeyId (--check-retire)', () => {
  it('no escribe y cuenta las filas que usan la clave, incluidas las legacy para id 0', async () => {
    const ring = ringActive1();
    const port = binaryPort(ring, {
      legacy: legacyBinary('a'),
      v0: encryptWithKeyring(Buffer.from('b'), ringId0()),
      v1: encryptWithKeyring(Buffer.from('c'), ring),
    });

    const report = await runReencrypt([port], { apply: false, retireKeyId: 0 });

    expect(port.writes).toEqual([]);
    expect(report.datasets[0].usingRetireKey).toBe(2);
    expect(computeExitCode(report, { apply: false, retireKeyId: 0 })).toBe(1);
  });

  it('sale con 0 cuando ninguna fila usa la clave', async () => {
    const ring = ringActive1();
    const port = binaryPort(ring, {
      v1: encryptWithKeyring(Buffer.from('c'), ring),
      empty: null,
    });

    const report = await runReencrypt([port], { apply: false, retireKeyId: 0 });

    expect(report.datasets[0].usingRetireKey).toBe(0);
    expect(computeExitCode(report, { apply: false, retireKeyId: 0 })).toBe(0);
  });

  it('una fila ilegible bloquea el retiro aunque no cuente como uso', async () => {
    const ring = ringActive1();
    const port = binaryPort(ring, {
      v1: encryptWithKeyring(Buffer.from('c'), ring),
      bad: legacyBinary('x', Buffer.alloc(32, 99)),
    });

    const report = await runReencrypt([port], { apply: false, retireKeyId: 0 });

    expect(report.datasets[0].usingRetireKey).toBe(0);
    expect(report.datasets[0].failed).toBe(1);
    expect(computeExitCode(report, { apply: false, retireKeyId: 0 })).toBe(1);
  });

  it('el texto plano del MFA no cuenta como uso de la clave', async () => {
    const port = textPort(ringActive1(), { a: 'JBSWY3DPEHPK3PXP' });

    const report = await runReencrypt([port], { apply: false, retireKeyId: 0 });

    expect(report.datasets[0].usingRetireKey).toBe(0);
  });
});

describe('computeExitCode', () => {
  it('es 0 sin fallos y 1 con algún fallo', async () => {
    const ok = await runReencrypt(
      [binaryPort(ringActive1(), { a: legacyBinary('x') })],
      { apply: false },
    );
    expect(computeExitCode(ok, { apply: false })).toBe(0);

    const bad = await runReencrypt(
      [
        binaryPort(ringActive1(), {
          a: legacyBinary('x', Buffer.alloc(32, 99)),
        }),
      ],
      { apply: false },
    );
    expect(computeExitCode(bad, { apply: false })).toBe(1);
  });
});

describe('formatReport', () => {
  it('muestra los buckets legacy(0) y no filtra contenido', async () => {
    const port = binaryPort(ringActive1(), { a: legacyBinary('TOPSECRET') });
    const report = await runReencrypt([port], { apply: false });

    const text = formatReport(report, { apply: false });

    expect(text).toContain('google');
    expect(text).toContain('legacy(0)');
    expect(text).toContain('dry-run');
    expect(text).not.toContain('TOPSECRET');
  });

  it('informa el resultado de --check-retire', async () => {
    const port = binaryPort(ringActive1(), { a: legacyBinary('x') });
    const options = { apply: false, retireKeyId: 0 };
    const report = await runReencrypt([port], options);

    expect(formatReport(report, options)).toContain('usan la clave 0: 1');
  });
});

describe('parseArgs', () => {
  it('usa dry-run y todos los datasets por defecto', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      only: ['mfa', 'google', 'payment', 'documents'],
      limit: undefined,
      checkRetire: undefined,
    });
  });

  it('lee --apply, --only, --limit y --check-retire', () => {
    expect(
      parseArgs(['--apply', '--only', 'mfa,documents', '--limit', '5']),
    ).toEqual({
      apply: true,
      only: ['mfa', 'documents'],
      limit: 5,
      checkRetire: undefined,
    });
    expect(parseArgs(['--check-retire', 'DOCUMENT_ENCRYPTION_KEY=0'])).toEqual({
      apply: false,
      only: ['documents'],
      limit: undefined,
      checkRetire: { keyName: 'DOCUMENT_ENCRYPTION_KEY', keyId: 0 },
    });
  });

  it('acepta la forma --flag=valor', () => {
    expect(parseArgs(['--only=google', '--limit=3'])).toMatchObject({
      only: ['google'],
      limit: 3,
    });
  });

  it.each([
    [['--nope']],
    [['--only', 'mfa,otro']],
    [['--only']],
    [['--limit', '0']],
    [['--limit', 'abc']],
    [['--limit', '1.5']],
    [['--check-retire', 'DOCUMENT_ENCRYPTION_KEY']],
    [['--check-retire', 'OTRA_CLAVE=0']],
    [['--check-retire', 'DOCUMENT_ENCRYPTION_KEY=300']],
    [['--check-retire', 'DOCUMENT_ENCRYPTION_KEY=x']],
    [['--check-retire', 'DOCUMENT_ENCRYPTION_KEY=0', '--apply']],
    [['--check-retire', 'DOCUMENT_ENCRYPTION_KEY=0', '--limit', '10']],
    [['--check-retire', 'DOCUMENT_ENCRYPTION_KEY=0', '--only', 'mfa']],
    [['posicional']],
  ])('rechaza argumentos inválidos %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});
