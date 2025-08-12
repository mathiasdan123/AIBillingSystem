import { useState, useEffect } from 'react';

interface SimpleEstimationProps {
  insuranceProvider: string;
}

export function SimpleEstimation({ insuranceProvider }: SimpleEstimationProps) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!insuranceProvider) return;
    
    // Simple fetch
    fetch('/api/estimate-reimbursement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insuranceProvider,
        cptCodes: ['97166', '97530', '97110'],
        sessionCount: 1,
        deductibleMet: false
      })
    })
    .then(res => res.json())
    .then(setData)
    .catch(console.error);
  }, [insuranceProvider]);

  if (!data || !data.estimates) {
    return (
      <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px', margin: '20px 0' }}>
        <h4>Cost Estimation</h4>
        <p>Select an insurance provider to see cost estimates.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px', margin: '20px 0' }}>
      <h4>Treatment Cost Estimates</h4>
      
      {data.estimates.map((est: any, idx: number) => {
        const insurancePays = est.practiceCharge - est.patientResponsibility;
        
        return (
          <div key={idx} style={{ margin: '15px 0', padding: '15px', backgroundColor: 'white', borderRadius: '6px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>
              CPT {est.cptCode} - ${est.practiceCharge}/session
            </div>
            
            <div style={{ display: 'flex', gap: '15px' }}>
              <div style={{ 
                flex: 1, 
                padding: '12px', 
                backgroundColor: '#dbeafe', 
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                <div style={{ fontWeight: 'bold', color: '#1e40af' }}>Insurance Pays</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb' }}>
                  ${insurancePays > 0 ? insurancePays : '0'}
                </div>
              </div>
              
              <div style={{ 
                flex: 1, 
                padding: '12px', 
                backgroundColor: '#fef3c7', 
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                <div style={{ fontWeight: 'bold', color: '#92400e' }}>You Pay</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#d97706' }}>
                  ${est.patientResponsibility}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      
      <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#fef2f2', borderRadius: '6px' }}>
        <small style={{ color: '#991b1b' }}>
          Note: These are estimates based on typical out-of-network rates. Actual costs may vary.
        </small>
      </div>
    </div>
  );
}