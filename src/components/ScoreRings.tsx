import { overallScoreExplanation, type CodeScoreGap, type CombinedScores } from "@/lib/code-scan/score";
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

/** Site score only. Code and overall stay blank so a missed code scan is not scored as clean. */
export function UnavailableScoreRings({
  gap,
  tone = "dark",
  layout = "report",
}: {
  gap: CodeScoreGap;
  tone?: GaugeTone;
  layout?: "report" | "dashboard";
}) {
  const compact = layout === "dashboard";
  const caption = tone === "dark" ? "text-[#d9d3c5]" : "text-[#536058]";
  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className={`mb-1 text-center text-xs font-semibold uppercase tracking-[0.14em] ${caption}`}>Site</p>
          <ScoreGauge score={gap.site} size={compact ? "sm" : "md"} tone={tone} showExplainer={false} />
        </div>
        <ScoreBlank label="Code" caption={caption} compact={compact} />
        <ScoreBlank label="Overall" caption={caption} compact={compact} prominent />
      </div>
      <p className={`mt-3 max-w-xl text-sm ${caption}`}>{gap.reason}</p>
    </div>
  );
}

function ScoreBlank({ label, caption, compact, prominent = false }: { label: string; caption: string; compact: boolean; prominent?: boolean }) {
  return (
    <div>
      <p className={`mb-1 text-center text-xs font-semibold uppercase tracking-[0.14em] ${prominent ? "text-lime" : caption}`}>{label}</p>
      <p className={`grid place-items-center font-display ${caption} ${compact ? "h-16 w-16 text-3xl" : "h-24 w-24 text-5xl"}`} aria-label={`${label} score unavailable`}>
        —
      </p>
    </div>
  );
}
