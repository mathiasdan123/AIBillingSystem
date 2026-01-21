import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon } from "lucide-react";

export default function Calendar() {
  return (
    <div className="md:ml-64 min-h-screen bg-slate-50 p-8 pt-20 md:pt-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <CalendarIcon className="w-8 h-8 text-blue-500" />
          <h1 className="text-3xl font-bold text-slate-900">Calendar</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Appointment Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600">
              Calendar functionality coming soon. This page will display scheduled appointments,
              allow scheduling new sessions, and integrate with patient records.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
