import { useEffect } from 'react';

export default function DirectLanding() {
  useEffect(() => {
    console.log('DirectLanding component mounted');
  }, []);

  return (
    <div 
      style={{ 
        padding: '40px', 
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        minHeight: '100vh',
        background: '#f8fafc'
      }}
    >
      <h1 style={{ fontSize: '3rem', color: '#1e293b', marginBottom: '1rem' }}>
        TherapyBill AI
      </h1>
      <p style={{ fontSize: '1.2rem', color: '#64748b', marginBottom: '3rem' }}>
        AI-powered billing for occupational therapy practices
      </p>
      
      <div style={{ marginBottom: '2rem' }}>
        <a 
          href="/soap-notes"
          onClick={(e) => {
            e.preventDefault();
            console.log('SOAP Notes link clicked');
            localStorage.setItem('dev-bypass', 'true');
            window.open('/soap-notes', '_self');
          }}
          style={{ 
            display: 'inline-block',
            margin: '10px',
            padding: '16px 32px',
            backgroundColor: '#3b82f6',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Demo Access (SOAP Notes)
        </a>
        
        <a 
          href="/intake"
          onClick={(e) => {
            e.preventDefault();
            console.log('Intake link clicked');
            window.open('/intake', '_self');
          }}
          style={{ 
            display: 'inline-block',
            margin: '10px',
            padding: '16px 32px',
            backgroundColor: '#10b981',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Complete Patient Intake
        </a>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <a 
          href="/data-upload"
          onClick={(e) => {
            e.preventDefault();
            console.log('Data upload link clicked');
            window.open('/data-upload', '_self');
          }}
          style={{ 
            display: 'inline-block',
            margin: '10px',
            padding: '12px 24px',
            backgroundColor: '#f59e0b',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600'
          }}
        >
          Upload Historical Data
        </a>
      </div>

      <div style={{ marginTop: '3rem' }}>
        <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '1rem' }}>
          Debug info: Using HTML anchor tags with window.open fallback
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', fontSize: '12px' }}>
          <span>JavaScript enabled: {typeof window !== 'undefined' ? 'Yes' : 'No'}</span>
          <span>LocalStorage: {typeof localStorage !== 'undefined' ? 'Available' : 'Not available'}</span>
        </div>
      </div>

      {/* Invisible test buttons for direct JavaScript navigation */}
      <div style={{ position: 'absolute', top: '10px', right: '10px', opacity: 0.1 }}>
        <button 
          onClick={() => {
            console.log('Direct JS navigation test');
            document.location.href = '/soap-notes';
          }}
          style={{ padding: '5px', fontSize: '10px' }}
        >
          JS Test
        </button>
      </div>
    </div>
  );
}