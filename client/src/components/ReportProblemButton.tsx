import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Bug, Loader2 } from "lucide-react";

/**
 * Global "Report a problem" entry point (support lane 1). Files a ticket with
 * the diagnostic context attached automatically — route, release, browser —
 * so the reporter only describes what went wrong.
 */
export default function ReportProblemButton() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("normal");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      let release: string | undefined;
      try {
        const rel = await fetch("/api/release").then((r) => r.json());
        release = rel?.release;
      } catch {
        // release is nice-to-have context only
      }
      const res = await apiRequest("POST", "/api/support/report", {
        description,
        severity,
        page: window.location.pathname,
        release,
        userAgent: navigator.userAgent,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not file the report.");
      setOpen(false);
      setDescription("");
      setSeverity("normal");
      toast({
        title: `Report filed (#${data.id})`,
        description: "The team has been notified. Thank you!",
      });
    } catch (e: any) {
      toast({ title: "Could not file the report", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label="Report a problem"
        title="Report a problem"
        onClick={() => setOpen(true)}
        data-testid="button-report-problem"
      >
        <Bug className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="report-problem-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="w-4 h-4" /> Report a problem
            </DialogTitle>
            <DialogDescription>
              Describe what went wrong — your page, app version, and browser are attached automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">What happened?</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What were you doing, and what did you see? Paste any error message."
                data-testid="textarea-problem-description"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">How bad is it?</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent — I can't work</SelectItem>
                  <SelectItem value="normal">Normal — something's broken but I can work around it</SelectItem>
                  <SelectItem value="low">Low — suggestion or polish</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting || description.trim().length < 5} data-testid="button-submit-problem">
              {submitting ? (<><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Sending…</>) : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
