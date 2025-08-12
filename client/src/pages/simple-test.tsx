import { useLocation } from "wouter";

export default function SimpleTest() {
  const [location] = useLocation();
  
  return (
    <div className="p-6 md:ml-64 bg-green-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-4">Simple Test Page</h1>
      <p className="mb-4">Current location: <strong>{location}</strong></p>
      <p className="mb-4">If you can see this page, navigation is working!</p>
      
      <div className="space-y-2">
        <button 
          className="block bg-blue-500 text-white px-4 py-2 rounded"
          onClick={() => window.location.href = '/'}
        >
          Go to Dashboard
        </button>
        <button 
          className="block bg-green-500 text-white px-4 py-2 rounded"
          onClick={() => window.location.href = '/patients'}
        >
          Go to Patients
        </button>
        <button 
          className="block bg-purple-500 text-white px-4 py-2 rounded"
          onClick={() => window.location.href = '/debug'}
        >
          Go to Debug
        </button>
      </div>
    </div>
  );
}