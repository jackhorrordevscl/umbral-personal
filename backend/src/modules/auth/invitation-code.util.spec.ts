import { hashInvitationCode } from './invitation-code.util';

describe('hashInvitationCode', () => {
  it('devuelve el SHA-256 hex del código (el mismo que calcula la migración en SQL)', () => {
    expect(hashInvitationCode('a1b2c3d4e5f6')).toBe(
      'bde81e9384b7848e57951ec32c7344459233235bfa519d7396ae3406014a06f4',
    );
  });

  it('es determinista y distingue códigos distintos', () => {
    expect(hashInvitationCode('abc')).toBe(hashInvitationCode('abc'));
    expect(hashInvitationCode('abc')).not.toBe(hashInvitationCode('abd'));
  });
});
