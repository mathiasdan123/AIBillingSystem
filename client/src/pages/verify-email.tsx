import { useState, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Mail, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';

type VerificationStatus = 'loading' | 'success' | 'error' | 'expired';

export default function VerifyEmailPage() {
  const [, params] = useRoute('/verify-email/:token');
  const token = params?.token;
  const [, setLocation] = useLocation();

  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const { toast } = useToast();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid verification link');
      return;
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (data.message?.includes('expired')) {
            setStatus('expired');
          } else {
            setStatus('error');
            setErrorMessage(data.message || 'Failed to verify email');
          }
          return;
        }

        setStatus('success');
        toast({
          title: 'Email Verified!',
          description: 'Your email has been successfully verified.',
        });
      } catch (error: any) {
        setStatus('error');
        setErrorMessage('Something went wrong. Please try again.');
      }
    };

    verifyEmail();
  }, [token, toast]);

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-blue-600 animate-pulse" />
              </div>
              <CardTitle>Verifying Email...</CardTitle>
              <CardDescription>
                Please wait while we verify your email address.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </CardContent>
          </Card>
        );

      case 'success':
        return (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <CardTitle>Email Verified!</CardTitle>
              <CardDescription>
                Your email has been successfully verified. You can now access all features.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => setLocation('/')}>
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        );

      case 'expired':
        return (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-yellow-600" />
              </div>
              <CardTitle>Link Expired</CardTitle>
              <CardDescription>
                This verification link has expired. Please request a new one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600 text-center">
                You can request a new verification email from your account settings.
              </p>
              <Button className="w-full" onClick={() => setLocation('/')}>
                Go to Dashboard
              </Button>
              <Link href="/">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        );

      case 'error':
      default:
        return (
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-red-600" />
              </div>
              <CardTitle>Verification Failed</CardTitle>
              <CardDescription>
                {errorMessage || 'We could not verify your email address.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600 text-center">
                The verification link may be invalid or has already been used.
              </p>
              <Link href="/">
                <Button className="w-full">Go to Home</Button>
              </Link>
            </CardContent>
          </Card>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
      {renderContent()}
    </div>
  );
}
