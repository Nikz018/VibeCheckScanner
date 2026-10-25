import { SCORE_EXPLAINER, renderScoreGaugeSvg, type GaugeTone } from "@/lib/score-gauge";

const WIDTH = { sm: 132, md: 188, lg: 232 } as const;

export function ScoreGauge({
  score,
  size = "md",
  tone = "light",
  showExplainer = true,
}: {
  score: number | null;
  size?: keyof typeof WIDTH;
  tone?: GaugeTone;
  showExplainer?: boolean;
}) {
  const svg = renderScoreGaugeSvg({ score, tone });
  const caption = tone === "dark" ? "text-[#d9d3c5]" : "text-[#536058]";
  return (
    <figure className="score-gauge" style={{ width: WIDTH[size] }} data-score={score ?? ""}>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      {showExplainer ? <figcaption className={`mt-1 text-xs leading-snug ${caption}`}>{SCORE_EXPLAINER}</figcaption> : null}
    </figure>
  );
}
