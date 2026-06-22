import React from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";

interface PaginationProps {
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>; // ✅ Explicitly defined
  pageSize: number;
  setPageSize: (size: number) => void;
  order: "asc" | "desc";
  setOrder: (order: "asc" | "desc") => void;
  defaultPageSize?: number;
  maxPageSize?: number;
  stepSize?: number;
  onLastPage: boolean;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  order,
  setOrder,
  // defaultPageSize is intentionally accepted (call-site compat) but unused.
  defaultPageSize = 25,
  maxPageSize = 100,
  stepSize = 25,
  onLastPage,
}) => {
  const pageSizeOptions = Array.from(
    { length: maxPageSize / stepSize },
    (_, i) => (i + 1) * stepSize,
  ).filter((size) => size <= maxPageSize);

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm">
      {/* Sort order */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
        aria-label={order === "asc" ? "Sort ascending" : "Sort descending"}
        className="gap-1.5"
      >
        {order === "asc" ? (
          <ArrowUp className="h-4 w-4" />
        ) : (
          <ArrowDown className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {order === "asc" ? "Ascending" : "Descending"}
        </span>
      </Button>

      {/* Page size */}
      <Select
        value={String(pageSize)}
        onValueChange={(value) => {
          setPageSize(Number(value));
          setCurrentPage(1); // Reset to first page when page size changes
        }}
      >
        <SelectTrigger className="h-9 w-[110px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pageSizeOptions.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size} / page
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Navigation */}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          disabled={currentPage === 1}
          aria-label="Previous page"
          onClick={() => setCurrentPage((prev: number) => Math.max(prev - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <span className="px-1 tabular-nums text-muted-foreground">
          Page {currentPage}
        </span>

        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          disabled={onLastPage}
          aria-label="Next page"
          onClick={() => setCurrentPage((prev: number) => prev + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default Pagination;
