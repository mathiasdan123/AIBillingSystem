import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import {
  MapPin,
  Plus,
  Phone,
  Mail,
  Globe,
  Printer,
  Users,
  Clock,
  Building2,
  Pencil,
  Trash2,
  UserPlus,
  UserMinus,
  BarChart3,
  ChevronLeft,
  Star,
} from "lucide-react";

interface PracticeLocation {
  id: number;
  practiceId: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  timezone: string | null;
  isMainLocation: boolean;
  isActive: boolean;
  operatingHours: OperatingHours | null;
  staffCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface DayHours {
  open: string;
  close: string;
}

interface OperatingHours {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
}

interface StaffMember {
  id: number;
  userId: string;
  locationId: number;
  isPrimary: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
  profileImageUrl: string | null;
  createdAt: string;
}

interface LocationStats {
  staffCount: number;
  patientCount: number;
  appointmentCount: number;
  revenue: number;
}

interface UserOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_LABELS: Record<string, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const US_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
  'America/Indiana/Indianapolis',
];

const TIMEZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern (ET)',
  'America/Chicago': 'Central (CT)',
  'America/Denver': 'Mountain (MT)',
  'America/Los_Angeles': 'Pacific (PT)',
  'America/Anchorage': 'Alaska (AKT)',
  'Pacific/Honolulu': 'Hawaii (HT)',
  'America/Phoenix': 'Arizona (MST)',
  'America/Indiana/Indianapolis': 'Indiana (ET)',
};

const emptyFormData = {
  name: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  email: '',
  fax: '',
  timezone: 'America/New_York',
  isMainLocation: false,
  operatingHours: {} as OperatingHours,
};

export default function LocationsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<PracticeLocation | null>(null);
  const [formData, setFormData] = useState(emptyFormData);
  const [showStaffDialog, setShowStaffDialog] = useState(false);
  const [selectedStaffUserId, setSelectedStaffUserId] = useState('');
  const [staffIsPrimary, setStaffIsPrimary] = useState(false);

  // Fetch locations
  const { data: locations = [], isLoading } = useQuery<PracticeLocation[]>({
    queryKey: ['/api/locations'],
    queryFn: async () => {
      const res = await fetch('/api/locations?includeInactive=true');
      if (!res.ok) throw new Error('Failed to fetch locations');
      return res.json();
    },
  });

  // Fetch staff for selected location
  const { data: locationStaff = [] } = useQuery<StaffMember[]>({
    queryKey: ['/api/locations', selectedLocationId, 'staff'],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${selectedLocationId}/staff`);
      if (!res.ok) throw new Error('Failed to fetch staff');
      return res.json();
    },
    enabled: !!selectedLocationId,
  });

  // Fetch stats for selected location
  const { data: locationStats } = useQuery<LocationStats>({
    queryKey: ['/api/locations', selectedLocationId, 'stats'],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${selectedLocationId}/stats`);
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    enabled: !!selectedLocationId,
  });

  // Fetch users for staff assignment
  const { data: availableUsers = [] } = useQuery<UserOption[]>({
    queryKey: ['/api/users'],
    queryFn: async () => {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    },
    enabled: showStaffDialog,
  });

  // Create location mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create location');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
      setShowForm(false);
      setFormData(emptyFormData);
      toast({ title: t('locations.created'), description: t('locations.createdDesc') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  // Update location mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await fetch(`/api/locations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update location');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
      setShowForm(false);
      setEditingLocation(null);
      setFormData(emptyFormData);
      toast({ title: t('locations.updated'), description: t('locations.updatedDesc') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  // Delete (deactivate) location mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/locations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to deactivate location');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
      setSelectedLocationId(null);
      toast({ title: t('locations.deactivated'), description: t('locations.deactivatedDesc') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  // Assign staff mutation
  const assignStaffMutation = useMutation({
    mutationFn: async ({ locationId, userId, isPrimary }: { locationId: number; userId: string; isPrimary: boolean }) => {
      const res = await fetch(`/api/locations/${locationId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isPrimary }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to assign staff');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/locations', selectedLocationId, 'staff'] });
      queryClient.invalidateQueries({ queryKey: ['/api/locations', selectedLocationId, 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
      setShowStaffDialog(false);
      setSelectedStaffUserId('');
      setStaffIsPrimary(false);
      toast({ title: t('locations.staffAssigned'), description: t('locations.staffAssignedDesc') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  // Remove staff mutation
  const removeStaffMutation = useMutation({
    mutationFn: async ({ locationId, userId }: { locationId: number; userId: string }) => {
      const res = await fetch(`/api/locations/${locationId}/staff/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to remove staff');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/locations', selectedLocationId, 'staff'] });
      queryClient.invalidateQueries({ queryKey: ['/api/locations', selectedLocationId, 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
      toast({ title: t('locations.staffRemoved'), description: t('locations.staffRemovedDesc') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const handleOpenCreate = () => {
    setEditingLocation(null);
    setFormData(emptyFormData);
    setShowForm(true);
  };

  const handleOpenEdit = (location: PracticeLocation) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      address: location.address || '',
      city: location.city || '',
      state: location.state || '',
      zipCode: location.zipCode || '',
      phone: location.phone || '',
      email: location.email || '',
      fax: location.fax || '',
      timezone: location.timezone || 'America/New_York',
      isMainLocation: location.isMainLocation,
      operatingHours: (location.operatingHours as OperatingHours) || {},
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: t('common.error'), description: t('locations.nameRequired'), variant: 'destructive' });
      return;
    }
    if (editingLocation) {
      updateMutation.mutate({ id: editingLocation.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const updateHours = (day: string, field: 'open' | 'close', value: string) => {
    setFormData(prev => ({
      ...prev,
      operatingHours: {
        ...prev.operatingHours,
        [day]: {
          ...(prev.operatingHours as any)?.[day],
          [field]: value,
        },
      },
    }));
  };

  const toggleDayEnabled = (day: string) => {
    setFormData(prev => {
      const hours = { ...prev.operatingHours } as any;
      if (hours[day]) {
        delete hours[day];
      } else {
        hours[day] = { open: '09:00', close: '17:00' };
      }
      return { ...prev, operatingHours: hours };
    });
  };

  const selectedLocation = locations.find(l => l.id === selectedLocationId);

  // Filter users not already assigned to this location
  const assignedUserIds = new Set(locationStaff.map(s => s.userId));
  const unassignedUsers = availableUsers.filter(u => !assignedUserIds.has(u.id));

  // Detail view for a selected location
  if (selectedLocation) {
    return (
      <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedLocationId(null)}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            {t('locations.backToList')}
          </Button>
        </div>

        {/* Location Info Card */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  {selectedLocation.name}
                  {selectedLocation.isMainLocation && (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="w-3 h-3" />
                      {t('locations.mainLocation')}
                    </Badge>
                  )}
                  {!selectedLocation.isActive && (
                    <Badge variant="destructive">{t('locations.inactive')}</Badge>
                  )}
                </CardTitle>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleOpenEdit(selectedLocation)}>
                  <Pencil className="w-4 h-4 mr-1" />
                  {t('common.edit')}
                </Button>
                {selectedLocation.isActive && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        {t('locations.deactivate')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Deactivate this location? Associated appointments may be affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(selectedLocation.id)}>
                          Deactivate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {(selectedLocation.address || selectedLocation.city) && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <span>
                  {[selectedLocation.address, selectedLocation.city, selectedLocation.state, selectedLocation.zipCode]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
            )}
            {selectedLocation.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{selectedLocation.phone}</span>
              </div>
            )}
            {selectedLocation.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span>{selectedLocation.email}</span>
              </div>
            )}
            {selectedLocation.fax && (
              <div className="flex items-center gap-2 text-sm">
                <Printer className="w-4 h-4 text-muted-foreground" />
                <span>{selectedLocation.fax}</span>
              </div>
            )}

            {selectedLocation.timezone && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <span>{TIMEZONE_LABELS[selectedLocation.timezone] || selectedLocation.timezone}</span>
              </div>
            )}

            {/* Operating Hours */}
            {selectedLocation.operatingHours && Object.keys(selectedLocation.operatingHours).length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  {t('locations.operatingHours')}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DAYS.map(day => {
                    const hours = (selectedLocation.operatingHours as OperatingHours)?.[day];
                    if (!hours) return null;
                    return (
                      <div key={day} className="text-sm bg-muted/50 rounded px-3 py-2">
                        <span className="font-medium">{DAY_LABELS[day]}</span>
                        <br />
                        <span className="text-muted-foreground">{hours.open} - {hours.close}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        {locationStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t('locations.staff')}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{locationStats.staffCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t('locations.patients')}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{locationStats.patientCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t('locations.appointments')}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{locationStats.appointmentCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t('locations.revenue')}</span>
                </div>
                <p className="text-2xl font-bold mt-1">${locationStats.revenue.toLocaleString()}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Staff List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">{t('locations.assignedStaff')}</CardTitle>
            {isAdmin && (
              <Button size="sm" onClick={() => setShowStaffDialog(true)}>
                <UserPlus className="w-4 h-4 mr-1" />
                {t('locations.addStaff')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {locationStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t('locations.noStaffAssigned')}
              </p>
            ) : (
              <div className="space-y-3">
                {locationStaff.map(staff => (
                  <div key={staff.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                        {(staff.firstName?.[0] || '') + (staff.lastName?.[0] || '')}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {staff.firstName} {staff.lastName}
                          {staff.isPrimary && (
                            <Badge variant="outline" className="ml-2 text-xs">{t('locations.primary')}</Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{staff.email} &middot; {staff.role}</p>
                      </div>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          removeStaffMutation.mutate({
                            locationId: selectedLocation.id,
                            userId: staff.userId,
                          })
                        }
                      >
                        <UserMinus className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add Staff Dialog */}
        <Dialog open={showStaffDialog} onOpenChange={setShowStaffDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('locations.addStaffToLocation')}</DialogTitle>
              <DialogDescription>{t('locations.addStaffDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t('locations.selectUser')}</Label>
                <Select value={selectedStaffUserId} onValueChange={setSelectedStaffUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('locations.selectUserPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedUsers.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.firstName} {user.lastName} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={staffIsPrimary} onCheckedChange={setStaffIsPrimary} />
                <Label>{t('locations.setPrimaryLocation')}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowStaffDialog(false)}>{t('common.cancel')}</Button>
              <Button
                disabled={!selectedStaffUserId || assignStaffMutation.isPending}
                onClick={() => {
                  if (selectedLocationId && selectedStaffUserId) {
                    assignStaffMutation.mutate({
                      locationId: selectedLocationId,
                      userId: selectedStaffUserId,
                      isPrimary: staffIsPrimary,
                    });
                  }
                }}
              >
                {t('locations.assign')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Location Form Dialog (for editing from detail view) */}
        <LocationFormDialog
          open={showForm}
          onOpenChange={(open) => {
            setShowForm(open);
            if (!open) { setEditingLocation(null); setFormData(emptyFormData); }
          }}
          formData={formData}
          setFormData={setFormData}
          editingLocation={editingLocation}
          onSubmit={handleSubmit}
          isPending={createMutation.isPending || updateMutation.isPending}
          updateHours={updateHours}
          toggleDayEnabled={toggleDayEnabled}
          t={t}
        />
      </div>
    );
  }

  // Location List View
  return (
    <div className="p-4 pt-16 pb-20 md:p-6 md:pt-6 md:pb-6 md:ml-64 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('locations.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('locations.subtitle')}</p>
        </div>
        {isAdmin && (
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-1" />
            {t('locations.addLocation')}
          </Button>
        )}
      </div>

      {/* Overview Stats */}
      {!isLoading && locations.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t('locations.totalLocations')}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{locations.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-green-500" />
                <span className="text-sm text-muted-foreground">{t('locations.activeLocations')}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{locations.filter(l => l.isActive).length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t('locations.totalStaff')}</span>
              </div>
              <p className="text-2xl font-bold mt-1">{locations.reduce((sum, l) => sum + (l.staffCount || 0), 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500" />
                <span className="text-sm text-muted-foreground">{t('locations.mainOffice')}</span>
              </div>
              <p className="text-2xl font-bold mt-1 truncate text-sm">
                {locations.find(l => l.isMainLocation)?.name || '--'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('locations.noLocations')}</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              {t('locations.noLocationsDesc')}
            </p>
            {isAdmin && (
              <Button onClick={handleOpenCreate}>
                <Plus className="w-4 h-4 mr-1" />
                {t('locations.addFirstLocation')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {locations.map(location => (
            <Card
              key={location.id}
              className={`cursor-pointer hover:shadow-md transition-shadow ${!location.isActive ? 'opacity-60' : ''}`}
              onClick={() => setSelectedLocationId(location.id)}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium text-sm">{location.name}</h3>
                      {location.isMainLocation && (
                        <Badge variant="secondary" className="text-[10px] gap-0.5 mt-0.5">
                          <Star className="w-2.5 h-2.5" />
                          {t('locations.main')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!location.isActive && (
                    <Badge variant="destructive" className="text-[10px]">{t('locations.inactive')}</Badge>
                  )}
                </div>

                {(location.city || location.state) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <MapPin className="w-3 h-3" />
                    <span>{[location.city, location.state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {location.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <Phone className="w-3 h-3" />
                    <span>{location.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="w-3 h-3" />
                  <span>{location.staffCount || 0} {t('locations.staffMembers')}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Location Form Dialog */}
      <LocationFormDialog
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) { setEditingLocation(null); setFormData(emptyFormData); }
        }}
        formData={formData}
        setFormData={setFormData}
        editingLocation={editingLocation}
        onSubmit={handleSubmit}
        isPending={createMutation.isPending || updateMutation.isPending}
        updateHours={updateHours}
        toggleDayEnabled={toggleDayEnabled}
        t={t}
      />
    </div>
  );
}

// Separate component for the form dialog to avoid duplication
function LocationFormDialog({
  open,
  onOpenChange,
  formData,
  setFormData,
  editingLocation,
  onSubmit,
  isPending,
  updateHours,
  toggleDayEnabled,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: typeof emptyFormData;
  setFormData: React.Dispatch<React.SetStateAction<typeof emptyFormData>>;
  editingLocation: PracticeLocation | null;
  onSubmit: () => void;
  isPending: boolean;
  updateHours: (day: string, field: 'open' | 'close', value: string) => void;
  toggleDayEnabled: (day: string) => void;
  t: (key: string) => string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingLocation ? t('locations.editLocation') : t('locations.addLocation')}
          </DialogTitle>
          <DialogDescription>
            {editingLocation ? t('locations.editLocationDesc') : t('locations.addLocationDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>{t('locations.locationName')} *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder={t('locations.locationNamePlaceholder')}
            />
          </div>
          <div>
            <Label>{t('locations.address')}</Label>
            <Input
              value={formData.address}
              onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
              placeholder={t('locations.addressPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t('locations.city')}</Label>
              <Input
                value={formData.city}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('locations.state')}</Label>
              <Select
                value={formData.state}
                onValueChange={(v) => setFormData(prev => ({ ...prev, state: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="--" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('locations.zipCode')}</Label>
              <Input
                value={formData.zipCode}
                onChange={(e) => setFormData(prev => ({ ...prev, zipCode: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('locations.phone')}</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <Label>{t('locations.email')}</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="office@example.com"
                type="email"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('locations.fax')}</Label>
              <Input
                value={formData.fax}
                onChange={(e) => setFormData(prev => ({ ...prev, fax: e.target.value }))}
                placeholder="(555) 123-4568"
              />
            </div>
            <div>
              <Label>{t('locations.timezone')}</Label>
              <Select
                value={formData.timezone}
                onValueChange={(v) => setFormData(prev => ({ ...prev, timezone: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('locations.selectTimezone')} />
                </SelectTrigger>
                <SelectContent>
                  {US_TIMEZONES.map(tz => (
                    <SelectItem key={tz} value={tz}>{TIMEZONE_LABELS[tz] || tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={formData.isMainLocation}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isMainLocation: checked }))}
            />
            <Label>{t('locations.setAsMainLocation')}</Label>
          </div>

          <Separator />

          {/* Operating Hours */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {t('locations.operatingHours')}
            </h4>
            <div className="space-y-2">
              {DAYS.map(day => {
                const enabled = !!(formData.operatingHours as any)?.[day];
                const hours = (formData.operatingHours as any)?.[day];
                return (
                  <div key={day} className="flex items-center gap-3">
                    <div className="w-12">
                      <Switch
                        checked={enabled}
                        onCheckedChange={() => toggleDayEnabled(day)}
                      />
                    </div>
                    <span className="w-10 text-sm font-medium">{DAY_LABELS[day]}</span>
                    {enabled ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="time"
                          value={hours?.open || '09:00'}
                          onChange={(e) => updateHours(day, 'open', e.target.value)}
                          className="w-32"
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={hours?.close || '17:00'}
                          onChange={(e) => updateHours(day, 'close', e.target.value)}
                          className="w-32"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('locations.closed')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending
              ? t('common.saving')
              : editingLocation
                ? t('common.save')
                : t('locations.createLocation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
