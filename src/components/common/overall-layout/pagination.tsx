import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";

interface PaginationProps {
  currentPage: number;
  setCurrentPage: (page: number) => void;
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
    <div className="flex w-full items-center justify-between border-x border-gray-400 p-4 rounded-md shadow-md">
      {/* Sorting Toggle */}
      <Button 
        onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700"
      >
        {order === "asc" ? <ArrowUp className="h-5 w-5" /> : <ArrowDown className="h-5 w-5" />}
        {order === "asc" ? "Ascending" : "Descending"}
      </Button>

      {/* Page Size Selector */}
      <select
        className="p-2 border rounded bg-gray-900 text-white"
        value={pageSize}
        onChange={(e) => {
          setPageSize(Number(e.target.value));
          setCurrentPage(1); // Reset to first page when page size changes
        }}
      >
        {Array.from({ length: maxPageSize / stepSize }, (_, i) => (i + 1) * stepSize)
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
          onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
          disabled={currentPage === 1}
          className={`flex items-center gap-2 ${currentPage === 1 ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <ChevronLeft className="h-5 w-5" /> Previous
        </Button>

        <span className="text-white">Page {currentPage}</span>

        <Button
          onClick={() => setCurrentPage((prev) => prev + 1)}
          disabled={onLastPage}
          className={`flex items-center gap-2 ${onLastPage ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Next <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default Pagination;