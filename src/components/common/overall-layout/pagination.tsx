import React from "react";
import { Button } from "@/components/ui/button";
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
  defaultPageSize = 25,
  maxPageSize = 100,
  stepSize = 25,
  onLastPage,
}) => {
  return (
    <div className="flex w-full items-center justify-between rounded-md border-x border-gray-400 p-4 shadow-md">
      {/* Sorting Toggle */}
      <Button
        onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700"
      >
        {order === "asc" ? (
          <ArrowUp className="h-5 w-5" />
        ) : (
          <ArrowDown className="h-5 w-5" />
        )}
        {order === "asc" ? "Ascending" : "Descending"}
      </Button>

      {/* Page Size Selector */}
      <select
        className="rounded border bg-gray-900 p-2 text-white"
        value={pageSize}
        onChange={(e) => {
          setPageSize(Number(e.target.value));
          setCurrentPage(1); // Reset to first page when page size changes
        }}
      >
        {Array.from(
          { length: maxPageSize / stepSize },
          (_, i) => (i + 1) * stepSize,
        )
          .filter((size) => size <= maxPageSize)
          .map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
      </select>

      {/* Pagination Controls */}
      <div className="flex items-center gap-4">
        <Button
          onClick={() => setCurrentPage((prev: number) => Math.max(prev - 1, 1))} // ✅ Explicitly typed
          disabled={currentPage === 1}
          className={`flex items-center gap-2 ${
            currentPage === 1 ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          <ChevronLeft className="h-5 w-5" /> Previous
        </Button>

        <span className="text-white">Page {currentPage}</span>

        <Button
          onClick={() => setCurrentPage((prev: number) => prev + 1)} // ✅ Explicitly typed
          disabled={onLastPage}
          className={`flex items-center gap-2 ${
            onLastPage ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          Next <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default Pagination;