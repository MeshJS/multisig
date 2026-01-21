import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import RegisterDRep from "./registerDrep";
import { Plus } from "lucide-react";

interface RegisterDrepModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RegisterDrepModal({
  open,
  onOpenChange,
}: RegisterDrepModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            <span>Register DRep</span>
          </DialogTitle>
        </DialogHeader>
        <RegisterDRep onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

