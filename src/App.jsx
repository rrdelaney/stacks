import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";

const SLIDE_DURATION_MS = 20_000;
const PAN_DURATION_MS = 1_200;
const VIEWPORT_ZOOM = 0.9;

// Slides are the rectangles in the drawing; their order follows the arrows
// that connect one slide rectangle to the next.
function orderSlides(elements) {
  const slides = elements.filter((el) => el.type === "rectangle" && !el.isDeleted);
  const slideIds = new Set(slides.map((s) => s.id));
  const next = new Map();
  const hasIncoming = new Set();

  for (const el of elements) {
    if (el.type !== "arrow" || el.isDeleted) continue;
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!slideIds.has(from) || !slideIds.has(to) || from === to) continue;
    next.set(from, to);
    hasIncoming.add(to);
  }

  const byId = new Map(slides.map((s) => [s.id, s]));
  const ordered = [];
  let current = slides.find((s) => !hasIncoming.has(s.id) && next.has(s.id))?.id;
  while (current && !ordered.some((s) => s.id === current)) {
    ordered.push(byId.get(current));
    current = next.get(current);
  }
  // Any slide not reachable via arrows goes on the end, top-to-bottom.
  const rest = slides
    .filter((s) => !ordered.includes(s))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return [...ordered, ...rest];
}

function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function App() {
  const [api, setApi] = useState(null);
  const [scene, setScene] = useState(null);
  const [slides, setSlides] = useState([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(SLIDE_DURATION_MS);
  const [paused, setPaused] = useState(false);
  const deadline = useRef(0);
  const remainingRef = useRef(SLIDE_DURATION_MS);
  remainingRef.current = remaining;
  const hasShown = useRef(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}jj.excalidraw`)
      .then((res) => res.json())
      .then((data) =>
        setScene({
          elements: data.elements,
          files: data.files,
          appState: {
            ...data.appState,
            viewModeEnabled: true,
            zenModeEnabled: true,
          },
        }),
      );
  }, []);

  useEffect(() => {
    if (api && scene) setSlides(orderSlides(api.getSceneElements()));
  }, [api, scene]);

  const next = useCallback(() => {
    if (slides.length) setIndex((i) => (i + 1) % slides.length);
  }, [slides.length]);

  const prev = useCallback(() => {
    if (slides.length) setIndex((i) => (i - 1 + slides.length) % slides.length);
  }, [slides.length]);

  // Pan to the current slide and restart its countdown.
  useEffect(() => {
    const slide = slides[index];
    if (!api || !slide) return;
    const show = (animate) =>
      api.scrollToContent(slide, {
        fitToViewport: true,
        viewportZoomFactor: VIEWPORT_ZOOM,
        animate,
        duration: PAN_DURATION_MS,
      });

    deadline.current = Date.now() + SLIDE_DURATION_MS;
    setRemaining(SLIDE_DURATION_MS);
    // First slide jumps into place; wait a frame so the canvas has its final size.
    const animate = hasShown.current;
    hasShown.current = true;
    const raf = requestAnimationFrame(() => show(animate));
    const onResize = () => show(false);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [api, slides, index]);

  // While paused the countdown is frozen; resuming picks up where it left off.
  useEffect(() => {
    if (!slides.length || paused) return;
    deadline.current = Date.now() + remainingRef.current;
    const tick = setInterval(() => {
      const left = deadline.current - Date.now();
      if (left <= 0) next();
      else setRemaining(left);
    }, 250);
    return () => clearInterval(tick);
  }, [slides.length, next, paused]);

  if (!scene) return null;

  return (
    <>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={scene}
        theme="dark"
        viewModeEnabled
        zenModeEnabled
        UIOptions={{ tools: { image: false } }}
      />
      {slides.length > 0 && (
        <>
          <div className="overlay timer">
            {formatTime(remaining)}
            <span className="count">
              {index + 1}/{slides.length}
            </span>
          </div>
          <div className="overlay controls">
            <button onClick={prev} aria-label="Previous slide">
              ←
            </button>
            <button
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume" : "Pause"}
            >
              {paused ? "▶" : "❚❚"}
            </button>
            <button onClick={next} aria-label="Next slide">
              →
            </button>
          </div>
        </>
      )}
    </>
  );
}
