/**
 * ECS-executable equivalent of scripts/repair-anthem-crosswalk-payer-id.ts.
 *
 * The prod app image has no tsx and no scripts/ directory, so the tsx script
 * cannot run there. This CommonJS payload carries the same canonical Anthem
 * rows (mirrors server/data/anthemCrosswalk.ts — keep them in sync) and is fed
 * to the container verbatim as `node -e <this file>` by
 * scripts/run-anthem-crosswalk-repair.sh — the same mechanism the deploy
 * workflow's migration step and the claim-46 repair used.
 *
 * All statements run in one transaction. DRY_RUN=1 in the environment rolls
 * the transaction back instead of committing.
 */
const { Client } = require('pg');
function sk(s) { return ['anthem ' + s, 'anthem blue cross ' + s, 'anthem blue cross blue shield ' + s, 'anthem blue cross and blue shield ' + s]; }
const STATES = [
  ['CA', 'california', '040', 'LAESW'],
  ['CO', 'colorado', '050', 'TBEZC'],
  ['CT', 'connecticut', '00060', 'DRWRY'],
  ['GA', 'georgia', '00601', 'VDCLI'],
  ['IN', 'indiana', '130', 'AOQAR'],
  ['KY', 'kentucky', '00660', 'DXTYZ'],
  ['ME', 'maine', '180', 'YJHSX'],
  ['MO', 'missouri', '241', 'XUAZF'],
  ['NV', 'nevada', '00265', 'ERSOT'],
  ['NH', 'new hampshire', '00770', 'QCFIB'],
  ['OH', 'ohio', '00834', 'BHNXS'],
  ['VA', 'virginia', '423', 'DGOYK'],
  ['WI', 'wisconsin', '450', 'VLFZU'],
];
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const rows = [
  {
    name: 'Anthem BCBS of New York',
    kw: [...sk('new york'), 'anthem', 'anthem bcbs', 'anthem blue cross', 'empire bcbs', 'empire blue cross'],
    id: '803',
    state: 'NY',
    notes: 'Anthem BCBS of New York (formerly Empire BCBS), Stedi OLQXL / primary payer ID 803. Also the generic fallback for unqualified "Anthem" plan names. Prior seed value 00805 resolved to Excellus BCBS of NY, not Anthem.',
  },
  ...STATES.map(([st, sn, pid, sid]) => ({
    name: 'Anthem BCBS of ' + title(sn),
    kw: sk(sn),
    id: pid,
    state: st,
    notes: 'Anthem ' + st + ' per Stedi registry (stediId ' + sid + ', primary payer ID ' + pid + ').',
  })),
];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('BEGIN');
  const upd = await c.query(
    "UPDATE payer_crosswalk SET sub_plan_name=$1, sub_plan_keywords=$2::jsonb, trading_partner_id=$3, stedi_payer_id=$3, state=$4, notes=$5 WHERE trading_partner_id='00805' AND sub_plan_name='Anthem BCBS' RETURNING id",
    [rows[0].name, JSON.stringify(rows[0].kw), rows[0].id, rows[0].state, rows[0].notes],
  );
  console.log('rewrote rows:', upd.rows.map((r) => r.id).join(',') || 'none');
  for (const r of rows) {
    const ins = await c.query(
      'INSERT INTO payer_crosswalk (parent_payer_name,sub_plan_name,sub_plan_keywords,trading_partner_id,stedi_payer_id,state,notes,is_active) ' +
        "SELECT 'Blue Cross Blue Shield',$1,$2::jsonb,$3,$3,$4,$5,true WHERE NOT EXISTS (SELECT 1 FROM payer_crosswalk WHERE sub_plan_name=$1) RETURNING id",
      [r.name, JSON.stringify(r.kw), r.id, r.state, r.notes],
    );
    if (ins.rows.length) console.log('inserted', ins.rows[0].id, r.name);
  }
  const fin = await c.query(
    "SELECT id,sub_plan_name,trading_partner_id,state,is_active FROM payer_crosswalk WHERE sub_plan_name ILIKE 'Anthem%' OR trading_partner_id='00805' ORDER BY id",
  );
  console.log('FINAL:', JSON.stringify(fin.rows));
  if (process.env.DRY_RUN) {
    await c.query('ROLLBACK');
    console.log('DRY_RUN set — rolled back.');
  } else {
    await c.query('COMMIT');
    console.log('Committed.');
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
