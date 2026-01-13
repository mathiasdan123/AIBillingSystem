import { useState, useEffect } from "react";
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
import { Building, User, Bell, Shield, CreditCard, FileText, Users, Mail, Copy, Clock, CheckCircle } from "lucide-react";
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
  name: z.string().min(1, "Practice name is required"),
  npi: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
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
  });

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
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "billing", label: "Billing", icon: CreditCard },
    ...(isAdmin ? [{ id: "users", label: "User Management", icon: Users }] : []),
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
                          <p className="font-medium text-slate-900">Professional Plan</p>
                          <p className="text-sm text-slate-600">2.25% per transaction + $0.35 per claim</p>
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
