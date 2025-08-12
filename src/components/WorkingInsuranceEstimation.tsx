import { useState, useEffect } from 'react';

interface WorkingInsuranceEstimationProps {
  insuranceProvider: string;
}

interface ServiceOption {
  cptCode: string;
  name: string;
  practiceRate: number;
  selected: boolean;
}

export function WorkingInsuranceEstimation({ insuranceProvider }: WorkingInsuranceEstimationProps) {
  const [services, setServices] = useState<ServiceOption[]>([
    { cptCode: '97166', name: 'OT Evaluation (Moderate Complexity)', practiceRate: 150, selected: true },
    { cptCode: '97530', name: 'Therapeutic Activities', practiceRate: 150, selected: true },
    { cptCode: '97110', name: 'Therapeutic Exercise', practiceRate: 150, selected: true },
    { cptCode: '97535', name: 'Self-Care Training', practiceRate: 150, selected: false },
    { cptCode: '97140', name: 'Manual Therapy', practiceRate: 150, selected: false },
    { cptCode: '97112', name: 'Neuromuscular Re-education', practiceRate: 150, selected: false },
    { cptCode: '97165', name: 'OT Evaluation (Low Complexity)', practiceRate: 120, selected: false },
    { cptCode: '97167', name: 'OT Evaluation (High Complexity)', practiceRate: 180, selected: false }
  ]);

  const [estimates, setEstimates] = useState<any[]>([]);

  // Insurance reimbursement rates (out-of-network)
  const getInsuranceRate = (cptCode: string, provider: string): number => {
    const rates: Record<string, Record<string, number>> = {
      'UnitedHealth': {
        '97166': 85, '97530': 75, '97110': 70, '97535': 75, 
        '97140': 80, '97112': 70, '97165': 65, '97167': 95
      },
      'Anthem': {
        '97166': 80, '97530': 70, '97110': 65, '97535': 70, 
        '97140': 75, '97112': 65, '97165': 60, '97167': 90
      },
      'Aetna': {
        '97166': 82, '97530': 72, '97110': 68, '97535': 72, 
        '97140': 77, '97112': 68, '97165': 62, '97167': 92
      },
      'BCBS': {
        '97166': 88, '97530': 78, '97110': 73, '97535': 78, 
        '97140': 83, '97112': 73, '97165': 68, '97167': 98
      },
      'Cigna': {
        '97166': 79, '97530': 69, '97110': 64, '97535': 69, 
        '97140': 74, '97112': 64, '97165': 59, '97167': 89
      }
    };
    return rates[provider]?.[cptCode] || 70;
  };

  const toggleService = (cptCode: string) => {
    setServices(prev => prev.map(service => 
      service.cptCode === cptCode 
        ? { ...service, selected: !service.selected }
        : service
    ));
  };

  useEffect(() => {
    if (!insuranceProvider) return;

    const selectedServices = services.filter(s => s.selected);
    const newEstimates = selectedServices.map(service => {
      const insuranceReimbursement = getInsuranceRate(service.cptCode, insuranceProvider);
      const patientResponsibility = Math.max(0, service.practiceRate - insuranceReimbursement);
      
      return {
        cptCode: service.cptCode,
        name: service.name,
        practiceCharge: service.practiceRate,
        insuranceReimbursement,
        patientResponsibility
      };
    });
    
    setEstimates(newEstimates);
  }, [services, insuranceProvider]);

  if (!insuranceProvider) {
    return (
      <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px', margin: '20px 0' }}>
        <h4>Cost Estimation</h4>
        <p>Select an insurance provider to see cost estimates.</p>
      </div>
    );
  }

  const totalInsurancePays = estimates.reduce((sum, est) => sum + est.insuranceReimbursement, 0);
  const totalPatientPays = estimates.reduce((sum, est) => sum + est.patientResponsibility, 0);

  return (
    <div style={{ padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '8px', margin: '20px 0' }}>
      <h4>Select Expected Services</h4>
      <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
        Choose the services you anticipate needing for {insuranceProvider}
      </p>
      
      {/* Service Selection */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px', marginBottom: '20px' }}>
        {services.map(service => (
          <label 
            key={service.cptCode}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '8px', 
              backgroundColor: service.selected ? '#e0f2fe' : 'white', 
              borderRadius: '4px', 
              cursor: 'pointer',
              border: service.selected ? '1px solid #0284c7' : '1px solid #e5e7eb'
            }}
          >
            <input 
              type="checkbox" 
              checked={service.selected}
              onChange={() => toggleService(service.cptCode)}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: '500', fontSize: '14px' }}>{service.name}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>
                CPT {service.cptCode} • Practice Rate: ${service.practiceRate}
              </div>
            </div>
          </label>
        ))}
      </div>

      {estimates.length > 0 && (
        <>
          <h5 style={{ marginBottom: '15px' }}>Cost Breakdown Per Session</h5>
          <div style={{ 
            display: 'flex', 
            gap: '15px',
            marginBottom: '15px'
          }}>
            <div style={{ 
              flex: 1, 
              padding: '12px', 
              backgroundColor: '#dbeafe', 
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{ fontWeight: 'bold', color: '#1e40af' }}>Insurance Pays</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb' }}>
                ${totalInsurancePays}
              </div>
              <div style={{ fontSize: '12px', color: '#3b82f6' }}>Total coverage</div>
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
                ${totalPatientPays}
              </div>
              <div style={{ fontSize: '12px', color: '#f59e0b' }}>Your responsibility</div>
            </div>
          </div>

          {/* Individual Service Breakdown */}
          <div style={{ marginBottom: '15px' }}>
            <h6 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>Service Details:</h6>
            {estimates.map(est => (
              <div key={est.cptCode} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #e5e7eb',
                fontSize: '13px'
              }}>
                <span>{est.name} (CPT {est.cptCode})</span>
                <span style={{ fontWeight: 'bold' }}>
                  Insurance: ${est.insuranceReimbursement} | You: ${est.patientResponsibility}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      
      <div style={{ padding: '10px', backgroundColor: '#fef2f2', borderRadius: '6px' }}>
        <small style={{ color: '#991b1b' }}>
          <strong>Note:</strong> These estimates are based on typical out-of-network rates for {insuranceProvider}. 
          Actual costs depend on your specific plan details, deductible status, and whether services are covered.
        </small>
      </div>
    </div>
  );
}