import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Eye,
  PenTool,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface Document {
  id: number;
  name: string;
  category: string;
  createdAt: string;
  requiresSignature: boolean;
  signedAt?: string;
  viewedAt?: string;
}

interface PatientPortalDocumentsProps {
  token: string;
}

function SignaturePad({ onSave, onClear }: { onSave: (dataUrl: string) => void; onClear?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  }, [getCoords]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing, getCoords]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onClear?.();
  }, [onClear]);

  const saveSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    onSave(canvas.toDataURL("image/png"));
  }, [hasDrawn, onSave]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full h-40 border-2 border-slate-300 rounded-lg bg-white cursor-crosshair touch-none"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      <p className="text-xs text-muted-foreground mt-1">Draw your signature above</p>
      <div className="flex gap-3 mt-3">
        <Button variant="outline" size="sm" onClick={clearCanvas}>
          Clear
        </Button>
        <Button size="sm" onClick={saveSignature} disabled={!hasDrawn}>
          <PenTool className="h-4 w-4 mr-2" />
          Save Signature
        </Button>
      </div>
    </div>
  );
}

export default function PatientPortalDocuments({ token }: PatientPortalDocumentsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);

  const { data: documents = [], isLoading, error } = useQuery<Document[]>({
    queryKey: ["/api/public/portal", token, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/public/portal/${token}/documents`);
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
    refetchInterval: 120000,
  });

  const signDocumentMutation = useMutation({
    mutationFn: async ({ documentId, signatureData }: { documentId: number; signatureData: string }) => {
      const res = await fetch(`/api/public/portal/${token}/documents/${documentId}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to sign document");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/public/portal", token, "documents"] });
    },
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t('portal.documents', 'Documents')}</h2>
          <p className="text-muted-foreground">{t('portal.documentsDesc', 'View and sign documents from your provider')}</p>
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-lg font-medium">{t('portal.failedLoadDocuments', 'Failed to load documents')}</p>
          <p className="text-muted-foreground">{t('portal.tryRefreshing', 'Please try refreshing the page.')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          {t('portal.documents', 'Documents')}
        </h2>
        <p className="text-muted-foreground mt-1">
          {t('portal.documentsDesc', 'View and sign documents from your provider')}
        </p>
      </div>

      {documents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <p className="text-lg font-medium text-center">
              {t('portal.noDocuments', 'No documents found')}
            </p>
            <p className="text-muted-foreground text-center mt-2 max-w-md">
              {t('portal.noDocumentsDesc', 'You have no documents at this time.')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{doc.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {doc.category} - {formatDate(doc.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doc.requiresSignature && !doc.signedAt ? (
                    <Button size="sm" onClick={() => setSelectedDocument(doc)}>
                      <PenTool className="h-4 w-4 mr-2" />
                      {t('portal.sign', 'Sign')}
                    </Button>
                  ) : doc.signedAt ? (
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {t('portal.signed', 'Signed')}
                    </Badge>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.open(
                        `/api/public/portal/${token}/documents/${doc.id}/download`,
                        '_blank'
                      );
                    }}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {t('portal.view', 'View')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Document Signature Dialog */}
      <Dialog open={!!selectedDocument} onOpenChange={(open) => {
        if (!open) {
          setSelectedDocument(null);
          setSavedSignature(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('portal.signDocument', 'Sign Document')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-muted-foreground mb-4">
              {t('portal.signDocumentDesc', 'Please sign below to acknowledge that you have read and agree to the terms of:')}
            </p>
            <p className="font-medium mb-6">{selectedDocument?.name}</p>
            {savedSignature ? (
              <div className="space-y-3">
                <div className="border-2 border-green-300 rounded-lg p-3 bg-green-50">
                  <p className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" /> {t('portal.signatureCaptured', 'Signature captured')}
                  </p>
                  <img
                    src={savedSignature}
                    alt="Your signature"
                    className="w-full h-auto rounded border bg-white"
                  />
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setSavedSignature(null)}>
                    {t('portal.reSign', 'Re-sign')}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={signDocumentMutation.isPending}
                    onClick={() => {
                      if (!selectedDocument || !savedSignature) return;
                      signDocumentMutation.mutate(
                        { documentId: selectedDocument.id, signatureData: savedSignature },
                        {
                          onSuccess: () => {
                            toast({
                              title: t('portal.documentSigned', 'Document Signed'),
                              description: t('portal.documentSignedDesc', `${selectedDocument?.name} has been signed successfully.`),
                            });
                            setSelectedDocument(null);
                            setSavedSignature(null);
                          },
                          onError: (err) => {
                            toast({
                              title: t('portal.signingFailed', 'Signing Failed'),
                              description: err.message,
                              variant: "destructive",
                            });
                          },
                        }
                      );
                    }}
                  >
                    {signDocumentMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    {t('portal.submitSignature', 'Submit Signature')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <SignaturePad
                  onSave={(dataUrl) => setSavedSignature(dataUrl)}
                  onClear={() => setSavedSignature(null)}
                />
                <div className="flex gap-3 mt-4">
                  <Button variant="outline" className="flex-1" onClick={() => {
                    setSelectedDocument(null);
                    setSavedSignature(null);
                  }}>
                    {t('portal.cancel', 'Cancel')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
