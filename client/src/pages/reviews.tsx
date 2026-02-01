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
  const [isAddReviewOpen, setIsAddReviewOpen] = useState(false);
  const [isSendRequestOpen, setIsSendRequestOpen] = useState(false);
  const [responseFilter, setResponseFilter] = useState<string>("all");
  const [editedResponse, setEditedResponse] = useState("");

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
    <div className="p-6 space-y-6">
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

      {/* Tabs for Reviews and Requests */}
      <Tabs defaultValue="reviews" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reviews">Google Reviews</TabsTrigger>
          <TabsTrigger value="requests">Review Requests</TabsTrigger>
        </TabsList>

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
