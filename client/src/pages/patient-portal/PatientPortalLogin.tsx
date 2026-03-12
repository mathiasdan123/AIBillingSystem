import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { User, Mail, Loader2, ArrowRight, AlertCircle, Shield } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

interface PatientPortalLoginProps {
  onLoginSuccess: (token: string) => void;
}

export default function PatientPortalLogin({ onLoginSuccess }: PatientPortalLoginProps) {
  const params = useParams<{ token?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();

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
          setTokenError(t('portal.couldNotConnect'));
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [params.token, onLoginSuccess, setLocation, t]);

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
          title: t('portal.loginLinkSent'),
          description: t('portal.checkEmailForLink'),
        });
      } else {
        toast({
          title: t('portal.requestFailed'),
          description: data.message || t('portal.couldNotSendLink'),
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: t('portal.error'),
        description: t('portal.couldNotConnect'),
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
            <p className="text-muted-foreground">{t('portal.verifyingLink')}</p>
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
            <CardTitle>{t('portal.loginLinkInvalid')}</CardTitle>
            <CardDescription>
              {tokenError}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              {t('portal.linkExpired')}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setTokenError(null);
                setLocation("/patient-portal/login");
              }}
            >
              {t('portal.requestNewLink')}
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
            <CardTitle>{t('portal.checkEmail')}</CardTitle>
            <CardDescription>
              {t('portal.loginLinkSentTo')} <strong>{email}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
              <p className="font-medium">{t('portal.whatToExpect')}</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>{t('portal.emailArriveMinutes')}</li>
                <li>{t('portal.clickLink')}</li>
                <li>{t('portal.linkExpires15')}</li>
                <li>{t('portal.checkSpam')}</li>
              </ul>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLinkSent(false)}
            >
              {t('portal.didntReceive')}
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
          <div className="flex justify-end mb-2">
            <LanguageSwitcher compact />
          </div>
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <User className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('portal.loginTitle')}</CardTitle>
          <CardDescription>
            {t('portal.loginSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRequestLink} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('form.emailAddress')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('portal.enterEmail')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t('portal.emailHint')}
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading || !email.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('portal.sending')}
                </>
              ) : (
                <>
                  {t('portal.getLoginLink')}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span>
                {t('portal.secureLogin')}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
