/**
 * Public demo-login gate (#500 addition).
 *
 * The staff demo login (POST /api/demo-login) and the patient-portal demo
 * login (GET /api/patient-portal/demo-login) are public, credential-free
 * entry points into the isolated demo practice. They are OFF unless the
 * environment explicitly enables them; when off, both answer 404 as if the
 * routes did not exist. The demo practice and its data are untouched by
 * this gate — it only decides whether the two endpoints respond.
 *
 * Enable: set DEMO_LOGIN_ENABLED=true on the task definition. Any other
 * value, or no value, keeps the endpoints off. Read at request time so a
 * running process picks up a change on its next restart without a build.
 */
export const DEMO_LOGIN_ENV_VAR = 'DEMO_LOGIN_ENABLED';

export function isDemoLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[DEMO_LOGIN_ENV_VAR] ?? '').trim().toLowerCase() === 'true';
}
