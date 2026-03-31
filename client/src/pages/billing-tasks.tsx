import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  Filter,
  TrendingUp,
  CheckCircle,
  XCircle,
  Calendar,
  Download,
  Eye,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

interface BillingTask {
  id: number;
  type: "denial" | "follow_up" | "deadline" | "status_change";
  priority: "low" | "medium" | "high" | "urgent";
  title: string;
  description: string;
  amount?: number;
  patientName: string;
  claimNumber: string;
  dueDate?: string;
  status: string;
  createdAt: string;
  appealId?: number;
}

interface TaskSummary {
  totalTasks: number;
  deniedClaims: number;
  agingClaims: number;
  upcomingDeadlines: number;
  totalAtRisk: number;
}

export default function BillingTasksPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  const { data: summary, isLoading: summaryLoading } = useQuery<TaskSummary>({
    queryKey: ["/api/billing-tasks/summary"],
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery<BillingTask[]>({
    queryKey: ["/api/billing-tasks"],
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "destructive";
      case "high":
        return "default";
      case "medium":
        return "secondary";
      case "low":
        return "outline";
      default:
        return "outline";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "denial":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "follow_up":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case "deadline":
        return <Calendar className="h-5 w-5 text-blue-500" />;
      case "status_change":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      default:
        return <FileText className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatDate = (date?: string) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return `${Math.abs(diffDays)} days overdue`;
    } else if (diffDays === 0) {
      return "Due today";
    } else if (diffDays === 1) {
      return "Due tomorrow";
    } else if (diffDays <= 7) {
      return `Due in ${diffDays} days`;
    } else {
      return d.toLocaleDateString();
    }
  };

  const handleDownloadAppeal = async (appealId: number) => {
    try {
      const response = await fetch(`/api/billing-documents/appeal-letter/${appealId}/pdf`);
      if (!response.ok) throw new Error("Failed to download appeal letter");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `appeal-letter-${appealId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Appeal letter downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to download appeal letter",
        variant: "destructive",
      });
    }
  };

  const filterTasks = (tasks: BillingTask[] | undefined, type?: string) => {
    if (!tasks) return [];

    let filtered = tasks;

    // Filter by type
    if (type && type !== "all") {
      filtered = filtered.filter((task) => task.type === type);
    }

    // Filter by priority
    if (priorityFilter !== "all") {
      filtered = filtered.filter((task) => task.priority === priorityFilter);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query) ||
          task.patientName.toLowerCase().includes(query) ||
          task.claimNumber.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  const renderTaskCard = (task: BillingTask) => (
    <Card key={task.id} className="mb-3 hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Left: Priority badge and icon */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <Badge variant={getPriorityColor(task.priority)} className="capitalize">
              {task.priority}
            </Badge>
            {getTypeIcon(task.type)}
          </div>

          {/* Middle: Task details */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base mb-1">{task.title}</h3>
            <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
            <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {task.claimNumber}
              </span>
              <span>{task.patientName}</span>
              {task.dueDate && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(task.dueDate)}
                </span>
              )}
            </div>
          </div>

          {/* Right: Amount and action */}
          <div className="flex flex-col items-end gap-2 pt-1">
            {task.amount && (
              <div className="text-lg font-semibold text-green-600">
                {formatCurrency(task.amount)}
              </div>
            )}
            {task.appealId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownloadAppeal(task.appealId!)}
              >
                <Download className="h-4 w-4 mr-1" />
                Appeal
              </Button>
            ) : (
              <Button size="sm" variant="ghost">
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderTaskList = (type?: string) => {
    const filtered = filterTasks(tasks, type);

    if (tasksLoading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-20 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (filtered.length === 0) {
      return (
        <div className="text-center py-12">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">All caught up!</h3>
          <p className="text-muted-foreground">
            {searchQuery || priorityFilter !== "all"
              ? "No tasks match your filters"
              : "No billing tasks at this time"}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {filtered.map(renderTaskCard)}
      </div>
    );
  };

  return (
    <div className="md:ml-64 p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Billing Tasks</h1>
        <p className="text-muted-foreground">
          Manage denials, appeals, and billing follow-ups
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total At Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold text-red-600">
                  {formatCurrency(summary?.totalAtRisk)}
                </div>
                <DollarSign className="h-8 w-8 text-red-500 opacity-50" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Denied Claims
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{summary?.deniedClaims || 0}</div>
                <XCircle className="h-8 w-8 text-orange-500 opacity-50" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aging Claims
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{summary?.agingClaims || 0}</div>
                <Clock className="h-8 w-8 text-yellow-500 opacity-50" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {summary?.upcomingDeadlines || 0}
                </div>
                <Calendar className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search tasks, claims, or patients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="sm:w-48">
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-5">
          <TabsTrigger value="all">
            All Tasks
            {!tasksLoading && tasks && (
              <Badge variant="secondary" className="ml-2">
                {filterTasks(tasks).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="denial">
            Denials
            {!tasksLoading && tasks && (
              <Badge variant="secondary" className="ml-2">
                {filterTasks(tasks, "denial").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="follow_up">
            Aging Claims
            {!tasksLoading && tasks && (
              <Badge variant="secondary" className="ml-2">
                {filterTasks(tasks, "follow_up").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="deadline">
            Deadlines
            {!tasksLoading && tasks && (
              <Badge variant="secondary" className="ml-2">
                {filterTasks(tasks, "deadline").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="status_change">
            Status Updates
            {!tasksLoading && tasks && (
              <Badge variant="secondary" className="ml-2">
                {filterTasks(tasks, "status_change").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">{renderTaskList()}</TabsContent>
        <TabsContent value="denial">{renderTaskList("denial")}</TabsContent>
        <TabsContent value="follow_up">{renderTaskList("follow_up")}</TabsContent>
        <TabsContent value="deadline">{renderTaskList("deadline")}</TabsContent>
        <TabsContent value="status_change">{renderTaskList("status_change")}</TabsContent>
      </Tabs>
    </div>
  );
}
