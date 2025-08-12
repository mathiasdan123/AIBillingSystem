import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Clock, XCircle, AlertCircle, Search, Send } from "lucide-react";

interface Claim {
  id: number;
  claimNumber: string;
  patient: {
    firstName: string;
    lastName: string;
  };
  totalAmount: number;
  paidAmount?: number;
  status: string;
  createdAt: string;
  aiReviewScore?: string;
  aiReviewNotes?: string;
  denialReason?: string;
}

interface ClaimsListProps {
  claims: Claim[];
  onSubmitClaim: (claimId: number) => void;
  isSubmitting: boolean;
}

export default function ClaimsList({ claims, onSubmitClaim, isSubmitting }: ClaimsListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const getClaimStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-healthcare-green-500" />;
      case 'submitted':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'denied':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-slate-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-healthcare-green-50 text-healthcare-green-700';
      case 'submitted':
        return 'bg-yellow-50 text-yellow-700';
      case 'denied':
        return 'bg-red-50 text-red-700';
      default:
        return 'bg-slate-50 text-slate-700';
    }
  };

  const getAiScoreColor = (score: number) => {
    if (score >= 80) return 'text-healthcare-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const filteredClaims = claims.filter((claim) => {
    const matchesSearch = claim.claimNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.patient?.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         claim.patient?.lastName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Search and Filter */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search claims..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Claims List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredClaims.length ? (
          filteredClaims.map((claim) => (
            <Card key={claim.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    {getClaimStatusIcon(claim.status)}
                    <div>
                      <h3 className="font-semibold text-slate-900">{claim.claimNumber}</h3>
                      <p className="text-sm text-slate-600">
                        Patient: {claim.patient?.firstName} {claim.patient?.lastName}
                      </p>
                      <p className="text-sm text-slate-600">
                        Created: {new Date(claim.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">${claim.totalAmount}</p>
                      {claim.paidAmount && (
                        <p className="text-sm text-healthcare-green-600">
                          Paid: ${claim.paidAmount}
                        </p>
                      )}
                    </div>
                    
                    {claim.aiReviewScore && (
                      <div className="text-center">
                        <p className={`font-semibold ${getAiScoreColor(parseFloat(claim.aiReviewScore))}`}>
                          {claim.aiReviewScore}%
                        </p>
                        <p className="text-xs text-slate-500">AI Score</p>
                      </div>
                    )}
                    
                    <Badge className={getStatusColor(claim.status)}>
                      {claim.status}
                    </Badge>
                    
                    {claim.status === 'draft' && (
                      <Button
                        size="sm"
                        onClick={() => onSubmitClaim(claim.id)}
                        disabled={isSubmitting}
                        className="bg-medical-blue-500 hover:bg-medical-blue-600"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Submit
                      </Button>
                    )}
                  </div>
                </div>
                
                {claim.aiReviewNotes && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-700">
                      <strong>AI Review:</strong> {claim.aiReviewNotes}
                    </p>
                  </div>
                )}
                
                {claim.denialReason && (
                  <div className="mt-4 p-3 bg-red-50 rounded-lg">
                    <p className="text-sm text-red-700">
                      <strong>Denial Reason:</strong> {claim.denialReason}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No Claims Found</h3>
              <p className="text-slate-600">
                {searchTerm || statusFilter !== "all" 
                  ? "No claims match your search criteria"
                  : "No claims available"
                }
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
