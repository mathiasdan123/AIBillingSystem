import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, FileText, Users, TrendingUp, Clock, Shield, DollarSign } from "lucide-react";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = '/api/login';
  };

  const handleIntakeForm = () => {
    window.location.href = '/intake';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
      {/* TEMP: Very obvious sign-in banner */}
      <div className="bg-red-600 text-white text-center py-4 text-xl font-bold">
        👉 CLICK HERE TO SIGN IN 👈
        <button onClick={handleLogin} className="ml-4 bg-white text-red-600 px-6 py-2 rounded-lg font-bold">
          SIGN IN NOW
        </button>
      </div>
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
            <Button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
              Sign In
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-tight mb-6">
            <span className="text-green-500">Minimal Work</span>,{" "}
            <span className="text-blue-500">Maximum Revenue</span>
            <br />Billing for OT Practices
          </h1>
          <p className="text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
            Simply dictate your session notes or upload documents. Our AI handles billing tasks AND optimizes your payments. Spend your time on patient care while earning more.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Button size="lg" onClick={handleLogin} className="px-8 py-6 text-lg bg-blue-600 hover:bg-blue-700">
              Sign In / Start Free Trial
            </Button>
            <Button size="lg" variant="outline" onClick={handleIntakeForm} className="px-8 py-6 text-lg border-green-500 text-green-600 hover:bg-green-50">
              Complete Patient Intake
            </Button>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Already have an account? <button onClick={handleLogin} className="text-blue-600 underline font-medium">Click here to sign in</button>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-600">
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              No setup fees
            </div>
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              HIPAA Compliant
            </div>
            <div className="flex items-center">
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              24/7 Support
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-16 bg-gradient-to-r from-green-500 to-blue-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
              Treat. Bill. Repeat. And we've got the billing.
            </h2>
            <p className="text-xl text-white/90 max-w-4xl mx-auto">
              We eliminate most of your billing administrative work.{" "}
              <strong className="bg-white/20 px-3 py-1 rounded-lg">
                Our AI handles billing from intake to following up on denials to help ensure your payments are optimized.
              </strong>{" "}
              Minimal forms, automated claims, automated follow-ups.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">Step 1: Dictate or Upload</h3>
              <p className="text-white/80">
                Simply speak your session notes or upload documents. Our AI transcribes and extracts all billing data.
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">Step 2: We Handle Everything</h3>
              <p className="text-white/80">
                AI creates claims, verifies insurance, submits to payers, tracks payments, and handles all follow-ups automatically.
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <DollarSign className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">Step 3: Get Paid More</h3>
              <p className="text-white/80">
                We optimize reimbursements and share 50% of any improvements. You earn more while doing less work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Everything You Need for OT Billing Success
            </h2>
            <p className="text-lg text-slate-600 max-w-3xl mx-auto">
              <strong>Stop spending hours on billing.</strong> Our AI-powered platform requires minimal work from OTs while optimizing your payments.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="hover:shadow-lg transition-shadow border-2 border-green-500 bg-green-50">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <CheckCircle className="w-6 h-6 text-green-500" />
                </div>
                <CardTitle className="text-green-700">Minimal Work + Higher Payments</CardTitle>
                <CardDescription>
                  Dramatically reduced paperwork AND AI-optimized reimbursements.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    <strong>Voice-to-text session notes</strong>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    <strong>AI-optimized billing & claims</strong>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    <strong>Higher reimbursement rates</strong>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-green-500" />
                </div>
                <CardTitle>Automated Insurance Verification</CardTitle>
                <CardDescription>
                  Real-time eligibility checks and benefit verification prevent claim denials.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Real-time eligibility checks
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Prior authorization tracking
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Benefit limitation alerts
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-blue-500" />
                </div>
                <CardTitle>Smart Patient Portal</CardTitle>
                <CardDescription>
                  Streamlined intake forms with smart field pre-population.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Digital intake forms
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Secure online payments
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Automated reminders
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-green-500" />
                </div>
                <CardTitle>Performance Analytics</CardTitle>
                <CardDescription>
                  Real-time insights into denial rates, revenue trends, and optimization opportunities.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Denial rate tracking
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Revenue forecasting
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Payer performance insights
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-blue-500" />
                </div>
                <CardTitle>End-to-End Claim Tracking</CardTitle>
                <CardDescription>
                  Monitor every claim from submission to payment with automated follow-up.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Real-time status updates
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Automated follow-ups
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Appeal assistance
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow border-2 border-green-500">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <DollarSign className="w-6 h-6 text-green-500" />
                </div>
                <CardTitle>Reimbursement Optimization</CardTitle>
                <CardDescription>
                  We find higher reimbursement rates and share 50% of any improvements.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Automated appeal processing
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Rate benchmarking & negotiation
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                    Revenue sharing on improvements
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Time Savings Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-6">
              Reclaim Your Time for Patient Care
            </h2>
            <p className="text-xl text-slate-600 max-w-4xl mx-auto">
              If you're spending hours each week on billing paperwork, we can help. Our automated system reduces billing work to{" "}
              <strong>under 30 minutes weekly</strong> so you can see more patients and earn more revenue.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
            <div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Before TherapyBill AI:</h3>
              <ul className="space-y-4">
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-4 mt-0.5 flex-shrink-0">
                    <span className="text-red-600 text-sm font-bold">✗</span>
                  </div>
                  <div>
                    <strong className="text-slate-900">Hours daily on paperwork</strong>
                    <p className="text-slate-600">Forms, claims, follow-ups, corrections</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-4 mt-0.5 flex-shrink-0">
                    <span className="text-red-600 text-sm font-bold">✗</span>
                  </div>
                  <div>
                    <strong className="text-slate-900">Constant claim denials</strong>
                    <p className="text-slate-600">Errors, missing info, coding mistakes</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-4 mt-0.5 flex-shrink-0">
                    <span className="text-red-600 text-sm font-bold">✗</span>
                  </div>
                  <div>
                    <strong className="text-slate-900">Unpredictable payments</strong>
                    <p className="text-slate-600">Slow reimbursements, payment delays</p>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-green-700 mb-6">After TherapyBill AI:</h3>
              <ul className="space-y-4">
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-4 mt-0.5 flex-shrink-0">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  <div>
                    <strong className="text-slate-900">2 minutes per session</strong>
                    <p className="text-slate-600">Just dictate notes, we handle everything</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-4 mt-0.5 flex-shrink-0">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  <div>
                    <strong className="text-slate-900">AI-optimized claims</strong>
                    <p className="text-slate-600">Higher approval rates, fewer denials</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-4 mt-0.5 flex-shrink-0">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  <div>
                    <strong className="text-slate-900">Guaranteed payments</strong>
                    <p className="text-slate-600">We optimize and track until paid</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <div className="text-center mt-16">
            <div className="bg-green-100 rounded-2xl p-8 max-w-2xl mx-auto">
              <h4 className="text-2xl font-bold text-green-700 mb-4">
                Reclaimed Time = More Patient Revenue
              </h4>
              <p className="text-green-600">
                Every hour saved on billing can be spent with patients, directly increasing your practice revenue
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Pay Less, Work Less, Earn More
            </h2>
            <p className="text-lg text-slate-600 max-w-3xl mx-auto">
              <strong>Minimal administrative work</strong> for OTs + <strong>AI-optimized payments</strong> + competitive rates from 5% down to 4.25%.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader className="text-center">
                <CardTitle>Starter</CardTitle>
                <CardDescription>Perfect for solo practitioners</CardDescription>
                <div className="text-3xl font-bold text-slate-900 mt-4">
                  5%
                  <span className="text-base font-normal text-slate-600"> per transaction</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Up to 200 claims/month</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Basic AI claim review</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Insurance verification</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Patient portal</span>
                  </li>
                </ul>
                <Button className="w-full" variant="outline" onClick={handleLogin}>
                  Start Free Trial
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-blue-500 hover:shadow-lg transition-shadow relative">
              <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white">
                Most Popular
              </Badge>
              <CardHeader className="text-center">
                <CardTitle>Professional</CardTitle>
                <CardDescription>Ideal for growing practices</CardDescription>
                <div className="text-3xl font-bold text-slate-900 mt-4">
                  4.5%
                  <span className="text-base font-normal text-slate-600"> per transaction</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Up to 1,000 claims/month</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Advanced AI optimization</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Analytics dashboard</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Priority phone support</span>
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
                <CardDescription>For large practices & clinics</CardDescription>
                <div className="text-3xl font-bold text-slate-900 mt-4">
                  4.25%
                  <span className="text-base font-normal text-slate-600"> per transaction</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Unlimited claims</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">Custom AI training</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">API integrations</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                    <span className="text-slate-700">24/7 priority support</span>
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

      {/* CTA Section */}
      <section className="py-20 bg-blue-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to Transform Your OT Billing?
          </h2>
          <p className="text-xl text-blue-100 mb-8 max-w-3xl mx-auto">
            <strong>Just dictate your notes.</strong> We handle the complex billing work while you focus on patient care. Reclaim your time starting today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              variant="secondary"
              className="px-8 py-6 text-lg bg-white text-blue-500 hover:bg-slate-50"
              onClick={handleLogin}
            >
              Start Your Free 30-Day Trial
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-6 text-lg border-2 border-white text-white hover:bg-white hover:text-blue-500"
            >
              Schedule a Demo
            </Button>
          </div>
          <p className="text-blue-100 mt-6 text-sm">
            No credit card required • Setup in minutes • Cancel anytime
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
              <p className="text-slate-400 mb-6">
                Intelligent billing solutions designed specifically for occupational therapy practices.
              </p>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Product</h3>
              <ul className="space-y-3">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Resources</h3>
              <ul className="space-y-3">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">OT Billing Guide</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6">Company</h3>
              <ul className="space-y-3">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-slate-400">© 2024 TherapyBill AI. All rights reserved.</p>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <span className="text-sm text-slate-400">HIPAA Compliant</span>
              <span className="text-sm text-slate-400">SOC 2 Certified</span>
              <span className="text-sm text-slate-400">99.9% Uptime</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
