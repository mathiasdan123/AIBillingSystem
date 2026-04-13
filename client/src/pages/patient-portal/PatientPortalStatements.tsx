import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, AlertCircle } from "lucide-react";

interface Statement {
  id: number;
  statementNumber: string;
  statementDate: string;
  totalAmount: string;
  balanceDue: string;
  status: string;
}

interface PatientPortalStatementsProps {
  token: string;
}

export default function PatientPortalStatements({ token }: PatientPortalStatementsProps) {
  const { t } = useTranslation();

  const { data: statements = [], isLoading, error } = useQuery<Statement[]>({
    queryKey: ["/api/public/portal", token, "statements"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${token}/statements`);
      if (!res.ok) throw new Error("Failed to fetch statements");
      return res.json();
    },
    refetchInterval: 120000,
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t('portal.statements', 'Billing Statements')}</h2>
          <p className="text-muted-foreground">{t('portal.statementsDesc', 'View and pay your statements')}</p>
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-lg font-medium">{t('portal.failedLoadStatements', 'Failed to load statements')}</p>
          <p className="text-muted-foreground">{t('portal.tryRefreshing', 'Please try refreshing the page.')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-primary" />
          {t('portal.statements', 'Billing Statements')}
        </h2>
        <p className="text-muted-foreground mt-1">
          {t('portal.statementsDesc', 'View and pay your statements')}
        </p>
      </div>

      {statements.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <DollarSign className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-medium text-center">
              {t('portal.noStatements', 'No statements found')}
            </p>
            <p className="text-muted-foreground text-center mt-2 max-w-md">
              {t('portal.noStatementsDesc', 'You have no billing statements at this time.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {statements.map((stmt) => (
            <Card key={stmt.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <DollarSign className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{stmt.statementNumber}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(stmt.statementDate)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatCurrency(stmt.balanceDue)}</p>
                  <Badge
                    variant={
                      stmt.status === "paid"
                        ? "default"
                        : stmt.status === "overdue"
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {stmt.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
