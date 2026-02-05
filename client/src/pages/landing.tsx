import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle, FileText, Users, TrendingUp, Clock, Shield, DollarSign,
  Mic, Video, Calendar, MessageSquare, ClipboardList, BarChart3, Star,
  Brain, Zap, Lock, ArrowRight
} from "lucide-react";
import { AuthModal } from "@/components/AuthModal";

export default function Landing() {
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const handleLogin = () => {
    setAuthModalOpen(true);
  };

  const handleIntakeForm = () => {
    window.location.href = '/intake';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-3">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900">TherapyBill AI</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="#features" className="text-slate-600 hover:text-slate-900 hidden sm:block">Features</a>
              <a href="#pricing" className="text-slate-600 hover:text-slate-900 hidden sm:block">Pricing</a>
              <Button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                Sign In
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <Badge className="mb-6 bg-green-100 text-green-700 hover:bg-green-100">
            Complete Practice Management + AI Billing
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight mb-6">
            The <span className="text-blue-500">All-in-One Platform</span> for
            <br />Therapy Practices
          </h1>
          <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
            From patient intake to insurance reimbursement. Schedule, document, bill, and get paid—all powered by AI that maximizes your revenue while minimizing your work.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Button size="lg" onClick={handleLogin} className="px-8 py-6 text-lg bg-blue-600 hover:bg-blue-700">
              Start Free Trial <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button size="lg" variant="outline" onClick={handleIntakeForm} className="px-8 py-6 text-lg border-green-500 text-green-600 hover:bg-green-50">
              Try Patient Intake
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-600">
            <div className="flex items-center">
              <Shield className="w-5 h-5 text-green-500 mr-2" />
              HIPAA Compliant
            </div>
            <div className="flex items-center">
              <Lock className="w-5 h-5 text-green-500 mr-2" />
              SOC 2 Certified
            </div>
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              No Setup Fees
            </div>
          </div>
        </div>
      </section>

      {/* Platform Overview */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              One Platform. Everything You Need.
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Stop juggling multiple tools. TherapyBill AI handles your entire practice workflow.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[
              { icon: Users, label: "Patient Intake", color: "blue" },
              { icon: Calendar, label: "Scheduling", color: "green" },
              { icon: Video, label: "Telehealth", color: "purple" },
              { icon: Mic, label: "Voice Notes", color: "orange" },
              { icon: ClipboardList, label: "SOAP Notes", color: "teal" },
              { icon: FileText, label: "Auto-Billing", color: "blue" },
              { icon: DollarSign, label: "Claims", color: "green" },
              { icon: TrendingUp, label: "Appeals", color: "red" },
              { icon: MessageSquare, label: "Messaging", color: "indigo" },
              { icon: BarChart3, label: "Analytics", color: "cyan" },
              { icon: Star, label: "Reviews", color: "yellow" },
              { icon: Shield, label: "Compliance", color: "slate" },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <item.icon className={`w-8 h-8 text-${item.color}-500 mb-2`} />
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Features Section */}
      <section id="features" className="py-20 bg-gradient-to-r from-blue-500 to-green-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              AI That Works While You Treat
            </h2>
            <p className="text-xl text-white/90 max-w-3xl mx-auto">
              Record your session. Our AI handles the rest—documentation, coding, billing, and follow-ups.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8">
              <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                <Mic className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Voice-to-Documentation</h3>
              <p className="text-white/80 mb-4">
                Record sessions (with consent) or dictate notes. AI transcribes and generates complete SOAP notes automatically.
              </p>
              <ul className="space-y-2 text-white/70 text-sm">
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Session recording with consent</li>
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> AI-generated SOAP notes</li>
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Auto-populated billing codes</li>
              </ul>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8">
              <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Smart Billing Optimization</h3>
              <p className="text-white/80 mb-4">
                AI selects optimal CPT codes for each insurance. Learns payer rules to maximize reimbursement.
              </p>
              <ul className="space-y-2 text-white/70 text-sm">
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Insurance-specific code selection</li>
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Contract rate parsing</li>
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Patient cost estimation</li>
              </ul>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8">
              <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                <Zap className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Automated Appeals</h3>
              <p className="text-white/80 mb-4">
                Denied claim? AI generates appeal letters with clinical justification. Track deadlines and outcomes.
              </p>
              <ul className="space-y-2 text-white/70 text-sm">
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> AI appeal letter generation</li>
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Deadline tracking</li>
                <li className="flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Success rate analytics</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Practice Management Features */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              Complete Practice Management
            </h2>
            <p className="text-lg text-slate-600">
              Everything you need to run your therapy practice efficiently
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle>Patient Intake</CardTitle>
                <CardDescription>
                  HIPAA-compliant digital forms with insurance consent, verification, and cost estimation
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <Calendar className="w-6 h-6 text-green-600" />
                </div>
                <CardTitle>Smart Scheduling</CardTitle>
                <CardDescription>
                  Online booking, waitlist management, and automated reminders
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <Video className="w-6 h-6 text-purple-600" />
                </div>
                <CardTitle>Telehealth</CardTitle>
                <CardDescription>
                  Built-in video sessions with waiting room, no extra software needed
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                  <MessageSquare className="w-6 h-6 text-orange-600" />
                </div>
                <CardTitle>Secure Messaging</CardTitle>
                <CardDescription>
                  HIPAA-compliant messaging with patients and care team
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-teal-100 rounded-lg flex items-center justify-center mb-4">
                  <BarChart3 className="w-6 h-6 text-teal-600" />
                </div>
                <CardTitle>Outcome Measures</CardTitle>
                <CardDescription>
                  Track patient progress with standardized assessments and visual reports
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center mb-4">
                  <Star className="w-6 h-6 text-yellow-600" />
                </div>
                <CardTitle>Review Management</CardTitle>
                <CardDescription>
                  Automated Google review requests after positive feedback
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* ROI Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-6">
                Save 10+ Hours Per Week
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                Our AI automation eliminates the tedious parts of running a practice so you can focus on what matters—your patients.
              </p>
              <div className="space-y-4">
                {[
                  { label: "Documentation time", before: "45 min/patient", after: "5 min/patient" },
                  { label: "Claim submission", before: "Manual entry", after: "Auto-generated" },
                  { label: "Denial follow-up", before: "Hours of research", after: "AI-generated appeals" },
                  { label: "Patient cost questions", before: "Call insurance", after: "Instant estimates" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <span className="font-medium text-slate-900">{item.label}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-red-500 line-through text-sm">{item.before}</span>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                      <span className="text-green-600 font-medium">{item.after}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-500 to-green-500 rounded-2xl p-8 text-white">
              <h3 className="text-2xl font-bold mb-6">Average Practice Results</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-4xl font-bold">23%</div>
                  <div className="text-white/80">Higher reimbursements</div>
                </div>
                <div>
                  <div className="text-4xl font-bold">85%</div>
                  <div className="text-white/80">Less admin time</div>
                </div>
                <div>
                  <div className="text-4xl font-bold">48hrs</div>
                  <div className="text-white/80">Faster payments</div>
                </div>
                <div>
                  <div className="text-4xl font-bold">95%</div>
                  <div className="text-white/80">Clean claim rate</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Simple, Transparent Pricing
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              No setup fees. No hidden costs. Pay only when you get paid.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader className="text-center">
                <CardTitle>Solo Practice</CardTitle>
                <CardDescription>For individual practitioners</CardDescription>
                <div className="text-4xl font-bold text-slate-900 mt-4">
                  5%
                  <span className="text-base font-normal text-slate-600 block">of collections</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Up to 100 patients</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>All core features</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Email support</span>
                  </li>
                </ul>
                <Button className="w-full" variant="outline" onClick={handleLogin}>
                  Start Free Trial
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-blue-500 hover:shadow-lg transition-shadow relative">
              <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-blue-500">
                Most Popular
              </Badge>
              <CardHeader className="text-center">
                <CardTitle>Growing Practice</CardTitle>
                <CardDescription>For small to medium practices</CardDescription>
                <div className="text-4xl font-bold text-slate-900 mt-4">
                  4.5%
                  <span className="text-base font-normal text-slate-600 block">of collections</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Unlimited patients</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Multiple providers</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Priority support</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Advanced analytics</span>
                  </li>
                </ul>
                <Button className="w-full" onClick={handleLogin}>
                  Start Free Trial
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader className="text-center">
                <CardTitle>Enterprise</CardTitle>
                <CardDescription>For large clinics & groups</CardDescription>
                <div className="text-4xl font-bold text-slate-900 mt-4">
                  Custom
                  <span className="text-base font-normal text-slate-600 block">volume pricing</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Multi-location support</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Custom integrations</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Dedicated success manager</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>SLA guarantee</span>
                  </li>
                </ul>
                <Button className="w-full" variant="outline" onClick={handleLogin}>
                  Contact Sales
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Built for Healthcare Compliance</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-8 items-center">
            <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 rounded-lg">
              <Shield className="w-6 h-6 text-green-600" />
              <span className="font-medium">HIPAA Compliant</span>
            </div>
            <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 rounded-lg">
              <Lock className="w-6 h-6 text-blue-600" />
              <span className="font-medium">256-bit Encryption</span>
            </div>
            <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <span className="font-medium">BAA Available</span>
            </div>
            <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 rounded-lg">
              <Shield className="w-6 h-6 text-purple-600" />
              <span className="font-medium">SOC 2 Type II</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-blue-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to Transform Your Practice?
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Join hundreds of therapy practices saving time and earning more with AI-powered billing.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="px-8 py-6 text-lg bg-white text-blue-600 hover:bg-slate-50"
              onClick={handleLogin}
            >
              Start Your Free 30-Day Trial
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-6 text-lg border-2 border-white text-white hover:bg-white hover:text-blue-600"
            >
              Schedule a Demo
            </Button>
          </div>
          <p className="text-blue-200 mt-6 text-sm">
            No credit card required • Full access for 30 days • Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center mb-6">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mr-3">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">TherapyBill AI</span>
              </div>
              <p className="text-slate-400 mb-4">
                The complete practice management and billing platform for therapy practices.
              </p>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Platform</h3>
              <ul className="space-y-3">
                <li><a href="#" className="hover:text-white transition-colors">Patient Intake</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Scheduling</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Billing & Claims</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Telehealth</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Resources</h3>
              <ul className="space-y-3">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Webinars</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API Docs</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Company</h3>
              <ul className="space-y-3">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors">BAA Request</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-slate-400">© 2024 TherapyBill AI. All rights reserved.</p>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <span className="text-sm">HIPAA Compliant</span>
              <span className="text-sm">SOC 2 Certified</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
    </div>
  );
}
