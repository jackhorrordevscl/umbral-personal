import { parseArgs } from '../../../scripts/grant-subscription';

describe('grant-subscription parseArgs', () => {
  it('normaliza el email y deja la concesión permanente sin --until', () => {
    expect(parseArgs([' Ana@Mail.COM '])).toEqual({
      email: 'ana@mail.com',
      expiresAt: null,
    });
  });

  it('--until fija el fin del día UTC indicado', () => {
    expect(parseArgs(['a@b.cl', '--until', '2027-03-31'])).toEqual({
      email: 'a@b.cl',
      expiresAt: new Date('2027-03-31T23:59:59.999Z'),
    });
  });

  it.each([
    [[]],
    [['no-es-email']],
    [['a@b.cl', '--until']],
    [['a@b.cl', '--until', '31-03-2027']],
  ])('rechaza %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});
