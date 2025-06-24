import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ScrollableTableWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export default function ScrollableTableWrapper({ 
  children, 
  className 
}: ScrollableTableWrapperProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  return (
    <div className={cn("relative", className)}>
      {/* Shadow indicators */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-10 transition-opacity",
          canScrollLeft ? "opacity-100" : "opacity-0"
        )}
      />
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10 transition-opacity",
          canScrollRight ? "opacity-100" : "opacity-0"
        )}
      />
      
      {/* Scrollable container with local overflow override */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="overflow-x-auto -mx-6 px-6"
        style={{
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255, 255, 255, 0.2) transparent",
          // Force override the global overflow-x: hidden
          overflowX: "auto",
          position: "relative",
        }}
      >
        <div className="inline-block min-w-full align-middle">
          {children}
        </div>
      </div>
      
      {/* Custom scrollbar styles */}
      <style jsx>{`
        div::-webkit-scrollbar {
          height: 6px;
        }
        div::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
        }
        div::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        div::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}