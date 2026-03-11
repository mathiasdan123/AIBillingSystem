import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, AlertCircle, Mail, UserPlus, Eye, EyeOff, XCircle } from "lucide-react";

interface InviteInfo {
  email: string;
  role: string;
  expiresAt: string;
}

interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
}

const passwordRequirements: PasswordRequirement[] = [
  { label: 'At least 12 characters', test: (p) => p.length >= 12 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One number', test: (p) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

export default function InvitePage() {
  const [, params] = useRoute("/invite/:token");
  const token = params?.token;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [accepted, setAccepted] = useState(false);

  // Registration form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

  // Accept invite mutation (for already authenticated users)
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

  // Register with invite mutation
  const registerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: invite?.email,
          password,
          firstName,
          lastName,
          inviteToken: token,
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.errors) {
          throw new Error(data.errors.join('. '));
        }
        throw new Error(data.message || 'Registration failed');
      }

      return data;
    },
    onSuccess: () => {
      setAccepted(true);
      toast({
        title: "Welcome!",
        description: "Your account has been created. Redirecting to dashboard...",
      });
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to create account",
        variant: "destructive",
      });
    },
  });

  const handleAcceptInvite = () => {
    acceptInviteMutation.mutate();
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please ensure both passwords are the same.",
        variant: "destructive",
      });
      return;
    }

    registerMutation.mutate();
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

  const isPasswordValid = passwordRequirements.every(req => req.test(password));
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

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
            <form onSubmit={handleRegister} className="space-y-4">
              <p className="text-sm text-slate-600 text-center">
                Create your account to join the team.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={invite.email}
                  disabled
                  className="bg-slate-50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Password requirements */}
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-slate-600">Password requirements:</p>
                    <div className="grid grid-cols-2 gap-1">
                      {passwordRequirements.map((req, index) => (
                        <div key={index} className="flex items-center gap-1 text-xs">
                          {req.test(password) ? (
                            <CheckCircle className="w-3 h-3 text-green-500" />
                          ) : (
                            <XCircle className="w-3 h-3 text-slate-300" />
                          )}
                          <span className={req.test(password) ? 'text-green-600' : 'text-slate-400'}>
                            {req.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-red-500">Passwords do not match</p>
                )}
                {passwordsMatch && (
                  <p className="text-xs text-green-500 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Passwords match
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={registerMutation.isPending || !isPasswordValid || !passwordsMatch}
              >
                {registerMutation.isPending ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Creating Account...
                  </span>
                ) : (
                  'Create Account & Join'
                )}
              </Button>
            </form>
          )}

          <p className="text-xs text-slate-500 text-center">
            This invite expires on {new Date(invite.expiresAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
