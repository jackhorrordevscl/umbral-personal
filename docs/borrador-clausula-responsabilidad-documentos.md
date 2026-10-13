# Borrador: cláusula de responsabilidad sobre documentos aportados

- **Estado:** borrador para incorporar a los términos de uso de Umbral. Aún no existe un documento de términos de uso en este repositorio.
- **Fecha:** 2026-10-13
- **Contexto:** ADR 0006 (informe de alta) y registro de actividades de tratamiento. El terapeuta es el responsable del tratamiento de los datos de sus pacientes y Ground Zero Devs, operador de Umbral, es el encargado (ver "Responsable del tratamiento" en `registro-actividades-tratamiento.md`).
- **Revisión legal:** se hará una sola vez, sobre el producto completo, al terminar la V1.

## Texto propuesto

**Documentos y autorizaciones aportados por el usuario.**

El terapeuta es el responsable del tratamiento de los datos de sus pacientes y de verificar la autenticidad, la vigencia y la formalidad de los documentos que carga en Umbral o que le aportan sus pacientes o sus representantes, incluidos consentimientos, asentimientos, poderes, autorizaciones de entrega y oficios. Umbral es una herramienta de organización: almacena esos documentos y registra las acciones realizadas, pero no verifica su veracidad, su validez legal ni la identidad de quien los otorga.

El terapeuta es el único responsable de decidir si una entrega de información, total o parcial, a un paciente, a un representante o a un tercero cumple los requisitos legales aplicables, y de las consecuencias de entregarla. El paciente o su representante que aporta un documento responde por la veracidad de su contenido y de su firma.

Esta cláusula no limita las obligaciones de seguridad y confidencialidad que Umbral asume como encargado del tratamiento de esos datos.

## Dónde se refleja en el producto

- **Diálogo "Registrar entrega del informe":** al elegir como destinatario a un tercero se muestra un aviso con la responsabilidad del terapeuta y lo que exige la ley según el tipo de tercero. Umbral no comprueba la autenticidad ni la formalidad del documento cargado.
- **Manual de terapeutas:** la sección "Cerrar el tratamiento e informe de alta" repite la advertencia para la entrega a terceros.

## Notas

- La última frase es deliberada: un término de uso reparte responsabilidad entre las partes, pero no elimina las obligaciones que el encargado asume por seguridad y confidencialidad.
- "Poder notarial simple" se usa como en el art. 13 de la Ley 20.584 y el art. 10 del Decreto 41: un poder firmado ante notario, sin escritura pública. No se encontró un dictamen de la Superintendencia de Salud que aclare si basta la autorización de firma.
