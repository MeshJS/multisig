import { useRef, useState, useEffect } from "react";

export type CarouselProps = {
  slides: React.ReactNode[];
};

export function Carousel({ slides }: CarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const manualOverrideRef = useRef(false);

  // Scroll to the current slide when currentSlide changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const slideWidth = container.clientWidth;
      container.scrollTo({ left: currentSlide * slideWidth, behavior: "smooth" });
    }
  }, [currentSlide]);

  const scrollToIndex = (index: number) => {
    manualOverrideRef.current = true;
    const container = scrollContainerRef.current;
    if (container) {
      const slideWidth = container.clientWidth;
      container.scrollTo({ left: index * slideWidth, behavior: "smooth" });
      setCurrentSlide(index);
      setTimeout(() => { manualOverrideRef.current = false; }, 500);
    }
  };

  if (!slides || slides.length === 0) return null;

  return (
    <div className="w-full flex flex-col items-center overflow-hidden">
      <div className="relative w-full overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="flex overflow-x-auto overflow-hidden scroll-smooth snap-x snap-mandatory w-full no-scrollbar"
          style={{ scrollbarWidth: "none" }}
          onScroll={() => {
            if (!manualOverrideRef.current && scrollContainerRef.current) {
              const scrollLeft = scrollContainerRef.current.scrollLeft;
              const width = scrollContainerRef.current.clientWidth;
              const newIndex = Math.round(scrollLeft / width);
              setCurrentSlide(newIndex);
            }
          }}
        >
          {slides.map((slide, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 snap-start px-2 w-full flex justify-center items-center"
              style={{ width: "100%" }}
            >
              <div className="flex justify-center items-center w-full h-full">{slide}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Navigation wedges */}
      <div className="relative w-full">
        <button
          onClick={() =>
            scrollToIndex((currentSlide - 1 + slides.length) % slides.length)
          }
          className="absolute left-0 top-1/2 transform -translate-y-1/2 p-4 text-4xl text-white bg-transparent"
          aria-label="Previous Slide"
          type="button"
        >
          ‹
        </button>
        <button
          onClick={() => scrollToIndex((currentSlide + 1) % slides.length)}
          className="absolute right-0 top-1/2 transform -translate-y-1/2 p-4 text-4xl text-white bg-transparent"
          aria-label="Next Slide"
          type="button"
        >
          ›
        </button>
      </div>
      {/* Navigation dots */}
      <div className="flex space-x-2 mt-2">
        {slides.map((_, idx) => (
          <button
            key={idx}
            className={`w-2 h-2 rounded-full ${
              currentSlide === idx ? "bg-blue-500" : "bg-gray-300"
            } focus:outline-none`}
            onClick={() => scrollToIndex(idx)}
            aria-label={`Go to slide ${idx + 1}`}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}