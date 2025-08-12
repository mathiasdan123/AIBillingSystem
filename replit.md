# TherapyBill AI - Replit Configuration

## Overview

TherapyBill AI is a comprehensive billing management system designed specifically for occupational therapy practices. It's built as a full-stack web application with AI-powered features to reduce claim denials and automate insurance processes.

## User Preferences

Preferred communication style: Simple, everyday language.
Data integrity: Remove all fake statistics and placeholder data that could be misleading. Use only authentic data or honest placeholders.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for development and production builds
- **Styling**: Tailwind CSS with custom medical/healthcare theme colors
- **UI Components**: Radix UI components with shadcn/ui styling system
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for client-side routing
- **Forms**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful API with conventional HTTP methods
- **Middleware**: Custom logging, error handling, and authentication middleware
- **Session Management**: Express sessions with PostgreSQL storage

### Authentication System
- **Provider**: Replit OAuth integration
- **Strategy**: OpenID Connect with Passport.js
- **Session Storage**: PostgreSQL-backed sessions with connect-pg-simple
- **Security**: HTTP-only cookies with secure flags

## Key Components

### Data Layer
- **ORM**: Drizzle ORM for type-safe database operations
- **Database**: PostgreSQL (configured for Neon serverless)
- **Migration System**: Drizzle Kit for schema management
- **Connection**: Neon serverless with WebSocket support

### Core Business Entities
- **Users**: Authentication and role-based access (therapist, admin, billing)
- **Practices**: Clinic/practice information with NPI and tax details
- **Patients**: Patient demographics and insurance information
- **Treatment Sessions**: Therapy session records with CPT codes
- **Claims**: Insurance claim processing and status tracking
- **Expenses**: Practice expense tracking for tax purposes
- **Payments**: Payment processing and reconciliation

### AI Features
- **Claim Review**: AI-powered claim validation and scoring
- **Denial Prevention**: Automated checks against common denial reasons
- **Insurance Verification**: Automated eligibility checking

## Data Flow

1. **User Authentication**: Replit OAuth → Express sessions → Protected routes
2. **Practice Management**: Users create/manage practice settings and configurations
3. **Patient Intake**: Multi-step form for patient demographics and insurance
4. **Session Documentation**: CPT code selection and session notes
5. **Claim Generation**: Automated claim creation from session data
6. **AI Processing**: Claims undergo AI review for completeness and accuracy
7. **Submission**: Electronic claim submission to insurance providers
8. **Tracking**: Real-time claim status updates and payment reconciliation

## External Dependencies

### Authentication
- **Replit OAuth**: Primary authentication provider
- **OpenID Connect**: Standard authentication protocol

### Database
- **Neon**: Serverless PostgreSQL hosting
- **Connection Pooling**: Built-in connection management

### UI Libraries
- **Radix UI**: Headless component primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library

### Development Tools
- **Vite**: Fast development server and build tool
- **TypeScript**: Type safety and developer experience
- **ESBuild**: Fast JavaScript bundler for production

## Deployment Strategy

### Development Environment
- **Replit Integration**: Native Replit development environment
- **Hot Reload**: Vite dev server with HMR
- **Error Overlay**: Custom error handling for development

### Production Build
- **Frontend**: Vite build to static assets
- **Backend**: ESBuild bundle for Node.js deployment
- **Static Assets**: Served from Express with fallback routing

### Environment Configuration
- **Database**: CONNECTION_STRING via environment variables
- **Sessions**: SECRET_KEY for session encryption
- **Authentication**: REPL_ID and OAuth configuration
- **Feature Flags**: Environment-based feature toggling

### File Structure
- **`client/`**: React frontend application
- **`server/`**: Express.js backend API
- **`shared/`**: Shared TypeScript types and schemas
- **`migrations/`**: Database migration files
- **Root configs**: Build tools, TypeScript, and framework configuration

The application follows a monorepo structure with clear separation between frontend, backend, and shared code, enabling efficient development and deployment workflows.

## Recent Changes

### January 18, 2025
- **Data Integrity Update**: Removed all fake statistics and misleading claims from landing page and dashboard
- **Landing Page**: Replaced fake metrics (2.3M+ claims, 40% denial reduction) with authentic feature highlights
- **Dashboard**: Updated statistics descriptions to be accurate and not imply false performance gains
- **Authentic Data**: All displayed data now comes from actual database queries or honest placeholder text
- **User Preference**: Established policy of using only authentic data sources and avoiding misleading claims
- **Pricing Update**: Updated pricing to competitive tiered structure: 5% (Starter), 4.5% (Professional), 4.25% (Enterprise) - significantly lower than current OT industry standards while offering reduced administrative work
- **Automated Data Capture**: Added features for minimal client input including voice dictation, document upload, EHR sync, and calendar integration
- **Reimbursement Optimization**: Added AI-powered system to find higher reimbursement rates with 50% revenue sharing on improvements
- **Messaging Refinement**: Evolved from "zero admin work" to honest "minimal work" claims after user feedback
- **Dual Value Proposition**: Updated hero section to emphasize both "Minimal Work, Maximum Revenue" 
- **Landing Page Polish**: Tightened spacing throughout, removed unsubstantiated time statistics (12+ hours weekly), combined work reduction with payment optimization messaging
- **Spacing Issue Resolved**: Fixed persistent white space gap on landing page by removing `pb-8` class from hero section container - identified using browser developer tools inspection
- **Content Enhancement**: Added comprehensive billing description "Our AI handles billing from intake to following up on denials to help ensure your payments are optimized" to green section for better messaging and space filling
- **Button Alignment Fix**: Corrected Watch Demo button centering issue by adding `items-center` class to button container
- **Critical Safari Browser Cache Resolution**: Solved persistent Safari caching issues preventing landing page updates from displaying. Used inline React styles instead of Tailwind classes to bypass cache conflicts and ensure immediate visibility of changes
- **White Space Gap Elimination**: Completely restructured hero and green sections with inline styles, removed complex div nesting, and used direct margin/padding control to eliminate page-size white space gaps
- **Landing Page Technical Overhaul**: Rebuilt hero and green sections from Tailwind CSS to inline React styles for reliable cross-browser compatibility and immediate cache-busting capabilities
- **Headline Optimization**: Refined main headline to clean, impactful messaging: "You care for your patients. We'll take care of your billing" for better visual impact and value proposition clarity
- **Patient Intake Enhancement**: Added comprehensive credit card collection and payment information step to intake form
- **Financial Responsibility Notices**: Added clear notices about patient responsibility for insurance gaps and appointment policies
- **Intake Form Access**: Made intake form accessible without authentication and added prominent navigation from landing page
- **Appointment Policy Clarification**: Updated policy to clarify appointments can be scheduled but won't occur without completed forms
- **Intake Form Structure**: Finalized 9-step intake process: Data Source → Diagnosis → Basic Info → Insurance → Payment → Medical History → Emergency Contact → Electronic Signature → Review
- **Electronic Signature Integration**: Added comprehensive electronic signature step with scrollable terms and conditions, privacy policy, cursive-style signature input field, required agreement checkboxes, and date stamping for legal compliance
- **Navigation System Refinement**: Completed resolution of all sidebar layout issues across SOAP notes, patient intake, and other main pages using consistent md:ml-64 margin approach
- **Step Indexing Resolution**: Fixed step progression bugs where incorrect titles were displayed, ensuring each step shows proper content and navigation flows correctly through all 9 intake steps
- **Insurance Reimbursement Estimation**: Added comprehensive insurance estimation service with real-world out-of-network rates for major providers (Anthem, UnitedHealth, Aetna, BCBS, Cigna)
- **CPT Code Selection Interface**: Enhanced insurance estimation with service selection checkboxes allowing patients to select anticipated treatment services for targeted cost estimates
- **Dynamic Cost Estimation**: Insurance estimates now display realistic patient responsibility amounts based on selected CPT codes rather than generic defaults
- **Treatment Service Options**: Added 8 common OT services including evaluations (97165/97166/97167), therapeutic activities (97530), self-care training (97535), exercises (97110), neuromuscular re-education (97112), and manual therapy (97140)
- **Practice-Based Billing System**: Updated insurance estimation to use practice's actual charges rather than insurance rates, with proper 15-minute unit billing, multiple CPT codes per session, and accurate balance billing calculations
- **Realistic Cost Transparency**: Enhanced Step 3 (Insurance Details) of intake form to show service names with CPT codes and per-session patient costs based on practice rates vs insurance reimbursement
- **AI-Powered Reimbursement Prediction**: Implemented comprehensive machine learning system for analyzing historical reimbursement data to provide accurate predictions based on insurance provider, CPT codes, plan types, deductible status, regional variations, and temporal trends. System includes confidence scoring, trend analysis, and personalized recommendations for optimal billing strategies
- **Data Upload System**: Created user-friendly CSV upload interface at `/data-upload` for importing hundreds of historical reimbursement records. System validates data, provides sample templates, shows processing progress, and immediately improves AI prediction accuracy. Supports required columns (insurance_provider, cpt_code, practice_charge, insurance_payment, date_of_service) and optional enhancement fields for better predictions
- **Development Navigation System**: Established proper development workflow where preview screen defaults to dashboard (main development focus) while providing "Back to Landing Page" button for easy testing of public-facing pages. Landing page navigation works correctly when accessed through debug tools, allowing developers to test both authenticated dashboard features and public user experience flows