import { ClinicalTextCryptoService } from '../../../common/crypto/clinical-text-crypto.service';

// issue #501 (A4): el título y el cuerpo de una notificación pueden llevar el
// nombre del paciente ("Tu sesión con X…"), así que se guardan cifrados con la
// misma clave de textos clínicos y hacia fuera (API) siempre salen en claro.
// Ninguna consulta filtra ni busca por estas columnas.
export const NOTIFICATION_TEXT_FIELDS = ['title', 'body'] as const;

export const UNREADABLE_NOTIFICATION_TITLE = 'Notificación';
export const UNREADABLE_NOTIFICATION_BODY =
  'No se pudo leer el contenido de esta notificación.';

interface NotificationTexts {
  title: string;
  body: string;
}

export function encryptNotificationTexts<T extends NotificationTexts>(
  data: T,
  crypto: ClinicalTextCryptoService,
): T {
  return {
    ...data,
    title: crypto.encrypt(data.title),
    body: crypto.encrypt(data.body),
  };
}

// Lectura tolerante: una fila alterada o cifrada con una clave que ya no está
// en el llavero no debe tumbar la lista completa de la campanita. Devuelve la
// fila con un texto neutro y avisa con `readable: false` para que el llamador
// lo registre sin volcar el contenido.
export function decryptNotificationRow<T extends NotificationTexts>(
  row: T,
  crypto: ClinicalTextCryptoService,
): { row: T; readable: boolean } {
  try {
    return {
      row: {
        ...row,
        title: crypto.decrypt(row.title),
        body: crypto.decrypt(row.body),
      },
      readable: true,
    };
  } catch {
    return {
      row: {
        ...row,
        title: UNREADABLE_NOTIFICATION_TITLE,
        body: UNREADABLE_NOTIFICATION_BODY,
      },
      readable: false,
    };
  }
}
