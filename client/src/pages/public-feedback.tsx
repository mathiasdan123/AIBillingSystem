import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Star, Check, Loader2, Heart, ExternalLink, ThumbsUp, ThumbsDown } from "lucide-react";

interface FeedbackFormData {
  practiceName: string;
  patientFirstName: string;
  practiceId: number;
}

export default function PublicFeedback() {
  const params = useParams();
  const token = params.token as string;

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [serviceRating, setServiceRating] = useState(0);
  const [staffRating, setStaffRating] = useState(0);
  const [facilityRating, setFacilityRating] = useState(0);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [googleReviewUrl, setGoogleReviewUrl] = useState<string | null>(null);

  // Fetch form data
  const { data: formData, isLoading, error } = useQuery<FeedbackFormData>({
    queryKey: ["/api/public/feedback", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/feedback/${token}`);
      if (!res.ok) {
        const data = await res.json();
        if (data.alreadySubmitted) {
          setSubmitted(true);
        }
        throw new Error(data.message || "Failed to load feedback form");
      }
      return res.json();
    },
    enabled: !!token,
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: {
      rating: number;
      feedbackText: string;
      serviceRating: number;
      staffRating: number;
      facilityRating: number;
      wouldRecommend: boolean | null;
    }) => {
      const res = await fetch(`/api/public/feedback/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
      return res.json();
    },
    onSuccess: (data) => {
      setSubmitted(true);
      if (data.googleReviewUrl) {
        setGoogleReviewUrl(data.googleReviewUrl);
      }
    },
  });

  const handleSubmit = () => {
    if (rating === 0) return;
    submitMutation.mutate({
      rating,
      feedbackText,
      serviceRating,
      staffRating,
      facilityRating,
      wouldRecommend,
    });
  };

  // Star rating component
  const StarRating = ({
    value,
    onChange,
    onHover,
    size = "lg",
  }: {
    value: number;
    onChange: (n: number) => void;
    onHover?: (n: number) => void;
    size?: "sm" | "lg";
  }) => {
    const displayValue = onHover && hoverRating > 0 ? hoverRating : value;
    const starSize = size === "lg" ? "w-12 h-12" : "w-8 h-8";

    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => onHover?.(star)}
            onMouseLeave={() => onHover?.(0)}
            className="focus:outline-none transition-transform hover:scale-110"
          >
            <Star
              className={`${starSize} ${
                star <= displayValue
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-slate-300"
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error && !submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <ThumbsDown className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              Oops! Something went wrong
            </h2>
            <p className="text-slate-600">
              {(error as Error).message || "This feedback link may be invalid or expired."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Thank you screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3">
              Thank You for Your Feedback!
            </h2>
            <p className="text-slate-600 mb-6">
              Your feedback helps us improve our services and provide better care for all our patients.
            </p>

            {googleReviewUrl && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
                <Heart className="w-8 h-8 text-blue-500 mx-auto mb-3" />
                <p className="text-blue-900 font-medium mb-3">
                  We're so glad you had a positive experience!
                </p>
                <p className="text-blue-700 text-sm mb-4">
                  Would you mind sharing your feedback on Google? It helps others find quality care.
                </p>
                <Button
                  onClick={() => window.open(googleReviewUrl, "_blank")}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Share on Google
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const getRatingLabel = (r: number) => {
    switch (r) {
      case 1: return "Poor";
      case 2: return "Fair";
      case 3: return "Good";
      case 4: return "Very Good";
      case 5: return "Excellent";
      default: return "";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            How was your visit?
          </h1>
          <p className="text-slate-600">
            Hi {formData?.patientFirstName}, we'd love to hear about your experience at{" "}
            <span className="font-semibold">{formData?.practiceName}</span>
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Share Your Feedback</CardTitle>
            <CardDescription>
              Your honest feedback helps us improve our services
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Overall Rating */}
            <div className="text-center">
              <Label className="text-lg font-medium mb-4 block">
                Overall Experience
              </Label>
              <StarRating
                value={rating}
                onChange={setRating}
                onHover={setHoverRating}
                size="lg"
              />
              {(rating > 0 || hoverRating > 0) && (
                <p className="mt-2 text-lg font-medium text-slate-700">
                  {getRatingLabel(hoverRating || rating)}
                </p>
              )}
            </div>

            {/* Detailed Ratings */}
            {rating > 0 && (
              <div className="grid gap-6 pt-4 border-t">
                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Quality of Service
                  </Label>
                  <StarRating
                    value={serviceRating}
                    onChange={setServiceRating}
                    size="sm"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Staff Friendliness
                  </Label>
                  <StarRating
                    value={staffRating}
                    onChange={setStaffRating}
                    size="sm"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Facility & Environment
                  </Label>
                  <StarRating
                    value={facilityRating}
                    onChange={setFacilityRating}
                    size="sm"
                  />
                </div>

                {/* Would Recommend */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">
                    Would you recommend us to friends or family?
                  </Label>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant={wouldRecommend === true ? "default" : "outline"}
                      onClick={() => setWouldRecommend(true)}
                      className="flex-1"
                    >
                      <ThumbsUp className="w-4 h-4 mr-2" />
                      Yes
                    </Button>
                    <Button
                      type="button"
                      variant={wouldRecommend === false ? "default" : "outline"}
                      onClick={() => setWouldRecommend(false)}
                      className="flex-1"
                    >
                      <ThumbsDown className="w-4 h-4 mr-2" />
                      No
                    </Button>
                  </div>
                </div>

                {/* Comments */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Additional Comments (Optional)
                  </Label>
                  <Textarea
                    placeholder="Tell us more about your experience..."
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    rows={4}
                    className="resize-none"
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            {rating > 0 && (
              <Button
                onClick={handleSubmit}
                disabled={submitMutation.isPending}
                className="w-full py-6 text-lg"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Feedback"
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-slate-500 mt-6">
          Your feedback is confidential and helps us serve you better.
        </p>
      </div>
    </div>
  );
}
