interface RecoveryCodesRevealProps {
  codes: string[];
  onContinue: () => void;
  continueLabel: string;
}

// Issue #50: se usa en dos flujos (enrolamiento MFA forzado en LoginPage y
// activación opcional en SettingsPage) -- el backend solo entrega estos
// códigos una vez, en la respuesta de mfa/enable o mfa/setup/confirm, así
// que ambos puntos de entrada necesitan la misma pantalla de "guárdalos
// ahora, no los vas a volver a ver".
export default function RecoveryCodesReveal({
  codes,
  onContinue,
  continueLabel,
}: RecoveryCodesRevealProps) {
  const handleCopyAll = () => {
    void navigator.clipboard.writeText(codes.join('\n'));
  };

  return (
    <div>
      <h3 className="font-display text-2xl text-slate-900 mb-2">
        Guarda tus códigos de recuperación
      </h3>
      <p className="text-slate-500 text-sm mb-6">
        Si pierdes el dispositivo con tu app autenticadora, vas a necesitar uno de
        estos 10 códigos para recuperar el acceso sin soporte técnico. Se muestran
        una única vez -- guárdalos en un gestor de contraseñas o impresos en un
        lugar seguro.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-2 gap-2 font-mono text-sm text-slate-700">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>

      <button onClick={handleCopyAll} className="btn-secondary w-full mb-4">
        Copiar todos los códigos
      </button>

      <button onClick={onContinue} className="btn-primary w-full py-3 text-base">
        {continueLabel}
      </button>
    </div>
  );
}
