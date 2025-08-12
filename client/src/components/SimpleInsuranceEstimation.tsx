import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/queryClient';

interface SimpleInsuranceEstimationProps {
  insuranceProvider: string;
}

export function SimpleInsuranceEstimation({ insuranceProvider }: SimpleInsuranceEstimationProps) {
  const [estimates, setEstimates] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedServices, setSelectedServices] = useState(['97166', '97530', '97110']);

  const services = [
    { code: '97165', name: 'OT Evaluation (Low Complexity)' },
    { code: '97166', name: 'OT Evaluation (Moderate Complexity)' },
    { code: '97167', name: 'OT Evaluation (High Complexity)' },
    { code: '97530', name: 'Therapeutic Activities' },
    { code: '97535', name: 'Self-Care Training' },
    { code: '97110', name: 'Therapeutic Exercise' },
    { code: '97112', name: 'Neuromuscular Re-education' },
    { code: '97140', name: 'Manual Therapy' },
  ];

  useEffect(() => {
    if (!insuranceProvider || selectedServices.length === 0) return;
    
    setLoading(true);
    apiRequest('POST', '/api/estimate-reimbursement', {
      insuranceProvider,
      cptCodes: selectedServices,
      sessionCount: 1,
      deductibleMet: false
    })
    .then(data => setEstimates(data))
    .catch(console.error)
    .finally(() => setLoading(false));
  }, [insuranceProvider, selectedServices]);

  const toggleService = (code: string) => {
    setSelectedServices(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  if (loading) return <div>Loading estimates...</div>;

  return (
    <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#f1f5f9', borderRadius: '8px' }}>
      <h4 style={{ fontWeight: 'bold', marginBottom: '12px' }}>Select Expected Services</h4>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '8px', marginBottom: '16px' }}>
        {services.map(service => (
          <label key={service.code} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selectedServices.includes(service.code)}
              onChange={() => toggleService(service.code)}
            />
            <div>
              <div style={{ fontWeight: '500' }}>{service.name}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>CPT {service.code}</div>
            </div>
          </label>
        ))}
      </div>

      {estimates && selectedServices.length > 0 && (
        <div>
          <h5 style={{ fontWeight: 'bold', marginBottom: '12px' }}>Cost Breakdown</h5>
          
          {estimates.estimates?.map((est: any, idx: number) => {
            const service = services.find(s => s.code === est.cptCode);
            const insurancePays = est.practiceCharge - est.patientResponsibility;
            
            return (
              <div key={idx} style={{ marginBottom: '12px', padding: '12px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                  {service?.name || est.cptCode} - ${est.practiceCharge}/session
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ padding: '12px', backgroundColor: '#dbeafe', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 'bold', color: '#1e40af' }}>Insurance Pays</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb' }}>
                      ${insurancePays > 0 ? insurancePays : '0'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#3b82f6' }}>
                      {est.deductibleApplies ? 'After deductible met' : 'Covered portion'}
                    </div>
                  </div>
                  
                  <div style={{ padding: '12px', backgroundColor: '#fef3c7', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 'bold', color: '#92400e' }}>You Pay</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#d97706' }}>
                      ${est.patientResponsibility}
                    </div>
                    <div style={{ fontSize: '12px', color: '#f59e0b' }}>
                      {est.deductibleApplies ? 'Until deductible met' : `${est.coinsurancePercent}% coinsurance`}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          
          <div style={{ padding: '12px', backgroundColor: '#fef2f2', borderRadius: '6px', marginTop: '12px' }}>
            <div style={{ fontSize: '12px', color: '#991b1b' }}>
              <strong>Note:</strong> These are estimates based on typical out-of-network rates. 
              Actual costs may vary based on your specific plan details and deductible status.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}