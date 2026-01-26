import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, DollarSign, Receipt, TrendingUp, TrendingDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ExpenseTracker from "@/components/ExpenseTracker";

export default function Expenses() {
  const { user, isAuthenticated, isLoading, isAdmin } = useAuth();
  const { toast } = useToast();
  const [practiceId] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
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
  }, [isAuthenticated, isLoading, toast]);

  const { data: expenses, isLoading: expensesLoading } = useQuery({
    queryKey: ['/api/expenses', practiceId],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  });

  if (isLoading || expensesLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      rent: 'bg-blue-50 text-blue-700',
      supplies: 'bg-green-50 text-green-700',
      equipment: 'bg-purple-50 text-purple-700',
      utilities: 'bg-yellow-50 text-yellow-700',
      insurance: 'bg-red-50 text-red-700',
      marketing: 'bg-pink-50 text-pink-700',
      other: 'bg-slate-50 text-slate-700',
    };
    return colors[category] || colors.other;
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-healthcare-green-600';
    if (confidence >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  // Filter expenses: admins see all, therapists see only their own
  const userExpenses = isAdmin
    ? expenses
    : expenses?.filter((expense: any) => expense.createdBy === (user as any)?.id);

  const filteredExpenses = userExpenses?.filter((expense: any) => {
    const matchesSearch = expense.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || expense.category === categoryFilter || expense.aiCategory === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const totalExpenses = userExpenses?.reduce((sum: number, expense: any) => sum + parseFloat(expense.amount), 0) || 0;
  const monthlyExpenses = userExpenses?.filter((expense: any) => {
    const expenseDate = new Date(expense.expenseDate);
    const currentMonth = new Date();
    return expenseDate.getMonth() === currentMonth.getMonth() &&
           expenseDate.getFullYear() === currentMonth.getFullYear();
  }).reduce((sum: number, expense: any) => sum + parseFloat(expense.amount), 0) || 0;

  const categorySummary = userExpenses?.reduce((acc: Record<string, number>, expense: any) => {
    const category = expense.aiCategory || expense.category || 'other';
    acc[category] = (acc[category] || 0) + parseFloat(expense.amount);
    return acc;
  }, {});

  const handleExpenseCreated = () => {
    setShowExpenseDialog(false);
    toast({
      title: "Success",
      description: "Expense added successfully with AI categorization",
    });
  };

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isAdmin ? "Expense Management" : "My Expenses"}
          </h1>
          <p className="text-slate-600">
            {isAdmin
              ? "Track and categorize business expenses with AI assistance"
              : "Track and manage your personal business expenses"}
          </p>
        </div>
        <Dialog open={showExpenseDialog} onOpenChange={setShowExpenseDialog}>
          <DialogTrigger asChild>
            <Button className="bg-medical-blue-500 hover:bg-medical-blue-600">
              <Plus className="w-4 h-4 mr-2" />
              Add Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Expense</DialogTitle>
              <DialogDescription>
                Record a new business expense with AI-powered categorization
              </DialogDescription>
            </DialogHeader>
            <ExpenseTracker 
              practiceId={practiceId} 
              onSuccess={handleExpenseCreated}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalExpenses)}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3 mr-1 text-healthcare-green-500" />
              <span className="text-healthcare-green-500">+5.2%</span>
              <span className="ml-1">from last month</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(monthlyExpenses)}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              <TrendingDown className="w-3 h-3 mr-1 text-healthcare-green-500" />
              <span className="text-healthcare-green-500">-2.1%</span>
              <span className="ml-1">vs last month</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. per Day</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(monthlyExpenses / new Date().getDate())}
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <span className="text-slate-500">Daily average</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Categories</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Object.keys(categorySummary || {}).length}
            </div>
            <div className="flex items-center text-xs text-muted-foreground">
              <span className="text-slate-500">Active categories</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center space-x-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Search expenses..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="rent">Rent</SelectItem>
            <SelectItem value="supplies">Supplies</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
            <SelectItem value="utilities">Utilities</SelectItem>
            <SelectItem value="insurance">Insurance</SelectItem>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Expenses List */}
      <div className="space-y-4">
        {filteredExpenses?.length ? (
          filteredExpenses.map((expense: any) => (
            <Card key={expense.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                      <Receipt className="w-5 h-5 text-slate-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{expense.description}</h3>
                      <p className="text-sm text-slate-600">
                        {new Date(expense.expenseDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">{formatCurrency(expense.amount)}</p>
                      {expense.isDeductible && (
                        <p className="text-xs text-healthcare-green-600">Tax Deductible</p>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-end space-y-1">
                      <Badge className={getCategoryColor(expense.aiCategory || expense.category || 'other')}>
                        {expense.aiCategory || expense.category || 'Other'}
                      </Badge>
                      {expense.aiCategory && expense.aiConfidence && (
                        <div className="text-xs text-slate-500">
                          AI: <span className={getConfidenceColor(parseFloat(expense.aiConfidence))}>
                            {parseFloat(expense.aiConfidence).toFixed(0)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Receipt className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No Expenses Found</h3>
              <p className="text-slate-600 mb-4">
                {searchTerm || categoryFilter !== "all" 
                  ? "No expenses match your search criteria"
                  : "Get started by adding your first expense"
                }
              </p>
              {!searchTerm && categoryFilter === "all" && (
                <Button 
                  onClick={() => setShowExpenseDialog(true)}
                  className="bg-medical-blue-500 hover:bg-medical-blue-600"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add First Expense
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Category Summary */}
      {Object.keys(categorySummary || {}).length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Expense Summary by Category</CardTitle>
            <CardDescription>Breakdown of expenses by category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(categorySummary || {}).map(([category, amount]) => (
                <div key={category} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-medical-blue-500 rounded-full" />
                    <span className="font-medium text-slate-900 capitalize">{category}</span>
                  </div>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(amount as number)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
