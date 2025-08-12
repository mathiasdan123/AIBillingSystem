import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, DollarSign, User, ArrowRight, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// Demo component showing Liam Smith intake with insurance estimation
function InsuranceEstimationDemo({ insuranceProvider }: { insuranceProvider: string }) {
  const [estimates, setEstimates] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!insuranceProvider) return;
    
    setLoading(true);
    
    // Use standard OT evaluation and treatment codes for estimation
    const standardCodes = ['97166', '97530', '97110']; // Typical OT evaluation + treatment
    
    apiRequest('POST', '/api/estimate-reimbursement', {
      insuranceProvider,
      cptCodes: standardCodes,
      sessionCount: 1,
      deductibleMet: false
    })
    .then(data => {
      setEstimates(data);
    })
    .catch(error => {
      console.error('Error fetching insurance estimates:', error);
    })
    .finally(() => {
      setLoading(false);
    });
  }, [insuranceProvider]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-blue-600">
        <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
        <span className="text-sm">Calculating estimates for Liam Smith...</span>
      </div>
    );
  }

  if (!estimates) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h5 className="font-medium text-slate-900">Provider Summary</h5>
          <div className="text-sm space-y-1">
            <div><span className="font-medium">Provider:</span> {estimates.summary?.provider || 'N/A'}</div>
            <div><span className="font-medium">Avg Rate:</span> ${estimates.summary?.avgReimbursement || 'N/A'}</div>
            <div><span className="font-medium">Coinsurance:</span> {estimates.summary?.coinsurance || 'N/A'}</div>
            <div><span className="font-medium">Deductible:</span> {estimates.summary?.deductible || 'N/A'}</div>
          </div>
        </div>
        
        <div className="space-y-2">
          <h5 className="font-medium text-slate-900">Common OT Services for Liam</h5>
          <div className="text-sm space-y-2">
            {estimates.estimates?.slice(0, 3).map((est: any, idx: number) => {
              const serviceNames: { [key: string]: string } = {
                '97166': 'OT Evaluation (Moderate)',
                '97530': 'Therapeutic Activities',
                '97110': 'Therapeutic Exercise',
                '97535': 'Self-Care Training',
                '97112': 'Neuromuscular Re-education',
                '97167': 'OT Evaluation (High)',
                '97165': 'OT Evaluation (Low)'
              };
              
              return (
                <div key={idx} className="bg-white p-2 rounded border border-slate-200">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-slate-800">{serviceNames[est.cptCode] || est.cptCode}</div>
                      <div className="text-xs text-slate-500">CPT {est.cptCode}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-amber-600">${est.patientResponsibility}</div>
                      <div className="text-xs text-slate-500">per session</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            *Estimated cost for Liam until deductible is met. UnitedHealth may cover portion after deductible.
          </div>
        </div>
      </div>

      {/* Rate Variation Disclaimer */}
      <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-xs text-amber-800">
          <strong>Disclaimer:</strong> These are estimates based on typical out-of-network rates for UnitedHealth. 
          Actual reimbursement rates may vary based on Liam's specific plan details, deductible status, 
          and individual policy terms. Contact UnitedHealth directly for exact benefit verification.
        </p>
      </div>
    </div>
  );
}

export default function DemoIntake() {
  const [currentStep, setCurrentStep] = useState(3); // Start at insurance step
  const [selectedInsurance, setSelectedInsurance] = useState("unitedhealth");

  // Demo data for Liam Smith
  const liamData = {
    firstName: "Liam",
    lastName: "Smith", 
    dateOfBirth: "2016-08-22",
    insuranceProvider: "UnitedHealth",
    policyNumber: "UH987654321"
  };

  const nextStep = () => {
    if (currentStep < 8) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  return (
    <div className="md:ml-64 min-h-screen bg-gray-50">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="flex items-center gap-3 mb-8">
          <User className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">Patient Intake Demo - Liam Smith</h1>
            <p className="text-muted-foreground">Demonstrating insurance reimbursement estimation</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Step {currentStep + 1} of 9</span>
            <span className="text-sm text-muted-foreground">Insurance Details</span>
          </div>
          <Progress value={(currentStep + 1) / 9 * 100} className="h-2" />
        </div>

        {/* Demo Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-500" />
              Insurance Details - Liam Smith Example
            </CardTitle>
            <CardDescription>
              This demonstrates how insurance cost estimates appear when a patient selects their provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pre-filled Demo Data */}
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h4 className="font-medium mb-3">Patient Information (Pre-filled for Demo)</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>Name:</strong> {liamData.firstName} {liamData.lastName}</div>
                <div><strong>DOB:</strong> {liamData.dateOfBirth}</div>
                <div><strong>Age:</strong> 8 years old</div>
                <div><strong>Policy:</strong> {liamData.policyNumber}</div>
              </div>
            </div>

            {/* Insurance Provider Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Insurance Provider *</label>
              <Select value={selectedInsurance} onValueChange={setSelectedInsurance}>
                <SelectTrigger>
                  <SelectValue placeholder="Select insurance provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aetna">Aetna</SelectItem>
                  <SelectItem value="anthem">Anthem</SelectItem>
                  <SelectItem value="bcbs">Blue Cross Blue Shield</SelectItem>
                  <SelectItem value="cigna">Cigna</SelectItem>
                  <SelectItem value="unitedhealth">UnitedHealth</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Mock form fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Insurance ID/Member ID *</label>
                <Input value="UH123456789" readOnly className="bg-slate-50" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Policy Number *</label>
                <Input value={liamData.policyNumber} readOnly className="bg-slate-50" />
              </div>
            </div>

            {/* Insurance Estimation */}
            {selectedInsurance && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="mb-4">
                  <h4 className="font-semibold text-blue-900 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Estimated Treatment Costs for Liam
                  </h4>
                  <p className="text-xs text-blue-700 mt-1">
                    Based on UnitedHealth's typical out-of-network rates for pediatric occupational therapy
                  </p>
                </div>
                <InsuranceEstimationDemo insuranceProvider={selectedInsurance} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={prevStep} disabled={currentStep === 0}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          <Button onClick={nextStep} disabled={currentStep === 8}>
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>

        {/* Demo Instructions */}
        <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-semibold text-green-800 mb-2">Demo Instructions</h3>
          <div className="text-sm text-green-700 space-y-1">
            <p>• Try changing the insurance provider to see different cost estimates</p>
            <p>• Notice how each CPT code shows both the service name and estimated patient cost</p>
            <p>• UnitedHealth typically has different rates than Aetna or Anthem</p>
            <p>• The system calculates realistic out-of-network rates for pediatric OT services</p>
          </div>
        </div>
      </div>
    </div>
  );
}