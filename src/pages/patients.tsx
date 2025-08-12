import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Search, Users, Phone, Mail, Calendar, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import PatientIntakeForm from "@/components/PatientIntakeForm";

export default function Patients() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [practiceId] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [showIntakeDialog, setShowIntakeDialog] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);

  // Check if we have dev bypass
  const hasDevBypass = localStorage.getItem('dev-bypass') === 'true';
  const shouldAllowAccess = isAuthenticated || hasDevBypass;

  // Redirect to login if not authenticated and no dev bypass
  useEffect(() => {
    if (!isLoading && !shouldAllowAccess) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [shouldAllowAccess, isLoading, toast]);

  const { data: patients, isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ['/api/patients'],
    enabled: shouldAllowAccess,
    retry: false,
  });

  // Debug logging for patients page
  console.log("Patients page - shouldAllowAccess:", shouldAllowAccess);
  console.log("Patients page - isLoading:", patientsLoading);
  console.log("Patients page - error:", patientsError);
  console.log("Patients page - data:", patients);

  const checkEligibilityMutation = useMutation({
    mutationFn: async (data: { patientId: number; insuranceId: number }) => {
      const response = await apiRequest("POST", "/api/insurance/eligibility", data);
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Eligibility Check Complete",
        description: data.message,
        variant: data.eligible ? "default" : "destructive",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to check eligibility",
        variant: "destructive",
      });
    },
  });

  if (isLoading || patientsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div>
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-600">Loading patients...</p>
          {patientsError && <p className="text-red-500 text-sm">Error: {String(patientsError)}</p>}
        </div>
      </div>
    );
  }

  if (!shouldAllowAccess) {
    return null;
  }

  const filteredPatients = (patients as any[])?.filter((patient: any) => {
    const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
    const email = patient.email?.toLowerCase() || "";
    const phone = patient.phone?.toLowerCase() || "";
    const searchLower = searchTerm.toLowerCase();
    
    return fullName.includes(searchLower) || 
           email.includes(searchLower) || 
           phone.includes(searchLower);
  }) || [];

  const handlePatientCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
    setShowIntakeDialog(false);
    toast({
      title: "Success",
      description: "Patient added successfully",
    });
  };

  return (
    <div className="p-6 md:ml-64">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Patient Management</h1>
          <p className="text-slate-600">Manage patient information and insurance details</p>
        </div>
        <Dialog open={showIntakeDialog} onOpenChange={setShowIntakeDialog}>
          <DialogTrigger asChild>
            <Button className="bg-medical-blue-500 hover:bg-medical-blue-600">
              <Plus className="w-4 h-4 mr-2" />
              Add Patient
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Patient Intake Form</DialogTitle>
              <DialogDescription>
                Add a new patient with insurance information
              </DialogDescription>
            </DialogHeader>
            <PatientIntakeForm 
              practiceId={practiceId} 
              onSuccess={handlePatientCreated}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search patients by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patients?.length || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patients?.length || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Insurance Verified</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {patients?.filter((p: any) => p.insuranceProvider).length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Patients Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPatients?.length ? (
          filteredPatients.map((patient: any) => (
            <Card key={patient.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {patient.firstName} {patient.lastName}
                    </CardTitle>
                    <CardDescription>
                      {patient.dateOfBirth && (
                        <span className="flex items-center mt-1">
                          <Calendar className="w-4 h-4 mr-1" />
                          {new Date(patient.dateOfBirth).toLocaleDateString()}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    {patient.insuranceProvider || "No Insurance"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {patient.email && (
                    <div className="flex items-center text-sm text-slate-600">
                      <Mail className="w-4 h-4 mr-2" />
                      {patient.email}
                    </div>
                  )}
                  {patient.phone && (
                    <div className="flex items-center text-sm text-slate-600">
                      <Phone className="w-4 h-4 mr-2" />
                      {patient.phone}
                    </div>
                  )}
                  {patient.insuranceId && (
                    <div className="flex items-center text-sm text-slate-600">
                      <Shield className="w-4 h-4 mr-2" />
                      ID: {patient.insuranceId}
                    </div>
                  )}
                </div>
                
                <div className="mt-4 flex space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => setSelectedPatient(patient)}
                  >
                    View Details
                  </Button>
                  {patient.insuranceProvider && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => checkEligibilityMutation.mutate({
                        patientId: patient.id,
                        insuranceId: 1 // Mock insurance ID
                      })}
                      disabled={checkEligibilityMutation.isPending}
                    >
                      <Shield className="w-4 h-4 mr-1" />
                      {checkEligibilityMutation.isPending ? "Checking..." : "Check Eligibility"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full">
            <Card>
              <CardContent className="p-12 text-center">
                <Users className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No Patients Found</h3>
                <p className="text-slate-600 mb-4">
                  {searchTerm 
                    ? "No patients match your search criteria"
                    : "Get started by adding your first patient"
                  }
                </p>
                {!searchTerm && (
                  <Button 
                    onClick={() => setShowIntakeDialog(true)}
                    className="bg-medical-blue-500 hover:bg-medical-blue-600"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Patient
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Patient Details Modal */}
      {selectedPatient && (
        <Dialog open={!!selectedPatient} onOpenChange={() => setSelectedPatient(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {selectedPatient.firstName} {selectedPatient.lastName}
              </DialogTitle>
              <DialogDescription>
                Patient details and insurance information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Email</label>
                  <p className="text-sm text-slate-600">{selectedPatient.email || "Not provided"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Phone</label>
                  <p className="text-sm text-slate-600">{selectedPatient.phone || "Not provided"}</p>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Date of Birth</label>
                <p className="text-sm text-slate-600">
                  {selectedPatient.dateOfBirth 
                    ? new Date(selectedPatient.dateOfBirth).toLocaleDateString()
                    : "Not provided"
                  }
                </p>
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-700">Address</label>
                <p className="text-sm text-slate-600">{selectedPatient.address || "Not provided"}</p>
              </div>
              
              <div className="border-t pt-4">
                <h4 className="font-medium text-slate-900 mb-2">Insurance Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Provider</label>
                    <p className="text-sm text-slate-600">{selectedPatient.insuranceProvider || "Not provided"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Member ID</label>
                    <p className="text-sm text-slate-600">{selectedPatient.insuranceId || "Not provided"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Policy Number</label>
                    <p className="text-sm text-slate-600">{selectedPatient.policyNumber || "Not provided"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Group Number</label>
                    <p className="text-sm text-slate-600">{selectedPatient.groupNumber || "Not provided"}</p>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
