import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Key, Settings, Copy, MessageSquare, CheckCircle2, ExternalLink, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export default function McpSetup() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${label} copied to clipboard` });
  };

  return (
    <div className="p-6 pt-20 md:pt-6 md:ml-64 max-w-4xl">
      {/* Back button */}
      <Button
        variant="ghost"
        className="mb-4 -ml-2 text-slate-600"
        onClick={() => setLocation("/settings")}
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Settings
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Connect Claude Desktop to TherapyBill</h1>
        <p className="text-lg text-slate-600 mt-2">
          Follow these steps to manage your billing, patients, and claims by talking to Claude on your computer.
        </p>
        <p className="text-sm text-slate-500 mt-1">
          Estimated time: 5 minutes. No technical knowledge required.
        </p>
      </div>

      {/* What you'll need */}
      <Card className="mb-6 border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-900 text-lg">Before you start, you will need:</CardTitle>
        </CardHeader>
        <CardContent className="text-blue-800 space-y-2">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <span>A computer (Mac or Windows)</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <span>An Anthropic account (the company that makes Claude) &mdash; you can sign up for free at <strong>claude.ai</strong></span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <span>Admin access to your TherapyBill practice (you need to be an admin to generate API keys)</span>
          </div>
        </CardContent>
      </Card>

      {/* Step 1 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">1</span>
            <div>
              <div className="text-xl">Download Claude Desktop</div>
              <div className="text-sm font-normal text-slate-500 mt-1">Install Claude's desktop app on your computer</div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="ml-[52px] space-y-4">
          <ol className="list-decimal list-outside ml-5 space-y-3 text-slate-700">
            <li>
              Open your web browser and go to{" "}
              <strong>claude.ai/download</strong>
            </li>
            <li>
              Click the download button for your computer type (Mac or Windows).
            </li>
            <li>
              <strong>Mac:</strong> Open the downloaded file and drag Claude to your Applications folder.
              <br />
              <strong>Windows:</strong> Run the installer and follow the prompts.
            </li>
            <li>
              Open Claude Desktop. If asked, sign in with your Anthropic account (the same one you use at claude.ai).
            </li>
          </ol>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-amber-800">
              If you already have Claude Desktop installed, make sure it is up to date. Go to <strong>Claude &gt; Check for Updates</strong> in the menu bar.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">2</span>
            <div>
              <div className="text-xl">Generate Your API Key</div>
              <div className="text-sm font-normal text-slate-500 mt-1">Create a secure key that connects Claude to your TherapyBill account</div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="ml-[52px] space-y-4">
          <ol className="list-decimal list-outside ml-5 space-y-3 text-slate-700">
            <li>
              In TherapyBill, click <strong>Settings</strong> in the left sidebar (at the bottom).
            </li>
            <li>
              Click the <strong>MCP Integration</strong> tab (the last tab on the right).
            </li>
            <li>
              Type a name for your key. This can be anything &mdash; for example, <strong>"My Claude Desktop"</strong>.
            </li>
            <li>
              Click <strong>Generate Key</strong>.
            </li>
            <li>
              A green box will appear with your API key and a configuration snippet.{" "}
              <strong>Click the Copy button next to the configuration snippet.</strong> You will need this in the next step.
            </li>
          </ol>
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-red-800">
              <strong>Important:</strong> Your API key is only shown once. If you close the green box without copying it, you will need to generate a new key.
            </span>
          </div>
          <Button onClick={() => setLocation("/settings")} variant="outline">
            <Key className="w-4 h-4 mr-2" />
            Go to Settings &gt; MCP Integration
          </Button>
        </CardContent>
      </Card>

      {/* Step 3 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">3</span>
            <div>
              <div className="text-xl">Connect Claude Desktop to TherapyBill</div>
              <div className="text-sm font-normal text-slate-500 mt-1">Add TherapyBill as a connector in Claude Desktop</div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="ml-[52px] space-y-4">
          <ol className="list-decimal list-outside ml-5 space-y-3 text-slate-700">
            <li>
              Open <strong>Claude Desktop</strong> on your computer.
            </li>
            <li>
              Click the <strong>gear icon</strong> (Settings) in the bottom-left corner of the Claude Desktop window.
            </li>
            <li>
              In the Settings sidebar, click <strong>Connectors</strong>.
            </li>
            <li>
              Click <strong>Add custom connector</strong>.
            </li>
            <li>
              Fill in the two fields:
              <div className="mt-2 ml-2 space-y-2">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-sm text-slate-500 mb-1">Name</div>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm bg-white px-2 py-1 rounded border flex-1">TherapyBill AI</code>
                    <Button variant="ghost" size="sm" onClick={() => copyText("TherapyBill AI", "Name")}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-sm text-slate-500 mb-1">Remote MCP server URL</div>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm bg-white px-2 py-1 rounded border flex-1">{window.location.origin}/mcp</code>
                    <Button variant="ghost" size="sm" onClick={() => copyText(`${window.location.origin}/mcp`, "URL")}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </li>
            <li>
              Click <strong>Add</strong>.
            </li>
            <li>
              Click <strong>Connect</strong> next to the TherapyBill AI connector.
            </li>
          </ol>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-amber-800">
              <strong>Note:</strong> If the connector doesn't connect on the first try, close Claude Desktop completely (<strong>Cmd+Q</strong> on Mac, or right-click the taskbar icon and Quit on Windows) and reopen it.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Step 4 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">4</span>
            <div>
              <div className="text-xl">Start Using It</div>
              <div className="text-sm font-normal text-slate-500 mt-1">Talk to Claude about your practice</div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="ml-[52px] space-y-4">
          <ol className="list-decimal list-outside ml-5 space-y-3 text-slate-700">
            <li>
              Open Claude Desktop and start a <strong>new conversation</strong> (click "New chat" in the top-left).
            </li>
            <li>
              Try typing one of these example prompts:
            </li>
          </ol>

          <div className="space-y-2 ml-5">
            {[
              "Show me my dashboard stats",
              "Do I have any upcoming appointments this week?",
              "Search for patient John Smith",
              "What is my collection rate?",
              "Show me my accounts receivable aging report",
              "Do I have any overdue claims?",
            ].map((prompt) => (
              <div
                key={prompt}
                className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => copyText(prompt, "Prompt")}
              >
                <MessageSquare className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span className="text-sm text-slate-700 flex-1">"{prompt}"</span>
                <Copy className="w-3 h-3 text-slate-400" />
              </div>
            ))}
          </div>

          <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-green-800">
              <strong>That's it!</strong> Claude now has secure access to your practice data. You can ask about patients, claims, eligibility, appointments, billing, and more &mdash; all through natural conversation.
            </span>
          </div>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      {/* FAQ */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Frequently Asked Questions</h2>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-slate-900 mb-2">Is my patient data safe?</h3>
              <p className="text-sm text-slate-600">
                Yes. All data is encrypted in transit (HTTPS) and at rest (AES-256). Every interaction is logged in a HIPAA-compliant audit trail. Your API key is encrypted and can be revoked at any time from Settings.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-slate-900 mb-2">What can Claude see?</h3>
              <p className="text-sm text-slate-600">
                Claude can only see data from your practice. It cannot access other practices, other users' data, or any data you haven't entered into TherapyBill. Claude's access is scoped to your practice and your API key.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-slate-900 mb-2">Can Claude make changes to my data?</h3>
              <p className="text-sm text-slate-600">
                Claude can read your practice data (patients, claims, appointments, etc.) and perform actions like checking eligibility or generating SOAP notes. It cannot delete data or make irreversible changes. All AI-suggested billing codes must be reviewed and approved by you before submission.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-slate-900 mb-2">What if I want to disconnect Claude?</h3>
              <p className="text-sm text-slate-600">
                Go to Settings &gt; MCP Integration and click <strong>Revoke</strong> next to your API key. Claude will immediately lose access to your practice data.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-slate-900 mb-2">Does this cost extra?</h3>
              <p className="text-sm text-slate-600">
                The TherapyBill MCP integration is included with your TherapyBill subscription at no extra charge. You do need a Claude account from Anthropic (claude.ai), which has its own pricing.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-slate-900 mb-2">I'm getting a "Server disconnected" error</h3>
              <p className="text-sm text-slate-600">
                Try these steps in order: (1) Quit Claude Desktop completely (Cmd+Q on Mac, not just close the window) and reopen it. (2) Check that your internet connection is working. (3) Go to Settings &gt; MCP Integration in TherapyBill and make sure your API key hasn't been revoked. (4) If none of that works, generate a new API key and reconnect.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Compliance disclaimer */}
      <p className="text-xs text-slate-400 text-center italic pb-8">
        TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider.
      </p>
    </div>
  );
}
