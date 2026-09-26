import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../context/useAuth";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import IdleWarningModal from "./IdleWarningModal";

export default function IdleManager() {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);

  // Si la sesión se cierra por otra vía mientras el aviso está abierto (por
  // ejemplo un 401 que dispara SessionExpiredHandler), el estado no debe
  // sobrevivir: de lo contrario el modal reaparece con una cuenta atrás nueva
  // en el siguiente login. Se ajusta durante el render, no en un efecto.
  if (!isAuthenticated && showWarning) setShowWarning(false);

  const handleWarn = useCallback(() => {
    if (isAuthenticated) setShowWarning(true);
  }, [isAuthenticated]);

  const handleLogout = useCallback(() => {
    setShowWarning(false);
    logout();
    navigate("/login");
  }, [logout, navigate]);

  const { extend } = useIdleTimeout({
    onWarn: handleWarn,
  });

  const handleExtend = useCallback(() => {
    if (!isAuthenticated) return;
    setShowWarning(false);
    extend();
  }, [extend, isAuthenticated]);

  if (!isAuthenticated) return null;

  return showWarning ? (
    <IdleWarningModal onExtend={handleExtend} onLogout={handleLogout} />
  ) : null;
}
