export default function ButtonTest() {
  const handleSoapClick = () => {
    console.log('SOAP button clicked');
    localStorage.setItem('dev-bypass', 'true');
    window.location.href = '/soap-notes';
  };

  const handleIntakeClick = () => {
    console.log('Intake button clicked');
    window.location.href = '/intake';
  };

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h1>Button Test Page</h1>
      
      <div style={{ marginTop: '40px' }}>
        <button 
          onClick={handleSoapClick}
          style={{ 
            display: 'inline-block', 
            margin: '10px', 
            padding: '15px 30px', 
            backgroundColor: '#3b82f6', 
            color: 'white', 
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          Test SOAP Navigation
        </button>
        
        <button 
          onClick={handleIntakeClick}
          style={{ 
            display: 'inline-block', 
            margin: '10px', 
            padding: '15px 30px', 
            backgroundColor: '#10b981', 
            color: 'white', 
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          Test Intake Navigation
        </button>
      </div>
      
      <div style={{ marginTop: '40px' }}>
        <h2>JavaScript Test</h2>
        <button 
          onClick={() => alert('JavaScript is working!')}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: '#f59e0b', 
            color: 'white', 
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Test Alert
        </button>
      </div>
    </div>
  );
}