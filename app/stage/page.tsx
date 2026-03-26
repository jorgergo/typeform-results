"use client";

import type { CSSProperties, ReactNode } from "react";
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Award, ListOrdered, Play, Sparkles, UsersRound } from "lucide-react";
import { readStageSession } from "./session";

type StageStep =
  | "intro"
  | "bronze"
  | "silver"
  | "winnerSpotlight"
  | "gold"
  | "celebration"
  | "full";

type PodiumTarget = "bronze" | "silver" | "gold";
type RevealState = "hidden" | "active" | "settled";

const STAGE_STEPS: StageStep[] = [
  "intro",
  "bronze",
  "silver",
  "gold",
  "winnerSpotlight",
  "celebration",
  "full",
];
const STEP_DURATION_MS: Record<Exclude<StageStep, "full">, number> = {
  intro: 1900,
  bronze: 2400,
  silver: 2400,
  gold: 1700,
  winnerSpotlight: 2400,
  celebration: 5200,
};

const PODIUM_CARD_STYLE: Record<PodiumTarget, string> = {
  silver:
    "order-2 min-h-[16rem] md:order-1 md:min-h-[18.75rem] bg-gradient-to-b from-slate-200/34 via-slate-300/22 to-slate-500/20",
  gold: "order-1 min-h-[18rem] md:order-2 md:min-h-[22rem] bg-gradient-to-b from-amber-200/40 via-yellow-300/24 to-amber-500/22",
  bronze:
    "order-3 min-h-[15rem] md:order-3 md:min-h-[16.75rem] bg-gradient-to-b from-orange-300/36 via-orange-300/22 to-amber-700/24",
};

const NAME_STYLE: Record<PodiumTarget, string> = {
  silver: "order-2 md:order-1",
  gold: "order-1 md:order-2",
  bronze: "order-3 md:order-3",
};

const MEDAL_STYLE: Record<PodiumTarget, string> = {
  silver: "bg-gradient-to-br from-slate-200 to-slate-500",
  gold: "bg-gradient-to-br from-amber-300 to-yellow-600",
  bronze: "bg-gradient-to-br from-orange-400 to-amber-800",
};

const PODIUM_GRID_LAYOUT =
  "grid items-end justify-center gap-4 md:grid-cols-[minmax(190px,260px)_minmax(240px,300px)_minmax(190px,260px)] md:gap-6";

const STAGE_CONTENT_WIDTH_CLASS = "w-[min(1240px,97vw)]";

const CARD_ACTIVE_STYLE: Record<PodiumTarget, string> = {
  silver:
    "animate-slide-in-bottom [animation-duration:1180ms] [animation-fill-mode:both] [animation-timing-function:cubic-bezier(0.16,1,0.3,1)]",
  gold:
    "animate-slide-in-bottom [animation-duration:1320ms] [animation-fill-mode:both] [animation-timing-function:cubic-bezier(0.16,1,0.3,1)]",
  bronze:
    "animate-slide-in-bottom [animation-duration:1240ms] [animation-fill-mode:both] [animation-timing-function:cubic-bezier(0.16,1,0.3,1)]",
};

const STAGE_ROOT_CLASS =
  "relative grid min-h-screen gap-5 overflow-x-hidden px-[clamp(1rem,3vw,2.75rem)] pb-6 pt-8 text-slate-100";

const STAGE_BACKGROUND_STYLE: CSSProperties = {
  background:
    "radial-gradient(circle at 50% -22%, rgba(82, 153, 255, 0.42), transparent 55%), radial-gradient(circle at 82% 12%, rgba(46, 212, 181, 0.2), transparent 42%), linear-gradient(160deg, #060f24 0%, #10254f 45%, #071733 100%)",
};

const ACTION_BUTTON_CLASS =
  "rounded-full border border-blue-200/35 bg-blue-950/75 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:-translate-y-0.5 hover:bg-blue-800/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200";

const scoreFormatter = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const subscribeToNoopStore = () => () => {};

function stepIndex(step: StageStep) {
  return STAGE_STEPS.indexOf(step);
}

function stageCardState(step: StageStep, target: PodiumTarget): RevealState {
  const current = stepIndex(step);
  const targetOrder = stepIndex(target);

  if (current < targetOrder) {
    return "hidden";
  }

  if (current === targetOrder) {
    return "active";
  }

  return "settled";
}

function cardClassName(step: StageStep, target: PodiumTarget) {
  const cardState = stageCardState(step, target);
  if (cardState === "active") {
    return `translate-y-0 scale-100 opacity-100 motion-reduce:animate-none ${CARD_ACTIVE_STYLE[target]}`;
  }

  if (cardState === "settled") {
    return "translate-y-0 scale-100 opacity-95";
  }

  return "translate-y-24 scale-90 opacity-0 md:translate-y-28";
}

function stageNameState(step: StageStep, target: PodiumTarget): RevealState {
  const current = stepIndex(step);
  const revealAt = target === "gold" ? stepIndex("winnerSpotlight") : stepIndex(target);

  if (current < revealAt) {
    return "hidden";
  }

  if (current === revealAt) {
    return "active";
  }

  return "settled";
}

function nameClassName(step: StageStep, target: PodiumTarget) {
  const state = stageNameState(step, target);

  if (state === "active") {
    return "translate-y-0 scale-100 opacity-100 animate-fade-in-up [animation-duration:860ms] [animation-fill-mode:both] motion-reduce:animate-none";
  }

  if (state === "settled") {
    return "translate-y-0 scale-100 opacity-92";
  }

  return "translate-y-6 scale-95 opacity-0";
}

function nameAnimationStyle(step: StageStep, target: PodiumTarget): CSSProperties | undefined {
  if (stageNameState(step, target) !== "active") {
    return undefined;
  }

  const delayMs = target === "gold" ? 880 : 620;
  return {
    animationDelay: `${delayMs}ms`,
  };
}

function formatCompletionTime(durationMs?: number | null) {
  if (durationMs === null || durationMs === undefined) {
    return "N/D";
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function StageShell({ children }: { children: ReactNode }) {
  return (
    <main className={STAGE_ROOT_CLASS} style={STAGE_BACKGROUND_STYLE}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(rgba(255,255,255,0.24)_0.65px,transparent_0.65px)] [background-size:4px_4px]"
        aria-hidden="true"
      />
      {children}
    </main>
  );
}

function StageEmptyState({
  title,
  description,
  showBackLink,
}: {
  title: string;
  description?: string;
  showBackLink?: boolean;
}) {
  return (
    <StageShell>
      <section className="relative z-10 mx-auto mt-[14vh] w-[min(700px,95vw)] animate-blurred-fade-in rounded-3xl border border-blue-200/35 bg-slate-900/90 px-6 py-7 text-center shadow-[0_22px_52px_rgba(2,8,26,0.48)] motion-reduce:animate-none">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-2 text-blue-100/85">{description}</p> : null}
        {showBackLink ? (
          <Link href="/" className={`${ACTION_BUTTON_CLASS} mt-4 inline-flex`}>
            <ArrowLeft aria-hidden="true" size={15} strokeWidth={2.4} />
            <span>Volver al panel</span>
          </Link>
        ) : null}
      </section>
    </StageShell>
  );
}

function StagePresentation() {
  const params = useSearchParams();
  const [step, setStep] = useState<StageStep>("intro");
  const [hasStarted, setHasStarted] = useState(false);
  const hasHydrated = useSyncExternalStore(subscribeToNoopStore, () => true, () => false);
  const sessionId = params.get("session");

  const session = useMemo(() => {
    if (!hasHydrated) {
      return null;
    }

    return readStageSession(sessionId);
  }, [hasHydrated, sessionId]);

  const ranking = session?.ranking ?? [];
  const topThree = ranking.slice(0, 3);
  const gold = topThree[0] ?? null;
  const silver = topThree[1] ?? null;
  const bronze = topThree[2] ?? null;
  const runnersUp = ranking.slice(3, 10);
  const winnerSpotlightOn = stepIndex(step) >= stepIndex("winnerSpotlight");
  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 46 }, (_, index) => {
        const randomUnit = (seed: number) => {
          const value = Math.sin(seed * 98.137 + 13.579) * 43758.5453;
          return value - Math.floor(value);
        };

        const leftPercent = 2 + randomUnit(index + 1) * 96;
        const widthPx = 5 + randomUnit(index + 11) * 7;
        const heightPx = widthPx * (1.25 + randomUnit(index + 21) * 1.35);
        const hue = Math.round(randomUnit(index + 31) * 360);
        const fallDurationMs = Math.round(4200 + randomUnit(index + 41) * 2600);
        const startDelayMs = -1 * Math.round(randomUnit(index + 51) * 6200);
        const driftPx = `${Math.round((randomUnit(index + 61) - 0.5) * 140)}px`;
        const swayPx = `${Math.round((randomUnit(index + 71) - 0.5) * 85)}px`;
        const spinDeg = `${320 + Math.round(randomUnit(index + 81) * 640)}deg`;
        const startY = `${-6 - Math.round(randomUnit(index + 91) * 28)}%`;
        const pieceRadius = `${Math.round(randomUnit(index + 101) * 3)}px`;
        return {
          id: index,
          style: {
            ["--confetti-left" as string]: `${leftPercent}%`,
            ["--confetti-width" as string]: `${widthPx.toFixed(1)}px`,
            ["--confetti-height" as string]: `${heightPx.toFixed(1)}px`,
            ["--confetti-start-y" as string]: startY,
            ["--confetti-color" as string]: `hsl(${hue} 84% 58%)`,
            ["--confetti-duration" as string]: `${fallDurationMs}ms`,
            ["--confetti-delay" as string]: `${startDelayMs}ms`,
            ["--confetti-drift" as string]: driftPx,
            ["--confetti-sway" as string]: swayPx,
            ["--confetti-rotate" as string]: spinDeg,
            ["--confetti-radius" as string]: pieceRadius,
          } as CSSProperties,
        };
      }),
    [],
  );

  useEffect(() => {
    if (!hasHydrated || !hasStarted || step === "full") {
      return;
    }

    const timeout = window.setTimeout(() => {
      const index = stepIndex(step);
      const next = STAGE_STEPS[Math.min(index + 1, STAGE_STEPS.length - 1)] as StageStep;
      setStep(next);
    }, STEP_DURATION_MS[step]);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [hasHydrated, hasStarted, step]);

  const celebrationOn = step === "celebration" || step === "full";

  if (!hasHydrated) {
    return <StageEmptyState title="Preparando vista de escenario..." />;
  }

  if (!session) {
    return (
      <StageEmptyState
        title="Sesion de escenario no encontrada"
        description="Genera un ranking en la pantalla principal y abre la vista de escenario."
        showBackLink
      />
    );
  }

  return (
    <StageShell>
      <header className="relative z-10 mx-auto text-center animate-fade-in motion-reduce:animate-none">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200/90">{session.title}</p>
        <h1 className="mt-2 inline-flex items-center gap-3 font-[var(--font-sora)] text-[clamp(1.9rem,2.8vw,3.2rem)] leading-[1.02] text-white">
          <Award aria-hidden="true" size={32} strokeWidth={2.2} className="text-amber-200" />
          <span>Podio de resultados</span>
        </h1>
      </header>

      <section className="relative z-10 grid min-h-[62vh] content-center place-items-center gap-5 py-2">
        {step === "intro" ? (
          <div className="w-[min(860px,95vw)] animate-zoom-in rounded-[1.8rem] border border-blue-200/35 bg-gradient-to-br from-blue-950/92 via-blue-900/90 to-blue-950/92 px-8 py-8 text-center shadow-[0_28px_62px_rgba(2,8,26,0.48)] motion-reduce:animate-none">
            <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-blue-200">
              <Sparkles aria-hidden="true" size={16} strokeWidth={2.35} />
              <span>Resultados listos</span>
            </p>
            <h2 className="mt-2 font-[var(--font-sora)] text-[clamp(1.55rem,2.9vw,2.7rem)] leading-tight text-white">
              {ranking.length} participantes evaluados
            </h2>
            <span className="mt-2 block text-base text-blue-100/90">Cuando estes listo, lanza la presentacion del podio.</span>
            <button
              type="button"
              className={`${ACTION_BUTTON_CLASS} mt-5 inline-flex items-center gap-2 px-6 py-2.5 text-base`}
              onClick={() => {
                setHasStarted(true);
                setStep("bronze");
              }}
            >
              <Play aria-hidden="true" size={16} strokeWidth={2.35} />
              <span>Mostrar podio</span>
            </button>
          </div>
        ) : null}

        <div className={`relative mx-auto ${STAGE_CONTENT_WIDTH_CLASS} overflow-visible pt-8 md:pt-9`}>
          <div className={`relative z-20 ${PODIUM_GRID_LAYOUT}`} aria-hidden="true">
              {silver ? (
                <p
                  style={nameAnimationStyle(step, "silver")}
                  className={`m-0 pb-3 text-center font-[var(--font-sora)] text-[clamp(1.15rem,2.15vw,2.25rem)] font-bold leading-tight text-white drop-shadow-[0_0_10px_rgba(190,220,255,0.64)] transition-all duration-500 ease-out motion-reduce:transition-none ${NAME_STYLE.silver} ${nameClassName(step, "silver")}`}
                >
                  {silver.participant}
                </p>
              ) : null}

              {gold ? (
                <p
                  style={nameAnimationStyle(step, "gold")}
                  className={`m-0 pb-3 text-center font-[var(--font-sora)] text-[clamp(1.15rem,2.15vw,2.25rem)] font-bold leading-tight text-white drop-shadow-[0_0_10px_rgba(190,220,255,0.64)] transition-all duration-500 ease-out motion-reduce:transition-none ${NAME_STYLE.gold} ${nameClassName(step, "gold")}`}
                >
                  {gold.participant}
                </p>
              ) : null}

              {bronze ? (
                <p
                  style={nameAnimationStyle(step, "bronze")}
                  className={`m-0 pb-3 text-center font-[var(--font-sora)] text-[clamp(1.15rem,2.15vw,2.25rem)] font-bold leading-tight text-white drop-shadow-[0_0_10px_rgba(190,220,255,0.64)] transition-all duration-500 ease-out motion-reduce:transition-none ${NAME_STYLE.bronze} ${nameClassName(step, "bronze")}`}
                >
                  {bronze.participant}
                </p>
              ) : null}
            </div>

          <div
            className={`pointer-events-none absolute left-1/2 top-[-5.4rem] z-0 h-[min(30rem,58vw)] w-[min(30rem,58vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,234,153,0.62)_0%,rgba(255,234,153,0.18)_38%,rgba(255,234,153,0.06)_58%,transparent_74%)] transition-all duration-500 ease-out motion-reduce:transition-none ${
              winnerSpotlightOn
                ? "scale-100 opacity-100 animate-pulsing motion-reduce:animate-none"
                : "scale-75 opacity-0"
            }`}
            aria-hidden="true"
          />

          <div className={`relative z-10 mt-1 ${PODIUM_GRID_LAYOUT}`}>
              {silver ? (
                <article
                  className={`relative w-full rounded-t-[1.45rem] border border-blue-100/30 px-4 pb-6 pt-4 text-center shadow-[0_26px_42px_rgba(2,8,26,0.46)] backdrop-blur-[2px] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${PODIUM_CARD_STYLE.silver} ${cardClassName(step, "silver")}`}
                  aria-label={`Segundo lugar ${silver.participant}`}
                >
                  <p
                    className={`relative left-1/2 grid h-16 w-16 -translate-x-1/2 place-items-center rounded-[1.25rem] font-[var(--font-sora)] text-3xl font-black tabular-nums text-white shadow-[0_10px_18px_rgba(0,0,0,0.3)] ${MEDAL_STYLE.silver}`}
                  >
                    2
                  </p>
                  <p className="mt-3 text-sm uppercase tracking-[0.12em] text-blue-100/85">{silver.company}</p>
                  <strong className="mt-2 block text-[clamp(1.2rem,1.8vw,1.8rem)] font-black text-white">
                    {scoreFormatter.format(silver.totalScore)} pts
                  </strong>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-blue-100/85">
                    Tiempo: {formatCompletionTime(silver.completionTimeMs)}
                  </p>
                </article>
              ) : null}

              {gold ? (
                <article
                  className={`relative z-20 w-full rounded-t-[1.45rem] border border-blue-100/30 px-4 pb-7 pt-4 text-center shadow-[0_30px_48px_rgba(2,8,26,0.52)] backdrop-blur-[2px] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${PODIUM_CARD_STYLE.gold} ${cardClassName(step, "gold")}`}
                  aria-label={`Primer lugar ${gold.participant}`}
                >
                  <p
                    className={`relative left-1/2 grid h-16 w-16 -translate-x-1/2 place-items-center rounded-[1.25rem] font-[var(--font-sora)] text-3xl font-black tabular-nums text-white shadow-[0_10px_18px_rgba(0,0,0,0.3)] ${MEDAL_STYLE.gold}`}
                  >
                    1
                  </p>
                  <p className="mt-4 text-sm uppercase tracking-[0.12em] text-blue-100/90">{gold.company}</p>
                  <strong className="mt-2 block text-[clamp(1.25rem,2vw,1.95rem)] font-black text-white">
                    {scoreFormatter.format(gold.totalScore)} pts
                  </strong>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-blue-100/90">
                    Tiempo: {formatCompletionTime(gold.completionTimeMs)}
                  </p>
                </article>
              ) : null}

              {bronze ? (
                <article
                  className={`relative w-full rounded-t-[1.45rem] border border-blue-100/30 px-4 pb-6 pt-4 text-center shadow-[0_24px_38px_rgba(2,8,26,0.44)] backdrop-blur-[2px] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${PODIUM_CARD_STYLE.bronze} ${cardClassName(step, "bronze")}`}
                  aria-label={`Tercer lugar ${bronze.participant}`}
                >
                  <p
                    className={`relative left-1/2 grid h-16 w-16 -translate-x-1/2 place-items-center rounded-[1.25rem] font-[var(--font-sora)] text-3xl font-black tabular-nums text-white shadow-[0_10px_18px_rgba(0,0,0,0.3)] ${MEDAL_STYLE.bronze}`}
                  >
                    3
                  </p>
                  <p className="mt-3 text-sm uppercase tracking-[0.12em] text-blue-100/85">{bronze.company}</p>
                  <strong className="mt-2 block text-[clamp(1.15rem,1.75vw,1.7rem)] font-black text-white">
                    {scoreFormatter.format(bronze.totalScore)} pts
                  </strong>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-blue-100/85">
                    Tiempo: {formatCompletionTime(bronze.completionTimeMs)}
                  </p>
                </article>
              ) : null}
            </div>

          <div
            className={`stage-confetti-layer ${celebrationOn ? "stage-confetti-layer--active" : ""}`}
            aria-hidden="true"
          >
            {confettiPieces.map((piece) => (
              <span key={`confetti-${piece.id}`} className="stage-confetti-piece" style={piece.style} />
            ))}
          </div>
        </div>

        {step !== "intro" && runnersUp.length > 0 ? (
          <section
            className={`${STAGE_CONTENT_WIDTH_CLASS} rounded-2xl border border-blue-200/30 bg-blue-950/84 p-4 shadow-[0_16px_30px_rgba(2,9,26,0.42)] transition-all duration-700 ease-out motion-reduce:transition-none ${
              step === "celebration"
                ? "animate-fade-in-up [animation-duration:760ms] [animation-delay:760ms] [animation-fill-mode:both]"
                : celebrationOn
                  ? "translate-y-0 scale-100 opacity-100"
                  : "pointer-events-none translate-y-5 scale-[0.985] opacity-0"
            }`}
          >
            <h2 className="inline-flex w-full items-center justify-center gap-2 text-center font-[var(--font-sora)] text-lg">
              <UsersRound aria-hidden="true" size={18} strokeWidth={2.3} className="text-blue-100" />
              <span>Runners-up</span>
            </h2>
            <ol className="mt-3 grid list-none gap-2 p-0 md:grid-cols-2 xl:grid-cols-3">
              {runnersUp.map((entry) => (
                <li
                  key={`runner-${entry.rank}-${entry.participant}`}
                  className="rounded-xl border border-blue-200/25 bg-blue-900/65 px-3 py-2"
                >
                  <span className="mx-auto inline-flex min-w-10 items-center justify-center rounded-full bg-blue-800/70 px-2 text-xs font-semibold tabular-nums uppercase tracking-[0.08em] text-blue-100">
                    #{entry.rank}
                  </span>
                  <strong className="mt-1 block text-center text-base text-white">{entry.participant}</strong>
                  <em className="mt-0.5 block text-center text-sm not-italic text-blue-100/90">
                    {scoreFormatter.format(entry.totalScore)} pts
                  </em>
                  <span className="mt-1 block text-center text-xs font-semibold uppercase tracking-[0.08em] text-blue-100/80">
                    Tiempo: {formatCompletionTime(entry.completionTimeMs)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </section>

      {step === "full" ? (
        <section className={`relative z-10 mx-auto ${STAGE_CONTENT_WIDTH_CLASS} animate-blurred-fade-in rounded-3xl border border-blue-200/30 bg-blue-950/86 p-4 shadow-[0_24px_42px_rgba(2,8,22,0.48)] motion-reduce:animate-none`}>
          <h2 className="inline-flex items-center gap-2 font-[var(--font-sora)] text-2xl text-white">
            <ListOrdered aria-hidden="true" size={24} strokeWidth={2.2} className="text-blue-100" />
            <span>Ranking completo</span>
          </h2>
          <div className="mt-3 max-h-[50vh] overflow-auto rounded-2xl border border-blue-200/30 bg-blue-950/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <table className="min-w-[700px] w-full border-separate border-spacing-0">
              <thead>
                <tr className="sticky top-0 z-20 bg-gradient-to-r from-[#173f9f]/98 via-[#255fd4]/97 to-[#1386b7]/96 text-xs font-bold uppercase tracking-[0.12em] text-white [box-shadow:inset_0_-1px_0_rgba(255,255,255,0.22),0_8px_18px_rgba(3,10,30,0.35)] backdrop-blur-[2px]">
                  <th className="w-[6.5rem] px-3 py-3 text-center font-bold !text-white [text-shadow:0_1px_0_rgba(2,8,20,0.68)]">
                    Rank
                  </th>
                  <th className="px-3 py-3 text-center font-bold !text-white [text-shadow:0_1px_0_rgba(2,8,20,0.68)]">
                    Participante
                  </th>
                  <th className="px-3 py-3 text-center font-bold !text-white [text-shadow:0_1px_0_rgba(2,8,20,0.68)]">
                    Empresa
                  </th>
                  <th className="px-3 py-3 text-center font-bold !text-white [text-shadow:0_1px_0_rgba(2,8,20,0.68)]">
                    Score
                  </th>
                  <th className="px-3 py-3 text-center font-bold !text-white [text-shadow:0_1px_0_rgba(2,8,20,0.68)]">
                    Tiempo
                  </th>
                </tr>
              </thead>
              <tbody className="text-[0.97rem] text-slate-50">
                {ranking.map((entry) => (
                  <tr
                    key={`${entry.rank}-${entry.participant}-${entry.company}`}
                    className="border-b border-blue-200/14 odd:bg-blue-900/30 even:bg-blue-900/16 last:border-b-0"
                  >
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-white">#{entry.rank}</td>
                    <td className="px-3 py-2.5 text-center font-medium text-blue-50">{entry.participant}</td>
                    <td className="px-3 py-2.5 text-center font-medium text-blue-100">{entry.company}</td>
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-white">
                      {scoreFormatter.format(entry.totalScore)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-blue-100">
                      {formatCompletionTime(entry.completionTimeMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <style jsx global>{`
        .stage-confetti-layer {
          position: absolute;
          inset-inline: -1.5rem;
          top: -4.4rem;
          height: 34rem;
          overflow: hidden;
          pointer-events: none;
          z-index: 30;
          opacity: 0;
          transform: translate3d(0, 10px, 0);
          transition: opacity 560ms ease, transform 560ms ease;
          will-change: opacity, transform;
        }

        .stage-confetti-layer--active {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }

        .stage-confetti-piece {
          position: absolute;
          left: var(--confetti-left, 50%);
          top: var(--confetti-start-y, -8%);
          width: var(--confetti-width, 8px);
          height: var(--confetti-height, 16px);
          border-radius: var(--confetti-radius, 2px);
          background: var(--confetti-color, #f97316);
          opacity: 0.9;
          box-shadow: 0 3px 8px rgba(6, 10, 22, 0.42);
          animation: stage-confetti-fall var(--confetti-duration, 4000ms) linear infinite;
          animation-delay: var(--confetti-delay, 0ms);
          animation-play-state: paused;
          will-change: transform, opacity;
        }

        .stage-confetti-layer--active .stage-confetti-piece {
          animation-play-state: running;
        }

        @keyframes stage-confetti-fall {
          0% {
            opacity: 0;
            transform: translate3d(0, -40px, 0) rotate(0deg);
          }

          8% {
            opacity: 0.96;
          }

          26% {
            transform: translate3d(calc(var(--confetti-drift, 16px) * 0.35), 150px, 0)
              rotate(calc(var(--confetti-rotate, 420deg) * 0.28));
          }

          42% {
            transform: translate3d(calc(var(--confetti-sway, 18px) * -1), 250px, 0)
              rotate(calc(var(--confetti-rotate, 420deg) * 0.48));
          }

          54% {
            transform: translate3d(calc(var(--confetti-drift, 16px) * -0.24), 330px, 0)
              rotate(calc(var(--confetti-rotate, 420deg) * 0.62));
          }

          78% {
            transform: translate3d(calc(var(--confetti-sway, 18px) * 0.7), 500px, 0)
              rotate(calc(var(--confetti-rotate, 420deg) * 0.84));
          }

          100% {
            opacity: 0.88;
            transform: translate3d(var(--confetti-drift, 16px), 620px, 0)
              rotate(var(--confetti-rotate, 420deg));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .stage-confetti-piece {
            animation: none !important;
          }
        }
      `}</style>
    </StageShell>
  );
}

export default function StagePage() {
  return (
    <Suspense
      fallback={<StageEmptyState title="Preparando vista de escenario..." />}
    >
      <StagePresentation />
    </Suspense>
  );
}
