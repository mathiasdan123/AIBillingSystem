import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

export default function Accounting() {
  return (
    <div className="md:ml-64 min-h-screen bg-slate-50 p-8 pt-20 md:pt-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <DollarSign className="w-8 h-8 text-green-500" />
          <h1 className="text-3xl font-bold text-slate-900">Accounting</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Financial Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600">
              Accounting features coming soon. This page will display revenue reports,
              payment tracking, outstanding balances, and financial analytics.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
