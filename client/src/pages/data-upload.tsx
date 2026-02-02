import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Upload, FileText, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';

interface ReimbursementRecord {
  insuranceProvider: string;
  cptCode: string;
  practiceCharge: number;
  insuranceReimbursement: number;
  patientResponsibility: number;
  dateOfService: string;
  planType?: string;
  deductibleMet?: boolean;
  copayAmount?: number;
  coinsurancePercentage?: number;
  region?: string;
  patientAge?: number;
  sessionType?: string;
}

export default function DataUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setUploadResult(null);
    } else {
      toast({
        title: "Invalid File",
        description: "Please select a CSV file",
        variant: "destructive"
      });
    }
  };

  const parseCSV = (csvText: string): ReimbursementRecord[] => {
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    const records: ReimbursementRecord[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length < headers.length) continue;
      
      const record: any = {};
      headers.forEach((header, index) => {
        const value = values[index]?.trim();
        if (!value) return;
        
        // Map common column names
        switch (header) {
          case 'insurance_provider':
          case 'insurer':
          case 'insurance':
            record.insuranceProvider = value;
            break;
          case 'cpt_code':
          case 'cpt':
          case 'code':
            record.cptCode = value;
            break;
          case 'practice_charge':
          case 'charge':
          case 'billed_amount':
            record.practiceCharge = parseFloat(value.replace('$', ''));
            break;
          case 'insurance_payment':
          case 'paid_amount':
          case 'reimbursement':
            record.insuranceReimbursement = parseFloat(value.replace('$', ''));
            break;
          case 'patient_responsibility':
          case 'patient_payment':
          case 'copay':
            record.patientResponsibility = parseFloat(value.replace('$', ''));
            break;
          case 'date_of_service':
          case 'service_date':
          case 'date':
            record.dateOfService = value;
            break;
          case 'plan_type':
            record.planType = value;
            break;
          case 'deductible_met':
            record.deductibleMet = value.toLowerCase() === 'true' || value === '1';
            break;
          case 'region':
            record.region = value;
            break;
          case 'patient_age':
          case 'age':
            record.patientAge = parseInt(value);
            break;
          case 'session_type':
            record.sessionType = value;
            break;
        }
      });
      
      // Validate required fields
      if (record.insuranceProvider && record.cptCode && 
          record.practiceCharge && record.insuranceReimbursement !== undefined && 
          record.dateOfService) {
        records.push(record);
      }
    }
    
    return records;
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    setUploadProgress(0);
    
    try {
      // Read file
      const text = await file.text();
      setUploadProgress(25);
      
      // Parse CSV
      const records = parseCSV(text);
      setUploadProgress(50);
      
      if (records.length === 0) {
        throw new Error('No valid records found in CSV file');
      }
      
      // Upload to server
      const response = await apiRequest('POST', '/api/upload-reimbursement-data', {
        records
      });
      setUploadProgress(100);
      
      const responseData = await response.json();
      setUploadResult(responseData);

      toast({
        title: "Upload Successful",
        description: `Imported ${responseData.importedRecords} reimbursement records`,
      });
      
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed", 
        description: error.message || "Failed to upload data",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  const generateSampleCSV = () => {
    const sampleData = [
      'insurance_provider,cpt_code,practice_charge,insurance_payment,patient_responsibility,date_of_service,plan_type,deductible_met,region,patient_age,session_type',
      'UnitedHealth,97166,150.00,85.00,65.00,2024-01-15,PPO,true,Northeast,45,evaluation',
      'Anthem,97530,150.00,72.00,78.00,2024-01-20,HMO,false,Southeast,32,follow-up',
      'Aetna,97110,150.00,68.00,82.00,2024-01-25,PPO,true,West,28,follow-up',
      'BCBS,97535,150.00,78.00,72.00,2024-02-01,EPO,false,Midwest,55,follow-up',
      'Cigna,97140,150.00,74.00,76.00,2024-02-05,PPO,true,Southwest,38,follow-up'
    ].join('\n');
    
    const blob = new Blob([sampleData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_reimbursement_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="md:ml-64 container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">AI Training Data Upload</h1>
        <p className="text-muted-foreground mt-2">
          Upload your historical reimbursement data to improve AI prediction accuracy
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload CSV Data
            </CardTitle>
            <CardDescription>
              Upload a CSV file containing your historical reimbursement records
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </div>
            
            {file && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">{file.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            )}
            
            {uploading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} />
                <p className="text-sm text-muted-foreground">
                  Uploading and processing... {uploadProgress}%
                </p>
              </div>
            )}
            
            <Button 
              onClick={handleUpload} 
              disabled={!file || uploading}
              className="w-full"
            >
              {uploading ? 'Processing...' : 'Upload Data'}
            </Button>
          </CardContent>
        </Card>

        {/* Instructions Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              CSV Format Requirements
            </CardTitle>
            <CardDescription>
              Your CSV file should include these columns
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium">Required Columns:</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• insurance_provider (e.g., "UnitedHealth")</li>
                <li>• cpt_code (e.g., "97166")</li>
                <li>• practice_charge (e.g., "150.00")</li>
                <li>• insurance_payment (e.g., "85.00")</li>
                <li>• patient_responsibility (e.g., "65.00")</li>  
                <li>• date_of_service (e.g., "2024-01-15")</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium">Optional Columns:</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• plan_type (PPO, HMO, EPO)</li>
                <li>• deductible_met (true/false)</li>
                <li>• region (Northeast, Southeast, etc.)</li>
                <li>• patient_age</li>
                <li>• session_type (evaluation, follow-up)</li>
              </ul>
            </div>
            
            <Button 
              variant="outline" 
              onClick={generateSampleCSV}
              className="w-full"
            >
              Download Sample CSV
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Results Section */}
      {uploadResult && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Upload Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {uploadResult.importedRecords}
                </div>
                <div className="text-sm text-green-700">Records Imported</div>
              </div>
              
              {uploadResult.skippedRecords > 0 && (
                <div className="p-4 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">
                    {uploadResult.skippedRecords}
                  </div>
                  <div className="text-sm text-yellow-700">Records Skipped</div>
                </div>
              )}
              
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  <div className="text-sm text-blue-700">AI Accuracy Improved</div>
                </div>
              </div>
            </div>
            
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                Your historical data has been processed and integrated into our AI prediction system. 
                Future reimbursement estimates will be more accurate based on your specific experience.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}