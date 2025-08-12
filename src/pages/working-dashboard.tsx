import { useQuery } from "@tanstack/react-query";

export default function WorkingDashboard() {
  const { data: stats, isLoading, error } = useQuery<any>({
    queryKey: ['/api/analytics/dashboard'],
    retry: false,
  });

  const goToLanding = () => {
    localStorage.setItem('dev-bypass', 'false');
    window.location.reload();
  };

  return (
    <div className="p-6 md:ml-64 bg-blue-50 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold">Dashboard Working!</h1>
        <button 
          onClick={goToLanding}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium whitespace-nowrap shrink-0"
        >
          Back to Landing Page
        </button>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Dashboard Analytics</h2>
        <div className="space-y-2">
          <p><strong>Loading:</strong> {isLoading ? 'Yes' : 'No'}</p>
          <p><strong>Error:</strong> {error ? String(error) : 'None'}</p>
          <p><strong>Data:</strong> {stats ? 'Loaded' : 'No data'}</p>
        </div>

        {stats && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 rounded">
              <h3 className="font-medium">Total Patients</h3>
              <p className="text-2xl font-bold text-green-600">{stats.totalPatients}</p>
            </div>
            <div className="p-4 bg-blue-50 rounded">
              <h3 className="font-medium">Active Claims</h3>
              <p className="text-2xl font-bold text-blue-600">{stats.activeClaims}</p>
            </div>
            <div className="p-4 bg-purple-50 rounded">
              <h3 className="font-medium">Monthly Revenue</h3>
              <p className="text-2xl font-bold text-purple-600">${stats.monthlyRevenue}</p>
            </div>
            <div className="p-4 bg-orange-50 rounded">
              <h3 className="font-medium">Accuracy Rate</h3>
              <p className="text-2xl font-bold text-orange-600">{stats.claimAccuracyRate}%</p>
            </div>
          </div>
        )}

        {stats?.recentActivity && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-3">Recent Activity</h3>
            <div className="space-y-2">
              {stats.recentActivity.map((activity: any, index: number) => (
                <div key={index} className="p-3 bg-gray-50 rounded">
                  <p className="text-sm">{activity.message}</p>
                  <p className="text-xs text-gray-500">{activity.time}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}