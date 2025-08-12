import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, FileText, Users, TrendingUp, Clock, Shield, Star, DollarSign } from "lucide-react";
import { useLocation } from "wouter";

export default function Landing() {
  const [, navigate] = useLocation();

  const handleDemoAccess = () => {
    console.log('Demo Access clicked');
    localStorage.setItem('dev-bypass', 'true');
    // Force a hard reload to ensure the dev bypass takes effect
    window.location.replace('/soap-notes');
  };

  const handleIntakeForm = () => {
    console.log('Intake Form clicked');
    // Force a hard reload to ensure proper navigation
    window.location.replace('/intake');
  };

  return (
    <div style={{margin: 0, padding: 0, minHeight: '100vh', background: 'linear-gradient(135deg, hsl(214, 100%, 97%) 0%, hsl(138, 62%, 97%) 100%)'}}>
      {/* Header */}
      <header style={{background: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgb(226, 232, 240)', position: 'sticky', top: 0, zIndex: 50}}>
        <div style={{maxWidth: '1280px', margin: '0 auto', padding: '0 16px'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px'}}>
            <div style={{display: 'flex', alignItems: 'center'}}>
              <div style={{width: '32px', height: '32px', background: 'hsl(207, 90%, 54%)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '12px'}}>
                <FileText style={{width: '20px', height: '20px', color: 'white'}} />
              </div>
              <span style={{fontSize: '20px', fontWeight: 'bold', color: 'rgb(15, 23, 42)'}}>TherapyBill AI</span>
            </div>
            <a 
              href="/soap-notes"
              onClick={(e) => {
                e.preventDefault();
                localStorage.setItem('dev-bypass', 'true');
                window.location.href = '/soap-notes';
              }}
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-center no-underline"
              data-testid="button-demo-access"
            >
              Demo Access
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section - No Gaps */}
      <div style={{padding: '32px 16px 16px', maxWidth: '1280px', margin: '0 auto'}}>
        <div style={{textAlign: 'center'}}>
          <h1 style={{fontSize: 'clamp(2rem, 5vw, 4rem)', fontWeight: 'bold', color: 'rgb(15, 23, 42)', lineHeight: '1.1', marginBottom: '24px'}}>
            <span style={{color: 'hsl(142, 71%, 45%)'}}>Minimal Work</span>, <span style={{color: 'hsl(207, 90%, 54%)'}}>Maximum Revenue</span> Billing for OT Practices
          </h1>
          <p style={{fontSize: '20px', color: 'rgb(71, 85, 105)', marginBottom: '24px', maxWidth: '768px', margin: '0 auto 24px'}}>
            Simply dictate your session notes or upload documents. Our AI handles billing tasks AND optimizes your payments. Spend your time on patient care while earning more.
          </p>
          <div style={{display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'center', alignItems: 'center', marginBottom: '24px'}}>
            <a 
              href="/soap-notes"
              onClick={(e) => {
                e.preventDefault();
                localStorage.setItem('dev-bypass', 'true');
                window.location.href = '/soap-notes';
              }}
              className="inline-block px-8 py-4 bg-blue-600 text-white text-lg rounded hover:bg-blue-700 text-center no-underline"
              data-testid="button-demo-soap"
            >
              Demo Access (Test SOAP Notes)
            </a>
            <a 
              href="/intake"
              onClick={(e) => {
                e.preventDefault();
                window.location.href = '/intake';
              }}
              className="inline-block px-8 py-4 bg-green-600 text-white text-lg rounded hover:bg-green-700 text-center no-underline"
              data-testid="button-intake-form"
            >
              Complete Patient Intake
            </a>
            <Button 
              size="lg" 
              variant="outline" 
              className="border-medical-blue-500 text-medical-blue-500 hover:bg-medical-blue-50 px-8 py-4 text-lg"
            >
              Watch Demo
            </Button>
          </div>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px', fontSize: '14px', color: 'rgb(71, 85, 105)', flexWrap: 'wrap'}}>
            <div style={{display: 'flex', alignItems: 'center'}}>
              <CheckCircle style={{width: '20px', height: '20px', color: 'hsl(142, 71%, 45%)', marginRight: '8px'}} />
              No setup fees
            </div>
            <div style={{display: 'flex', alignItems: 'center'}}>
              <CheckCircle style={{width: '20px', height: '20px', color: 'hsl(142, 71%, 45%)', marginRight: '8px'}} />
              HIPAA Compliant
            </div>
            <div style={{display: 'flex', alignItems: 'center'}}>
              <CheckCircle style={{width: '20px', height: '20px', color: 'hsl(142, 71%, 45%)', marginRight: '8px'}} />
              24/7 Support
            </div>
          </div>
        </div>
      </div>

      {/* Green Section - Direct Connection */}
      <div style={{background: 'linear-gradient(135deg, hsl(142, 71%, 45%) 0%, hsl(207, 90%, 54%) 100%)', padding: '64px 16px', margin: 0}}>
        <div style={{maxWidth: '1280px', margin: '0 auto'}}>
          <div style={{textAlign: 'center', marginBottom: '64px'}}>
            <h2 style={{fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', fontWeight: 'bold', color: 'white', marginBottom: '32px'}}>
              Treat. Bill. Repeat. And we've got the billing.
            </h2>
            <p style={{fontSize: '24px', color: 'white', maxWidth: '1000px', margin: '0 auto 80px', lineHeight: '1.5', fontWeight: '500'}}>
              We eliminate most of your billing administrative work. <strong style={{color: 'white', background: 'rgba(34, 197, 94, 0.3)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.2)'}}>Our AI handles billing from intake to following up on denials to help ensure your payments are optimized.</strong> Minimal forms, automated claims, automated follow-ups. Spend your time on what you do best - helping patients.
            </p>
          </div>
          
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px', maxWidth: '1000px', margin: '0 auto'}}>
            <div style={{background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(12px)', borderRadius: '12px', padding: '32px', textAlign: 'center'}}>
              <div style={{width: '64px', height: '64px', background: 'rgba(255, 255, 255, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px'}}>
                <CheckCircle style={{width: '32px', height: '32px', color: 'white'}} />
              </div>
              <h3 style={{fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '16px'}}>Step 1: Dictate or Upload</h3>
              <p style={{color: 'rgba(255, 255, 255, 0.8)'}}>
                Simply speak your session notes or upload documents. Our AI transcribes and extracts all billing data.
              </p>
            </div>
            
            <div style={{background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(12px)', borderRadius: '12px', padding: '32px', textAlign: 'center'}}>
              <div style={{width: '64px', height: '64px', background: 'rgba(255, 255, 255, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px'}}>
                <Shield style={{width: '32px', height: '32px', color: 'white'}} />
              </div>
              <h3 style={{fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '16px'}}>Step 2: We Handle Everything</h3>
              <p style={{color: 'rgba(255, 255, 255, 0.8)'}}>
                AI creates claims, verifies insurance, submits to payers, tracks payments, and handles all follow-ups automatically.
              </p>
            </div>
            
            <div style={{background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(12px)', borderRadius: '12px', padding: '32px', textAlign: 'center'}}>
              <div style={{width: '64px', height: '64px', background: 'rgba(255, 255, 255, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px'}}>
                <DollarSign style={{width: '32px', height: '32px', color: 'white'}} />
              </div>
              <h3 style={{fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '16px'}}>Step 3: Get Paid More</h3>
              <p style={{color: 'rgba(255, 255, 255, 0.8)'}}>
                We optimize reimbursements and share 50% of any improvements. You earn more while doing less work.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Everything You Need for OT Billing Success
            </h2>
            <p className="text-lg text-slate-600 max-w-3xl mx-auto">
              <strong>Stop spending hours on billing.</strong> Our AI-powered platform requires minimal work from OTs while optimizing your payments - just dictate notes and we handle the complex billing tasks AND maximize your reimbursements.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="hover:shadow-lg transition-shadow border-2 border-healthcare-green-500 bg-healthcare-green-50">
              <CardHeader>
                <div className="w-12 h-12 bg-healthcare-green-100 rounded-lg flex items-center justify-center mb-4">
                  <CheckCircle className="w-6 h-6 text-healthcare-green-500" />
                </div>
                <CardTitle className="text-healthcare-green-700">Minimal Work + Higher Payments</CardTitle>
                <CardDescription>
                  Dramatically reduced paperwork AND AI-optimized reimbursements. Voice dictation handles billing while AI maximizes your revenue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    <strong>Voice-to-text session notes</strong>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    <strong>AI-optimized billing & claims</strong>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    <strong>Higher reimbursement rates</strong>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-healthcare-green-100 rounded-lg flex items-center justify-center mb-4">
                  <Shield className="w-6 h-6 text-healthcare-green-500" />
                </div>
                <CardTitle>Automated Insurance Verification</CardTitle>
                <CardDescription>
                  Real-time eligibility checks and benefit verification prevent claim denials and reduce uncollectible revenue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Real-time eligibility checks
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Prior authorization tracking
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Benefit limitation alerts
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-medical-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-medical-blue-500" />
                </div>
                <CardTitle>Smart Patient Portal</CardTitle>
                <CardDescription>
                  Streamlined intake forms with smart field pre-population and secure payment processing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Digital intake forms
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Secure online payments
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Automated reminders
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-healthcare-green-100 rounded-lg flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-healthcare-green-500" />
                </div>
                <CardTitle>Performance Analytics</CardTitle>
                <CardDescription>
                  Real-time insights into denial rates, revenue trends, and optimization opportunities.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Denial rate tracking
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Revenue forecasting
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Payer performance insights
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-medical-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-medical-blue-500" />
                </div>
                <CardTitle>End-to-End Claim Tracking</CardTitle>
                <CardDescription>
                  Monitor every claim from submission to payment with automated follow-up and appeal management.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Real-time status updates
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Automated follow-ups
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Appeal assistance
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 bg-healthcare-green-100 rounded-lg flex items-center justify-center mb-4">
                  <TrendingUp className="w-6 h-6 text-healthcare-green-500" />
                </div>
                <CardTitle>Smart Expense Tracking</CardTitle>
                <CardDescription>
                  AI-powered expense categorization and financial insights to optimize your practice profitability.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Automatic categorization
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Tax-ready reports
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Profitability insights
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow border-2 border-healthcare-green-500">
              <CardHeader>
                <div className="w-12 h-12 bg-healthcare-green-100 rounded-lg flex items-center justify-center mb-4">
                  <DollarSign className="w-6 h-6 text-healthcare-green-500" />
                </div>
                <CardTitle>Reimbursement Optimization</CardTitle>
                <CardDescription>
                  We find higher reimbursement rates and share 50% of any improvements we secure for your practice.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Automated appeal processing
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Rate benchmarking & negotiation
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500 mr-2" />
                    Revenue sharing on improvements
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Time Savings Section */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6">
              Reclaim Your Time for Patient Care
            </h2>
            <p className="text-xl text-slate-600 max-w-4xl mx-auto">
              If you're spending hours each week on billing paperwork, we can help. Our automated system reduces billing work to <strong>under 30 minutes weekly</strong> so you can see more patients and earn more revenue.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Before TherapyBill AI:</h3>
              <ul className="space-y-4">
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-4 mt-0.5">
                    <span className="text-red-600 text-sm">✗</span>
                  </div>
                  <div>
                    <strong className="text-slate-900">Hours daily on paperwork</strong>
                    <p className="text-slate-600">Forms, claims, follow-ups, corrections</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-4 mt-0.5">
                    <span className="text-red-600 text-sm">✗</span>
                  </div>
                  <div>
                    <strong className="text-slate-900">Constant claim denials</strong>
                    <p className="text-slate-600">Errors, missing info, coding mistakes</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center mr-4 mt-0.5">
                    <span className="text-red-600 text-sm">✗</span>
                  </div>
                  <div>
                    <strong className="text-slate-900">Unpredictable payments</strong>
                    <p className="text-slate-600">Slow reimbursements, payment delays</p>
                  </div>
                </li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-2xl font-bold text-healthcare-green-700 mb-6">After TherapyBill AI:</h3>
              <ul className="space-y-4">
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-healthcare-green-100 rounded-full flex items-center justify-center mr-4 mt-0.5">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500" />
                  </div>
                  <div>
                    <strong className="text-slate-900">2 minutes per session</strong>
                    <p className="text-slate-600">Just dictate notes, we handle everything</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-healthcare-green-100 rounded-full flex items-center justify-center mr-4 mt-0.5">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500" />
                  </div>
                  <div>
                    <strong className="text-slate-900">AI-optimized claims</strong>
                    <p className="text-slate-600">Higher approval rates, fewer denials</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-healthcare-green-100 rounded-full flex items-center justify-center mr-4 mt-0.5">
                    <CheckCircle className="w-4 h-4 text-healthcare-green-500" />
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
            <div className="bg-healthcare-green-100 rounded-2xl p-8 max-w-2xl mx-auto">
              <h4 className="text-2xl font-bold text-healthcare-green-700 mb-4">
                Reclaimed Time = More Patient Revenue
              </h4>
              <p className="text-healthcare-green-600">
                Every hour saved on billing can be spent with patients, directly increasing your practice revenue
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Pay Less, Work Less, Earn More
            </h2>
            <p className="text-lg text-slate-600 max-w-3xl mx-auto">
              <strong>Minimal administrative work</strong> for OTs + <strong>AI-optimized payments</strong> + competitive rates from 5% down to 4.25%. Lower fees than current billing services while dramatically reducing admin tasks AND increasing your revenue.
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
                <p className="text-sm text-slate-600">Starting rate for small practices</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Up to 200 claims/month</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Basic AI claim review</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Insurance verification</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Patient portal</span>
                  </li>
                </ul>
                <Button 
                  className="w-full bg-medical-blue-50 text-medical-blue-600 border border-medical-blue-200 hover:bg-medical-blue-100"
                  onClick={() => window.location.href = '/api/login'}
                >
                  Start Free Trial
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-medical-blue-500 hover:shadow-lg transition-shadow relative">
              <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-medical-blue-500 text-white">
                Most Popular
              </Badge>
              <CardHeader className="text-center">
                <CardTitle>Professional</CardTitle>
                <CardDescription>Ideal for growing practices</CardDescription>
                <div className="text-3xl font-bold text-slate-900 mt-4">
                  4.5%
                  <span className="text-base font-normal text-slate-600"> per transaction</span>
                </div>
                <p className="text-sm text-slate-600">Volume discount for growing practices</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Up to 1,000 claims/month</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Advanced AI optimization</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Analytics dashboard</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Priority phone support</span>
                  </li>
                </ul>
                <Button 
                  className="w-full bg-medical-blue-500 text-white hover:bg-medical-blue-600"
                  onClick={() => window.location.href = '/api/login'}
                >
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
                <p className="text-sm text-slate-600">Best rate for large practices</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Unlimited claims</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">Custom AI training</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">API integrations</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-healthcare-green-500 mr-3" />
                    <span className="text-slate-700">24/7 priority support</span>
                  </li>
                </ul>
                <Button 
                  className="w-full bg-medical-blue-50 text-medical-blue-600 border border-medical-blue-200 hover:bg-medical-blue-100"
                  onClick={() => window.location.href = '/api/login'}
                >
                  Contact Sales
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-medical-blue-500 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-blue-800 mb-6">
            Ready to Transform Your OT Billing?
          </h2>
          <p className="text-xl text-medical-blue-100 mb-8 max-w-3xl mx-auto">
            <strong>Just dictate your notes.</strong> We handle the complex billing work while you focus on patient care. Reclaim your time starting today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              className="bg-white text-medical-blue-500 hover:bg-slate-50 px-8 py-4 text-lg"
              onClick={() => window.location.href = '/api/login'}
            >
              Start Your Free 30-Day Trial
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="border-2 border-white text-white hover:bg-white hover:text-medical-blue-500 px-8 py-4 text-lg"
            >
              Schedule a Demo
            </Button>
          </div>
          <p className="text-medical-blue-100 mt-6 text-sm">
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
                <div className="w-8 h-8 bg-medical-blue-500 rounded-lg flex items-center justify-center mr-3">
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
