import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  Lightbulb,
  Clock,
  FileText,
  BarChart3,
} from "lucide-react";

interface PayerRatesSummary {
  provider: string;
  rates: Array<{
    cptCode: string;
    description: string;
    inNetworkRate: number | null;
    rank: number;
  }>;
  averageRate: number;
  highestPayingCode: string | null;
  lowestPayingCode: string | null;
}

interface InterventionCategories {
  categories: Record<string, { codes: string[]; description: string }>;
  payersRequiringDifferentCodes: string[];
}

interface SessionOptimization {
  totalUnits: number;
  lineItems: Array<{
    code: string;
    codeId: number;
    units: number;
    rate: number | null;
    interventionType: string;
  }>;
  totalEstimatedReimbursement: number;
  optimizationNotes: string[];
}

export default function ReimbursementPage() {
  const [selectedPayer, setSelectedPayer] = useState<string>("");
  const [sessionDuration, setSessionDuration] = useState<number>(45);
  const [selectedInterventions, setSelectedInterventions] = useState<string[]>([]);

  // Get list of payers with rates
  const { data: providers } = useQuery<string[]>({
    queryKey: ["/api/insurance-rates/providers"],
  });

  // Get intervention categories
  const { data: interventionData } = useQuery<InterventionCategories>({
    queryKey: ["/api/reimbursement/intervention-categories"],
  });

  // Get payer rates summary when a payer is selected
  const { data: payerSummary, isLoading: loadingRates } = useQuery<PayerRatesSummary>({
    queryKey: [`/api/reimbursement/payer-summary/${selectedPayer}`],
    enabled: !!selectedPayer,
  });

  // Get session optimization when interventions are selected
  const { data: sessionOptimization, isLoading: loadingOptimization } = useQuery<SessionOptimization>({
    queryKey: ["/api/reimbursement/optimize-session", selectedPayer, sessionDuration, selectedInterventions],
    enabled: !!selectedPayer && selectedInterventions.length > 0,
    queryFn: async () => {
      const response = await fetch("/api/reimbursement/optimize-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionDurationMinutes: sessionDuration,
          interventions: selectedInterventions,
          insuranceProvider: selectedPayer,
        }),
      });
      return response.json();
    },
  });

  const toggleIntervention = (intervention: string) => {
    setSelectedInterventions(prev =>
      prev.includes(intervention)
        ? prev.filter(i => i !== intervention)
        : [...prev, intervention]
    );
  };

  const requiresDifferentCodes = interventionData?.payersRequiringDifferentCodes.some(
    p => selectedPayer.toLowerCase().includes(p.toLowerCase())
  );

  return (
    <div className="md:ml-64 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="w-8 h-8 text-green-600" />
            Reimbursement Optimization
          </h1>
          <p className="text-slate-600 mt-1">
            Maximize reimbursement by selecting optimal CPT codes for each payer
          </p>
        </div>
      </div>

      <Tabs defaultValue="rates" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rates" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Payer Rates
          </TabsTrigger>
          <TabsTrigger value="optimizer" className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Session Optimizer
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Billing Rules
          </TabsTrigger>
        </TabsList>

        {/* Payer Rates Tab */}
        <TabsContent value="rates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Select Insurance Payer</CardTitle>
              <CardDescription>
                View reimbursement rates ranked from highest to lowest
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedPayer} onValueChange={setSelectedPayer}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Choose a payer..." />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedPayer && payerSummary && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-green-50 border-green-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-green-600 font-medium">Highest Paying Code</p>
                        <p className="text-2xl font-bold text-green-700">
                          {payerSummary.highestPayingCode || "N/A"}
                        </p>
                        {payerSummary.rates[0] && (
                          <p className="text-sm text-green-600">
                            ${payerSummary.rates[0].inNetworkRate?.toFixed(2)}/unit
                          </p>
                        )}
                      </div>
                      <TrendingUp className="w-10 h-10 text-green-300" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-blue-600 font-medium">Average Rate</p>
                        <p className="text-2xl font-bold text-blue-700">
                          ${payerSummary.averageRate.toFixed(2)}
                        </p>
                        <p className="text-sm text-blue-600">per 15-min unit</p>
                      </div>
                      <DollarSign className="w-10 h-10 text-blue-300" />
                    </div>
                  </CardContent>
                </Card>

                <Card className={requiresDifferentCodes ? "bg-amber-50 border-amber-200" : "bg-slate-50"}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-600 font-medium">Unit Billing Rule</p>
                        <p className="text-lg font-bold">
                          {requiresDifferentCodes ? (
                            <span className="text-amber-700">Different Codes Required</span>
                          ) : (
                            <span className="text-slate-700">Can Stack Units</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {requiresDifferentCodes
                            ? "Use different code per 15-min block"
                            : "Multiple units of same code OK"}
                        </p>
                      </div>
                      {requiresDifferentCodes ? (
                        <AlertTriangle className="w-10 h-10 text-amber-300" />
                      ) : (
                        <CheckCircle className="w-10 h-10 text-slate-300" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Rates Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Reimbursement Rates for {selectedPayer}</CardTitle>
                  <CardDescription>
                    Codes ranked by in-network reimbursement rate
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Rank</TableHead>
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Rate/Unit</TableHead>
                        <TableHead className="text-right">vs. Average</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payerSummary.rates.map((rate) => {
                        const vsAvg = rate.inNetworkRate
                          ? ((rate.inNetworkRate - payerSummary.averageRate) / payerSummary.averageRate) * 100
                          : 0;
                        return (
                          <TableRow key={rate.cptCode}>
                            <TableCell>
                              <Badge
                                variant={rate.rank === 1 ? "default" : "outline"}
                                className={rate.rank === 1 ? "bg-green-600" : ""}
                              >
                                #{rate.rank}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono font-bold">{rate.cptCode}</TableCell>
                            <TableCell className="text-sm text-slate-600">
                              {rate.description || "—"}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {rate.inNetworkRate ? `$${rate.inNetworkRate.toFixed(2)}` : "N/A"}
                            </TableCell>
                            <TableCell className="text-right">
                              {rate.inNetworkRate && (
                                <span className={vsAvg >= 0 ? "text-green-600" : "text-red-600"}>
                                  {vsAvg >= 0 ? "+" : ""}{vsAvg.toFixed(1)}%
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}

          {selectedPayer && !payerSummary && !loadingRates && (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center">
                <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No rate data found for {selectedPayer}</p>
                <p className="text-sm text-slate-400 mt-1">
                  Upload a fee schedule to populate rates
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Session Optimizer Tab */}
        <TabsContent value="optimizer" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Session Details</CardTitle>
                <CardDescription>
                  Configure session parameters for optimization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Insurance Payer</Label>
                  <Select value={selectedPayer} onValueChange={setSelectedPayer}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a payer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {providers?.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {provider}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Session Duration (minutes)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={sessionDuration}
                      onChange={(e) => setSessionDuration(parseInt(e.target.value) || 45)}
                      className="w-24"
                    />
                    <span className="text-sm text-slate-500">
                      = {Math.floor(sessionDuration / 15)} billable units
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Interventions Performed</Label>
                  <p className="text-xs text-slate-500 mb-2">
                    Select all interventions documented in the session
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {interventionData?.categories &&
                      Object.entries(interventionData.categories).map(([key, { description }]) => (
                        <Badge
                          key={key}
                          variant={selectedInterventions.includes(key) ? "default" : "outline"}
                          className={`cursor-pointer ${
                            selectedInterventions.includes(key)
                              ? "bg-blue-600 hover:bg-blue-700"
                              : "hover:bg-slate-100"
                          }`}
                          onClick={() => toggleIntervention(key)}
                        >
                          {key.replace(/_/g, " ")}
                        </Badge>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-yellow-500" />
                  Optimization Result
                </CardTitle>
                <CardDescription>
                  Recommended billing codes for maximum reimbursement
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedPayer || selectedInterventions.length === 0 ? (
                  <div className="text-center py-6 text-slate-400">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>Select a payer and interventions to see optimization</p>
                  </div>
                ) : loadingOptimization ? (
                  <div className="text-center py-6">
                    <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm text-slate-500 mt-2">Optimizing...</p>
                  </div>
                ) : sessionOptimization ? (
                  <div className="space-y-4">
                    {/* Recommended Line Items */}
                    <div className="space-y-2">
                      {sessionOptimization.lineItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="font-mono">
                              {item.code}
                            </Badge>
                            <span className="text-sm text-slate-600">
                              {item.interventionType.replace(/_/g, " ")}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold">{item.units} unit(s)</span>
                            {item.rate && (
                              <span className="text-sm text-green-600 ml-2">
                                ${(item.rate * item.units).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Total */}
                    <div className="flex items-center justify-between pt-3 border-t">
                      <span className="font-medium">Total Estimated Reimbursement</span>
                      <span className="text-xl font-bold text-green-600">
                        ${sessionOptimization.totalEstimatedReimbursement.toFixed(2)}
                      </span>
                    </div>

                    {/* Optimization Notes */}
                    {sessionOptimization.optimizationNotes.length > 0 && (
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <p className="text-xs font-medium text-blue-700 mb-1">Optimization Notes:</p>
                        <ul className="text-xs text-blue-600 space-y-1">
                          {sessionOptimization.optimizationNotes.map((note, idx) => (
                            <li key={idx}>• {note}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Code Equivalencies Reference */}
          <Card>
            <CardHeader>
              <CardTitle>Code Equivalencies Reference</CardTitle>
              <CardDescription>
                These interventions can be coded multiple ways - system selects highest-reimbursing option
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {interventionData?.categories &&
                  Object.entries(interventionData.categories).map(([key, { codes, description }]) => (
                    <div key={key} className="p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium capitalize">{key.replace(/_/g, " ")}</span>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div className="flex gap-1">
                          {codes.map((code) => (
                            <Badge key={code} variant="outline" className="font-mono text-xs">
                              {code}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">{description}</p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing Rules Tab */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Payer-Specific Billing Rules</CardTitle>
              <CardDescription>
                Important rules that affect how codes should be billed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <h3 className="font-medium text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Payers Requiring Different Codes Per 15-Minute Unit
                  </h3>
                  <p className="text-sm text-amber-700 mt-2">
                    These payers typically require you to use different CPT codes for each 15-minute block.
                    Billing multiple units of the same code may result in denials or reduced payment.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {interventionData?.payersRequiringDifferentCodes.map((payer) => (
                      <Badge key={payer} className="bg-amber-600">
                        {payer}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h3 className="font-medium text-green-800 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Standard Billing (Can Stack Units)
                  </h3>
                  <p className="text-sm text-green-700 mt-2">
                    Most other payers allow multiple units of the same code when clinically appropriate.
                    You can bill 2-3 units of 97530 if the documentation supports it.
                  </p>
                </div>

                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="font-medium text-blue-800 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5" />
                    Optimization Strategy
                  </h3>
                  <ul className="text-sm text-blue-700 mt-2 space-y-1">
                    <li>• <strong>Clinical accuracy is always primary</strong> - only use codes that accurately describe documented services</li>
                    <li>• When multiple codes could accurately describe an intervention, choose the higher-reimbursing option</li>
                    <li>• For payers requiring different codes, distribute units across the highest-paying applicable codes</li>
                    <li>• Always ensure documentation supports medical necessity for each code billed</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
