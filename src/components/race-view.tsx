import { useEffect, useRef, useState, type RefObject } from "react";
import { Flag, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  createEngine,
  formatTime,
  type Engine,
  type EngineHooks,
  type FinishPayload,
  type Hud,
  type Phase,
} from "@/game/engine";

const emptyHud = (): Hud => ({
  speed: null,
  lap: null,
  time: null,
  best: null,
  place: null,
  drift: null,
  banner: null,
  boost: null,
  rows: [null, null, null, null],
  map: null,
});

export function RaceView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<Hud>(emptyHud());
  const hooksRef = useRef<EngineHooks>({
    onPhase: () => {},
    onRecord: () => {},
  });
  const engineRef = useRef<Engine | null>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const [result, setResult] = useState<FinishPayload | null>(null);
  const [bestLap, setBestLap] = useState<number | null>(null);
  const [bestRace, setBestRace] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  hooksRef.current = {
    onPhase: (next, payload) => {
      setPhase(next);
      if (payload) setResult(payload);
    },
    onRecord: (save) => {
      setBestLap(save.bestLap);
      setBestRace(save.bestRace);
      setVolume(save.volume);
    },
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const engine = createEngine(canvas, hudRef, hooksRef);
      engineRef.current = engine;
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err) {
      setBootError(err instanceof Error ? err.message : "Não foi possível abrir a pista.");
    }
  }, []);

  const racing = phase === "race" || phase === "paused";

  return (
    <main className="relative h-dvh w-full touch-none overflow-hidden bg-bg text-fg select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <div
        ref={(el) => {
          hudRef.current.boost = el;
        }}
        className="boost-wash pointer-events-none absolute inset-0 opacity-0"
      />

      <div className={racing ? "pointer-events-none absolute inset-0 z-10" : "pointer-events-none invisible absolute inset-0"}>
        <header className="flex items-start justify-between gap-3 p-3 sm:p-5">
          <div className="min-w-0">
            <p className="font-display text-4xl leading-none tracking-wide text-primary tabular-nums sm:text-5xl">
              <span
                ref={(el) => {
                  hudRef.current.place = el;
                }}
              >
                1º
              </span>
            </p>
            <ul className="mt-2 space-y-0.5">
              {[0, 1, 2, 3].map((i) => (
                <li
                  key={i}
                  ref={(el) => {
                    hudRef.current.rows[i] = el;
                  }}
                  className="font-display text-sm tracking-wide text-muted"
                />
              ))}
            </ul>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <p className="text-xs tracking-[0.18em] text-muted uppercase">Volta</p>
            <p
              ref={(el) => {
                hudRef.current.lap = el;
              }}
              className="font-display text-2xl leading-none tabular-nums"
            >
              1/3
            </p>
            <p
              ref={(el) => {
                hudRef.current.time = el;
              }}
              className="mt-1 font-display text-lg tabular-nums"
            >
              0:00.00
            </p>
            <p className="text-xs text-muted">
              melhor{" "}
              <span
                ref={(el) => {
                  hudRef.current.best = el;
                }}
                className="tabular-nums text-fg"
              >
                —
              </span>
            </p>
            <canvas
              ref={(el) => {
                hudRef.current.map = el;
              }}
              width={256}
              height={256}
              className="mt-2 size-24 rounded-md border border-line sm:size-32"
            />
          </div>
        </header>

        <p
          ref={(el) => {
            hudRef.current.banner = el;
          }}
          className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 font-display text-3xl tracking-[0.14em] text-primary opacity-0 sm:top-28"
        />

        <div className="speed-readout absolute left-1/2 flex -translate-x-1/2 flex-col items-center">
          <div className="mb-2 h-1.5 w-40 overflow-hidden rounded-full bg-line sm:w-52">
            <div
              ref={(el) => {
                hudRef.current.drift = el;
              }}
              className="h-full w-full origin-left bg-primary"
              style={{ transform: "scaleX(0)" }}
            />
          </div>
          <p className="text-[0.65rem] tracking-[0.22em] text-muted uppercase">Turbo</p>
          <p className="font-display text-6xl leading-none tabular-nums sm:text-7xl">
            <span
              ref={(el) => {
                hudRef.current.speed = el;
              }}
            >
              0
            </span>
          </p>
          <p className="text-xs tracking-[0.2em] text-muted">KM/H</p>
        </div>

        <button
          type="button"
          className="pointer-events-auto absolute top-3 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface/80 text-fg"
          aria-label={muted ? "Ativar som" : "Silenciar"}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            engineRef.current?.setMuted(next);
          }}
        >
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
      </div>

      <div className={`touch-dock absolute inset-x-0 bottom-0 z-20 gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${phase === "race" ? "" : "!hidden"}`}>
        <div className="flex flex-1 gap-2">
          <Touch label="Esquerda" code="KeyA" engineRef={engineRef} />
          <Touch label="Direita" code="KeyD" engineRef={engineRef} />
        </div>
        <div className="flex flex-1 justify-end gap-2">
          <Touch label="Freio" code="KeyS" engineRef={engineRef} />
          <Touch label="Drift" code="ShiftLeft" engineRef={engineRef} />
          <Touch label="Acelera" code="KeyW" engineRef={engineRef} accent />
        </div>
      </div>

      {phase === "menu" && (
        <div className="absolute inset-0 z-30 flex items-end p-4 sm:items-center sm:p-10">
          <section className="w-full max-w-md rounded-lg border border-line bg-surface/85 p-5 shadow-lg backdrop-blur-md sm:p-7">
            <p className="text-xs tracking-[0.28em] text-primary uppercase">Circuito da Serra</p>
            <h1 className="font-display text-6xl leading-none tracking-wide text-balance sm:text-7xl">Vértice</h1>
            <p className="mt-3 max-w-sm text-pretty text-muted">
              Três voltas, três rivais, de noite. Segure o drift na curva e solte na saída — o turbo paga o risco.
            </p>
            <button
              type="button"
              className="mt-5 flex h-12 w-full items-center justify-center rounded-md bg-primary font-display text-xl tracking-[0.18em] text-bg"
              onClick={() => engineRef.current?.start()}
            >
              Start
            </button>
            <ul className="mt-4 space-y-1 text-sm text-muted">
              <li>W acelera · S freia · A e D viram</li>
              <li>Shift ou Espaço segura o drift</li>
              <li>R resgata · C troca a câmera · Esc pausa</li>
            </ul>
            <div className="mt-4 flex items-center gap-3 text-sm">
              <label className="flex flex-1 items-center gap-3">
                <span className="text-muted">Volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  aria-label="Volume"
                  className="w-full"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    engineRef.current?.setVolume(v);
                  }}
                />
              </label>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-md border border-line"
                aria-label={muted ? "Ativar som" : "Silenciar"}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  engineRef.current?.setMuted(next);
                }}
              >
                {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted">
              <Flag className="size-4 text-primary" />
              Melhor volta {formatTime(bestLap)}
              {bestRace != null ? ` · corrida ${formatTime(bestRace)}` : ""}
            </p>
            {bootError && <p className="mt-3 text-sm text-clay">{bootError}</p>}
          </section>
        </div>
      )}

      {phase === "paused" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/45 p-4">
          <section className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 text-center">
            <h2 className="font-display text-4xl tracking-wide">Pausado</h2>
            <p className="mt-1 text-sm text-muted">A serra espera.</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                className="h-12 rounded-md bg-primary font-display text-lg tracking-wide text-bg"
                onClick={() => engineRef.current?.resume()}
              >
                Continuar
              </button>
              <button
                type="button"
                className="h-12 rounded-md border border-line font-display text-lg tracking-wide"
                onClick={() => engineRef.current?.restart()}
              >
                Reiniciar
              </button>
              <button
                type="button"
                className="h-12 rounded-md text-muted"
                onClick={() => engineRef.current?.toMenu()}
              >
                Menu
              </button>
            </div>
          </section>
        </div>
      )}

      {phase === "finish" && result && (
        <div className="absolute inset-0 z-30 flex items-end justify-center p-4 sm:items-center">
          <section className="max-h-[86dvh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface/92 p-6 backdrop-blur-md">
            <p className="text-xs tracking-[0.22em] text-primary uppercase">{result.place}º lugar</p>
            <h2 className="font-display text-4xl tracking-wide text-balance">
              {result.place === 1 ? "A serra ficou para trás." : "Bandeirada."}
            </h2>
            <p className="mt-1 text-muted tabular-nums">Tempo {formatTime(result.raceTime)}</p>
            <ol className="mt-4 space-y-1">
              {result.standings.map((row, i) => (
                <li key={row.name} className={row.you ? "font-display text-lg text-primary" : "font-display text-lg text-muted"}>
                  {i + 1} {row.name}
                </li>
              ))}
            </ol>
            <ul className="mt-4 space-y-1 text-sm text-muted tabular-nums">
              {result.lapTimes.map((t, i) => (
                <li key={i}>
                  Volta {i + 1} · {formatTime(t)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              Recorde da volta {formatTime(result.bestLap)}
              {result.bestRace != null ? ` · corrida ${formatTime(result.bestRace)}` : ""}
            </p>
            <button
              type="button"
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary font-display text-lg tracking-wide text-bg"
              onClick={() => engineRef.current?.restart()}
            >
              <RotateCcw className="size-4" />
              Correr de novo
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function Touch({
  label,
  code,
  accent,
  engineRef,
}: {
  label: string;
  code: string;
  accent?: boolean;
  engineRef: RefObject<Engine | null>;
}) {
  return (
    <button
      type="button"
      className={
        accent
          ? "h-14 min-w-16 flex-1 rounded-md bg-primary font-display text-sm tracking-wide text-bg"
          : "h-14 min-w-16 flex-1 rounded-md border border-line bg-surface/80 font-display text-sm tracking-wide text-fg"
      }
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        engineRef.current?.hold(code, true);
      }}
      onPointerUp={() => engineRef.current?.hold(code, false)}
      onPointerCancel={() => engineRef.current?.hold(code, false)}
    >
      {label}
    </button>
  );
}
