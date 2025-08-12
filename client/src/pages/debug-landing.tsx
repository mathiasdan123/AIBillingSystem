import { useState, useEffect } from 'react';

export default function DebugLanding() {
  const [devBypass, setDevBypass] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  
  useEffect(() => {
    setDevBypass(localStorage.getItem('dev-bypass'));
    setCurrentPath(window.location.pathname);
  }, []);

  const clearStorage = () => {
    localStorage.removeItem('dev-bypass');
    setDevBypass(null);
    window.location.reload();
  };

  const testNavigation = (path: string) => {
    console.log(`Testing navigation to: ${path}`);
    if (path === '/soap-notes') {
      localStorage.setItem('dev-bypass', 'true');
    }
    
    // Try multiple navigation methods
    console.log('Method 1: window.location.href');
    window.location.href = path;
    
    setTimeout(() => {
      console.log('Method 2: window.location.assign');
      window.location.assign(path);
    }, 100);
    
    setTimeout(() => {
      console.log('Method 3: window.location.replace');
      window.location.replace(path);
    }, 200);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Debug Landing Page</h1>
      
      <div style={{ background: '#f0f0f0', padding: '10px', margin: '10px 0' }}>
        <h3>Debug Info:</h3>
        <p>Current Path: {currentPath}</p>
        <p>Dev Bypass: {devBypass || 'null'}</p>
        <p>NODE_ENV: {import.meta.env.NODE_ENV}</p>
        <p>DEV Mode: {import.meta.env.DEV ? 'true' : 'false'}</p>
      </div>

      <div style={{ margin: '20px 0' }}>
        <button 
          onClick={clearStorage}
          style={{ 
            padding: '10px 20px', 
            margin: '5px',
            backgroundColor: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Clear LocalStorage & Reload
        </button>
      </div>

      <div style={{ margin: '20px 0' }}>
        <h3>Test Navigation:</h3>
        <button 
          onClick={() => testNavigation('/soap-notes')}
          style={{ 
            padding: '10px 20px', 
            margin: '5px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Navigate to SOAP Notes
        </button>
        
        <button 
          onClick={() => testNavigation('/intake')}
          style={{ 
            padding: '10px 20px', 
            margin: '5px',
            backgroundColor: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Navigate to Intake
        </button>
        
        <button 
          onClick={() => testNavigation('/data-upload')}
          style={{ 
            padding: '10px 20px', 
            margin: '5px',
            backgroundColor: '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Navigate to Data Upload
        </button>
      </div>

      <div style={{ margin: '20px 0' }}>
        <h3>Direct Links (fallback):</h3>
        <a href="/soap-notes" style={{ display: 'block', margin: '5px 0', color: '#3b82f6' }}>
          Direct Link to SOAP Notes
        </a>
        <a href="/intake" style={{ display: 'block', margin: '5px 0', color: '#10b981' }}>
          Direct Link to Intake
        </a>
        <a href="/data-upload" style={{ display: 'block', margin: '5px 0', color: '#f59e0b' }}>
          Direct Link to Data Upload
        </a>
      </div>

      <div style={{ background: '#fff3cd', padding: '10px', margin: '10px 0', fontSize: '12px' }}>
        <strong>Instructions:</strong>
        <ol>
          <li>Check debug info above</li>
          <li>Clear LocalStorage if dev-bypass is set</li>
          <li>Try test navigation buttons</li>
          <li>Try direct links if buttons fail</li>
          <li>Check browser console for logs</li>
        </ol>
      </div>
    </div>
  );
}