export default function SimpleLanding() {
  // Direct navigation functions using window.location
  const goToSoap = () => {
    console.log('Direct navigation to SOAP');
    localStorage.setItem('dev-bypass', 'true');
    // Force a full page reload to ensure routing works
    window.location.href = window.location.origin + '/soap-notes';
  };

  const goToIntake = () => {
    console.log('Direct navigation to Intake');
    window.location.href = window.location.origin + '/intake';
  };

  const goToDataUpload = () => {
    console.log('Direct navigation to Data Upload');
    window.location.href = window.location.origin + '/data-upload';
  };

  // Alternative method using raw DOM manipulation
  const handleDirectClick = (path: string) => {
    console.log('Alternative navigation to:', path);
    if (path === '/soap-notes') {
      localStorage.setItem('dev-bypass', 'true');
    }
    setTimeout(() => {
      window.location.assign(path);
    }, 100);
  };

  return (
    <div style={{ 
      padding: '40px', 
      textAlign: 'center' as const,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
      background: '#f9fafb',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#111827', fontSize: '2.5rem', margin: '0 0 16px 0' }}>
        TherapyBill AI
      </h1>
      <p style={{ color: '#6b7280', fontSize: '1.1rem', marginBottom: '40px' }}>
        AI-powered billing for occupational therapy practices
      </p>
      
      <div style={{ marginBottom: '30px' }}>
        <button 
          onClick={goToSoap}
          onMouseDown={() => handleDirectClick('/soap-notes')}
          style={{ 
            display: 'inline-block', 
            margin: '10px', 
            padding: '15px 30px', 
            backgroundColor: '#3b82f6', 
            color: 'white', 
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: '500',
            transition: 'transform 0.1s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0px)'}
        >
          Demo Access (SOAP Notes)
        </button>
        
        <button 
          onClick={goToIntake}
          onMouseDown={() => handleDirectClick('/intake')}
          style={{ 
            display: 'inline-block', 
            margin: '10px', 
            padding: '15px 30px', 
            backgroundColor: '#10b981', 
            color: 'white', 
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: '500',
            transition: 'transform 0.1s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0px)'}
        >
          Complete Patient Intake
        </button>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <button 
          onClick={goToDataUpload}
          style={{ 
            display: 'inline-block', 
            margin: '10px', 
            padding: '12px 24px', 
            backgroundColor: '#f59e0b', 
            color: 'white', 
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            transition: 'transform 0.1s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0px)'}
        >
          Upload Historical Data
        </button>
      </div>

      <div style={{ marginTop: '30px' }}>
        <p style={{ fontSize: '12px', color: '#6b7280' }}>
          Using direct window.location navigation. Check browser console for debug info.
        </p>
        <a 
          href="/test-buttons.html" 
          style={{ 
            color: '#3b82f6', 
            textDecoration: 'underline',
            fontSize: '14px'
          }}
        >
          Try HTML test page
        </a>
      </div>
    </div>
  );
}