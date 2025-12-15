import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import UpdateDRep from "./updateDrep";
import { Minus } from "lucide-react";

interface UpdateDrepModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UpdateDrepModal({
  open,
  onOpenChange,
}: UpdateDrepModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Minus className="h-5 w-5" />
            <span>Update DRep</span>
          </DialogTitle>
        </DialogHeader>
        <UpdateDRep onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

