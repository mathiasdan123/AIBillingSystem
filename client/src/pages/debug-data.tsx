import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export default function DebugData() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const hasDevBypass = localStorage.getItem('dev-bypass') === 'true';
  const shouldAllowAccess = isAuthenticated || hasDevBypass;

  console.log("Debug - isAuthenticated:", isAuthenticated);
  console.log("Debug - hasDevBypass:", hasDevBypass);
  console.log("Debug - shouldAllowAccess:", shouldAllowAccess);
  console.log("Debug - user:", user);

  const { data: patients, isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ['/api/patients'],
    enabled: shouldAllowAccess,
    retry: false,
  });

  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError } = useQuery({
    queryKey: ['/api/analytics/dashboard'],
    enabled: shouldAllowAccess,
    retry: false,
  });

  return (
    <div className="p-6 md:ml-64 bg-white min-h-screen">
      <h1 className="text-2xl font-bold mb-6">Debug Data Loading</h1>
      
      <div className="space-y-6">
        <div className="bg-blue-50 p-4 rounded border">
          <h2 className="text-lg font-semibold mb-2">Authentication Status</h2>
          <p><strong>Is Loading:</strong> {isLoading ? 'Yes' : 'No'}</p>
          <p><strong>Is Authenticated:</strong> {isAuthenticated ? 'Yes' : 'No'}</p>
          <p><strong>Has Dev Bypass:</strong> {hasDevBypass ? 'Yes' : 'No'}</p>
          <p><strong>Should Allow Access:</strong> {shouldAllowAccess ? 'Yes' : 'No'}</p>
          <p><strong>User:</strong> {user ? JSON.stringify(user) : 'None'}</p>
        </div>

        <div className="bg-white p-4 rounded border">
          <h2 className="text-lg font-semibold mb-2">Patients API</h2>
          <p><strong>Loading:</strong> {patientsLoading ? 'Yes' : 'No'}</p>
          <p><strong>Error:</strong> {patientsError ? String(patientsError) : 'None'}</p>
          <p><strong>Data:</strong> {patients ? `${patients.length} patients` : 'No data'}</p>
          {patients && (
            <pre className="mt-2 text-sm bg-gray-100 p-2 rounded overflow-auto">
              {JSON.stringify(patients, null, 2)}
            </pre>
          )}
        </div>

        <div className="bg-white p-4 rounded border">
          <h2 className="text-lg font-semibold mb-2">Dashboard API</h2>
          <p><strong>Loading:</strong> {dashboardLoading ? 'Yes' : 'No'}</p>
          <p><strong>Error:</strong> {dashboardError ? String(dashboardError) : 'None'}</p>
          <p><strong>Data:</strong> {dashboard ? 'Loaded' : 'No data'}</p>
          {dashboard && (
            <pre className="mt-2 text-sm bg-gray-100 p-2 rounded overflow-auto">
              {JSON.stringify(dashboard, null, 2)}
            </pre>
          )}
        </div>

        <div className="bg-yellow-50 p-4 rounded border">
          <h2 className="text-lg font-semibold mb-2">Manual Test</h2>
          <button 
            className="bg-blue-500 text-white px-4 py-2 rounded mr-2"
            onClick={() => localStorage.setItem('dev-bypass', 'true')}
          >
            Enable Dev Bypass
          </button>
          <button 
            className="bg-red-500 text-white px-4 py-2 rounded mr-2"
            onClick={() => localStorage.removeItem('dev-bypass')}
          >
            Disable Dev Bypass
          </button>
          <button 
            className="bg-green-500 text-white px-4 py-2 rounded"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}