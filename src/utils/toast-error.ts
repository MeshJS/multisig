import { toast } from "@/hooks/use-toast";
import { getFriendlyError } from "@/utils/errors";

/**
 * Show a destructive toast with a normalized, human-readable message for any
 * caught error. Use in catch blocks instead of dumping raw error strings.
 */
export function toastError(error: unknown, title = "Something went wrong") {
  toast({
    title,
    description: getFriendlyError(error),
    variant: "destructive",
  });
}
