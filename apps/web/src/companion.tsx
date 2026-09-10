import type { ChildCompanion } from "@xiaoban/contracts";

export const COMPANION_COPY: Record<ChildCompanion, { name: string; description: string }> = {
  sprout: { name: "小芽", description: "安静、耐心，喜欢把大问题变成小行动。" },
  cloud: { name: "小云", description: "柔和、轻松，适合陪你说说心里话。" },
  kite: { name: "小风", description: "有活力，喜欢带你到现实里动一动。" },
};

export function CompanionIllustration({
  companion,
  className,
}: {
  companion: ChildCompanion;
  className?: string;
}) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className={className} viewBox="0 0 120 120" role="img" aria-label={`AI伙伴${COMPANION_COPY[companion].name}`}>
      <circle cx="60" cy="60" r="52" fill="#fffdf7" stroke="#d7d1c1" />
      {companion === "sprout" ? (
        <>
          <path d="M60 42c-13-15-30-7-29 9 1 13 13 24 29 32 16-8 28-19 29-32 1-16-16-24-29-9Z" fill="#d8ebe4" stroke="#0f766e" strokeWidth="3" />
          <path d="M60 42c-2-16 6-24 20-25-1 13-7 21-20 25Z" fill="#78a66c" stroke="#416d3a" strokeWidth="3" />
          <circle cx="50" cy="58" r="2.8" fill="#183b3a" />
          <circle cx="70" cy="58" r="2.8" fill="#183b3a" />
          <path d="M53 68c5 4 9 4 14 0" {...common} strokeWidth="3" />
        </>
      ) : companion === "cloud" ? (
        <>
          <path d="M35 73c-9 0-14-7-12-15 2-7 8-11 15-10 3-13 15-21 27-18 9 2 15 9 17 18 9-1 16 5 16 13 0 8-6 12-15 12H35Z" fill="#e6f0ef" stroke="#0f766e" strokeWidth="3" />
          <circle cx="51" cy="56" r="2.8" fill="#183b3a" />
          <circle cx="69" cy="56" r="2.8" fill="#183b3a" />
          <path d="M53 65c5 4 9 4 14 0" {...common} strokeWidth="3" />
          <path d="M43 83c-3 5-1 9 3 11M62 83c-3 5-1 9 3 11M80 82c-3 5-1 9 3 11" {...common} stroke="#78a66c" strokeWidth="3" />
        </>
      ) : (
        <>
          <path d="m60 26 31 28-31 31-31-31 31-28Z" fill="#f6e7bd" stroke="#9d6d17" strokeWidth="3" />
          <path d="M60 26v59M29 54h62" {...common} stroke="#d6a447" strokeWidth="2.5" />
          <circle cx="51" cy="52" r="2.8" fill="#183b3a" />
          <circle cx="69" cy="52" r="2.8" fill="#183b3a" />
          <path d="M53 62c5 4 9 4 14 0M60 85c-2 9 10 8 7 18-2 7-10 3-9 12" {...common} strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
