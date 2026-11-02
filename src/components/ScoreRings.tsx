import { overallScoreExplanation, type CombinedScores } from "@/lib/code-scan/score";
import type { GaugeTone } from "@/lib/score-gauge";
import { ScoreGauge } from "./ScoreGauge";

export function ScoreRings({
  scores,
  tone = "dark",
  layout = "report",
}: {
  scores: CombinedScores;
  tone?: GaugeTone;
  layout?: "report" | "dashboard";
}) {
  const compact = layout === "dashboard";
  const caption = tone === "dark" ? "text-[#d9d3c5]" : "text-[#536058]";
  const rings = [
    { label: "Overall", score: scores.overall, size: compact ? ("md" as const) : ("lg" as const) },
    { label: "Site", score: scores.site, size: "sm" as const },
    { label: "Code", score: scores.code, size: "sm" as const },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        {rings.map((ring) => (
          <div key={ring.label}>
            <p className={`mb-1 text-center text-xs font-semibold uppercase tracking-[0.14em] ${ring.label === "Overall" ? "text-lime" : caption}`}>{ring.label}</p>
            <ScoreGauge score={ring.score} size={ring.size} tone={tone} showExplainer={false} />
          </div>
        ))}
      </div>
      {compact ? null : <p className={`mt-3 max-w-xl text-sm ${caption}`}>{overallScoreExplanation()}</p>}
    </div>
  );
}
