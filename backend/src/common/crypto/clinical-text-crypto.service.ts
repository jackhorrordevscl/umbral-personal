import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildKeyring,
  decryptTextWithKeyring,
  encryptTextWithKeyring,
  Keyring,
} from './keyring';

const ENV_VAR_NAME = 'CLINICAL_TEXT_ENCRYPTION_KEY';

// Prefijos versionados del texto almacenado (mismo formato que el resto de los
// datasets de texto, ver keyring.ts). Un valor sin prefijo es texto plano
// heredado y decrypt() lo devuelve tal cual.
const CIPHER_PREFIXES = ['enc:v1:', 'enc:v2:', 'enc:v3:', 'enc:v4:'];

// issue #486: contexto que liga un texto cifrado a su dueño y a su campo. El
// dueño es el paciente (consultas, snapshots e informes de alta) o, para las
// notificaciones, que no tienen paciente, el usuario destinatario. Va dentro
// del AAD de enc:v4: copiar un texto a otro paciente, usuario o campo lo deja
// sin poder descifrarse.
export type ClinicalOwnerScope = 'patient' | 'user';

export function clinicalContext(
  scope: ClinicalOwnerScope,
  ownerId: string,
  field: string,
): string {
  if (!ownerId || !field) {
    throw new Error('El contexto de cifrado necesita dueño y campo');
  }
  return `${scope}/${ownerId}/${field}`;
}

// ADR 0004 (opción B) y ADR 0005: cifra a nivel de aplicación los textos
// clínicos libres (notas de consulta e informe de alta) con una clave AES-256-GCM
// propia, nunca compartida con las demás. Formato enc:v4:<keyId>:<base64(iv|tag|ct)>
// con AAD (prefijo, keyId, dataset "clinical" y contexto dueño/campo), por lo
// que un valor movido a otro dataset, paciente o campo, o con el keyId alterado,
// no se descifra. enc:v1/v2/v3 siguen leyéndose (sin ligar al registro).
//
// Contrato: tras activar el cifrado toda escritura de estas columnas pasa por
// encrypt(); el paso de texto plano en decrypt() existe solo para el legado y
// para que el reencriptado pueda leer valores aún sin cifrar.
@Injectable()
export class ClinicalTextCryptoService implements OnModuleInit {
  private keyring!: Keyring;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.keyring = buildKeyring(
      this.config.get<string>(ENV_VAR_NAME),
      this.config.get<string>(`${ENV_VAR_NAME}_KEYRING`),
      this.config.get<string>(`${ENV_VAR_NAME}_ACTIVE_KEY_ID`),
      ENV_VAR_NAME,
    );
  }

  // `context` viene de clinicalContext(): obligatorio, para que ninguna
  // escritura quede sin ligar al registro.
  encrypt(text: string, context: string): string {
    return encryptTextWithKeyring(
      Buffer.from(text, 'utf8'),
      this.keyring,
      context,
    );
  }

  decrypt(stored: string, context: string): string {
    if (!this.isEncrypted(stored)) return stored;
    return decryptTextWithKeyring(stored, this.keyring, context).toString(
      'utf8',
    );
  }

  encryptNullable(
    text: string | null | undefined,
    context: string,
  ): string | null {
    return text === null || text === undefined
      ? null
      : this.encrypt(text, context);
  }

  decryptNullable(
    stored: string | null | undefined,
    context: string,
  ): string | null {
    return stored === null || stored === undefined
      ? null
      : this.decrypt(stored, context);
  }

  isEncrypted(stored: string): boolean {
    return CIPHER_PREFIXES.some((prefix) => stored.startsWith(prefix));
  }
}
