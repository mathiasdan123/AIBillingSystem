import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { History, ChevronDown, ChevronUp, DollarSign } from 'lucide-react';

interface Claim {
  claimNumber: string;
  dateOfService: string;
  provider: string;
  serviceType: string;
  billedAmount: number;
  allowedAmount: number;
  paidAmount: number;
  patientResponsibility: number;
  status: string;
}

interface NormalizedClaimsHistory {
  claims: Claim[];
  totalClaims: number;
  totalPaid: number;
}

interface ClaimsHistoryTableProps {
  claimsHistory: NormalizedClaimsHistory;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getStatusBadge(status: string) {
  const statusLower = status.toLowerCase();

  if (statusLower.includes('paid') || statusLower.includes('complete')) {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Paid</Badge>;
  }
  if (statusLower.includes('pending') || statusLower.includes('process')) {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pending</Badge>;
  }
  if (statusLower.includes('denied') || statusLower.includes('reject')) {
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Denied</Badge>;
  }

  return <Badge variant="secondary">{status}</Badge>;
}

export default function ClaimsHistoryTable({ claimsHistory }: ClaimsHistoryTableProps) {
  const [showAll, setShowAll] = useState(false);

  const { claims, totalClaims, totalPaid } = claimsHistory;
  const displayedClaims = showAll ? claims : claims.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Claims History
            </CardTitle>
            <CardDescription>
              {totalClaims} total claims | {formatCurrency(totalPaid)} paid
            </CardDescription>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
            <div className="text-xs text-green-600 font-medium">Total Paid</div>
            <div className="text-lg font-bold text-green-700">{formatCurrency(totalPaid)}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {claims.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <History className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>No claims history found</p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold">Claim #</TableHead>
                    <TableHead className="font-semibold">Service</TableHead>
                    <TableHead className="font-semibold text-right">Billed</TableHead>
                    <TableHead className="font-semibold text-right">Paid</TableHead>
                    <TableHead className="font-semibold text-right">Your Cost</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedClaims.map((claim, index) => (
                    <TableRow key={claim.claimNumber || index}>
                      <TableCell className="font-medium">
                        {formatDate(claim.dateOfService)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{claim.claimNumber}</TableCell>
                      <TableCell>
                        <div className="max-w-[200px]">
                          <div className="truncate font-medium">{claim.serviceType}</div>
                          <div className="text-xs text-gray-500 truncate">{claim.provider}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(claim.billedAmount)}
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">
                        {formatCurrency(claim.paidAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {claim.patientResponsibility > 0 ? (
                          <span className="text-amber-600 font-medium">
                            {formatCurrency(claim.patientResponsibility)}
                          </span>
                        ) : (
                          <span className="text-gray-400">$0.00</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(claim.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {claims.length > 5 && (
              <div className="mt-4 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(!showAll)}
                  className="w-full max-w-xs"
                >
                  {showAll ? (
                    <>
                      <ChevronUp className="w-4 h-4 mr-1" />
                      Show Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4 mr-1" />
                      Show All {claims.length} Claims
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Summary Stats */}
            <div className="mt-6 grid grid-cols-4 gap-4 pt-4 border-t">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{claims.length}</div>
                <div className="text-xs text-gray-500">Total Claims</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(claims.reduce((sum, c) => sum + c.billedAmount, 0))}
                </div>
                <div className="text-xs text-gray-500">Total Billed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</div>
                <div className="text-xs text-gray-500">Insurance Paid</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600">
                  {formatCurrency(claims.reduce((sum, c) => sum + c.patientResponsibility, 0))}
                </div>
                <div className="text-xs text-gray-500">Patient Owed</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
