import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'sso'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmailSent, setForgotEmailSent] = useState(false);
  const [ssoPracticeId, setSsoPracticeId] = useState('');
  const [ssoStatus, setSsoStatus] = useState<{ ssoEnabled: boolean; provider: string | null } | null>(null);

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setShowPassword(false);
    setForgotEmailSent(false);
  };

  const handleSignIn = async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Login failed');
    }

    // Check if MFA is required
    if (data.requiresMfa) {
      toast({
        title: 'MFA Required',
        description: 'Please complete two-factor authentication.',
      });
      onOpenChange(false);
      setLocation('/mfa-challenge');
      return;
    }

    toast({
      title: 'Welcome back!',
      description: 'You have been signed in successfully.',
    });
    resetForm();
    onOpenChange(false);
    window.location.reload(); // Reload to update auth state
  };

  const handleSignUp = async () => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName }),
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.errors) {
        throw new Error(data.errors.join('. '));
      }
      throw new Error(data.message || 'Registration failed');
    }

    toast({
      title: 'Account created!',
      description: 'Please check your email to verify your account.',
    });
    resetForm();
    onOpenChange(false);
    window.location.reload(); // Reload to update auth state
  };

  const handleForgotPassword = async () => {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to send reset email');
    }

    setForgotEmailSent(true);
    toast({
      title: 'Check your email',
      description: 'If an account exists, you will receive a password reset link.',
    });
  };

  const handleSsoLookup = async () => {
    if (!ssoPracticeId.trim()) {
      toast({
        title: 'Practice ID Required',
        description: 'Please enter your practice ID to continue with SSO.',
        variant: 'destructive',
      });
      return;
    }

    const response = await fetch(`/api/sso/check/${ssoPracticeId.trim()}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to check SSO configuration');
    }

    const data = await response.json();
    setSsoStatus(data);

    if (!data.ssoEnabled) {
      toast({
        title: 'SSO Not Available',
        description: 'SSO is not configured for this practice. Please use email/password to sign in.',
        variant: 'destructive',
      });
      return;
    }

    // Redirect to SSO login
    window.location.href = `/api/sso/login/${ssoPracticeId.trim()}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (mode === 'sso') {
        await handleSsoLookup();
      } else if (mode === 'forgot') {
        await handleForgotPassword();
      } else if (mode === 'signup') {
        await handleSignUp();
      } else {
        await handleSignIn();
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isPasswordValid = passwordRequirements.every(req => req.test(password));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'signin' && 'Sign In'}
            {mode === 'signup' && 'Create Account'}
            {mode === 'forgot' && 'Reset Password'}
            {mode === 'sso' && 'Sign in with SSO'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'signin' && 'Enter your credentials to access your account.'}
            {mode === 'signup' && 'Fill in your details to create a new account.'}
            {mode === 'forgot' && "Enter your email to receive a password reset link."}
            {mode === 'sso' && 'Enter your practice ID to sign in with your organization\'s identity provider.'}
          </DialogDescription>
        </DialogHeader>

        {forgotEmailSent ? (
          <div className="py-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-slate-600 mb-4">
              If an account exists with that email, you will receive a password reset link shortly.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setForgotEmailSent(false);
                setMode('signin');
              }}
            >
              Back to Sign In
            </Button>
          </div>
        ) : mode === 'sso' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ssoPracticeId">Practice ID</Label>
              <Input
                id="ssoPracticeId"
                type="text"
                value={ssoPracticeId}
                onChange={(e) => setSsoPracticeId(e.target.value)}
                placeholder="Enter your practice ID"
                required
              />
              <p className="text-xs text-slate-500">
                Your practice ID is provided by your organization administrator.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !ssoPracticeId.trim()}
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connecting...
                </span>
              ) : (
                'Continue with SSO'
              )}
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-500">Or</span>
              </div>
            </div>

            <p className="text-center text-sm text-slate-600">
              <button
                type="button"
                className="text-blue-600 hover:underline font-medium"
                onClick={() => { setMode('signin'); setSsoStatus(null); }}
              >
                Sign in with email and password
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
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
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
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

                {/* Password strength indicator for signup */}
                {mode === 'signup' && password.length > 0 && (
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
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || (mode === 'signup' && !isPasswordValid)}
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                <>
                  {mode === 'signin' && 'Sign In'}
                  {mode === 'signup' && 'Create Account'}
                  {mode === 'forgot' && 'Send Reset Link'}
                </>
              )}
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-500">Or</span>
              </div>
            </div>

            <div className="space-y-2">
              {mode === 'signin' && (
                <>
                  <Button
                    type="button"
                    variant="default"
                    className="w-full bg-green-600 hover:bg-green-700"
                    disabled={isLoading}
                    onClick={async () => {
                      setIsLoading(true);
                      try {
                        const res = await fetch('/api/demo-login', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                        });
                        if (!res.ok) throw new Error('Demo login failed');
                        toast({ title: 'Welcome!', description: 'Logged in as Demo Admin.' });
                        resetForm();
                        onOpenChange(false);
                        window.location.reload();
                      } catch (error: any) {
                        toast({ title: 'Error', description: error.message, variant: 'destructive' });
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                  >
                    Try Demo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setMode('sso')}
                  >
                    Sign in with SSO
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setMode('forgot')}
                  >
                    Forgot Password?
                  </Button>
                  <p className="text-center text-sm text-slate-600">
                    Don't have an account?{' '}
                    <button
                      type="button"
                      className="text-blue-600 hover:underline font-medium"
                      onClick={() => setMode('signup')}
                    >
                      Sign up
                    </button>
                  </p>
                </>
              )}
              {mode === 'signup' && (
                <p className="text-center text-sm text-slate-600">
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline font-medium"
                    onClick={() => setMode('signin')}
                  >
                    Sign in
                  </button>
                </p>
              )}
              {mode === 'forgot' && (
                <p className="text-center text-sm text-slate-600">
                  Remember your password?{' '}
                  <button
                    type="button"
                    className="text-blue-600 hover:underline font-medium"
                    onClick={() => setMode('signin')}
                  >
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
