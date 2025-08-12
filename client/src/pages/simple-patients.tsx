import { useQuery } from "@tanstack/react-query";

export default function SimplePatients() {
  const { data: patients, isLoading, error } = useQuery<any[]>({
    queryKey: ['/api/patients'],
    retry: false,
  });

  return (
    <div className="p-6 md:ml-64 bg-green-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-6">Patients Page Working!</h1>
      
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">API Status</h2>
        <div className="space-y-2">
          <p><strong>Loading:</strong> {isLoading ? 'Yes' : 'No'}</p>
          <p><strong>Error:</strong> {error ? String(error) : 'None'}</p>
          <p><strong>Data Count:</strong> {patients ? patients.length : 0}</p>
        </div>

        {patients && patients.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-3">Patient List:</h3>
            <div className="space-y-2">
              {patients.map((patient: any) => (
                <div key={patient.id} className="p-3 bg-blue-50 rounded">
                  <p className="font-medium">{patient.firstName} {patient.lastName}</p>
                  <p className="text-sm text-gray-600">Insurance: {patient.insuranceProvider}</p>
                  <p className="text-sm text-gray-600">Policy: {patient.policyNumber}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}