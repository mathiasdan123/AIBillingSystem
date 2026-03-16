import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Shield, Key, Globe, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SsoConfig {
  id?: number;
  practiceId?: number;
  provider: string;
  protocol: string;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  callbackUrl: string;
  metadataUrl: string;
  emailDomain: string;
  enabled: boolean;
  ssoEnforced: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const PROVIDER_OPTIONS = [
  { value: 'okta', label: 'Okta' },
  { value: 'azure-ad', label: 'Azure AD (Entra ID)' },
  { value: 'google', label: 'Google Workspace' },
  { value: 'custom', label: 'Custom Provider' },
];

const PROTOCOL_OPTIONS = [
  { value: 'oidc', label: 'OpenID Connect (OIDC)' },
  { value: 'saml', label: 'SAML 2.0' },
];

export default function SsoSettings() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [config, setConfig] = useState<SsoConfig>({
    provider: 'okta',
    protocol: 'oidc',
    clientId: '',
    clientSecret: '',
    issuerUrl: '',
    callbackUrl: '',
    metadataUrl: '',
    emailDomain: '',
    enabled: false,
    ssoEnforced: false,
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/sso/config', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setConfig({
            ...data,
            clientSecret: data.clientSecret || '',
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch SSO config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, any> = {
        provider: config.provider,
        protocol: config.protocol,
        clientId: config.clientId,
        issuerUrl: config.issuerUrl,
        callbackUrl: config.callbackUrl || undefined,
        metadataUrl: config.metadataUrl || undefined,
        emailDomain: config.emailDomain || undefined,
        enabled: config.enabled,
        ssoEnforced: config.ssoEnforced,
      };
      // Only include clientSecret if it was changed (not masked)
      if (config.clientSecret && !config.clientSecret.startsWith('****')) {
        payload.clientSecret = config.clientSecret;
      }

      const response = await fetch('/api/sso/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save SSO configuration');
      }

      const savedConfig = await response.json();
      setConfig({
        ...savedConfig,
        clientSecret: savedConfig.clientSecret || '',
      });

      toast({
        title: 'SSO Configuration Saved',
        description: 'Your SSO settings have been updated successfully.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save SSO configuration',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      // First save the config if needed
      await handleSave();

      // Test by checking if the login URL works
      const practiceId = config.practiceId;
      if (!practiceId) {
        toast({
          title: 'Save Configuration First',
          description: 'Please save your SSO configuration before testing.',
          variant: 'destructive',
        });
        return;
      }

      const checkResponse = await fetch(`/api/sso/check/${practiceId}`, {
        credentials: 'include',
      });

      if (checkResponse.ok) {
        const checkData = await checkResponse.json();
        if (checkData.ssoEnabled) {
          toast({
            title: 'Connection Test Passed',
            description: `SSO is configured and enabled with ${checkData.provider} (${checkData.protocol.toUpperCase()}).`,
          });
        } else {
          toast({
            title: 'SSO Not Enabled',
            description: 'SSO configuration exists but is not enabled. Toggle the "Enable SSO" switch to activate.',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Connection Test Failed',
          description: 'Could not verify SSO configuration. Check your settings.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Test Failed',
        description: error.message || 'Failed to test SSO connection',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const updateField = (field: keyof SsoConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-900">SSO Configuration</h1>
          {config.enabled ? (
            <Badge className="bg-green-100 text-green-700">Active</Badge>
          ) : (
            <Badge variant="outline" className="text-slate-500">Inactive</Badge>
          )}
        </div>
        <p className="text-slate-600">
          Configure Single Sign-On (SSO) for your practice to enable enterprise authentication
          via SAML or OpenID Connect.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Identity Provider
          </CardTitle>
          <CardDescription>
            Select your identity provider and authentication protocol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={config.provider}
                onValueChange={(value) => updateField('provider', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="protocol">Protocol</Label>
              <Select
                value={config.protocol}
                onValueChange={(value) => updateField('protocol', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select protocol" />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Connection Details
          </CardTitle>
          <CardDescription>
            {config.protocol === 'oidc'
              ? 'Enter the OIDC client credentials and issuer URL from your identity provider.'
              : 'Enter the SAML metadata URL or issuer URL from your identity provider.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="issuerUrl">
              {config.protocol === 'oidc' ? 'Issuer URL' : 'IdP SSO URL / Issuer'}
            </Label>
            <Input
              id="issuerUrl"
              type="url"
              value={config.issuerUrl}
              onChange={(e) => updateField('issuerUrl', e.target.value)}
              placeholder={
                config.protocol === 'oidc'
                  ? 'https://your-domain.okta.com'
                  : 'https://your-domain.okta.com/app/sso/saml'
              }
            />
            <p className="text-xs text-slate-500">
              {config.protocol === 'oidc'
                ? 'The OpenID Connect issuer URL. This is used for auto-discovery of OIDC endpoints.'
                : 'The SAML SSO URL where authentication requests are sent.'}
            </p>
          </div>

          {config.protocol === 'oidc' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="clientId">Client ID</Label>
                <Input
                  id="clientId"
                  value={config.clientId}
                  onChange={(e) => updateField('clientId', e.target.value)}
                  placeholder="Enter your OIDC client ID"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientSecret">Client Secret</Label>
                <Input
                  id="clientSecret"
                  type="password"
                  value={config.clientSecret}
                  onChange={(e) => updateField('clientSecret', e.target.value)}
                  placeholder="Enter your OIDC client secret"
                />
                <p className="text-xs text-slate-500">
                  The client secret is encrypted at rest using AES-256 encryption.
                </p>
              </div>
            </>
          )}

          {config.protocol === 'saml' && (
            <div className="space-y-2">
              <Label htmlFor="metadataUrl">SAML Metadata URL</Label>
              <Input
                id="metadataUrl"
                type="url"
                value={config.metadataUrl}
                onChange={(e) => updateField('metadataUrl', e.target.value)}
                placeholder="https://your-domain.okta.com/app/metadata"
              />
              <p className="text-xs text-slate-500">
                The URL where your IdP publishes its SAML metadata XML.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="callbackUrl">Callback URL (optional)</Label>
            <Input
              id="callbackUrl"
              type="url"
              value={config.callbackUrl}
              onChange={(e) => updateField('callbackUrl', e.target.value)}
              placeholder={
                config.protocol === 'oidc'
                  ? 'https://your-app.com/api/sso/callback/oidc'
                  : 'https://your-app.com/api/sso/callback/saml'
              }
            />
            <p className="text-xs text-slate-500">
              Leave blank to use the default callback URL. Set this to your custom domain
              if you are behind a reverse proxy.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Domain & Enforcement</CardTitle>
          <CardDescription>
            Configure automatic SSO detection by email domain and enforcement settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="emailDomain">Email Domain</Label>
            <Input
              id="emailDomain"
              value={config.emailDomain}
              onChange={(e) => updateField('emailDomain', e.target.value)}
              placeholder="acme.com"
            />
            <p className="text-xs text-slate-500">
              When a user enters an email with this domain on the login page, the SSO login
              option will be shown automatically. Leave blank to only use practice ID lookup.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="sso-enabled" className="font-medium">Enable SSO</Label>
              <p className="text-sm text-slate-500 mt-1">
                When enabled, users can sign in with your identity provider.
                Standard email/password login remains available unless SSO is enforced.
              </p>
            </div>
            <Switch
              id="sso-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) => updateField('enabled', checked)}
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label htmlFor="sso-enforced" className="font-medium">Enforce SSO-Only Login</Label>
              <p className="text-sm text-slate-500 mt-1">
                When enforced, password-based login is disabled for all users in this practice.
                Users must authenticate through the identity provider. Use with caution.
              </p>
            </div>
            <Switch
              id="sso-enforced"
              checked={config.ssoEnforced}
              onCheckedChange={(checked) => updateField('ssoEnforced', checked)}
              disabled={!config.enabled}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </span>
          ) : (
            'Save Configuration'
          )}
        </Button>
        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={isTesting || isSaving}
        >
          {isTesting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Testing...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Test Connection
            </span>
          )}
        </Button>
      </div>

      {/* Help section */}
      <Card className="mt-8 border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            Setup Guide
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-3">
          <div>
            <p className="font-medium text-slate-700">For Okta (OIDC):</p>
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li>Create a new Web Application in Okta Admin Console</li>
              <li>Set the Sign-in redirect URI to: <code className="bg-white px-1 py-0.5 rounded text-xs">{window.location.origin}/api/sso/callback/oidc</code></li>
              <li>Copy the Client ID and Client Secret into this form</li>
              <li>Set the Issuer URL to your Okta domain (e.g., https://your-org.okta.com)</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-slate-700">For Azure AD (OIDC):</p>
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li>Register a new application in Azure Portal &gt; App registrations</li>
              <li>Add a redirect URI: <code className="bg-white px-1 py-0.5 rounded text-xs">{window.location.origin}/api/sso/callback/oidc</code></li>
              <li>Create a client secret under Certificates &amp; secrets</li>
              <li>Set the Issuer URL to: https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-slate-700">For SAML 2.0:</p>
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li>Create a new SAML application in your IdP</li>
              <li>Set the ACS (Assertion Consumer Service) URL to: <code className="bg-white px-1 py-0.5 rounded text-xs">{window.location.origin}/api/sso/callback/saml</code></li>
              <li>Configure Name ID format as Email Address</li>
              <li>Copy the IdP SSO URL and Metadata URL into this form</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
