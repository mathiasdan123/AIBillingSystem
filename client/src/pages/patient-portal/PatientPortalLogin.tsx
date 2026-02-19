import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { User, Mail, Loader2, ArrowRight, AlertCircle, Shield } from "lucide-react";

interface PatientPortalLoginProps {
  onLoginSuccess: (token: string) => void;
}

export default function PatientPortalLogin({ onLoginSuccess }: PatientPortalLoginProps) {
  const params = useParams<{ token?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Handle magic link token from URL
  useEffect(() => {
    if (params.token && params.token.length === 64) {
      setIsLoading(true);
      fetch(`/api/patient-portal/login/${params.token}`)
        .then(res => res.json())
        .then(data => {
          if (data.portalToken) {
            localStorage.setItem("patientPortalToken", data.portalToken);
            onLoginSuccess(data.portalToken);
            setLocation("/patient-portal");
          } else {
            setTokenError(data.message || "Invalid or expired login link");
          }
        })
        .catch(() => {
          setTokenError("Could not connect to server");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [params.token, onLoginSuccess, setLocation]);

  const handleRequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/patient-portal/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setLinkSent(true);
        toast({
          title: "Login Link Sent",
          description: "Check your email for the login link. It will expire in 15 minutes.",
        });
      } else {
        toast({
          title: "Request Failed",
          description: data.message || "Could not send login link",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not connect to server",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state when processing token
  if (isLoading && params.token) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Verifying your login link...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Token error state
  if (tokenError) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle>Login Link Invalid</CardTitle>
            <CardDescription>
              {tokenError}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Login links expire after 15 minutes for your security. Please request a new one below.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setTokenError(null);
                setLocation("/patient-portal/login");
              }}
            >
              Request New Login Link
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Link sent confirmation
  if (linkSent) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <Mail className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle>Check Your Email</CardTitle>
            <CardDescription>
              We've sent a secure login link to <strong>{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">What to expect:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>The email should arrive within a few minutes</li>
                <li>Click the link in the email to log in</li>
                <li>The link expires in 15 minutes</li>
                <li>Check your spam folder if you don't see it</li>
              </ul>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLinkSent(false)}
            >
              Didn't receive it? Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main login form
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <User className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Patient Portal</CardTitle>
          <CardDescription>
            Access your appointments, profile, and more
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRequestLink} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
              <p className="text-xs text-muted-foreground">
                Enter the email address associated with your patient record
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading || !email.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  Get Login Link
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span>
                We'll send you a secure, one-time login link. No password needed.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
