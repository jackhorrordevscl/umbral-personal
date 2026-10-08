import type { AgeBand } from "../../types/patient";

const LABELS: Record<Exclude<AgeBand, "ADULT">, string> = {
  UNDER_14: "Menor de 14 años",
  AGE_14_17: "Adolescente de 14 a 17 años",
};

// Bloque Menores (M5): tramo etario del paciente. Un adulto no muestra badge.
export default function AgeBandBadge({ ageBand }: { ageBand?: AgeBand }) {
  if (!ageBand || ageBand === "ADULT") return null;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
      {LABELS[ageBand]}
    </span>
  );
}
