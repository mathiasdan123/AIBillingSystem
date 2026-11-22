// CloudWatch Synthetics canary "therapybill-demo-path" (us-east-1).
//
// Source of truth for the canary script. It was created in the console on
// 2026-09-01 and lived only there until 2026-11-18, when its hard-coded
// "exactly 6 patients" assertion fired the therapybill-demo-path-broken
// alarm after QA fixture patients were added to the demo practice (Riley
// Nodob by server/services/demoPractice.ts, Jordan Sweepdemo by hand). The
// demo path was fine; the canary's expectation was stale, and nothing in the
// repo could have told a reviewer that adding a demo patient would page.
//
// Deploy with ../deploy.sh (see ../README.md); it stages this file into the
// nodejs/node_modules/ layout the Synthetics Node.js runtime expects inside
// the uploaded zip. (The file is kept flat here because any node_modules/
// path is gitignored.)
//
// Runtime: syn-nodejs-puppeteer-17.0 (console recommends 19.0; this script
// uses only https, Synthetics and SyntheticsLogger, so either works).
const https = require('https');
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const HOST = 'app.therapybillai.com';

// The demo practice seeds 6 canonical patients and may carry QA fixture
// patients on top (see DEMO_FIXTURE_PATIENTS in server/services/demoPractice.ts
// and anything added by hand during a QA sweep). The canary guards the demo
// path -- health, login, a populated patient list -- not an exact census, so
// the assertion is a floor. .github/workflows/health-check.yml uses the same
// ">= 6" rule.
const MIN_DEMO_PATIENTS = 6;

// Never log response bodies. The demo practice is synthetic data, but this
// canary hits the same endpoints the real practice uses, so treat bodies as
// PHI-shaped by default and log only status codes and counts.
function request(options, body, cookie) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ 'User-Agent': 'TherapyBillCanary/1.0' }, options.headers || {});
    if (cookie) headers.Cookie = cookie;
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(
      { hostname: HOST, port: 443, method: options.method, path: options.path, headers, timeout: 30000 },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }
    );
    req.on('timeout', () => { req.destroy(new Error('request timed out after 30s')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const apiCanary = async function () {
  let cookie = null;

  await synthetics.executeStep('health', async function () {
    const res = await request({ method: 'GET', path: '/api/health' });
    if (res.status !== 200) throw new Error(`/api/health returned HTTP ${res.status}, expected 200`);
    const parsed = JSON.parse(res.body);
    if (parsed.status !== 'healthy') {
      throw new Error(`/api/health status is "${parsed.status}", expected "healthy"`);
    }
    const db = parsed.checks && parsed.checks.database ? parsed.checks.database.status : 'unknown';
    if (db !== 'healthy') throw new Error(`database check is "${db}", expected "healthy"`);
    log.info(`health ok — release=${parsed.release} dbLatency=${parsed.checks.database.latency}ms`);
  });

  await synthetics.executeStep('demoLogin', async function () {
    // The demo account's password is public by design (it is in
    // .github/workflows/health-check.yml and the demo login page).
    const res = await request(
      { method: 'POST', path: '/api/demo-login' },
      JSON.stringify({ email: 'demo@therapybill.com', password: 'demo1234' })
    );
    if (res.status !== 200) throw new Error(`/api/demo-login returned HTTP ${res.status}, expected 200`);
    const setCookie = res.headers['set-cookie'];
    if (!setCookie || !setCookie.length) throw new Error('/api/demo-login returned no session cookie');
    cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    log.info('demo login ok — session cookie received');
  });

  await synthetics.executeStep('patients', async function () {
    const res = await request({ method: 'GET', path: '/api/patients' }, null, cookie);
    if (res.status !== 200) throw new Error(`/api/patients returned HTTP ${res.status}, expected 200`);
    const parsed = JSON.parse(res.body);
    const list = Array.isArray(parsed) ? parsed : parsed.patients;
    if (!Array.isArray(list)) throw new Error('/api/patients did not return a list');
    if (list.length < MIN_DEMO_PATIENTS) {
      throw new Error(
        `/api/patients returned ${list.length} patients, expected at least ${MIN_DEMO_PATIENTS} — the demo is broken`
      );
    }
    log.info(`patients ok — ${list.length} returned (minimum ${MIN_DEMO_PATIENTS})`);
  });
};

exports.handler = async () => {
  return await apiCanary();
};
