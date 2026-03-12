import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, DollarSign, Clock, AlertTriangle } from "lucide-react";

interface ArAgingData {
  totalOutstanding: number;
  buckets: Array<{ bucket: string; count: number; amount: number }>;
  byPatient: Array<{ patientId: number; patientName: string; totalOwed: number; oldestDays: number }>;
}

function getBucketColor(bucket: string): string {
  switch (bucket) {
    case "0-30": return "bg-green-100 text-green-800";
    case "31-60": return "bg-yellow-100 text-yellow-800";
    case "61-90": return "bg-orange-100 text-orange-800";
    case "90+": return "bg-red-100 text-red-800";
    default: return "bg-slate-100 text-slate-800";
  }
}

function getBucketBarColor(bucket: string): string {
  switch (bucket) {
    case "0-30": return "bg-green-500";
    case "31-60": return "bg-yellow-500";
    case "61-90": return "bg-orange-500";
    case "90+": return "bg-red-500";
    default: return "bg-slate-500";
  }
}

export default function PatientArAgingSummary() {
  const { data: arData, isLoading } = useQuery<ArAgingData>({
    queryKey: ["/api/billing/ar-aging"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    );
  }

  if (!arData) {
    return null;
  }

  const maxAmount = Math.max(...arData.buckets.map((b) => b.amount), 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-600" />
          Patient A/R Aging
          <Badge variant="outline" className="ml-auto text-xs">
            ${arData.totalOutstanding.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Aging Buckets */}
        <div className="space-y-2">
          {arData.buckets.map((bucket) => (
            <div key={bucket.bucket} className="flex items-center gap-3">
              <Badge className={`${getBucketColor(bucket.bucket)} w-14 justify-center text-xs`}>
                {bucket.bucket}
              </Badge>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getBucketBarColor(bucket.bucket)}`}
                      style={{ width: `${Math.max((bucket.amount / maxAmount) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-700 w-20 text-right">
                    ${bucket.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <span className="text-xs text-slate-500 w-16 text-right">
                {bucket.count} stmt{bucket.count !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>

        {/* Top patients with outstanding balances */}
        {arData.byPatient.length > 0 && (
          <div className="border-t pt-3">
            <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Top Outstanding Balances
            </h4>
            <div className="space-y-1.5">
              {arData.byPatient.slice(0, 5).map((pt) => (
                <div key={pt.patientId} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{pt.patientName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{pt.oldestDays}d</span>
                    <span className="font-medium text-slate-900">
                      <DollarSign className="w-3 h-3 inline" />
                      {pt.totalOwed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {arData.totalOutstanding === 0 && (
          <p className="text-sm text-slate-500 text-center py-2">
            No outstanding patient balances
          </p>
        )}
      </CardContent>
    </Card>
  );
}
