import { useQuery } from "@tanstack/react-query";
import { Users, ClipboardList, FileText, Calendar } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // T6.4 (issue #51): ADMIN ya no tiene acceso a fichas clínicas -- GET
  // /patients le responde 403. Sin este `enabled`, el dashboard le rompería
  // apenas loguea (es la primera pantalla, no un caso límite).
  const hasPatientAccess = user?.role !== "ADMIN";

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => api.get("/patients").then((r) => r.data),
    enabled: hasPatientAccess,
  });

  const { data: consultations = [] } = useQuery({
    queryKey: ["consultations-all"],
    queryFn: () =>
      api.get("/patients").then(async (r) => {
        const all = await Promise.all(
          r.data.map((p: any) =>
            api.get(`/consultations/patient/${p.id}`).then((c) => c.data),
          ),
        );
        return all.flat();
      }),
    enabled: hasPatientAccess,
  });

  const stats = [
    {
      label: "Pacientes activos",
      value: patients.length,
      icon: Users,
      color: "text-sage-600",
      bg: "bg-sage-50",
      route: "/patients",
    },
    {
      label: "Consultas registradas",
      value: consultations.length,
      icon: ClipboardList,
      color: "text-blue-600",
      bg: "bg-blue-50",
      route: "/consultations",
    },
    {
      // T6.1 (issue #27): consentSigned ya no existe como columna; el
      // backend agrega `consents` (estado vigente por finalidad, derivado
      // del ledger PatientConsent) en la misma respuesta de GET /patients,
      // así que este stat sigue sin necesitar llamadas extra.
      label: "Consentimientos firmados",
      value: patients.filter((p: any) => p.consents?.TREATMENT).length,
      icon: FileText,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      route: "/patients",
    },
    {
      label: "Próximas sesiones",
      value: consultations.filter(
        (c: any) =>
          c.nextSessionDate && new Date(c.nextSessionDate) >= new Date(),
      ).length,
      icon: Calendar,
      color: "text-amber-600",
      bg: "bg-amber-50",
      route: "/consultations",
    },
  ];

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h2 className="font-display text-2xl md:text-3xl text-slate-900">
          Dashboard
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Bienvenida, {user?.name ?? user?.email} —{" "}
          {new Date().toLocaleDateString("es-CL", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {!hasPatientAccess ? (
        <div className="card p-6 md:p-8 text-center">
          <p className="text-slate-500 text-sm">
            El rol Administrador no tiene acceso a datos clínicos de pacientes.
            Gestioná cuentas de usuario desde el módulo{" "}
            <button
              onClick={() => navigate("/users")}
              className="text-sage-600 hover:underline font-medium"
            >
              Usuarios
            </button>
            .
          </p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5 mb-6 md:mb-8">
            {stats.map((stat) => (
              <div
                key={stat.label}
                onClick={() => navigate(stat.route)}
                className="card flex items-center gap-3 p-4 md:p-6 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className={`${stat.bg} p-2 md:p-3 rounded-lg shrink-0`}>
                  <stat.icon size={18} className={stat.color} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl md:text-2xl font-display text-slate-900">
                    {stat.value}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Pacientes recientes */}
          <div className="card p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg md:text-xl text-slate-900">
                Pacientes recientes
              </h3>
              <button
                onClick={() => navigate("/patients")}
                className="text-xs text-sage-600 hover:underline"
              >
                Ver todos →
              </button>
            </div>
            {patients.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">
                No hay pacientes registrados aún.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {patients.slice(0, 5).map((p: any) => (
                  <div
                    key={p.id}
                    onClick={() => navigate("/patients")}
                    className="py-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-cream-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {p.fullName}
                      </p>
                      <p className="text-xs text-slate-400">{p.rut}</p>
                    </div>
                    <div className="shrink-0">
                      {p.consents?.TREATMENT ? (
                        <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full">
                          ✓
                        </span>
                      ) : (
                        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-full">
                          Pendiente
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
