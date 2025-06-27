import axios from "axios";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface DialogReportWrapperProps {
  mode: "button" | "menu-item";
  onAction?: () => void;
}

export default function DialogReportWrapper({ 
  mode, 
  onAction 
}: DialogReportWrapperProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [type, setType] = useState<"bug" | "enhancement">("bug");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [loading, setLoading] = useState<boolean>(false);

  async function handleReport() {
    setLoading(true);
    await axios.post("/api/github/create-issue", { title, body, type });
    setSent(true);
    toast({
      title: "Ticket created",
      description: "Your report has been submitted.",
      duration: 5000,
    });
    setLoading(false);
    resetForm();
    setOpen(false);
    
    // Call the optional callback after action completes
    if (onAction) {
      onAction();
    }
  }

  function resetForm() {
    setSent(false);
    setTitle("");
    setBody("");
    setType("bug");
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (newOpen) {
      resetForm();
    }
  }

  const dialogContent = (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create a ticket</DialogTitle>
        <DialogDescription>
          Submit a ticket to report a problem or feature request.
        </DialogDescription>
      </DialogHeader>

      {sent ? (
        <p>Your report has been submitted.</p>
      ) : (
        <>
          <div className="grid gap-4 py-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label>Title</Label>
              <Input
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid w-full gap-1.5">
              <Label>What do you want to report?</Label>
              <Textarea
                placeholder="I am having trouble with... something isn't working... improvements or additions..."
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            <div className="grid w-full gap-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(value) =>
                  setType(value as "bug" | "enhancement")
                }
                defaultValue={"atLeast"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select report type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="bug">Bug</SelectItem>
                    <SelectItem value="enhancement">Enhancement</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              className="px-3 py-2"
              onClick={() => handleReport()}
              disabled={loading}
            >
              Create Ticket
            </Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  );

  if (mode === "button") {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="secondary" size="icon" className="rounded-full">
            <MessageSquare className="h-5 w-5" />
            <span className="sr-only">Report</span>
          </Button>
        </DialogTrigger>
        {dialogContent}
      </Dialog>
    );
  }

  // Menu item mode
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer">
          <MessageSquare className="h-4 w-4" />
          <span>Report Issue</span>
        </div>
      </DialogTrigger>
      {dialogContent}
    </Dialog>
  );
}