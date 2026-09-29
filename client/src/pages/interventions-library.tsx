import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Edit2, Trash2 } from "lucide-react";

/**
 * Admin management UI for the SOAP-form Interventions picker library
 * (/api/soap-intervention-templates).
 *
 * System defaults are shared by every practice: they can't be edited or
 * deleted, only hidden per practice (the visibility switch, which the
 * server implements as a practice-owned "shadow" row). Custom items
 * belong to this practice and can be added, edited, and deleted.
 */

interface InterventionItem {
  id: number;
  name: string;
  description: string | null;
  isCustom: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Practice-owned shadow row that hides/shows a system default. */
  overrideId: number | null;
}

interface CategoryGroup {
  category: string;
  items: InterventionItem[];
}

const NEW_CATEGORY = "__new__";

type FormState = {
  category: string;      // existing category name, or NEW_CATEGORY
  newCategory: string;   // used when category === NEW_CATEGORY
  name: string;
  description: string;
};

function emptyForm(): FormState {
  return { category: NEW_CATEGORY, newCategory: "", name: "", description: "" };
}

export default function InterventionsLibraryPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data, isLoading } = useQuery<{ categories: CategoryGroup[] }>({
    queryKey: ["/api/soap-intervention-templates", "all"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/soap-intervention-templates?includeInactive=true");
      return res.json();
    },
  });
  const categories = data?.categories ?? [];
  const categoryNames = categories.map((c) => c.category);

  // Invalidate every interventions query — this admin view and the
  // SOAP form's picker (["/api/soap-intervention-templates"]).
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/soap-intervention-templates"] });

  const resolvedCategory = () =>
    (form.category === NEW_CATEGORY ? form.newCategory : form.category).trim();

  const buildPayload = () => ({
    category: resolvedCategory(),
    name: form.name.trim(),
    description: form.description.trim() || null,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/soap-intervention-templates", buildPayload());
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Intervention added" });
      setDialogOpen(false);
      setForm(emptyForm());
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to add intervention",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (editingId == null) throw new Error("No intervention selected");
      const res = await apiRequest(
        "PATCH",
        `/api/soap-intervention-templates/${editingId}`,
        buildPayload(),
      );
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Intervention updated" });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm());
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to update intervention",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/soap-intervention-templates/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Intervention deleted" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to delete intervention",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  // Hide/show a system default for this practice. Hiding creates the
  // shadow row (POST isActive:false); once one exists, toggle it via PATCH.
  const toggleSystemMutation = useMutation({
    mutationFn: async ({
      item,
      category,
      visible,
    }: { item: InterventionItem; category: string; visible: boolean }) => {
      const res = item.overrideId
        ? await apiRequest("PATCH", `/api/soap-intervention-templates/${item.overrideId}`, {
            isActive: visible,
          })
        : await apiRequest("POST", "/api/soap-intervention-templates", {
            category,
            name: item.name,
            isActive: visible,
          });
      return res.json();
    },
    onSuccess: (_data, { visible }) => {
      invalidate();
      toast({ title: visible ? "Intervention shown" : "Intervention hidden" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to update visibility",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm(), category: categoryNames[0] ?? NEW_CATEGORY });
    setDialogOpen(true);
  };

  const openEdit = (category: string, item: InterventionItem) => {
    setEditingId(item.id);
    setForm({
      category: categoryNames.includes(category) ? category : NEW_CATEGORY,
      newCategory: categoryNames.includes(category) ? "" : category,
      name: item.name,
      description: item.description ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!resolvedCategory()) {
      toast({ title: "Category is required", variant: "destructive" });
      return;
    }
    if (editingId != null) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="interventions-library-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Interventions Library</h1>
          <p className="text-sm text-muted-foreground">
            Manage the categorized intervention picker shown on the SOAP note form.
            System defaults are shared and can only be hidden; custom items belong to your practice.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-intervention">
          <Plus className="h-4 w-4 mr-2" />
          Add intervention
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No interventions yet. Add your first custom intervention to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        categories.map((group) => (
          <Card key={group.category} data-testid={`category-${group.category}`}>
            <CardHeader>
              <CardTitle className="text-lg">{group.category}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-4 py-3"
                    data-testid={`row-intervention-${item.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={item.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>
                          {item.name}
                        </span>
                        {item.isCustom ? (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                            Custom
                          </Badge>
                        ) : (
                          <Badge variant="secondary">System</Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-sm text-muted-foreground truncate" title={item.description}>
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.isCustom ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(group.category, item)}
                            aria-label={`Edit ${item.name}`}
                            data-testid={`button-edit-${item.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete "${item.name}"?`)) {
                                deleteMutation.mutate(item.id);
                              }
                            }}
                            aria-label={`Delete ${item.name}`}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {item.isActive ? "Visible" : "Hidden"}
                          </span>
                          <Switch
                            checked={item.isActive}
                            disabled={toggleSystemMutation.isPending}
                            onCheckedChange={(visible) =>
                              toggleSystemMutation.mutate({ item, category: group.category, visible })
                            }
                            aria-label={`Toggle visibility of ${item.name}`}
                            data-testid={`switch-system-${item.id}`}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit intervention" : "Add custom intervention"}</DialogTitle>
              <DialogDescription>
                Custom interventions appear in the SOAP form picker for everyone in your practice.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger id="category" data-testid="select-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryNames.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                    <SelectItem value={NEW_CATEGORY}>New category…</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.category === NEW_CATEGORY && (
                <div className="space-y-2">
                  <Label htmlFor="newCategory">New category name</Label>
                  <Input
                    id="newCategory"
                    value={form.newCategory}
                    onChange={(e) => setForm((f) => ({ ...f, newCategory: e.target.value }))}
                    placeholder="e.g. Feeding Therapy"
                    maxLength={80}
                    data-testid="input-new-category"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Oral motor exercises"
                  maxLength={200}
                  data-testid="input-name"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Shown on hover so new therapists know what this involves."
                  rows={3}
                  data-testid="input-description"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-intervention"
              >
                {editingId ? "Save changes" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
