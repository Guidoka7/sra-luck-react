import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import "@/styles/home-campaign-carousel.css";
import { HomeCampaignSlide } from "./HomeCampaignSlide";
import {
  HOME_CAMPAIGN_SLIDES,
  resolveHomeCampaignSlides,
  type HomeCampaignSlideConfig,
  type ResolvedHomeCampaignSlide,
} from "./homeCampaigns";

interface HomeCampaignCarouselProps {
  slides?: HomeCampaignSlideConfig[];
  autoplayMs?: number;
  onAction: (slide: ResolvedHomeCampaignSlide) => void;
}

const INTERACTION_PAUSE_MS = 7000;
const LOOP_SETTLE_MS = 110;

function slideImage(slide: ResolvedHomeCampaignSlide) {
  return slide.mobileImage ?? slide.desktopImage ?? slide.backgroundImage ?? null;
}

function prefersReducedMotionNow() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function HomeCampaignCarousel({
  slides = HOME_CAMPAIGN_SLIDES,
  autoplayMs = 6000,
  onAction,
}: HomeCampaignCarouselProps) {
  const activeSlides = useMemo(() => resolveHomeCampaignSlides(slides), [slides]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const dragPointerRef = useRef<number | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const dragMovedRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoplayPaused, setAutoplayPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotionNow);

  const loopedSlides = useMemo(() => {
    if (activeSlides.length <= 1) return activeSlides;
    return [activeSlides[activeSlides.length - 1], ...activeSlides, activeSlides[0]];
  }, [activeSlides]);

  const getNearestVisualIndex = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return activeSlides.length > 1 ? activeIndex + 1 : activeIndex;
    const children = Array.from(scroller.children) as HTMLElement[];
    if (children.length === 0) return 0;

    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < children.length; index += 1) {
      const currentDistance = Math.abs(scroller.scrollLeft - children[index].offsetLeft);
      if (currentDistance < distance) {
        distance = currentDistance;
        nearest = index;
      }
    }
    return nearest;
  }, [activeIndex, activeSlides.length]);

  const logicalIndexFromVisual = useCallback((visualIndex: number) => {
    if (activeSlides.length <= 1) return 0;
    if (visualIndex === 0) return activeSlides.length - 1;
    if (visualIndex === activeSlides.length + 1) return 0;
    return Math.max(0, Math.min(activeSlides.length - 1, visualIndex - 1));
  }, [activeSlides.length]);

  const scrollToVisualIndex = useCallback((visualIndex: number, behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = scroller.children.item(visualIndex) as HTMLElement | null;
    if (!target) return;

    if (behavior === "auto" || reducedMotion) {
      scroller.scrollLeft = target.offsetLeft;
      return;
    }
    scroller.scrollTo({ left: target.offsetLeft, behavior });
  }, [reducedMotion]);

  const normalizeLoopPosition = useCallback(() => {
    if (activeSlides.length <= 1) return;
    const visualIndex = getNearestVisualIndex();
    if (visualIndex === 0) {
      scrollToVisualIndex(activeSlides.length, "auto");
    } else if (visualIndex === activeSlides.length + 1) {
      scrollToVisualIndex(1, "auto");
    }
  }, [activeSlides.length, getNearestVisualIndex, scrollToVisualIndex]);

  const pauseAutoplayTemporarily = useCallback(() => {
    setAutoplayPaused(true);
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      setAutoplayPaused(false);
    }, INTERACTION_PAUSE_MS);
  }, []);

  const goToLogicalIndex = useCallback((logicalIndex: number, fromUser = true) => {
    if (activeSlides.length === 0) return;
    if (fromUser) pauseAutoplayTemporarily();
    const normalized = ((logicalIndex % activeSlides.length) + activeSlides.length) % activeSlides.length;
    scrollToVisualIndex(activeSlides.length > 1 ? normalized + 1 : normalized, "smooth");
  }, [activeSlides.length, pauseAutoplayTemporarily, scrollToVisualIndex]);

  const goRelative = useCallback((delta: number, fromUser = true) => {
    if (activeSlides.length <= 1) return;
    if (fromUser) pauseAutoplayTemporarily();

    let visualIndex = getNearestVisualIndex();
    if (visualIndex === 0) visualIndex = activeSlides.length;
    if (visualIndex === activeSlides.length + 1) visualIndex = 1;
    const target = Math.max(0, Math.min(activeSlides.length + 1, visualIndex + delta));
    scrollToVisualIndex(target, "smooth");
  }, [activeSlides.length, getNearestVisualIndex, pauseAutoplayTemporarily, scrollToVisualIndex]);

  useEffect(() => {
    if (activeSlides.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToVisualIndex(activeSlides.length > 1 ? 1 : 0, "auto");
      setActiveIndex(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSlides, scrollToVisualIndex]);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (activeSlides.length <= 1 || autoplayPaused || !pageVisible || reducedMotion) return;
    const timer = window.setTimeout(() => goRelative(1, false), Math.max(5000, autoplayMs));
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeSlides.length, autoplayMs, autoplayPaused, goRelative, pageVisible, reducedMotion]);

  useEffect(() => {
    const onResize = () => {
      scrollToVisualIndex(activeSlides.length > 1 ? activeIndex + 1 : activeIndex, "auto");
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [activeIndex, activeSlides.length, scrollToVisualIndex]);

  useEffect(() => {
    if (activeSlides.length === 0) return;
    const nextIndex = (activeIndex + 1) % activeSlides.length;
    const nextSource = slideImage(activeSlides[nextIndex]);
    if (!nextSource) return;

    const timer = window.setTimeout(() => {
      const image = new Image();
      image.decoding = "async";
      image.src = nextSource;
    }, 900);
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeSlides]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
  }, []);

  const handleScroll = useCallback(() => {
    if (activeSlides.length === 0) return;
    const visualIndex = getNearestVisualIndex();
    const logicalIndex = logicalIndexFromVisual(visualIndex);
    setActiveIndex((current) => current === logicalIndex ? current : logicalIndex);

    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      normalizeLoopPosition();
    }, LOOP_SETTLE_MS);
  }, [activeSlides.length, getNearestVisualIndex, logicalIndexFromVisual, normalizeLoopPosition]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pauseAutoplayTemporarily();
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    dragPointerRef.current = event.pointerId;
    dragStartXRef.current = event.clientX;
    dragStartScrollRef.current = scroller.scrollLeft;
    dragMovedRef.current = false;
    scroller.setPointerCapture(event.pointerId);
    scroller.classList.add("is-dragging");
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller || dragPointerRef.current !== event.pointerId) return;
    const delta = event.clientX - dragStartXRef.current;
    if (Math.abs(delta) > 4) dragMovedRef.current = true;
    scroller.scrollLeft = dragStartScrollRef.current - delta;
    if (dragMovedRef.current) event.preventDefault();
  };

  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller || dragPointerRef.current !== event.pointerId) return;
    if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    dragPointerRef.current = null;
    scroller.classList.remove("is-dragging");
    const nearest = getNearestVisualIndex();
    scrollToVisualIndex(nearest, "smooth");
    window.setTimeout(() => { dragMovedRef.current = false; }, 0);
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goRelative(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goRelative(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goToLogicalIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goToLogicalIndex(activeSlides.length - 1);
    }
  };

  const handleWheel = (_event: WheelEvent<HTMLDivElement>) => {
    pauseAutoplayTemporarily();
  };

  if (activeSlides.length === 0) return null;

  return (
    <section className="sl-campaign-shell" aria-label="Campanhas e destaques Sra. Luck">
      <div className="sl-campaign-viewport">
        <div
          ref={scrollerRef}
          className="sl-campaign-scroller"
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Destaques da sua jornada. Deslize para navegar entre as campanhas."
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onWheel={handleWheel}
          onKeyDown={handleKeyboard}
          onClickCapture={(event) => {
            if (!dragMovedRef.current) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {loopedSlides.map((slide, visualIndex) => {
            const isLeadingClone = activeSlides.length > 1 && visualIndex === 0;
            const isTrailingClone = activeSlides.length > 1 && visualIndex === loopedSlides.length - 1;
            const logicalIndex = logicalIndexFromVisual(visualIndex);
            return (
              <div
                key={`${slide.id}-${visualIndex}`}
                className="sl-campaign-slide-wrap"
                role="group"
                aria-roledescription="slide"
                aria-label={`${logicalIndex + 1} de ${activeSlides.length}`}
                aria-hidden={isLeadingClone || isTrailingClone ? true : undefined}
              >
                <HomeCampaignSlide
                  slide={slide}
                  indexLabel={`${String(logicalIndex + 1).padStart(2, "0")} / ${String(activeSlides.length).padStart(2, "0")}`}
                  priority={!isLeadingClone && !isTrailingClone && logicalIndex === 0}
                  suppressAction={isLeadingClone || isTrailingClone}
                  onAction={onAction}
                />
              </div>
            );
          })}
        </div>
      </div>

      {activeSlides.length > 1 && (
        <div className="sl-campaign-indicators" aria-hidden="true">
          {activeSlides.map((slide, index) => (
            <span
              key={slide.id}
              className={`sl-campaign-indicator ${activeIndex === index ? "is-active" : ""}`}
            >
              <span />
            </span>
          ))}
        </div>
      )}

      <p className="sr-only" aria-live={autoplayPaused ? "polite" : "off"}>
        Destaque {activeIndex + 1} de {activeSlides.length}: {activeSlides[activeIndex]?.title}
      </p>
    </section>
  );
}
