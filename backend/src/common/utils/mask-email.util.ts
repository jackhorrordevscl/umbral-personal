// Issue #134 (Ley 19.628/21.719): los logs de aplicación (stdout/Nest
// Logger) terminan en el sistema de logging del hosting sin el control de
// retención/acceso que sí tiene AuditService -- el email completo solo debe
// circular por ese canal auditado, nunca por logs. Se conserva el dominio
// (útil para depurar sin identificar a la persona) y solo el primer
// carácter del local-part.
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

// Para texto libre que puede contener emails (p. ej. el cuerpo de un error
// de un gateway externo que ecoa el payload rechazado, issue #197).
export function maskEmailsInText(text: string): string {
  return text.replace(/[^\s"'<>,;:=&\\]+@[^\s"'<>,;:=&\\]+/g, maskEmail);
}
