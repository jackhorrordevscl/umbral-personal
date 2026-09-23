// Issue #158: broadcast único a todos los usuarios pidiendo que vuelvan a
// subir los documentos legales perdidos por el bug de disco efímero de
// Render (PatientDocument vivía en disco local antes de la migración a B2,
// PR #180). Se detectaron y limpiaron 15 registros huérfanos en producción
// (ver memoria del proyecto); esos 15 archivos físicos no son recuperables,
// así que en vez de mapear cuáles terapeutas fueron afectados, se notifica
// a todos -- decisión explícita del usuario.
//
// Standalone, ejecución MANUAL única -- NUNCA wireado a `prisma migrate
// dev`/`deploy`, app boot, ni ningún request path (mismo patrón que
// seed-holidays.ts). Crea una fila Notification por cada User existente con
// un solo createMany (no vía NotificationsService.create -- no soporta
// batch, y acá no hace falta el logging por fila que hace para altas
// individuales):
//
//   npx ts-node backend/scripts/notify-document-reupload.ts
import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient, NotificationType } from '@prisma/client';

const TITLE = 'Es necesario revisar los documentos legales de los pacientes';
const BODY =
  'Tuvimos un problema de almacenamiento y algunos documentos legales subidos ' +
  '(consentimientos, acuerdos de telemedicina, etc.) se perdieron antes del ' +
  '23/09. Ya está resuelto para que no vuelva a pasar, pero es necesario ' +
  'entrar a la ficha de cada paciente y volver a subir los que falten. ' +
  'Disculpa las molestias -- preferimos avisar antes de que lo notes por tu cuenta.';

export async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
    if (users.length === 0) {
      console.log('No hay usuarios activos -- nada que notificar.');
      return 0;
    }
    const result = await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: NotificationType.PATIENT_DOCUMENT_REUPLOAD_REQUIRED,
        title: TITLE,
        body: BODY,
        linkPath: '/patients',
      })),
    });
    console.log(`✅ ${result.count} notificación(es) creada(s) (de ${users.length} usuario(s) activos).`);
    return result.count;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
