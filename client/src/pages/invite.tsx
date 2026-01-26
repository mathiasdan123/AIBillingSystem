import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, AlertCircle, Mail, UserPlus } from "lucide-react";

interface InviteInfo {
  email: string;
  role: string;
  expiresAt: string;
}

export default function InvitePage() {
  const [, params] = useRoute("/invite/:token");
  const token = params?.token;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);

  // Fetch invite info
  const { data: invite, isLoading: inviteLoading, error: inviteError } = useQuery<InviteInfo>({
    queryKey: ['/api/invites', token],
    queryFn: async () => {
      const response = await fetch(`/api/invites/${token}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to fetch invite");
      }
      return response.json();
    },
    enabled: !!token,
    retry: false,
  });

  // Accept invite mutation
  const acceptInviteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/invites/${token}/accept`, {});
      return response.json();
    },
    onSuccess: (data) => {
      setAccepted(true);
      toast({
        title: "Welcome!",
        description: `You've joined as ${data.role}. Redirecting to dashboard...`,
      });
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to accept invite",
        variant: "destructive",
      });
    },
  });

  const handleSignIn = () => {
    // Store the invite token so we can redirect back after login
    sessionStorage.setItem("pendingInviteToken", token || "");
    window.location.href = "/api/login";
  };

  const handleAcceptInvite = () => {
    acceptInviteMutation.mutate();
  };

  // Check for pending invite after login
  useEffect(() => {
    const pendingToken = sessionStorage.getItem("pendingInviteToken");
    if (pendingToken && isAuthenticated && token === pendingToken) {
      sessionStorage.removeItem("pendingInviteToken");
      // Auto-accept the invite after login
      acceptInviteMutation.mutate();
    }
  }, [isAuthenticated, token]);

  if (inviteLoading || authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
            <p className="text-center text-slate-600 mt-4">Loading invite...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (inviteError || !invite) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <CardTitle>Invalid or Expired Invite</CardTitle>
            <CardDescription>
              {(inviteError as Error)?.message || "This invite link is no longer valid."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.href = "/"}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <CardTitle>Welcome to the Team!</CardTitle>
            <CardDescription>
              Your account has been set up successfully. Redirecting you to the dashboard...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserPlus className="w-8 h-8 text-blue-600" />
          </div>
          <CardTitle>You're Invited!</CardTitle>
          <CardDescription>
            You've been invited to join TherapyBill AI
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-slate-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center text-sm">
              <Mail className="w-4 h-4 mr-2 text-slate-500" />
              <span className="text-slate-600">Invited email:</span>
              <span className="ml-auto font-medium">{invite.email}</span>
            </div>
            <div className="flex items-center text-sm">
              <UserPlus className="w-4 h-4 mr-2 text-slate-500" />
              <span className="text-slate-600">Role:</span>
              <span className="ml-auto font-medium capitalize">{invite.role}</span>
            </div>
          </div>

          {isAuthenticated ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 text-center">
                You're signed in as <strong>{(user as any)?.email}</strong>
              </p>
              <Button
                onClick={handleAcceptInvite}
                className="w-full"
                disabled={acceptInviteMutation.isPending}
              >
                {acceptInviteMutation.isPending ? "Accepting..." : "Accept Invite & Join"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 text-center">
                Sign in to accept this invite and join the team.
              </p>
              <Button onClick={handleSignIn} className="w-full">
                Sign In to Accept
              </Button>
            </div>
          )}

          <p className="text-xs text-slate-500 text-center">
            This invite expires on {new Date(invite.expiresAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
