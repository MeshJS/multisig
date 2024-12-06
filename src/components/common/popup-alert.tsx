import { useSiteStore } from "@/lib/zustand/site";
import { CircleAlert } from "lucide-react";
import { useEffect } from "react";

export const PopupAlert = () => {
  const alert = useSiteStore((state) => state.alert);

  useEffect(() => {
    if (alert) {
      setTimeout(() => {
        useSiteStore.setState({ alert: "" });
      }, 5000);
    }
  }, [alert]);

  return (
    <div className="text-caption-1 fixed bottom-4 right-8 flex flex-col gap-2 break-words text-center">
      {alert && (
        <div className="animate-popup-alert relative flex justify-center gap-2 overflow-hidden rounded-xl border border-zinc-200 bg-accent bg-white px-16 py-8 text-zinc-950 shadow shadow-md shadow-black transition-transform dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          <CircleAlert />
          <div className="flex w-fit items-center justify-center">{alert}</div>
        </div>
      )}
    </div>
  );
};
