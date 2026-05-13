import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Network, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

interface PayerOrder {
  order: string;
  payerName?: string;
  memberId?: string;
}

interface CobResult {
  primacyDetermined: boolean;
  classification?: string;
  coverageOverlap?: boolean;
  payerOrder: PayerOrder[];
  notSupported?: boolean;
}

interface Props {
  patientId: number;
  patientName: string;
}

export default function CoordinationOfBenefitsCard({ patientId, patientName }: Props) {
  const { toast } = useToast();
  const [result, setResult] = useState<CobResult | null>(null);

  const mutation = useMutation<CobResult, Error>({
    mutationFn: async () => {
      const res = await fetch("/api/payer-intel/cob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ patientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "COB check failed");
      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.notSupported) {
        toast({
          title: "COB endpoint unavailable",
          description: "Stedi did not return a COB response for this payer.",
        });
      }
    },
    onError: (err) => {
      toast({ variant: "destructive", title: "COB check failed", description: err.message });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="w-5 h-5 text-blue-600" />
            Coordination of Benefits
          </CardTitle>
          <Button
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="cob-check-button"
          >
            {mutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Checking…</>
            ) : (
              "Check primacy"
            )}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Asks the payer which plan is primary for {patientName}. Replaces a phone call.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!result && !mutation.isPending && (
          <p className="text-sm text-slate-500">No COB check has been run yet.</p>
        )}

        {result?.notSupported && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
            COB lookup is not available for this payer in Stedi.
          </div>
        )}

        {result && !result.notSupported && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {result.primacyDetermined ? (
                <Badge className="bg-green-100 text-green-700 border-green-200">
                  <CheckCircle className="w-3 h-3 mr-1" /> Primary payer determined
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                  <AlertTriangle className="w-3 h-3 mr-1" /> Primary not determined
                </Badge>
              )}
              {result.coverageOverlap !== undefined && (
                <Badge variant="outline" className="text-xs">
                  Coverage overlap: {result.coverageOverlap ? "yes" : "no"}
                </Badge>
              )}
              {result.classification && (
                <Badge variant="outline" className="text-xs">{result.classification}</Badge>
              )}
            </div>

            {result.payerOrder.length > 0 ? (
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="text-left p-2 font-medium">Order</th>
                      <th className="text-left p-2 font-medium">Payer</th>
                      <th className="text-left p-2 font-medium">Member ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.payerOrder.map((p, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 font-medium">{p.order}</td>
                        <td className="p-2">{p.payerName || "—"}</td>
                        <td className="p-2 text-slate-600">{p.memberId || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No payer order returned by the response.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
