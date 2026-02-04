import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  Star,
  Send,
  MessageSquare,
  TrendingUp,
  Users,
  Clock,
  CheckCircle,
  Sparkles,
  Plus,
  ExternalLink,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Minus,
  AlertCircle,
  CheckCheck,
  Mail,
  Phone,
  Settings,
  Link,
  Save,
} from "lucide-react";

interface ReviewRequest {
  id: number;
  practiceId: number;
  patientId: number;
  appointmentId?: number;
  status: string;
  sentVia?: string;
  emailSent: boolean;
  smsSent: boolean;
  sentAt?: string;
  clickedAt?: string;
  reviewedAt?: string;
  createdAt: string;
}

interface GoogleReview {
  id: number;
  practiceId: number;
  reviewerName?: string;
  rating?: number;
  reviewText?: string;
  reviewDate?: string;
  responseStatus: string;
  aiDraftResponse?: string;
  finalResponse?: string;
  respondedAt?: string;
  sentiment?: string;
  tags?: string[];
  createdAt: string;
}

interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

interface PatientFeedback {
  id: number;
  practiceId: number;
  reviewRequestId: number;
  patientId: number;
  rating: number;
  feedbackText?: string;
  serviceRating?: number;
  staffRating?: number;
  facilityRating?: number;
  wouldRecommend?: boolean;
  sentiment?: string;
  isAddressed: boolean;
  addressedAt?: string;
  addressedBy?: string;
  addressNotes?: string;
  googlePostRequested: boolean;
  googlePostRequestedAt?: string;
  postedToGoogle: boolean;
  postedToGoogleAt?: string;
  createdAt: string;
  // Enriched fields
  patientName?: string;
  patientEmail?: string;
  patientPhone?: string;
}

interface FeedbackStats {
  totalFeedback: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  unaddressedNegative: number;
  googlePostsPending: number;
  googlePostsCompleted: number;
  averageRating: number;
}

interface ReviewStats {
  requests: {
    totalSent: number;
    pending: number;
    clicked: number;
    reviewed: number;
    declined: number;
    clickRate: number;
    reviewRate: number;
  };
  reviews: {
    totalReviews: number;
    averageRating: number;
    pendingResponses: number;
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    ratingDistribution: Record<number, number>;
  };
}

const SENTIMENT_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  positive: { bg: "bg-green-100", text: "text-green-800", icon: <ThumbsUp className="h-4 w-4" /> },
  neutral: { bg: "bg-gray-100", text: "text-gray-800", icon: <Minus className="h-4 w-4" /> },
  negative: { bg: "bg-red-100", text: "text-red-800", icon: <ThumbsDown className="h-4 w-4" /> },
};

const RESPONSE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  draft: "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
  skipped: "bg-gray-100 text-gray-800",
};

export default function ReviewsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedReview, setSelectedReview] = useState<GoogleReview | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<PatientFeedback | null>(null);
  const [isAddReviewOpen, setIsAddReviewOpen] = useState(false);
  const [isSendRequestOpen, setIsSendRequestOpen] = useState(false);
  const [responseFilter, setResponseFilter] = useState<string>("all");
  const [feedbackFilter, setFeedbackFilter] = useState<string>("all");
  const [editedResponse, setEditedResponse] = useState("");
  const [addressNotes, setAddressNotes] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");

  // Fetch stats
  const { data: stats } = useQuery<ReviewStats>({
    queryKey: ["/api/reviews/stats"],
    queryFn: async () => {
      const res = await fetch("/api/reviews/stats?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  // Fetch Google reviews
  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<GoogleReview[]>({
    queryKey: ["/api/reviews/google", responseFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ practiceId: "1" });
      if (responseFilter !== "all") {
        params.append("responseStatus", responseFilter);
      }
      const res = await fetch(`/api/reviews/google?${params}`);
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
  });

  // Fetch review requests
  const { data: requests = [] } = useQuery<ReviewRequest[]>({
    queryKey: ["/api/reviews/requests"],
    queryFn: async () => {
      const res = await fetch("/api/reviews/requests?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
  });

  // Fetch patients
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
    queryFn: async () => {
      const res = await fetch("/api/patients?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch patients");
      return res.json();
    },
  });

  // Fetch patient feedback
  const { data: feedback = [], isLoading: feedbackLoading } = useQuery<PatientFeedback[]>({
    queryKey: ["/api/feedback", feedbackFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ practiceId: "1" });
      if (feedbackFilter !== "all") {
        params.append("sentiment", feedbackFilter);
      }
      const res = await fetch(`/api/feedback?${params}`);
      if (!res.ok) throw new Error("Failed to fetch feedback");
      return res.json();
    },
  });

  // Fetch feedback stats
  const { data: feedbackStats } = useQuery<FeedbackStats>({
    queryKey: ["/api/feedback/stats"],
    queryFn: async () => {
      const res = await fetch("/api/feedback/stats?practiceId=1");
      if (!res.ok) throw new Error("Failed to fetch feedback stats");
      return res.json();
    },
  });

  // Fetch practice settings (for Google Review URL)
  const { data: practice } = useQuery<{ id: number; name: string; googleReviewUrl?: string }>({
    queryKey: ["/api/practices/1"],
    queryFn: async () => {
      const res = await fetch("/api/practices/1");
      if (!res.ok) throw new Error("Failed to fetch practice");
      return res.json();
    },
    onSuccess: (data: { googleReviewUrl?: string }) => {
      if (data?.googleReviewUrl) {
        setGoogleReviewUrl(data.googleReviewUrl);
      }
    },
  } as any);

  // Update Google Review URL mutation
  const updateGoogleUrl = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch("/api/practices/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleReviewUrl: url }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/practices/1"] });
      toast({ title: "Google Review URL saved!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save URL", variant: "destructive" });
    },
  });

  // Address feedback mutation
  const addressFeedback = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const res = await fetch(`/api/feedback/${id}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressNotes: notes }),
      });
      if (!res.ok) throw new Error("Failed to address feedback");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      setSelectedFeedback(null);
      setAddressNotes("");
      toast({ title: "Feedback addressed" });
    },
  });

  // Request Google post mutation
  const requestGooglePost = useMutation({
    mutationFn: async ({ id, sendVia }: { id: number; sendVia: string }) => {
      const res = await fetch(`/api/feedback/${id}/request-google-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendVia }),
      });
      if (!res.ok) throw new Error("Failed to request Google post");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      toast({
        title: "Google post request sent",
        description: data.emailSent ? "Email sent" : data.smsSent ? "SMS sent" : undefined,
      });
    },
  });

  // Mark as posted to Google mutation
  const markPostedToGoogle = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/feedback/${id}/mark-posted`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to mark as posted");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback/stats"] });
      toast({ title: "Marked as posted to Google" });
    },
  });

  // Add Google review mutation
  const addReview = useMutation({
    mutationFn: async (data: Partial<GoogleReview>) => {
      const res = await fetch("/api/reviews/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add review");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/google"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/stats"] });
      setIsAddReviewOpen(false);
      toast({ title: "Review added" });
    },
  });

  // Generate AI response mutation
  const generateResponse = useMutation({
    mutationFn: async ({ id, tone }: { id: number; tone: string }) => {
      const res = await fetch(`/api/reviews/google/${id}/generate-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone }),
      });
      if (!res.ok) throw new Error("Failed to generate response");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/google"] });
      setEditedResponse(data.response);
      toast({ title: "AI response generated" });
    },
  });

  // Publish response mutation
  const publishResponse = useMutation({
    mutationFn: async ({ id, finalResponse }: { id: number; finalResponse: string }) => {
      const res = await fetch(`/api/reviews/google/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalResponse }),
      });
      if (!res.ok) throw new Error("Failed to publish response");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/google"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/stats"] });
      setSelectedReview(null);
      toast({ title: "Response marked as published" });
    },
  });

  // Send review request mutation
  const sendRequest = useMutation({
    mutationFn: async (data: { patientId: number; googleReviewUrl: string; sendVia: string }) => {
      // First create the request
      const createRes = await fetch("/api/reviews/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: data.patientId }),
      });
      if (!createRes.ok) throw new Error("Failed to create request");
      const request = await createRes.json();

      // Then send it
      const sendRes = await fetch(`/api/reviews/requests/${request.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleReviewUrl: data.googleReviewUrl, sendVia: data.sendVia }),
      });
      if (!sendRes.ok) throw new Error("Failed to send request");
      return sendRes.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/stats"] });
      setIsSendRequestOpen(false);
      if (data.emailSent || data.smsSent) {
        toast({
          title: "Review request sent",
          description: `Email: ${data.emailSent ? "Sent" : "Not sent"}, SMS: ${data.smsSent ? "Sent" : "Not sent"}`,
        });
      } else {
        toast({
          title: "Failed to send request",
          description: data.errors?.join(", "),
          variant: "destructive",
        });
      }
    },
  });

  // Get patient name
  const getPatientName = (patientId: number) => {
    const patient = patients.find((p) => p.id === patientId);
    return patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${patientId}`;
  };

  // Render stars
  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="md:ml-64 p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Review Management</h1>
          <p className="text-muted-foreground">
            Request reviews from patients and respond to Google reviews
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isSendRequestOpen} onOpenChange={setIsSendRequestOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Send className="mr-2 h-4 w-4" />
                Request Review
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Review Request</DialogTitle>
                <DialogDescription>
                  Send a review request email/SMS to a patient
                </DialogDescription>
              </DialogHeader>
              <SendRequestForm
                patients={patients}
                onSubmit={(data) => sendRequest.mutate(data)}
                isLoading={sendRequest.isPending}
              />
            </DialogContent>
          </Dialog>
          <Dialog open={isAddReviewOpen} onOpenChange={setIsAddReviewOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Review
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Google Review</DialogTitle>
                <DialogDescription>
                  Manually add a review to track and respond to
                </DialogDescription>
              </DialogHeader>
              <AddReviewForm
                onSubmit={(data) => addReview.mutate(data)}
                isLoading={addReview.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.reviews.averageRating?.toFixed(1) || "0"}</p>
                <p className="text-xs text-muted-foreground">Avg Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.reviews.totalReviews || 0}</p>
                <p className="text-xs text-muted-foreground">Total Reviews</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.reviews.pendingResponses || 0}</p>
                <p className="text-xs text-muted-foreground">Need Response</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.reviews.positiveCount || 0}</p>
                <p className="text-xs text-muted-foreground">Positive</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.requests.totalSent || 0}</p>
                <p className="text-xs text-muted-foreground">Requests Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.requests.clickRate || 0}%</p>
                <p className="text-xs text-muted-foreground">Click Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-teal-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.requests.reviewRate || 0}%</p>
                <p className="text-xs text-muted-foreground">Review Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-500" />
              <div>
                <p className="text-2xl font-bold">{stats?.requests.reviewed || 0}</p>
                <p className="text-xs text-muted-foreground">Converted</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Feedback, Reviews and Requests */}
      <Tabs defaultValue="feedback" className="space-y-4">
        <TabsList>
          <TabsTrigger value="feedback">Patient Feedback</TabsTrigger>
          <TabsTrigger value="reviews">Google Reviews</TabsTrigger>
          <TabsTrigger value="requests">Review Requests</TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feedback" className="space-y-4">
          {/* Feedback Stats */}
          {feedbackStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    <span className="text-sm text-muted-foreground">Total Feedback</span>
                  </div>
                  <p className="text-2xl font-bold">{feedbackStats.totalFeedback}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <ThumbsUp className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-muted-foreground">Positive</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600">{feedbackStats.positiveCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm text-muted-foreground">Needs Attention</span>
                  </div>
                  <p className="text-2xl font-bold text-red-600">{feedbackStats.unaddressedNegative}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm text-muted-foreground">Avg Rating</span>
                  </div>
                  <p className="text-2xl font-bold">{feedbackStats.averageRating}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Filter */}
          <div className="flex gap-4 items-center">
            <Label>Filter by sentiment:</Label>
            <Select value={feedbackFilter} onValueChange={setFeedbackFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="positive">Positive</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
                <SelectItem value="negative">Negative</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Feedback List */}
          <Card>
            <CardHeader>
              <CardTitle>Patient Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              {feedbackLoading ? (
                <p className="text-center py-8 text-muted-foreground">Loading...</p>
              ) : feedback.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No patient feedback received yet. Send review requests to collect feedback.
                </p>
              ) : (
                <div className="space-y-4">
                  {feedback.map((fb) => (
                    <div
                      key={fb.id}
                      className={`p-4 border rounded-lg hover:bg-muted/50 cursor-pointer ${
                        fb.sentiment === 'negative' && !fb.isAddressed ? 'border-red-300 bg-red-50' : ''
                      }`}
                      onClick={() => setSelectedFeedback(fb)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{fb.patientName}</span>
                            {fb.rating && renderStars(fb.rating)}
                            {fb.sentiment && (
                              <Badge className={`${SENTIMENT_COLORS[fb.sentiment]?.bg} ${SENTIMENT_COLORS[fb.sentiment]?.text}`}>
                                <span className="flex items-center gap-1">
                                  {SENTIMENT_COLORS[fb.sentiment]?.icon}
                                  {fb.sentiment}
                                </span>
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {fb.feedbackText || "No comments provided"}
                          </p>
                          <div className="flex gap-2">
                            {fb.wouldRecommend === true && (
                              <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                                Would recommend
                              </Badge>
                            )}
                            {fb.wouldRecommend === false && (
                              <Badge variant="outline" className="text-xs text-red-600 border-red-300">
                                Would not recommend
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {fb.sentiment === 'negative' && !fb.isAddressed && (
                            <Badge className="bg-red-100 text-red-800">Needs attention</Badge>
                          )}
                          {fb.isAddressed && (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckCheck className="h-3 w-3 mr-1" />
                              Addressed
                            </Badge>
                          )}
                          {fb.googlePostRequested && !fb.postedToGoogle && (
                            <Badge className="bg-blue-100 text-blue-800">Google request sent</Badge>
                          )}
                          {fb.postedToGoogle && (
                            <Badge className="bg-green-100 text-green-800">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Posted to Google
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {new Date(fb.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reviews" className="space-y-4">
          {/* Filter */}
          <div className="flex gap-4 items-center">
            <Label>Filter by status:</Label>
            <Select value={responseFilter} onValueChange={setResponseFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Reviews List */}
          <Card>
            <CardHeader>
              <CardTitle>Reviews</CardTitle>
            </CardHeader>
            <CardContent>
              {reviewsLoading ? (
                <p className="text-center py-8 text-muted-foreground">Loading...</p>
              ) : reviews.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No reviews found. Add reviews manually or wait for patients to leave reviews.
                </p>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div
                      key={review.id}
                      className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        setSelectedReview(review);
                        setEditedResponse(review.aiDraftResponse || review.finalResponse || "");
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{review.reviewerName || "Anonymous"}</span>
                            {review.rating && renderStars(review.rating)}
                            {review.sentiment && (
                              <Badge className={`${SENTIMENT_COLORS[review.sentiment]?.bg} ${SENTIMENT_COLORS[review.sentiment]?.text}`}>
                                <span className="flex items-center gap-1">
                                  {SENTIMENT_COLORS[review.sentiment]?.icon}
                                  {review.sentiment}
                                </span>
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {review.reviewText || "No review text"}
                          </p>
                          {review.tags && (review.tags as string[]).length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {(review.tags as string[]).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge className={RESPONSE_STATUS_COLORS[review.responseStatus]}>
                            {review.responseStatus}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {review.reviewDate
                              ? new Date(review.reviewDate).toLocaleDateString()
                              : "No date"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Review Requests</CardTitle>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  No review requests sent yet
                </p>
              ) : (
                <div className="space-y-3">
                  {requests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{getPatientName(request.patientId)}</p>
                        <p className="text-sm text-muted-foreground">
                          {request.sentAt
                            ? `Sent ${new Date(request.sentAt).toLocaleDateString()}`
                            : "Not sent yet"}
                          {request.sentVia && ` via ${request.sentVia}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {request.emailSent && (
                          <Badge variant="outline">Email</Badge>
                        )}
                        {request.smsSent && (
                          <Badge variant="outline">SMS</Badge>
                        )}
                        <Badge
                          className={
                            request.status === "reviewed"
                              ? "bg-green-100 text-green-800"
                              : request.status === "clicked"
                              ? "bg-blue-100 text-blue-800"
                              : request.status === "sent"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-gray-100 text-gray-800"
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link className="h-5 w-5" />
                Google Review URL
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="googleReviewUrl">Your Google Review Link</Label>
                <div className="flex gap-2">
                  <Input
                    id="googleReviewUrl"
                    value={googleReviewUrl}
                    onChange={(e) => setGoogleReviewUrl(e.target.value)}
                    placeholder="https://g.page/r/your-business-id/review"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => updateGoogleUrl.mutate(googleReviewUrl)}
                    disabled={updateGoogleUrl.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {updateGoogleUrl.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  This URL is used when sending review requests to patients. When they click the link, they'll be taken directly to your Google review page.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-blue-900">How to get your Google Review URL:</h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                  <li>Go to <a href="https://business.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Business Profile</a></li>
                  <li>Click on your business</li>
                  <li>Click "Get more reviews" or find "Share review form"</li>
                  <li>Copy the link and paste it above</li>
                </ol>
                <p className="text-xs text-blue-700">
                  The URL usually looks like: https://g.page/r/XXXXX/review
                </p>
              </div>

              {googleReviewUrl && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-green-800">Google Review URL is configured</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(googleReviewUrl, '_blank')}
                    className="ml-auto"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Test Link
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review Detail Sheet */}
      <Sheet open={!!selectedReview} onOpenChange={() => setSelectedReview(null)}>
        <SheetContent className="w-[500px] sm:w-[640px] overflow-y-auto">
          {selectedReview && (
            <>
              <SheetHeader>
                <SheetTitle>Review from {selectedReview.reviewerName || "Anonymous"}</SheetTitle>
                <SheetDescription>
                  {selectedReview.reviewDate
                    ? new Date(selectedReview.reviewDate).toLocaleDateString()
                    : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {/* Rating */}
                <div className="flex items-center gap-3">
                  {selectedReview.rating && renderStars(selectedReview.rating)}
                  {selectedReview.sentiment && (
                    <Badge className={`${SENTIMENT_COLORS[selectedReview.sentiment]?.bg} ${SENTIMENT_COLORS[selectedReview.sentiment]?.text}`}>
                      {selectedReview.sentiment}
                    </Badge>
                  )}
                </div>

                {/* Review Text */}
                <div className="space-y-2">
                  <h4 className="font-medium">Review</h4>
                  <p className="text-sm bg-muted p-3 rounded-lg">
                    {selectedReview.reviewText || "No review text"}
                  </p>
                </div>

                {/* Tags */}
                {selectedReview.tags && (selectedReview.tags as string[]).length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Topics</h4>
                    <div className="flex gap-1 flex-wrap">
                      {(selectedReview.tags as string[]).map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Response Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Response</h4>
                    {selectedReview.responseStatus !== "published" && (
                      <div className="flex gap-2">
                        <Select
                          defaultValue="professional"
                          onValueChange={(tone) =>
                            generateResponse.mutate({ id: selectedReview.id, tone })
                          }
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Tone" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="professional">Professional</SelectItem>
                            <SelectItem value="friendly">Friendly</SelectItem>
                            <SelectItem value="empathetic">Empathetic</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            generateResponse.mutate({
                              id: selectedReview.id,
                              tone: "professional",
                            })
                          }
                          disabled={generateResponse.isPending}
                        >
                          <Sparkles className="mr-1 h-4 w-4" />
                          {generateResponse.isPending ? "Generating..." : "Generate"}
                        </Button>
                      </div>
                    )}
                  </div>

                  <Textarea
                    value={editedResponse}
                    onChange={(e) => setEditedResponse(e.target.value)}
                    placeholder="Write or generate a response..."
                    rows={6}
                    disabled={selectedReview.responseStatus === "published"}
                  />

                  {selectedReview.responseStatus !== "published" && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          navigator.clipboard.writeText(editedResponse);
                          toast({ title: "Copied to clipboard" });
                        }}
                        disabled={!editedResponse}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copy
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() =>
                          publishResponse.mutate({
                            id: selectedReview.id,
                            finalResponse: editedResponse,
                          })
                        }
                        disabled={!editedResponse || publishResponse.isPending}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Mark as Published
                      </Button>
                    </div>
                  )}

                  {selectedReview.responseStatus === "published" && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Response published
                      {selectedReview.respondedAt &&
                        ` on ${new Date(selectedReview.respondedAt).toLocaleDateString()}`}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Feedback Detail Sheet */}
      <Sheet open={!!selectedFeedback} onOpenChange={() => {
        setSelectedFeedback(null);
        setAddressNotes("");
      }}>
        <SheetContent className="w-[500px] sm:w-[640px] overflow-y-auto">
          {selectedFeedback && (
            <>
              <SheetHeader>
                <SheetTitle>Feedback from {selectedFeedback.patientName}</SheetTitle>
                <SheetDescription>
                  Received {new Date(selectedFeedback.createdAt).toLocaleDateString()}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {/* Overall Rating */}
                <div className="flex items-center gap-3">
                  {selectedFeedback.rating && renderStars(selectedFeedback.rating)}
                  {selectedFeedback.sentiment && (
                    <Badge className={`${SENTIMENT_COLORS[selectedFeedback.sentiment]?.bg} ${SENTIMENT_COLORS[selectedFeedback.sentiment]?.text}`}>
                      {selectedFeedback.sentiment}
                    </Badge>
                  )}
                </div>

                {/* Detailed Ratings */}
                {(selectedFeedback.serviceRating || selectedFeedback.staffRating || selectedFeedback.facilityRating) && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Detailed Ratings</h4>
                    <div className="grid grid-cols-3 gap-4">
                      {selectedFeedback.serviceRating && (
                        <div className="text-center p-2 bg-muted rounded">
                          <p className="text-xs text-muted-foreground">Service</p>
                          <p className="font-bold">{selectedFeedback.serviceRating}/5</p>
                        </div>
                      )}
                      {selectedFeedback.staffRating && (
                        <div className="text-center p-2 bg-muted rounded">
                          <p className="text-xs text-muted-foreground">Staff</p>
                          <p className="font-bold">{selectedFeedback.staffRating}/5</p>
                        </div>
                      )}
                      {selectedFeedback.facilityRating && (
                        <div className="text-center p-2 bg-muted rounded">
                          <p className="text-xs text-muted-foreground">Facility</p>
                          <p className="font-bold">{selectedFeedback.facilityRating}/5</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Would Recommend */}
                {selectedFeedback.wouldRecommend !== null && (
                  <div className="flex items-center gap-2">
                    {selectedFeedback.wouldRecommend ? (
                      <>
                        <ThumbsUp className="h-5 w-5 text-green-500" />
                        <span className="text-green-700">Would recommend to others</span>
                      </>
                    ) : (
                      <>
                        <ThumbsDown className="h-5 w-5 text-red-500" />
                        <span className="text-red-700">Would not recommend</span>
                      </>
                    )}
                  </div>
                )}

                {/* Feedback Text */}
                <div className="space-y-2">
                  <h4 className="font-medium">Comments</h4>
                  <p className="text-sm bg-muted p-3 rounded-lg">
                    {selectedFeedback.feedbackText || "No comments provided"}
                  </p>
                </div>

                {/* Patient Contact Info */}
                <div className="space-y-2">
                  <h4 className="font-medium">Patient Contact</h4>
                  <div className="flex flex-col gap-1 text-sm">
                    {selectedFeedback.patientEmail && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {selectedFeedback.patientEmail}
                      </div>
                    )}
                    {selectedFeedback.patientPhone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        {selectedFeedback.patientPhone}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions for Negative Feedback */}
                {selectedFeedback.sentiment === 'negative' && !selectedFeedback.isAddressed && (
                  <div className="space-y-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center gap-2 text-red-800">
                      <AlertCircle className="h-5 w-5" />
                      <h4 className="font-medium">This feedback needs attention</h4>
                    </div>
                    <div className="space-y-2">
                      <Label>Resolution Notes</Label>
                      <Textarea
                        value={addressNotes}
                        onChange={(e) => setAddressNotes(e.target.value)}
                        placeholder="Describe how you addressed this feedback..."
                        rows={3}
                      />
                    </div>
                    <Button
                      onClick={() => addressFeedback.mutate({ id: selectedFeedback.id, notes: addressNotes })}
                      disabled={addressFeedback.isPending}
                      className="w-full"
                    >
                      <CheckCheck className="mr-2 h-4 w-4" />
                      Mark as Addressed
                    </Button>
                  </div>
                )}

                {/* Addressed Status */}
                {selectedFeedback.isAddressed && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800 mb-2">
                      <CheckCheck className="h-5 w-5" />
                      <h4 className="font-medium">Addressed</h4>
                    </div>
                    {selectedFeedback.addressNotes && (
                      <p className="text-sm text-green-700">{selectedFeedback.addressNotes}</p>
                    )}
                    {selectedFeedback.addressedAt && (
                      <p className="text-xs text-green-600 mt-2">
                        {new Date(selectedFeedback.addressedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}

                {/* Actions for Positive Feedback */}
                {selectedFeedback.sentiment === 'positive' && (
                  <div className="space-y-4">
                    {!selectedFeedback.googlePostRequested && !selectedFeedback.postedToGoogle && (
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="font-medium text-blue-800 mb-3">
                          Request Google Review
                        </h4>
                        <p className="text-sm text-blue-700 mb-4">
                          This patient had a positive experience! Ask them to share it on Google.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => requestGooglePost.mutate({ id: selectedFeedback.id, sendVia: 'email' })}
                            disabled={!selectedFeedback.patientEmail || requestGooglePost.isPending}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            Send Email
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => requestGooglePost.mutate({ id: selectedFeedback.id, sendVia: 'sms' })}
                            disabled={!selectedFeedback.patientPhone || requestGooglePost.isPending}
                          >
                            <Phone className="mr-2 h-4 w-4" />
                            Send SMS
                          </Button>
                          <Button
                            onClick={() => requestGooglePost.mutate({ id: selectedFeedback.id, sendVia: 'both' })}
                            disabled={(!selectedFeedback.patientEmail && !selectedFeedback.patientPhone) || requestGooglePost.isPending}
                          >
                            <Send className="mr-2 h-4 w-4" />
                            Send Both
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedFeedback.googlePostRequested && !selectedFeedback.postedToGoogle && (
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-yellow-800">Google Post Requested</h4>
                            <p className="text-sm text-yellow-700">
                              Sent {selectedFeedback.googlePostRequestedAt
                                ? new Date(selectedFeedback.googlePostRequestedAt).toLocaleDateString()
                                : 'recently'}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => markPostedToGoogle.mutate(selectedFeedback.id)}
                            disabled={markPostedToGoogle.isPending}
                          >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Mark as Posted
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedFeedback.postedToGoogle && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2 text-green-800">
                          <ExternalLink className="h-5 w-5" />
                          <h4 className="font-medium">Posted to Google</h4>
                        </div>
                        {selectedFeedback.postedToGoogleAt && (
                          <p className="text-sm text-green-700 mt-1">
                            {new Date(selectedFeedback.postedToGoogleAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Add Review Form
function AddReviewForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: Partial<GoogleReview>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    reviewerName: "",
    rating: "5",
    reviewText: "",
    reviewDate: new Date().toISOString().split("T")[0],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      reviewerName: formData.reviewerName,
      rating: parseInt(formData.rating),
      reviewText: formData.reviewText,
      reviewDate: new Date(formData.reviewDate).toISOString(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Reviewer Name</Label>
        <Input
          value={formData.reviewerName}
          onChange={(e) => setFormData((prev) => ({ ...prev, reviewerName: e.target.value }))}
          placeholder="John D."
        />
      </div>
      <div className="space-y-2">
        <Label>Rating</Label>
        <Select
          value={formData.rating}
          onValueChange={(value) => setFormData((prev) => ({ ...prev, rating: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[5, 4, 3, 2, 1].map((rating) => (
              <SelectItem key={rating} value={String(rating)}>
                {rating} Star{rating !== 1 ? "s" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Review Text</Label>
        <Textarea
          value={formData.reviewText}
          onChange={(e) => setFormData((prev) => ({ ...prev, reviewText: e.target.value }))}
          placeholder="Paste the review text here..."
          rows={4}
        />
      </div>
      <div className="space-y-2">
        <Label>Review Date</Label>
        <Input
          type="date"
          value={formData.reviewDate}
          onChange={(e) => setFormData((prev) => ({ ...prev, reviewDate: e.target.value }))}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Adding..." : "Add Review"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Send Request Form
function SendRequestForm({
  patients,
  onSubmit,
  isLoading,
}: {
  patients: Patient[];
  onSubmit: (data: { patientId: number; googleReviewUrl: string; sendVia: string }) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    patientId: "",
    googleReviewUrl: "",
    sendVia: "both",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      patientId: parseInt(formData.patientId),
      googleReviewUrl: formData.googleReviewUrl,
      sendVia: formData.sendVia,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient</Label>
        <Select
          value={formData.patientId}
          onValueChange={(value) => setFormData((prev) => ({ ...prev, patientId: value }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a patient" />
          </SelectTrigger>
          <SelectContent>
            {patients.map((patient) => (
              <SelectItem key={patient.id} value={String(patient.id)}>
                {patient.firstName} {patient.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Google Review URL</Label>
        <Input
          value={formData.googleReviewUrl}
          onChange={(e) => setFormData((prev) => ({ ...prev, googleReviewUrl: e.target.value }))}
          placeholder="https://g.page/r/..."
        />
        <p className="text-xs text-muted-foreground">
          Get this from your Google Business Profile
        </p>
      </div>
      <div className="space-y-2">
        <Label>Send Via</Label>
        <Select
          value={formData.sendVia}
          onValueChange={(value) => setFormData((prev) => ({ ...prev, sendVia: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Email & SMS</SelectItem>
            <SelectItem value="email">Email Only</SelectItem>
            <SelectItem value="sms">SMS Only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button
          type="submit"
          disabled={!formData.patientId || !formData.googleReviewUrl || isLoading}
        >
          <Send className="mr-2 h-4 w-4" />
          {isLoading ? "Sending..." : "Send Request"}
        </Button>
      </DialogFooter>
    </form>
  );
}
