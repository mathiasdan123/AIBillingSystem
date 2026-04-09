import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building, User, Bell, Shield, CreditCard, FileText, Users, Mail, Copy, Clock, CheckCircle, Key, Trash2, Star, ExternalLink, Palette, BadgeCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getAuthHeaders } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface InviteData {
  id: number;
  email: string;
  role: string;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

const practiceSchema = z.object({
  // Basic Info
  name: z.string().min(1, "Practice name is required"),
  npi: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),

  // Branding
  brandLogoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  brandPrimaryColor: z.string().optional(),
  brandWebsiteUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  brandPrivacyPolicyUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),

  // Licenses
  professionalLicense: z.string().optional(),
  licenseExpiration: z.string().optional(),
  businessLicense: z.string().optional(),
  caqhProfileId: z.string().optional(),

  // Billing Contact
  billingContactName: z.string().optional(),
  billingContactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  billingContactPhone: z.string().optional(),

  // Reviews
  googleReviewUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type PracticeFormData = z.infer<typeof practiceSchema>;

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: string;
}

// ─── MCP Integration Tab Component ─────────────────────────────────────────
interface McpApiKeyData {
  id: number;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function McpIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);

  const { data: mcpKeys, isLoading } = useQuery<McpApiKeyData[]>({
    queryKey: ["/api/mcp-api-keys"],
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/mcp-api-keys", { name });
      return res.json();
    },
    onSuccess: (data) => {
      setNewKey({ key: data.key, name: data.name });
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/mcp-api-keys"] });
      toast({ title: "API key created", description: "Copy your key now - it won't be shown again." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create API key", variant: "destructive" });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mcp-api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp-api-keys"] });
      toast({ title: "Key revoked", description: "The API key has been revoked and can no longer be used." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to revoke API key", variant: "destructive" });
    },
  });

  const configSnippet = (key: string) => JSON.stringify({
    mcpServers: {
      therapybill: {
        url: `${window.location.origin}/mcp`,
        headers: {
          Authorization: `Bearer ${key}`,
        },
      },
    },
  }, null, 2);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${label} copied to clipboard` });
  };

  return (
    <div className="space-y-6">
      {/* New Key Created Dialog */}
      {newKey && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center text-green-800">
              <CheckCircle className="w-5 h-5 mr-2" />
              API Key Created: {newKey.name}
            </CardTitle>
            <CardDescription className="text-green-700">
              Copy your API key now. It will only be shown once.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-green-800">Your API Key</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input value={newKey.key} readOnly className="font-mono text-sm bg-white" />
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(newKey.key, "API key")}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-green-800">Claude Desktop Config</Label>
              <div className="relative mt-1">
                <pre className="p-3 bg-white rounded-lg border text-xs font-mono overflow-x-auto whitespace-pre">
                  {configSnippet(newKey.key)}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(configSnippet(newKey.key), "Config snippet")}
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copy
                </Button>
              </div>
            </div>
            <Button variant="outline" onClick={() => setNewKey(null)} className="w-full">
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create New Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Key className="w-5 h-5 mr-2" />
            Generate API Key
          </CardTitle>
          <CardDescription>
            Create an API key to connect Claude Desktop to your TherapyBill practice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder="Key name (e.g. My Claude Desktop)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                maxLength={100}
              />
            </div>
            <Button
              onClick={() => createKeyMutation.mutate(keyName)}
              disabled={!keyName.trim() || createKeyMutation.isPending}
            >
              {createKeyMutation.isPending ? "Generating..." : "Generate Key"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Shield className="w-5 h-5 mr-2" />
            Active API Keys
          </CardTitle>
          <CardDescription>
            Manage your MCP API keys. Revoking a key immediately disconnects any Claude Desktop sessions using it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : mcpKeys && mcpKeys.length > 0 ? (
            <div className="space-y-3">
              {mcpKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-medium text-slate-900">{k.name}</p>
                    <p className="text-sm text-slate-500 font-mono">{k.keyPrefix}...</p>
                    <p className="text-xs text-slate-400">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsedAt && ` \u00b7 Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-4 h-4 mr-1" />
                        Revoke
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will immediately disconnect any Claude Desktop sessions using the key "{k.name}" ({k.keyPrefix}...). This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => revokeKeyMutation.mutate(k.id)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Revoke Key
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center py-4">No API keys yet. Generate one above to get started.</p>
          )}
        </CardContent>
      </Card>

      {/* Setup Guide Link */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-blue-900 text-lg">Need help setting up?</h3>
              <p className="text-sm text-blue-700 mt-1">
                Follow our step-by-step guide to connect Claude Desktop to your practice. No technical knowledge required.
              </p>
            </div>
            <Button onClick={() => setLocation("/mcp-setup")} className="flex-shrink-0">
              <ExternalLink className="w-4 h-4 mr-2" />
              View Setup Guide
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [practiceId] = useState(1);
  const [activeTab, setActiveTab] = useState("practice");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("therapist");

  // Check if current user is admin
  const isAdmin = (user as any)?.role === 'admin';

  const form = useForm<PracticeFormData>({
    resolver: zodResolver(practiceSchema),
    defaultValues: {
      name: "",
      npi: "",
      taxId: "",
      address: "",
      phone: "",
      email: "",
      brandLogoUrl: "",
      brandPrimaryColor: "#2563eb",
      brandWebsiteUrl: "",
      brandPrivacyPolicyUrl: "",
      professionalLicense: "",
      licenseExpiration: "",
      businessLicense: "",
      caqhProfileId: "",
      billingContactName: "",
      billingContactEmail: "",
      billingContactPhone: "",
      googleReviewUrl: "",
    },
  });

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: practice, isLoading: practiceLoading } = useQuery({
    queryKey: ['/api/practices', practiceId],
    enabled: isAuthenticated && !!practiceId,
    retry: false,
  }) as any;

  const updatePracticeMutation = useMutation({
    mutationFn: async (data: PracticeFormData) => {
      const response = await apiRequest("PATCH", `/api/practices/${practiceId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/practices'] });
      toast({
        title: "Success",
        description: "Practice settings updated successfully",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update practice settings",
        variant: "destructive",
      });
    },
  });

  // Users query (only for admins)
  const { data: users, isLoading: usersLoading } = useQuery<UserData[]>({
    queryKey: ['/api/users'],
    enabled: isAuthenticated && isAdmin,
    retry: false,
  });

  // Update user role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const response = await apiRequest("PATCH", `/api/users/${userId}/role`, { role });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to update user role",
        variant: "destructive",
      });
    },
  });

  // Invites query (only for admins)
  const { data: invites, isLoading: invitesLoading } = useQuery<InviteData[]>({
    queryKey: ['/api/invites'],
    enabled: isAuthenticated && isAdmin,
    retry: false,
  });

  // Create invite mutation
  const createInviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const response = await apiRequest("POST", "/api/invites", { email, role, practiceId });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/invites'] });
      setInviteEmail("");
      setInviteRole("therapist");

      // Copy invite link to clipboard
      const inviteLink = `${window.location.origin}/invite/${data.invite.token}`;
      navigator.clipboard.writeText(inviteLink);

      toast({
        title: "Invite Sent!",
        description: `Invite link copied to clipboard. Share it with ${data.invite.email}`,
      });
    },
    onError: (error: any) => {
      let errorMessage = "Failed to create invite";
      try {
        // Try to parse the error message if it contains JSON
        const errorText = error?.message || "";
        if (errorText.includes('{')) {
          const jsonPart = errorText.substring(errorText.indexOf('{'));
          const parsed = JSON.parse(jsonPart);
          errorMessage = parsed.message || errorMessage;
        } else if (errorText.includes(':')) {
          // Format is "status: message"
          errorMessage = errorText.split(':').slice(1).join(':').trim() || errorMessage;
        } else {
          errorMessage = errorText || errorMessage;
        }
      } catch {
        errorMessage = error?.message || "Failed to create invite";
      }
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // MFA state
  const [mfaSetupData, setMfaSetupData] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [mfaToken, setMfaToken] = useState('');

  const mfaSetupMutation = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mfa/setup', { method: 'POST', headers: { ...headers } });
      if (!res.ok) throw new Error('MFA setup failed');
      return res.json();
    },
    onSuccess: (data) => setMfaSetupData(data),
    onError: () => toast({ title: 'Error', description: 'Failed to start MFA setup', variant: 'destructive' }),
  });

  const mfaVerifyMutation = useMutation({
    mutationFn: async (token: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error('Verification failed');
      return res.json();
    },
    onSuccess: () => {
      setMfaSetupData(null);
      setMfaToken('');
      toast({ title: 'MFA Enabled', description: 'Two-factor authentication is now active.' });
    },
    onError: () => toast({ title: 'Error', description: 'Invalid code. Try again.', variant: 'destructive' }),
  });

  const mfaDisableMutation = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mfa/disable', { method: 'POST', headers: { ...headers } });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => toast({ title: 'MFA Disabled', description: 'Two-factor authentication has been removed.' }),
    onError: () => toast({ title: 'Error', description: 'Failed to disable MFA', variant: 'destructive' }),
  });

  // BAA queries
  const { data: baaRecords, isLoading: baaLoading } = useQuery<any[]>({
    queryKey: ['/api/baa'],
    enabled: isAuthenticated && isAdmin,
    retry: false,
  });

  const [newBaa, setNewBaa] = useState({ vendorName: '', vendorType: 'cloud_provider', signedDate: '', expirationDate: '' });

  const createBaaMutation = useMutation({
    mutationFn: async (data: typeof newBaa) => {
      const response = await apiRequest('POST', '/api/baa', { ...data, status: 'active', practiceId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/baa'] });
      setNewBaa({ vendorName: '', vendorType: 'cloud_provider', signedDate: '', expirationDate: '' });
      toast({ title: 'BAA Created', description: 'Business Associate Agreement recorded.' });
    },
    onError: () => toast({ title: 'Error', description: 'Failed to create BAA record', variant: 'destructive' }),
  });

  const deleteBaaMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/baa/${id}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/baa'] });
      toast({ title: 'Deleted', description: 'BAA record removed.' });
    },
  });

  // Therapist management
  interface TherapistData {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    credentials: string | null;
    licenseNumber: string | null;
    npiNumber: string | null;
    hasSignature: boolean;
    signatureUploadedAt: string | null;
  }

  const { data: therapists, isLoading: therapistsLoading } = useQuery<TherapistData[]>({
    queryKey: ['/api/therapists'],
    queryFn: async () => (await apiRequest('GET', '/api/therapists')).json(),
  });

  const updateTherapistMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest('PATCH', `/api/therapists/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/therapists'] });
      toast({ title: 'Updated', description: 'Therapist profile updated successfully.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update therapist profile.', variant: 'destructive' });
    },
  });

  const [editingTherapist, setEditingTherapist] = useState<string | null>(null);
  const [therapistForm, setTherapistForm] = useState({ credentials: '', licenseNumber: '', npiNumber: '' });
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>, therapistId: string) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setSignatureDataUrl(base64);
        updateTherapistMutation.mutate({
          id: therapistId,
          data: { digitalSignature: base64 }
        });
      };
      reader.readAsDataURL(file);
    }
  };

  // Populate form with practice data
  useEffect(() => {
    if (practice) {
      form.reset({
        name: practice.name || "",
        npi: practice.npi || "",
        taxId: practice.taxId || "",
        address: practice.address || "",
        phone: practice.phone || "",
        email: practice.email || "",
        brandLogoUrl: practice.brandLogoUrl || "",
        brandPrimaryColor: practice.brandPrimaryColor || "#2563eb",
        brandWebsiteUrl: practice.brandWebsiteUrl || "",
        brandPrivacyPolicyUrl: practice.brandPrivacyPolicyUrl || "",
        professionalLicense: practice.professionalLicense || "",
        licenseExpiration: practice.licenseExpiration || "",
        businessLicense: practice.businessLicense || "",
        caqhProfileId: practice.caqhProfileId || "",
        billingContactName: practice.billingContactName || "",
        billingContactEmail: practice.billingContactEmail || "",
        billingContactPhone: practice.billingContactPhone || "",
        googleReviewUrl: practice.googleReviewUrl || "",
      });
    }
  }, [practice, form]);

  if (isLoading || practiceLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const onSubmit = (data: PracticeFormData) => {
    updatePracticeMutation.mutate(data);
  };

  const tabs = [
    { id: "practice", label: "Practice Information", icon: Building },
    { id: "branding", label: "Branding & Onboarding", icon: Palette },
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "billing", label: "Billing", icon: CreditCard },
    { id: "therapists", label: "Therapists", icon: BadgeCheck },
    ...(isAdmin ? [
      { id: "users", label: "User Management", icon: Users },
      { id: "baa", label: "BAA Tracking", icon: FileText },
      { id: "mcp", label: "MCP Integration", icon: Key },
    ] : []),
  ];

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-600">Manage your practice settings and preferences</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <div className="lg:w-64">
          <Card>
            <CardContent className="p-4">
              <nav className="space-y-2">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center space-x-3 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? "bg-medical-blue-50 text-medical-blue-600"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {activeTab === "practice" && (
            <Card>
              <CardHeader>
                <CardTitle>Practice Information</CardTitle>
                <CardDescription>
                  Update your practice details and billing information
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Practice Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Your Practice Name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="npi"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>NPI Number</FormLabel>
                            <FormControl>
                              <Input placeholder="1234567890" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="taxId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tax ID</FormLabel>
                            <FormControl>
                              <Input placeholder="12-3456789" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="123 Main St, City, State 12345" 
                              {...field}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone Number</FormLabel>
                            <FormControl>
                              <Input placeholder="(555) 123-4567" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email Address</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="practice@example.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Separator className="my-6" />

                    {/* Google Reviews Section */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Star className="h-5 w-5 text-yellow-500" />
                        <h3 className="font-medium">Google Reviews</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Connect your Google Business Profile to automatically request reviews from patients after their appointments.
                      </p>
                      <FormField
                        control={form.control}
                        name="googleReviewUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Google Review URL</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://g.page/r/your-business/review"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                            <p className="text-xs text-muted-foreground mt-1">
                              To get this URL: Go to your Google Business Profile → Click "Get more reviews" → Copy the link
                            </p>
                          </FormItem>
                        )}
                      />
                      {form.watch("googleReviewUrl") && (
                        <div className="flex items-center gap-2 text-sm text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          <span>Google Reviews connected - patients will be prompted to post positive feedback</span>
                        </div>
                      )}
                    </div>

                    <Button
                      type="submit"
                      disabled={updatePracticeMutation.isPending}
                      className="bg-medical-blue-500 hover:bg-medical-blue-600"
                    >
                      {updatePracticeMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {activeTab === "profile" && (
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>
                  Your personal information and preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      defaultValue={(user as any)?.firstName || ""}
                      disabled
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      defaultValue={(user as any)?.lastName || ""}
                      disabled
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      defaultValue={(user as any)?.email || ""}
                      disabled
                    />
                  </div>
                  <div>
                    <Label htmlFor="role">Role</Label>
                    <Input
                      id="role"
                      defaultValue={(user as any)?.role || "therapist"}
                      disabled
                    />
                  </div>
                </div>
                <p className="text-sm text-slate-600">
                  Profile information is managed through your authentication provider.
                </p>

                {/* Initial Admin Setup - shows for non-admins */}
                <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <h4 className="font-medium text-amber-900 mb-2">Initial Setup</h4>
                    <p className="text-sm text-amber-800 mb-4">
                      Your current role is: <strong>{(user as any)?.role || 'therapist'}</strong>.
                      Click below to become admin and access User Management.
                    </p>
                    <Button
                      onClick={async () => {
                        try {
                          const response = await apiRequest("POST", "/api/setup/make-admin", {});
                          const data = await response.json();
                          toast({
                            title: "Success",
                            description: data.message || "You are now an admin!",
                          });
                          // Refresh the page to update user data
                          window.location.reload();
                        } catch (error: any) {
                          toast({
                            title: "Error",
                            description: error?.message || "Failed to complete setup. An admin may already exist.",
                            variant: "destructive",
                          });
                        }
                      }}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      Become Admin
                    </Button>
                  </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "notifications" && (
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>
                  Configure how you receive notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="email-notifications">Email Notifications</Label>
                      <p className="text-sm text-slate-600">
                        Receive notifications via email
                      </p>
                    </div>
                    <Switch id="email-notifications" defaultChecked />
                  </div>
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="claim-updates">Claim Updates</Label>
                      <p className="text-sm text-slate-600">
                        Get notified when claim status changes
                      </p>
                    </div>
                    <Switch id="claim-updates" defaultChecked />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="payment-notifications">Payment Notifications</Label>
                      <p className="text-sm text-slate-600">
                        Receive notifications for payments received
                      </p>
                    </div>
                    <Switch id="payment-notifications" defaultChecked />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="denial-alerts">Denial Alerts</Label>
                      <p className="text-sm text-slate-600">
                        Get immediate alerts for claim denials
                      </p>
                    </div>
                    <Switch id="denial-alerts" defaultChecked />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "security" && (
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>
                  Manage your account security and privacy
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-slate-900 mb-2">Account Security</h4>
                    <p className="text-sm text-slate-600 mb-4">
                      Your account is secured through Replit authentication.
                    </p>
                    <Button 
                      variant="outline"
                      onClick={() => window.location.href = "/api/logout"}
                    >
                      Sign Out
                    </Button>
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <h4 className="font-medium text-slate-900 mb-2">Data Privacy</h4>
                    <p className="text-sm text-slate-600 mb-4">
                      All data is encrypted and HIPAA compliant.
                    </p>
                    <div className="flex items-center space-x-2">
                      <Shield className="w-4 h-4 text-healthcare-green-500" />
                      <span className="text-sm text-healthcare-green-600">HIPAA Compliant</span>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium text-slate-900 mb-2">Two-Factor Authentication (MFA)</h4>
                    <p className="text-sm text-slate-600 mb-4">
                      Add an extra layer of security using a TOTP authenticator app.
                    </p>

                    {mfaSetupData ? (
                      <div className="space-y-4 p-4 border rounded-lg">
                        <p className="text-sm">Scan this URI with your authenticator app, then enter the 6-digit code to confirm:</p>
                        <code className="block text-xs bg-slate-100 p-2 rounded break-all">{mfaSetupData.uri}</code>
                        <div className="flex gap-2">
                          <Input
                            value={mfaToken}
                            onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            maxLength={6}
                            className="font-mono w-32"
                          />
                          <Button
                            onClick={() => mfaVerifyMutation.mutate(mfaToken)}
                            disabled={mfaToken.length !== 6 || mfaVerifyMutation.isPending}
                          >
                            {mfaVerifyMutation.isPending ? 'Verifying...' : 'Verify'}
                          </Button>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-700 mb-1">Backup Codes (save these):</p>
                          <div className="grid grid-cols-2 gap-1">
                            {mfaSetupData.backupCodes.map((code, i) => (
                              <code key={i} className="text-xs bg-slate-100 p-1 rounded text-center">{code}</code>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (user as any)?.mfaEnabled ? (
                      <div className="flex items-center gap-3">
                        <Badge className="bg-green-100 text-green-800">MFA Enabled</Badge>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => mfaDisableMutation.mutate()}
                          disabled={mfaDisableMutation.isPending}
                        >
                          {mfaDisableMutation.isPending ? 'Disabling...' : 'Disable MFA'}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => mfaSetupMutation.mutate()}
                        disabled={mfaSetupMutation.isPending}
                      >
                        <Key className="w-4 h-4 mr-2" />
                        {mfaSetupMutation.isPending ? 'Setting up...' : 'Set Up MFA'}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "billing" && (
            <Card>
              <CardHeader>
                <CardTitle>Billing Settings</CardTitle>
                <CardDescription>
                  Manage your subscription and billing preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-slate-900 mb-2">Current Plan</h4>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">Practice Management Plan</p>
                          <p className="text-sm text-slate-600">Flat monthly fee + 6% billing engine</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-slate-900">Active</p>
                          <p className="text-sm text-slate-600">Next billing: Dec 15, 2024</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="font-medium text-slate-900 mb-2">Usage This Month</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-2xl font-bold text-slate-900">147</p>
                        <p className="text-sm text-slate-600">Claims Processed</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <p className="text-2xl font-bold text-slate-900">$18,450</p>
                        <p className="text-sm text-slate-600">Total Volume</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <Button variant="outline">
                      <CreditCard className="w-4 h-4 mr-2" />
                      Update Payment Method
                    </Button>
                    <Button variant="outline">
                      <FileText className="w-4 h-4 mr-2" />
                      Download Invoice
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "branding" && (
            <div className="space-y-6">
              {/* Branding Settings */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    Branding & White-Label Settings
                  </CardTitle>
                  <CardDescription>
                    Customize how your practice appears to patients on intake forms, emails, and patient portal
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="brandLogoUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Logo URL</FormLabel>
                            <FormControl>
                              <Input placeholder="https://yourdomain.com/logo.png" {...field} />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">Your practice logo will appear on patient forms and emails</p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="brandPrimaryColor"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Brand Color</FormLabel>
                              <FormControl>
                                <div className="flex gap-2">
                                  <Input type="color" {...field} className="w-12 h-10 p-1" />
                                  <Input {...field} placeholder="#2563eb" className="flex-1" />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="brandWebsiteUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Website URL</FormLabel>
                              <FormControl>
                                <Input placeholder="https://yourpractice.com" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="brandPrivacyPolicyUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Privacy Policy URL</FormLabel>
                            <FormControl>
                              <Input placeholder="https://yourpractice.com/privacy" {...field} />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">Link displayed on consent forms and patient portal</p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button type="submit" disabled={updatePracticeMutation.isPending}>
                        {updatePracticeMutation.isPending ? "Saving..." : "Save Branding"}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* Licenses & Credentials */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BadgeCheck className="w-5 h-5" />
                    Licenses & Credentials
                  </CardTitle>
                  <CardDescription>
                    Keep your professional credentials on file for insurance enrollment
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="professionalLicense"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Professional License #</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g., OT12345" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="licenseExpiration"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>License Expiration</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="businessLicense"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Business License #</FormLabel>
                              <FormControl>
                                <Input placeholder="Business registration number" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="caqhProfileId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>CAQH Profile ID</FormLabel>
                              <FormControl>
                                <Input placeholder="12345678" {...field} />
                              </FormControl>
                              <p className="text-xs text-muted-foreground">Required for insurance credentialing</p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <Button type="submit" disabled={updatePracticeMutation.isPending}>
                        {updatePracticeMutation.isPending ? "Saving..." : "Save Credentials"}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* Billing Contact */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5" />
                    Billing Contact
                  </CardTitle>
                  <CardDescription>
                    Contact person for billing inquiries and insurance communications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="billingContactName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Billing Contact Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Jane Smith" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="billingContactEmail"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Billing Email</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="billing@yourpractice.com" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="billingContactPhone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Billing Phone</FormLabel>
                              <FormControl>
                                <Input placeholder="(555) 123-4567" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <Button type="submit" disabled={updatePracticeMutation.isPending}>
                        {updatePracticeMutation.isPending ? "Saving..." : "Save Contact"}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* Onboarding Checklist */}
              <Card>
                <CardHeader>
                  <CardTitle>Onboarding Checklist</CardTitle>
                  <CardDescription>Complete these steps to fully set up your practice</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { label: "Practice name and address", field: "name", done: !!form.watch("name") },
                      { label: "NPI number", field: "npi", done: !!form.watch("npi") },
                      { label: "Tax ID", field: "taxId", done: !!form.watch("taxId") },
                      { label: "Professional license", field: "professionalLicense", done: !!form.watch("professionalLicense") },
                      { label: "CAQH Profile ID", field: "caqhProfileId", done: !!form.watch("caqhProfileId") },
                      { label: "Billing contact info", field: "billingContactEmail", done: !!form.watch("billingContactEmail") },
                      { label: "Privacy policy URL", field: "brandPrivacyPolicyUrl", done: !!form.watch("brandPrivacyPolicyUrl") },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-3">
                        {item.done ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-slate-300" />
                        )}
                        <span className={item.done ? "text-slate-600" : "text-slate-900 font-medium"}>
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "baa" && isAdmin && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Add BAA Record</CardTitle>
                  <CardDescription>Track Business Associate Agreements with vendors</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <Label>Vendor Name</Label>
                      <Input
                        value={newBaa.vendorName}
                        onChange={(e) => setNewBaa({ ...newBaa, vendorName: e.target.value })}
                        placeholder="e.g., Stedi, Supabase"
                      />
                    </div>
                    <div>
                      <Label>Vendor Type</Label>
                      <Select value={newBaa.vendorType} onValueChange={(v) => setNewBaa({ ...newBaa, vendorType: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cloud_provider">Cloud Provider</SelectItem>
                          <SelectItem value="clearinghouse">Clearinghouse</SelectItem>
                          <SelectItem value="ehr">EHR</SelectItem>
                          <SelectItem value="billing_service">Billing Service</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Signed Date</Label>
                      <Input type="date" value={newBaa.signedDate} onChange={(e) => setNewBaa({ ...newBaa, signedDate: e.target.value })} />
                    </div>
                    <div>
                      <Label>Expiration Date</Label>
                      <Input type="date" value={newBaa.expirationDate} onChange={(e) => setNewBaa({ ...newBaa, expirationDate: e.target.value })} />
                    </div>
                  </div>
                  <Button
                    onClick={() => createBaaMutation.mutate(newBaa)}
                    disabled={!newBaa.vendorName || !newBaa.signedDate || !newBaa.expirationDate || createBaaMutation.isPending}
                  >
                    {createBaaMutation.isPending ? 'Saving...' : 'Add BAA Record'}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Active BAA Records</CardTitle>
                </CardHeader>
                <CardContent>
                  {baaLoading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : !baaRecords || baaRecords.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No BAA records yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {baaRecords.map((baa: any) => (
                        <div key={baa.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="font-medium">{baa.vendorName}</p>
                            <p className="text-xs text-muted-foreground">
                              {baa.vendorType} | Signed: {baa.signedDate} | Expires: {baa.expirationDate}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={baa.status === 'active' ? 'default' : 'destructive'}>{baa.status}</Badge>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="Delete BAA record"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Delete this BAA record? This cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteBaaMutation.mutate(baa.id)}>
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "therapists" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <BadgeCheck className="w-5 h-5 mr-2" />
                    Therapist Profiles & Signatures
                  </CardTitle>
                  <CardDescription>
                    Manage therapist credentials and digital signatures for SOAP notes
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {therapistsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
                    </div>
                  ) : therapists && therapists.length > 0 ? (
                    <div className="space-y-6">
                      {therapists.map((therapist) => (
                        <div key={therapist.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <h3 className="font-semibold text-lg">
                                {therapist.firstName} {therapist.lastName}
                                {therapist.credentials && (
                                  <span className="text-slate-600 font-normal ml-2">
                                    {therapist.credentials}
                                  </span>
                                )}
                              </h3>
                              <p className="text-sm text-slate-600">{therapist.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {therapist.hasSignature ? (
                                <Badge variant="default" className="bg-green-100 text-green-800">
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                  Signature on File
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">
                                  No Signature
                                </Badge>
                              )}
                            </div>
                          </div>

                          {editingTherapist === therapist.id ? (
                            <div className="space-y-4 bg-slate-50 p-4 rounded-lg">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <Label>Credentials (e.g., OTR/L, PT, DPT)</Label>
                                  <Input
                                    value={therapistForm.credentials}
                                    onChange={(e) => setTherapistForm({ ...therapistForm, credentials: e.target.value })}
                                    placeholder="OTR/L"
                                  />
                                </div>
                                <div>
                                  <Label>License Number</Label>
                                  <Input
                                    value={therapistForm.licenseNumber}
                                    onChange={(e) => setTherapistForm({ ...therapistForm, licenseNumber: e.target.value })}
                                    placeholder="OT-12345"
                                  />
                                </div>
                                <div>
                                  <Label>NPI Number</Label>
                                  <Input
                                    value={therapistForm.npiNumber}
                                    onChange={(e) => setTherapistForm({ ...therapistForm, npiNumber: e.target.value })}
                                    placeholder="1234567890"
                                  />
                                </div>
                              </div>

                              <div>
                                <Label>Digital Signature</Label>
                                <p className="text-sm text-slate-600 mb-2">
                                  Upload a PNG or JPG image of your signature (transparent background recommended)
                                </p>
                                <Input
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  onChange={(e) => handleSignatureUpload(e, therapist.id)}
                                />
                                {therapist.hasSignature && (
                                  <p className="text-xs text-slate-500 mt-1">
                                    Current signature uploaded: {therapist.signatureUploadedAt ? new Date(therapist.signatureUploadedAt).toLocaleDateString() : 'Unknown'}
                                  </p>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  onClick={() => {
                                    updateTherapistMutation.mutate({
                                      id: therapist.id,
                                      data: therapistForm
                                    });
                                    setEditingTherapist(null);
                                  }}
                                  disabled={updateTherapistMutation.isPending}
                                >
                                  Save Changes
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => setEditingTherapist(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <span className="text-slate-500">License:</span>{' '}
                                  <span className="font-medium">{therapist.licenseNumber || 'Not set'}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500">NPI:</span>{' '}
                                  <span className="font-medium">{therapist.npiNumber || 'Not set'}</span>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingTherapist(therapist.id);
                                  setTherapistForm({
                                    credentials: therapist.credentials || '',
                                    licenseNumber: therapist.licenseNumber || '',
                                    npiNumber: therapist.npiNumber || ''
                                  });
                                }}
                              >
                                Edit Profile
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}

                      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-medium text-blue-900 mb-2">About Digital Signatures</h4>
                        <div className="text-sm text-blue-800 space-y-1">
                          <p>Digital signatures are used to sign SOAP notes electronically, meeting compliance requirements.</p>
                          <p>Once uploaded, your signature will appear on all SOAP notes you sign.</p>
                          <p>For best results, use a transparent PNG with your signature in dark ink.</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-600">
                      <p>No therapists found.</p>
                      <p className="text-sm mt-2">Therapists will appear here once they are added to your practice.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "mcp" && isAdmin && (
            <McpIntegrationTab />
          )}

          {activeTab === "users" && isAdmin && (
            <div className="space-y-6">
              {/* Invite New User Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Mail className="w-5 h-5 mr-2" />
                    Invite New User
                  </CardTitle>
                  <CardDescription>
                    Send an invite link to add a new team member
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <Label htmlFor="invite-email">Email Address</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="colleague@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="w-full sm:w-40">
                      <Label htmlFor="invite-role">Role</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger id="invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="therapist">Therapist</SelectItem>
                          <SelectItem value="billing">Billing</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => {
                          if (inviteEmail) {
                            createInviteMutation.mutate({ email: inviteEmail, role: inviteRole });
                          }
                        }}
                        disabled={!inviteEmail || createInviteMutation.isPending}
                        className="w-full sm:w-auto"
                      >
                        {createInviteMutation.isPending ? "Sending..." : "Send Invite"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pending Invites */}
              {invites && invites.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Clock className="w-5 h-5 mr-2" />
                      Pending Invites
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {invites.filter(i => i.status === 'pending').map((invite) => (
                        <div key={invite.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                          <div>
                            <p className="font-medium text-slate-900">{invite.email}</p>
                            <p className="text-sm text-slate-600">
                              Role: {invite.role} • Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const inviteLink = `${window.location.origin}/invite/${invite.token}`;
                              navigator.clipboard.writeText(inviteLink);
                              toast({
                                title: "Copied!",
                                description: "Invite link copied to clipboard",
                              });
                            }}
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Copy Link
                          </Button>
                        </div>
                      ))}
                      {invites.filter(i => i.status === 'pending').length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-4">No pending invites</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Current Users */}
              <Card>
                <CardHeader>
                  <CardTitle>Current Users</CardTitle>
                  <CardDescription>
                    Manage user roles and permissions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {usersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
                    </div>
                  ) : users && users.length > 0 ? (
                    <div className="space-y-4">
                      <div className="text-sm text-slate-600 mb-4">
                        Assign roles to control what users can see. <strong>Therapists</strong> cannot see financial data like reimbursement rates.
                      </div>
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">User</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {users.map((u) => (
                              <tr key={u.id}>
                                <td className="px-4 py-3">
                                  <div className="flex items-center">
                                    <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center mr-3">
                                      <User className="w-4 h-4 text-slate-600" />
                                    </div>
                                    <div>
                                      <div className="font-medium text-slate-900">
                                        {u.firstName} {u.lastName}
                                      </div>
                                      {u.id === (user as any)?.id && (
                                        <Badge variant="outline" className="text-xs">You</Badge>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">{u.email}</td>
                                <td className="px-4 py-3">
                                  <Badge
                                    variant={u.role === 'admin' ? 'default' : u.role === 'billing' ? 'secondary' : 'outline'}
                                  >
                                    {u.role || 'therapist'}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3">
                                  <Select
                                    value={u.role || 'therapist'}
                                    onValueChange={(newRole) => {
                                      updateRoleMutation.mutate({ userId: u.id, role: newRole });
                                    }}
                                    disabled={updateRoleMutation.isPending}
                                  >
                                    <SelectTrigger className="w-32">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="therapist">Therapist</SelectItem>
                                      <SelectItem value="billing">Billing</SelectItem>
                                      <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-medium text-blue-900 mb-2">Role Permissions</h4>
                        <div className="text-sm text-blue-800 space-y-1">
                          <p><strong>Therapist:</strong> Can create SOAP notes, view patients, submit claims. Cannot see financial data.</p>
                          <p><strong>Billing:</strong> Full access to financial data, reimbursement estimates, and analytics.</p>
                          <p><strong>Admin:</strong> Full access plus user management capabilities.</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-600">
                      No users found.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
