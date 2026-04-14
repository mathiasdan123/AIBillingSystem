import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Upload, Loader2, Trash2, Calendar, File
} from "lucide-react";

interface InsuranceDocument {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  notes?: string;
  createdAt: string;
}

const INSURANCE_DOC_TYPES = [
  { value: 'eob', label: 'EOB (Explanation of Benefits)' },
  { value: 'insurance_card', label: 'Insurance Card' },
  { value: 'auth_letter', label: 'Authorization Letter' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' },
] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  eob: 'EOB',
  insurance_card: 'Insurance Card',
  auth_letter: 'Auth Letter',
  referral: 'Referral',
  other: 'Other',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface InsuranceDocumentsSectionProps {
  patientId: number;
}

export default function InsuranceDocumentsSection({ patientId }: InsuranceDocumentsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('eob');
  const [uploading, setUploading] = useState(false);

  // Fetch insurance-related documents for this patient
  const { data: documents = [], isLoading } = useQuery({
    queryKey: [`/api/documents/patient/${patientId}`, { fileType: 'insurance' }],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/documents/patient/${patientId}`);
      const allDocs = await response.json();
      // Filter to insurance-related document types
      const insuranceTypes = ['eob', 'insurance_card', 'auth_letter', 'referral'];
      return (allDocs as InsuranceDocument[]).filter(
        (doc) => insuranceTypes.includes(doc.fileType) || doc.fileType === 'other'
      );
    },
    enabled: !!patientId,
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Maximum file size is 10MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      // Convert file to base64 for simple storage
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          await apiRequest("POST", `/api/documents/patient/${patientId}`, {
            fileName: file.name,
            fileType: docType,
            fileSize: file.size,
            mimeType: file.type,
            storagePath: base64,
            notes: `Uploaded via Benefits Verification`,
          });

          queryClient.invalidateQueries({
            queryKey: [`/api/documents/patient/${patientId}`],
          });

          toast({
            title: "Document Uploaded",
            description: `${file.name} has been uploaded successfully.`,
          });
        } catch (err) {
          toast({
            title: "Upload Failed",
            description: "Could not upload the document. Please try again.",
            variant: "destructive",
          });
        } finally {
          setUploading(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      };
      reader.onerror = () => {
        setUploading(false);
        toast({
          title: "Read Error",
          description: "Could not read the file.",
          variant: "destructive",
        });
      };
      reader.readAsDataURL(file);
    } catch {
      setUploading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (docId: number) => {
      await apiRequest("DELETE", `/api/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/documents/patient/${patientId}`],
      });
      toast({ title: "Document Removed" });
    },
    onError: () => {
      toast({
        title: "Delete Failed",
        description: "Could not remove the document.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-600" />
        <h4 className="font-medium text-foreground">Insurance Documents</h4>
      </div>

      {/* Upload section */}
      <div className="flex items-center gap-2">
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Document type" />
          </SelectTrigger>
          <SelectContent>
            {INSURANCE_DOC_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif,image/*"
          onChange={handleFileUpload}
          className="hidden"
          disabled={uploading}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-3.5 h-3.5 mr-1" />
              Upload
            </>
          )}
        </Button>
      </div>

      {/* Document list */}
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading documents...</div>
      ) : documents.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No insurance documents uploaded yet. Upload EOBs, insurance cards, or authorization letters.
        </p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc: InsuranceDocument) => (
            <div
              key={doc.id}
              className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border"
            >
              <div className="flex items-center gap-2 min-w-0">
                <File className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {doc.fileName}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Badge variant="outline" className="text-xs py-0">
                      {DOC_TYPE_LABELS[doc.fileType] || doc.fileType}
                    </Badge>
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-3 h-3" />
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-red-500 flex-shrink-0"
                onClick={() => deleteMutation.mutate(doc.id)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
