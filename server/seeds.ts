import { getDb } from "./db";
import { practices, cptCodes, icd10Codes, insurances, users, payerCrosswalk } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./services/passwordService";

/**
 * Seed realistic practice history: appointments, claims, sessions, SOAP notes, payments.
 * Uses relative dates (NOW() - INTERVAL) so data stays fresh.
 */
async function seedDemoPracticeHistory(db: any, practiceId: number) {
  console.log("Seeding demo practice history...");

  // Get patient IDs
  const patientRows = await db.execute(sql`SELECT id, first_name, last_name FROM patients WHERE practice_id = ${practiceId} AND deleted_at IS NULL ORDER BY id LIMIT 6`);
  const patients = patientRows.rows;
  if (patients.length === 0) return;

  // Seed appointments (8 past completed, 1 cancelled, 3 future scheduled)
  const apptData = [
    { idx: 0, offset: '28 days', title: 'OT Evaluation', status: 'completed' },
    { idx: 1, offset: '25 days', title: 'Therapy Session', status: 'completed' },
    { idx: 2, offset: '21 days', title: 'Therapy Session', status: 'completed' },
    { idx: 0, offset: '18 days', title: 'Therapy Session', status: 'completed' },
    { idx: 3, offset: '14 days', title: 'OT Evaluation', status: 'completed' },
    { idx: 1, offset: '10 days', title: 'Therapy Session', status: 'completed' },
    { idx: 4, offset: '7 days', title: 'Therapy Session', status: 'completed' },
    { idx: 2, offset: '3 days', title: 'Therapy Session', status: 'completed' },
    { idx: 5, offset: '5 days', title: 'Therapy Session', status: 'cancelled' },
    { idx: 0, offset: '-2 days', title: 'Therapy Session', status: 'scheduled' },
    { idx: 3, offset: '-4 days', title: 'Therapy Session', status: 'scheduled' },
    { idx: 1, offset: '-6 days', title: 'Therapy Session', status: 'scheduled' },
  ];

  for (const a of apptData) {
    const pid = patients[a.idx % patients.length].id;
    const sign = a.offset.startsWith('-') ? '+' : '-';
    const interval = a.offset.replace('-', '');
    try {
      await db.execute(sql.raw(`
        INSERT INTO appointments (practice_id, patient_id, start_time, end_time, title, status, created_at)
        VALUES (${practiceId}, ${pid}, NOW() ${sign} INTERVAL '${interval}' + INTERVAL '10 hours', NOW() ${sign} INTERVAL '${interval}' + INTERVAL '11 hours', '${a.title}', '${a.status}', NOW())
      `));
    } catch (e: any) { console.error(`Seed appt error: ${e.message}`); }
  }
  console.log("  Seeded 12 appointments");

  // Seed treatment sessions (linked to completed appointments)
  const sessions = [
    { idx: 0, offset: '28 days', duration: 60, type: 'OT Evaluation', notes: 'Initial evaluation completed. Fine motor delays noted. Grip strength below age expectations.' },
    { idx: 1, offset: '25 days', duration: 45, type: 'Therapy Session', notes: 'Worked on bilateral coordination. Patient showed improvement in bead stringing task.' },
    { idx: 2, offset: '21 days', duration: 45, type: 'Therapy Session', notes: 'Sensory integration activities. Patient tolerated textured materials better than previous session.' },
    { idx: 0, offset: '18 days', duration: 45, type: 'Therapy Session', notes: 'Fine motor strengthening exercises. Handwriting practice with adaptive grip.' },
    { idx: 3, offset: '14 days', duration: 60, type: 'OT Evaluation', notes: 'Initial evaluation. Visual motor integration deficits identified. Recommended 2x weekly.' },
    { idx: 1, offset: '10 days', duration: 45, type: 'Therapy Session', notes: 'Continued bilateral coordination. Introduced scissor skills activities.' },
    { idx: 4, offset: '7 days', duration: 45, type: 'Therapy Session', notes: 'Self-care skills training. Patient practiced buttoning and zipping with moderate assist.' },
    { idx: 2, offset: '3 days', duration: 45, type: 'Therapy Session', notes: 'Sensory diet review and modification. Introduced weighted vest during tabletop activities.' },
  ];

  for (const s of sessions) {
    const pid = patients[s.idx % patients.length].id;
    try {
      await db.execute(sql.raw(`
        INSERT INTO treatment_sessions (practice_id, patient_id, session_date, duration, session_type, status, notes, created_at)
        VALUES (${practiceId}, ${pid}, (NOW() - INTERVAL '${s.offset}')::date, ${s.duration}, '${s.type}', 'completed', '${s.notes.replace(/'/g, "''")}', NOW())
      `));
    } catch (e: any) { console.error(`Seed session error: ${e.message}`); }
  }
  console.log("  Seeded 8 treatment sessions");

  // Seed SOAP notes
  const soapNotes = [
    {
      idx: 0, offset: '28 days',
      subjective: 'Parent reports child continues to struggle with holding pencils during homework and self-feeding with utensils. Mom notes difficulty with buttons and zippers during morning dressing routine, requiring full assistance daily. Home program compliance has been consistent 4-5 days/week with theraputty exercises. No changes in medication or sleep patterns reported.\n\nPatient presented as cooperative and willing to engage in therapist-directed activities upon arrival. Child self-reported that writing makes his hand tired at school.\n\nPresentation is consistent with previous session, suggesting stable baseline with gradual improvement in engagement.',
      objective: 'Session conducted in clinic for 45 minutes (3 billable units).\n\nStandardized Measures: Grip strength 2/5 bilateral via dynamometer (4 lbs R, 3.5 lbs L; age expectation 8-10 lbs). VMI standard score 72 (below average). Tripod grasp inconsistent, reverting to gross grasp after 2 minutes of sustained writing.\n\nFine Motor Activities:\n- In-hand manipulation (coin rotation): completed 3/10 trials with mod assist (50%); dropped coin on 7 trials\n- Theraputty exercises (soft resistance): maintained grasp for 45 seconds before fatigue (prev 30 seconds)\n- Bead stringing (small beads): completed 5 beads in 4 min with min assist for stabilization\n\nEquipment: Theraputty (soft), adaptive pencil grip, weighted pencil, small beads, tweezers\n\nSkilled Interventions: Neuromuscular re-education for hand intrinsic strengthening, graded fine motor activities targeting precision grasp patterns, therapeutic exercise for UE endurance.\n\nAssistance level: Moderate assist for in-hand manipulation tasks, minimum assist for grasp activities. Progressed from mod assist to min assist for theraputty exercises by end of session.',
      assessment: 'During today\'s occupational therapy session, patient demonstrated good engagement throughout therapist-directed fine motor activities, with decreasing tolerance for sustained grasp tasks as the session progressed. Patient benefited from structured activities with built-in rest breaks to manage hand fatigue.\n\nPatient continues to present with decreased hand and finger strength bilaterally, which significantly impacts ability to maintain functional grasp patterns for age-appropriate tasks including handwriting, utensil use, and fastener management. Grip strength measured at 2/5 bilateral, well below age expectations. Tripod grasp is emerging but inconsistent, with reversion to gross grasp patterns after approximately 2 minutes of sustained activity.\n\nFine motor precision remains below age expectations. In-hand manipulation skills are significantly delayed, with patient completing only 3/10 trials of coin rotation with moderate assistance. This impacts functional tasks requiring finger isolation and dexterity including handwriting, buttoning, and managing small objects.\n\nProgress toward treatment goals: Patient is demonstrating slow but measurable improvement in grasp endurance (30 sec to 45 sec sustained grasp) and theraputty resistance tolerance. Fine motor precision remains an area of significant deficit requiring continued skilled intervention. Compared to previous session, patient showed improved tolerance for fine motor demands and emerging in-hand manipulation skills.\n\nOverall, patient continues to demonstrate significant fine motor delays impacting school performance (handwriting legibility and speed) and self-care independence (dressing, feeding). Skilled occupational therapy services remain medically necessary to address grip strength deficits, in-hand manipulation delays, and functional grasp pattern development to support participation in age-appropriate academic and self-care activities.',
      plan: 'Continue OT 2x/week for 45-minute sessions to address fine motor and self-care goals.\n\nNext Session Plan:\n- Progress theraputty resistance from soft to medium to challenge grip strengthening\n- In-hand manipulation activities targeting coin rotation and translation with graded complexity\n- Functional handwriting task with adaptive grip and timed component\n- Introduce scissor skills assessment\n\nHome Program Modifications:\n- Continue theraputty exercises daily (increase to medium resistance when soft is easy)\n- Add coin flipping practice 5 min/day for in-hand manipulation\n- Practice buttoning on dressing board 5 min before school daily\n\nGoals to prioritize: Grip strength improvement, in-hand manipulation, and functional grasp endurance for handwriting.\n\nCoordination: Recommend teacher communication regarding adaptive pencil grip use in classroom.'
    },
    {
      idx: 1, offset: '25 days',
      subjective: 'Parent notes improved bead stringing at home, reporting child can now complete a 10-bead necklace with minimal frustration. Mom states child is more willing to attempt cutting activities at home. Home program completed 5/7 days this week with bilateral coordination exercises.\n\nChild presented as excited and eager to participate in today\'s session, reporting that she made a necklace for her friend at home. Positive social interaction with therapist observed.\n\nPresentation improved compared to previous session; increased confidence in bilateral tasks is noted.',
      objective: 'Session conducted in clinic for 45 minutes (3 billable units).\n\nFunctional Performance Data:\n- Bead stringing (medium beads): completed 10-bead string in 3:00 min with supervision only (prev 5:00 min with min assist); improved by 40%\n- Midline crossing: present for 7/10 trials during bilateral drawing task (prev 4/10 trials)\n- Bilateral paper tearing: completed 5/8 trials with min assist for paper stabilization\n- Scissor skills assessment: continuous cutting on straight line within 1/4 inch for 4/10 trials with verbal cueing for hand positioning\n\nAssistance Levels: Supervision for bead stringing (improved from min assist), min assist (25%) for scissor tasks, min assist for bilateral paper tasks. Verbal and visual cueing provided for hand positioning and sequencing.\n\nEquipment: Medium and small beads, string, loop scissors, adapted scissors, bilateral drawing templates, construction paper\n\nSkilled Interventions: Motor planning activities for bilateral sequencing, neuromuscular re-education for UE coordination at midline, graded bilateral coordination tasks with progressive complexity.',
      assessment: 'During today\'s occupational therapy session, patient demonstrated excellent engagement and enthusiasm throughout bilateral coordination activities. Patient showed increased confidence when approaching previously challenging tasks, indicating positive response to therapeutic intervention.\n\nBilateral coordination has shown measurable improvement, with patient completing bead stringing tasks in 3 minutes compared to 5 minutes at previous assessment, representing a 40% improvement in task completion speed. Midline crossing has improved from 4/10 to 7/10 trials, suggesting emerging bilateral integration. Patient demonstrated improved ability to stabilize with one hand while manipulating with the other during functional tasks.\n\nScissor skills were formally assessed for the first time. Patient demonstrated ability to manage loop scissors with verbal cueing for hand positioning, completing continuous straight-line cutting within 1/4 inch accuracy for 4/10 trials. This represents an emerging skill that will benefit from continued skilled intervention to develop efficiency and accuracy.\n\nContinued difficulty with asymmetrical bilateral tasks was observed, particularly when tasks required different movements from each hand simultaneously (e.g., holding paper steady while cutting). Patient compensated by using trunk rotation rather than distal UE dissociation.\n\nProgress toward treatment goals: Patient is improving in bilateral coordination (bead stringing, midline crossing) with measurable gains. Scissor skills are emerging and require continued intervention. Asymmetrical bilateral tasks remain challenging.\n\nSkilled occupational therapy services remain medically necessary to continue building bilateral coordination, introduce scissor skill development, and address asymmetrical bilateral task deficits that impact participation in classroom cutting activities, craft projects, and self-care tasks requiring two-hand coordination.',
      plan: 'Continue OT 2x/week for 45-minute sessions.\n\nNext Session Plan:\n- Progress to smaller beads for bead stringing to challenge fine motor precision\n- Introduce curved-line cutting with adapted scissors\n- Bilateral coordination tasks requiring asymmetrical hand movements (holding/cutting)\n- Midline crossing activities with increased complexity\n\nHome Program Modifications:\n- Continue bead stringing daily (progress to small beads)\n- Add supervised scissor practice with loop scissors 5 min/day using straight-line worksheets\n- Bilateral play activities: tearing paper for collage, rolling playdough with both hands\n\nGoals to prioritize: Scissor skill development, asymmetrical bilateral coordination, midline crossing consistency.\n\nCoordination: No additional referrals needed at this time. Continue caregiver education on bilateral activity integration at home.'
    },
    {
      idx: 2, offset: '21 days',
      subjective: 'Parent reports child continues to cover ears at school assemblies and avoids messy play at home (finger painting, playdough). Mom notes slight improvement in tolerance for new food textures at dinner, trying mashed potatoes for the first time this week. Brushing protocol completed 2x/day as prescribed. No medication changes.\n\nPatient presented as cautious upon arrival, initially hesitant to enter the sensory gym area. After 5 minutes of heavy work activities, patient became more regulated and willing to engage.\n\nCompared to previous session, patient showed faster transition to regulated state (5 min vs 10 min previously).',
      objective: 'Session conducted in sensory gym for 45 minutes (3 billable units).\n\nSensory Processing Observations:\n- Tactile: Tolerated theraputty manipulation for 8 min continuously (prev 3 min at last session; 167% improvement). Accepted finger painting with one finger for 2 min before requesting to wash hands (prev: refused entirely)\n- Vestibular: Tolerated linear swinging for 5 min (prev 3 min). Accepted prone position on platform swing with min assist. No signs of autonomic distress\n- Proprioceptive: Responded positively to joint compressions and heavy work. Wheelbarrow walking completed for 15 feet with mod assist for hip stabilization\n\nAssistance Levels: Min assist (25%) for sensory regulation activities; mod assist (50%) for vestibular challenges on swing; supervision for proprioceptive heavy work activities. Verbal cueing for deep breathing during tactile exposure.\n\nEquipment: Theraputty (soft), finger paint, platform swing, crash mat, weighted blanket (3 lb), body sock, joint compression protocol tools\n\nSkilled Interventions: Sensory integration techniques for tactile desensitization via graded exposure, vestibular processing through controlled linear and rotary input, proprioceptive regulation strategies, Wilbarger brushing protocol.',
      assessment: 'During today\'s session, patient demonstrated improving sensory modulation with continued evidence of tactile and auditory over-responsivity. Notably, patient transitioned from a dysregulated state to a calm, alert state within 5 minutes of heavy work activities, compared to 10 minutes at previous session, suggesting improved self-regulation capacity.\n\nTactile defensiveness remains a primary area of concern but is showing measurable improvement with graded exposure. Patient tolerated theraputty for 8 minutes continuously compared to 3 minutes previously, representing significant progress. First-time acceptance of finger painting (albeit briefly at 2 minutes) represents a meaningful breakthrough in tactile tolerance.\n\nVestibular processing shows gradual improvement, with patient tolerating linear swing input for 5 minutes in prone position compared to 3 minutes at previous session. No signs of autonomic distress (pallor, nausea, excessive sweating) were observed during vestibular activities. Patient continues to benefit from structured vestibular input to support overall sensory regulation.\n\nProprioceptive processing remains a relative strength. Patient responded positively to deep pressure and heavy work activities, which served as an effective regulation strategy throughout the session. Proprioceptive input was used as a bridging strategy before introducing more challenging tactile and vestibular activities.\n\nProgress toward treatment goals: Patient is improving in tactile tolerance (theraputty duration, finger paint acceptance) and vestibular processing (swing duration). Sensory over-responsivity continues to impact functional participation at school (avoids messy art activities, distressed during assemblies). Rate of progress supports continued intervention.\n\nSkilled occupational therapy services remain medically necessary to continue sensory integration intervention, expand tactile tolerance for functional participation in school and home activities, and develop self-regulation strategies that the patient can independently employ.',
      plan: 'Continue OT 2x/week for 45-minute sessions focusing on sensory processing goals.\n\nNext Session Plan:\n- Progress tactile exposure: introduce two-finger painting and theraputty hiding/finding small objects\n- Vestibular challenge: progress from linear to gentle rotary swinging if tolerated\n- Continue heavy work activities as regulation foundation\n- Introduce Wilbarger brushing protocol assessment for home carry-over\n\nHome Program Modifications:\n- Continue brushing protocol 2x/day (morning and before bed)\n- Add daily sensory diet: 10 min heavy work before school (wheelbarrow walk, wall push-ups, carrying heavy items)\n- Introduce one new texture per week during structured play time (not mealtimes)\n\nGoals to prioritize: Tactile tolerance expansion, vestibular processing, self-regulation strategy development.\n\nCoordination: Recommend communication with classroom teacher regarding sensory accommodations (fidget tools, movement breaks, advance warning before assemblies). Consider audiology referral if auditory over-responsivity does not improve with sensory integration intervention.'
    },
    {
      idx: 0, offset: '18 days',
      subjective: 'Teacher reports improved handwriting legibility on classroom assignments this week. Parent is pleased with progress and notes child is voluntarily practicing writing at home. Mom reports adaptive pencil grip is being used independently at school without reminders. Home program completed consistently this week.\n\nPatient presented as happy and proud, spontaneously showing therapist a writing sample from school. Positive self-esteem observed regarding handwriting improvement.\n\nSignificant improvement in patient confidence compared to previous sessions. Teacher feedback corroborates clinical progress.',
      objective: 'Session conducted in clinic for 45 minutes (3 billable units).\n\nStandardized Measures: Handwriting sample analysis: improved letter formation accuracy 6/10 letters within age-appropriate size and alignment (prev 3/10 letters; 100% improvement). Adaptive pencil grip used independently throughout session without reminders.\n\nFine Motor Performance Data:\n- Letter formation: 6/10 lowercase letters formed correctly on lined paper (prev 3/10)\n- Letter sizing: 7/10 letters within appropriate height guidelines (prev 4/10)\n- Writing speed: completed 3 sentences in 4:30 min (prev 2 sentences in 5:00 min)\n- Grip endurance: maintained functional tripod grasp with adaptive grip for 8 min sustained writing (prev 4 min before fatigue)\n- Theraputty exercises (medium resistance): sustained pinch grasp 60 seconds (prev 45 seconds)\n\nAssistance Levels: Modified independent for handwriting with adaptive grip; supervision for letter formation accuracy; min assist (25%) for spacing and line alignment. Verbal cueing for posture during sustained writing tasks.\n\nEquipment: Adaptive pencil grip, lined paper (highlighted lines), theraputty (medium), weighted pencil, slant board\n\nSkilled Interventions: Neuromuscular re-education for hand intrinsic strengthening and grasp endurance, therapeutic exercise for UE stabilization during fine motor tasks, graded handwriting activities targeting legibility and speed.',
      assessment: 'During today\'s session, patient demonstrated excellent engagement and increased confidence during handwriting activities, correlating with positive teacher and parent reports of functional improvement in the classroom.\n\nFine motor gains are evident in functional handwriting tasks. Letter formation accuracy has doubled from 3/10 to 6/10 letters, representing meaningful functional progress. Letter sizing consistency has also improved (4/10 to 7/10), indicating developing motor control for spatial awareness during writing. Grip endurance has improved from 4 minutes to 8 minutes of sustained writing, though fatigue remains a limiting factor for extended classroom writing tasks.\n\nAdaptive pencil grip is being used independently across environments (clinic, school, home) without cueing, demonstrating successful carryover of adaptive strategies. The plan to fade the adaptive grip will begin once grip endurance reaches 12+ minutes and tripod grasp is maintained without the adaptation.\n\nWriting speed remains below age expectations but has shown improvement (3 sentences in 4:30 vs 2 sentences in 5:00 previously). Speed will continue to develop as letter formation becomes more automatic and grip endurance improves.\n\nProgress toward treatment goals: Patient is improving in handwriting legibility (letter formation, sizing) and grip endurance. Writing speed is emerging as a focus area. Clinical gains are being observed across environments per teacher and parent report. Rate of progress supports current treatment frequency.\n\nSkilled occupational therapy services remain medically necessary to continue developing handwriting automaticity, grip endurance for classroom writing demands, and writing speed to support academic participation. Gradual fading of adaptive equipment is planned as underlying motor skills develop.',
      plan: 'Continue OT 2x/week for 45-minute sessions.\n\nNext Session Plan:\n- Timed handwriting activities to begin addressing writing speed\n- Progress theraputty to medium-firm resistance for continued grip strengthening\n- Introduce copying from near-point and far-point models\n- Begin assessment of grip pattern without adaptive grip for 2-minute intervals\n\nHome Program Modifications:\n- Continue daily handwriting practice 10 min/day (increase from 5 min)\n- Theraputty exercises daily with medium resistance\n- Begin timed writing activities: copy 1 sentence as neatly and quickly as possible, record time\n\nGoals to prioritize: Writing speed development, grip endurance beyond 10 min, begin fading adaptive pencil grip.\n\nCoordination: Send progress update to classroom teacher. Recommend continued use of adaptive grip at school until endurance goal (12 min) is met.'
    },
    {
      idx: 3, offset: '14 days',
      subjective: 'Parent expresses ongoing concern about clumsiness and difficulty keeping up with peers on playground equipment. Mom reports child fell twice this week during recess, once from the monkey bars and once while running. Dad notes child avoids riding bicycle despite peer interest. Home program (obstacle course) completed 3/7 days this week.\n\nPatient presented as cooperative but expressed frustration about not being able to do what other kids do at recess. Reported that gym class is hard.\n\nPresentation consistent with previous session. Emotional impact of motor difficulties on peer relationships is becoming more evident.',
      objective: 'Session conducted in sensory gym for 45 minutes (3 billable units).\n\nStandardized Measures: BOT-2 body coordination composite: 25th percentile (below average). Balance: single leg stand R 4 sec, L 3 sec (age expectation 8 sec). Tandem walk: 6/10 steps before loss of balance (age expectation: complete). Motor planning: 3-step obstacle course sequences completed with verbal cues for each transition.\n\nGross Motor Performance Data:\n- Obstacle course (3 stations): completed with verbal cueing at each transition; required 2 demonstrations before initiating; time 3:45 min (prev 4:30 min)\n- Balance beam (4-inch): walked 6 feet with min assist for hand-holding (prev 4 feet with mod assist)\n- Scooter board prone: propelled 10 feet with bilateral UE; required verbal cueing for reciprocal arm pattern\n- Ball skills: caught 5/10 tosses from 6 feet (prev 3/10); threw overhand with accuracy to target 3/10 trials\n\nAssistance Levels: Min assist (25%) for balance activities; supervision for scooter board; mod assist (50%) for multi-step motor sequences. Verbal cueing for motor planning and sequencing at each transition.\n\nEquipment: Obstacle course components (tunnels, cones, balance beam), scooter board, therapy balls, foam balance beam, floor ladder\n\nSkilled Interventions: Neuromuscular re-education for balance and postural reactions, motor planning activities with graded complexity, therapeutic exercise for core strengthening and bilateral coordination, body awareness training.',
      assessment: 'During today\'s session, patient demonstrated cooperative engagement in gross motor and balance activities, though emotional frustration was observed when tasks proved challenging. Therapist provided encouragement and structured choices to maintain participation and build self-efficacy.\n\nMotor planning deficits remain significant, consistent with developmental coordination disorder profile. Patient required verbal cueing at each transition during multi-step obstacle course sequences and needed visual demonstration before initiating novel movement patterns. However, measurable improvement was noted in obstacle course completion time (3:45 min vs 4:30 min previously), suggesting improving motor planning efficiency with familiar sequences.\n\nBalance remains significantly below age expectations. Single leg stance at 4 seconds (R) and 3 seconds (L) is approximately 50% of the 8-second age expectation. Balance beam performance improved from 4 feet with moderate assist to 6 feet with minimum assist, representing meaningful functional progress. Postural reactions remain delayed, with patient demonstrating limited protective extension responses during dynamic balance challenges.\n\nBilateral coordination is impacted during gross motor tasks. Scooter board propulsion revealed difficulty with reciprocal arm patterns, requiring verbal cueing throughout. Ball skills showed improvement in catching (3/10 to 5/10) but throwing accuracy remains limited, likely impacted by motor planning and timing deficits.\n\nProgress toward treatment goals: Patient is improving in balance (beam distance, assistance level reduction), obstacle course efficiency, and ball catching. Motor planning for novel tasks and single leg balance remain primary areas of deficit. Emotional impact of motor difficulties on peer relationships warrants monitoring.\n\nSkilled occupational therapy services remain medically necessary to address motor planning deficits, balance delays, and bilateral coordination difficulties that significantly impact participation in playground activities, physical education, and age-appropriate gross motor play with peers.',
      plan: 'Continue OT 2x/week for 45-minute sessions focusing on motor planning and balance goals.\n\nNext Session Plan:\n- Progress obstacle course to 4-station sequences with reduced verbal cueing\n- Balance challenges: introduce foam surface for single leg stance to increase proprioceptive demand\n- Scooter board activities targeting reciprocal UE patterns and prone extension endurance\n- Ball skills: catching from 8 feet with larger ball, introduce kicking accuracy\n\nHome Program Modifications:\n- Obstacle course at home: increase to 4 stations, practice 4x/week (currently 3/7 compliance)\n- Single leg balance practice: 3x10 second attempts each leg during teeth brushing\n- Bicycle with training wheels: encourage 10 min practice on weekends for bilateral coordination and motor planning\n\nGoals to prioritize: Balance improvement toward age expectations, motor planning for multi-step sequences, bilateral gross motor coordination.\n\nCoordination: Recommend gym teacher communication regarding motor planning difficulties and modified expectations during PE class. Consider psychology referral if emotional impact of motor delays on self-esteem and peer relationships increases.'
    },
    {
      idx: 4, offset: '7 days',
      subjective: 'Child reports that dressing is hard and states "I want to do it myself." Parent confirms she helps with most fasteners including buttons, zippers, and shoe tying. Mom notes child can now pull on elastic-waist pants independently (new skill since last session). Home program with dressing board completed 4/7 days.\n\nPatient presented as motivated and determined upon arrival, requesting to practice buttons first. Positive self-advocacy and desire for independence observed.\n\nImproved motivation compared to previous session, suggesting developing self-awareness and goal-directed behavior around self-care independence.',
      objective: 'Session conducted in clinic for 45 minutes (3 billable units).\n\nSelf-Care Performance Data:\n- Buttoning (large buttons on dressing board): completed 4/6 buttons with mod assist (50%) for alignment and push-through; improved from 3/6 with max assist at previous session\n- Buttoning (shirt buttons): completed 2/6 with mod assist and verbal cueing for sequencing\n- Zipper management: grasped zipper pull and pulled up with hand-over-hand assist for initial engagement; completed pull-up independently once started (new skill)\n- Snap fasteners: completed 3/5 with min assist for alignment\n- Shoe tying: not yet attempted; prerequisite skills assessed: bilateral hand use for crossing midline 6/10 trials, pinch grasp sustained 20 seconds\n\nAssistance Levels: Mod assist (50%) for button tasks, max assist (75%) transitioning to mod assist for zipper initiation, min assist (25%) for snap fasteners. Hand-over-hand for zipper engagement, verbal cueing for sequencing all fastener types.\n\nEquipment: Dressing board with various fastener types, adapted button hook, oversized practice buttons, child\'s jacket for functional practice\n\nSkilled Interventions: Therapeutic activities targeting bilateral fine motor coordination for self-care tasks, neuromuscular re-education for finger isolation and pinch strength, backward chaining for multi-step dressing sequences, graded fastener difficulty progression.',
      assessment: 'During today\'s session, patient demonstrated strong motivation and goal-directed behavior around self-care skill development. Patient actively requested to practice specific fastener types and expressed desire for independence, which is a positive prognostic indicator for continued skill development.\n\nSelf-care deficits remain consistent with underlying fine motor delays, impacting independence with age-appropriate dressing tasks. Buttoning performance improved from 3/6 buttons with max assist to 4/6 with mod assist, representing improvement in both accuracy and assistance level. Patient demonstrates understanding of the buttoning sequence but lacks the finger strength and bilateral coordination for consistent independent completion.\n\nZipper management showed an important breakthrough: patient was able to independently complete the pull-up portion once the zipper was engaged, representing a new skill. Zipper initiation (engaging the slider with the insert pin) remains the most challenging component, requiring hand-over-hand assistance. This is consistent with the bilateral coordination and motor planning demands of zipper initiation.\n\nSnap fasteners are emerging as an area of relative strength, with patient completing 3/5 with minimum assist. This skill is expected to reach independence soon given current rate of progress. Prerequisite skills for shoe tying were assessed: bilateral hand use at midline (6/10 trials) and pinch grasp endurance (20 seconds) suggest patient is approaching readiness to begin shoe tying instruction using backward chaining.\n\nProgress toward treatment goals: Patient is improving in buttoning (assistance level reduced from max to mod), zipper management (new independent pull-up skill), and snap fasteners (approaching independence). Self-care independence is functionally limited but improving at a rate that supports continued intervention.\n\nSkilled occupational therapy services remain medically necessary to address self-care deficits in dressing skills (buttoning, zippers, shoe tying) that impact functional independence for age-appropriate daily living activities across home and school environments.',
      plan: 'Continue OT 2x/week for 45-minute sessions focusing on self-care independence goals.\n\nNext Session Plan:\n- Progress buttoning: practice on actual clothing items (shirt buttons) with graded difficulty\n- Zipper initiation: introduce adapted zipper pull and practice engagement sequence with backward chaining\n- Introduce shoe tying instruction using backward chaining method (start with final step)\n- Continue snap fastener practice targeting independence\n\nHome Program Modifications:\n- Dressing board practice daily focusing on buttons and zippers (increase from 4/7 to daily)\n- Practice buttoning on pajama top each night (functional carry-over)\n- Pinch strengthening: clothespin activities 5 min/day to support fastener manipulation\n- Begin practicing pulling zipper up on jacket independently (caregiver engages zipper)\n\nGoals to prioritize: Buttoning independence on clothing, zipper initiation skill, shoe tying introduction.\n\nCoordination: Educate caregiver on backward chaining approach for dressing skills. Recommend allowing extra time for morning dressing routine to encourage independence with moderate assist rather than completing tasks for the child.'
    },
  ];

  for (const s of soapNotes) {
    const pid = patients[s.idx % patients.length].id;
    try {
      await db.execute(sql.raw(`
        INSERT INTO soap_notes (practice_id, patient_id, session_date, subjective, objective, assessment, plan, cpt_codes, therapist_name, status, data_source, created_at)
        VALUES (${practiceId}, ${pid}, (NOW() - INTERVAL '${s.offset}')::date, '${s.subjective.replace(/'/g, "''")}', '${s.objective.replace(/'/g, "''")}', '${s.assessment.replace(/'/g, "''")}', '${s.plan.replace(/'/g, "''")}', '["97530","97110"]'::jsonb, 'Demo Therapist', 'completed', 'manual', NOW())
      `));
    } catch (e: any) { console.error(`Seed SOAP error: ${e.message}`); }
  }
  console.log("  Seeded 6 SOAP notes");

  // Seed claims (mix of statuses) + line items
  const claimData = [
    { idx: 0, offset: '28 days', status: 'paid', amount: 289, paidAmount: 245, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-001' },
    { idx: 1, offset: '25 days', status: 'paid', amount: 216, paidAmount: 183, cpt: '97110', icd: 'F82', claimNum: 'CLM-DEMO-002' },
    { idx: 2, offset: '21 days', status: 'paid', amount: 289, paidAmount: 252, cpt: '97530', icd: 'F80.9', claimNum: 'CLM-DEMO-003' },
    { idx: 0, offset: '18 days', status: 'submitted', amount: 216, paidAmount: 0, cpt: '97110', icd: 'F82', claimNum: 'CLM-DEMO-004' },
    { idx: 3, offset: '14 days', status: 'submitted', amount: 289, paidAmount: 0, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-005' },
    { idx: 1, offset: '10 days', status: 'denied', amount: 216, paidAmount: 0, cpt: '97110', icd: 'F82', claimNum: 'CLM-DEMO-006' },
    { idx: 4, offset: '7 days', status: 'submitted', amount: 289, paidAmount: 0, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-007' },
    { idx: 2, offset: '3 days', status: 'draft', amount: 216, paidAmount: 0, cpt: '97110', icd: 'F80.9', claimNum: 'CLM-DEMO-008' },
    { idx: 0, offset: '1 day', status: 'draft', amount: 289, paidAmount: 0, cpt: '97530', icd: 'F82', claimNum: 'CLM-DEMO-009' },
  ];

  for (const c of claimData) {
    const pid = patients[c.idx % patients.length].id;
    const denialReason = c.status === 'denied' ? "'Prior authorization required'" : 'NULL';
    const submittedAt = ['submitted', 'paid', 'denied'].includes(c.status) ? `NOW() - INTERVAL '${c.offset}'` : 'NULL';
    const paidAt = c.status === 'paid' ? `NOW() - INTERVAL '${c.offset}' + INTERVAL '12 days'` : 'NULL';
    try {
      const claimResult = await db.execute(sql.raw(`
        INSERT INTO claims (practice_id, patient_id, claim_number, status, total_amount, paid_amount, denial_reason, submitted_at, paid_at, created_at)
        VALUES (${practiceId}, ${pid}, '${c.claimNum}', '${c.status}', ${c.amount}, ${c.paidAmount}, ${denialReason}, ${submittedAt}, ${paidAt}, NOW())
        RETURNING id
      `));
      const claimId = claimResult.rows[0]?.id;
      if (claimId) {
        // Add claim line item with CPT code
        await db.execute(sql.raw(`
          INSERT INTO claim_line_items (claim_id, cpt_code_id, units, rate, amount, date_of_service, created_at)
          VALUES (${claimId}, (SELECT id FROM cpt_codes WHERE code = '${c.cpt}' LIMIT 1), 4, ${c.amount / 4}, ${c.amount}, (NOW() - INTERVAL '${c.offset}')::date, NOW())
        `));
      }
    } catch (e: any) { console.error(`Seed claim error: ${e.message}`); }
  }
  console.log("  Seeded 9 claims with line items");

  // Seed payments for paid claims
  const payments = [
    { idx: 0, offset: '16 days', amount: 245, type: 'insurance', ref: 'ERA-2026-001' },
    { idx: 1, offset: '13 days', amount: 183, type: 'insurance', ref: 'ERA-2026-002' },
    { idx: 2, offset: '9 days', amount: 252, type: 'insurance', ref: 'ERA-2026-003' },
    { idx: 0, offset: '15 days', amount: 25, type: 'patient', ref: 'COPAY-001' },
    { idx: 1, offset: '12 days', amount: 30, type: 'patient', ref: 'COPAY-002' },
  ];

  for (const p of payments) {
    const pid = patients[p.idx % patients.length].id;
    try {
      await db.execute(sql.raw(`
        INSERT INTO payments (practice_id, patient_id, amount, payment_type, payment_date, reference_number, status, created_at)
        VALUES (${practiceId}, ${pid}, ${p.amount}, '${p.type}', (NOW() - INTERVAL '${p.offset}')::date, '${p.ref}', 'completed', NOW())
      `));
    } catch (e: any) { console.error(`Seed payment error: ${e.message}`); }
  }
  console.log("  Seeded 5 payments");

  // Seed AI learning data for the AI Insights page
  // The generateInsights() function queries ai_learning_data directly, so we need
  // sufficient density: 3+ per payer+CPT+ICD10, 3+ per payer+CPT, 5+ per payer, 3+ per CPT+modifier
  await seedAiLearningData(db, practiceId);

  console.log("Demo practice history seeded successfully!");
}

/**
 * Seed ai_learning_data with enough density for each insight type:
 * - Denial patterns: 3+ per (payer, cpt, icd10) with >=20% denial rate
 * - Underpayment patterns: 3+ paid per (payer, cpt) where paid < 95% submitted
 * - Payer trends: 5+ per payer with processingDays (some old, some recent)
 * - Modifier patterns: 3+ per (cpt, modifier) comparing with/without
 */
async function seedAiLearningData(db: any, practiceId: number) {
  console.log("  Seeding AI learning data for insights...");

  const rows: Array<{
    payer: string;
    cpt: string;
    icd: string;
    modifier: string | null;
    outcome: string;
    submitted: number;
    paid: number | null;
    denialReason: string | null;
    processingDays: number;
    daysAgo: number; // how many days ago the createdAt should be
  }> = [];

  // --- Aetna + 97530 + F82: 6 claims (2 denied = 33% denial rate) ---
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 230, denialReason: null, processingDays: 18, daysAgo: 120 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 235, denialReason: null, processingDays: 22, daysAgo: 100 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 228, denialReason: null, processingDays: 20, daysAgo: 80 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 240, denialReason: null, processingDays: 30, daysAgo: 30 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: null, outcome: 'denied', submitted: 289, paid: null, denialReason: 'Prior authorization required', processingDays: 14, daysAgo: 60 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: null, outcome: 'denied', submitted: 289, paid: null, denialReason: 'Medical necessity not established', processingDays: 10, daysAgo: 40 });

  // --- Aetna + 97110 + F82: 5 claims (2 denied = 40% denial rate) ---
  rows.push({ payer: 'Aetna', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 170, denialReason: null, processingDays: 25, daysAgo: 110 });
  rows.push({ payer: 'Aetna', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 175, denialReason: null, processingDays: 28, daysAgo: 85 });
  rows.push({ payer: 'Aetna', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 168, denialReason: null, processingDays: 35, daysAgo: 20 });
  rows.push({ payer: 'Aetna', cpt: '97110', icd: 'F82', modifier: null, outcome: 'denied', submitted: 216, paid: null, denialReason: 'Duplicate claim submission', processingDays: 8, daysAgo: 50 });
  rows.push({ payer: 'Aetna', cpt: '97110', icd: 'F82', modifier: null, outcome: 'denied', submitted: 216, paid: null, denialReason: 'Prior authorization required', processingDays: 12, daysAgo: 35 });

  // --- Blue Cross Blue Shield + 97530 + F82: 5 claims (1 denied = 20% denial rate) ---
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 260, denialReason: null, processingDays: 15, daysAgo: 115 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 255, denialReason: null, processingDays: 14, daysAgo: 90 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 258, denialReason: null, processingDays: 16, daysAgo: 70 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 262, denialReason: null, processingDays: 22, daysAgo: 25 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97530', icd: 'F82', modifier: null, outcome: 'denied', submitted: 289, paid: null, denialReason: 'Medical necessity not established', processingDays: 10, daysAgo: 45 });

  // --- Blue Cross Blue Shield + 97110 + F82: 5 claims (1 denied) ---
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 190, denialReason: null, processingDays: 12, daysAgo: 105 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 185, denialReason: null, processingDays: 13, daysAgo: 75 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 188, denialReason: null, processingDays: 18, daysAgo: 55 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 192, denialReason: null, processingDays: 25, daysAgo: 15 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: null, outcome: 'denied', submitted: 216, paid: null, denialReason: 'Benefit limit exceeded', processingDays: 7, daysAgo: 65 });

  // --- UnitedHealthcare + 97530 + F82: 4 claims (all paid, underpayment pattern) ---
  rows.push({ payer: 'UnitedHealthcare', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 200, denialReason: null, processingDays: 30, daysAgo: 130 });
  rows.push({ payer: 'UnitedHealthcare', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 195, denialReason: null, processingDays: 28, daysAgo: 95 });
  rows.push({ payer: 'UnitedHealthcare', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 205, denialReason: null, processingDays: 35, daysAgo: 50 });
  rows.push({ payer: 'UnitedHealthcare', cpt: '97530', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 198, denialReason: null, processingDays: 40, daysAgo: 10 });

  // --- Extra Aetna rows (to reach 5+ total for payer trend) with increasing processing times ---
  // Older claims: faster processing
  rows.push({ payer: 'Aetna', cpt: '97535', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 245, denialReason: null, processingDays: 15, daysAgo: 150 });
  rows.push({ payer: 'Aetna', cpt: '97535', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 250, denialReason: null, processingDays: 16, daysAgo: 140 });
  // Recent claims: slower processing (triggers payer trend insight)
  rows.push({ payer: 'Aetna', cpt: '97535', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 242, denialReason: null, processingDays: 32, daysAgo: 15 });

  // --- Extra BCBS rows for payer trend (need 5+ with processingDays) ---
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97535', icd: 'F82', modifier: null, outcome: 'paid', submitted: 289, paid: 255, denialReason: null, processingDays: 10, daysAgo: 145 });

  // --- Modifier patterns: 97530 with GP modifier vs without ---
  // With modifier GP: 4 claims, 0 denied (0% denial rate)
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: 'GP', outcome: 'paid', submitted: 289, paid: 235, denialReason: null, processingDays: 18, daysAgo: 125 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: 'GP', outcome: 'paid', submitted: 289, paid: 240, denialReason: null, processingDays: 20, daysAgo: 98 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: 'GP', outcome: 'paid', submitted: 289, paid: 232, denialReason: null, processingDays: 22, daysAgo: 70 });
  rows.push({ payer: 'Aetna', cpt: '97530', icd: 'F82', modifier: 'GP', outcome: 'paid', submitted: 289, paid: 238, denialReason: null, processingDays: 19, daysAgo: 42 });

  // With modifier 59: 4 claims, 1 denied (25%)
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: '59', outcome: 'paid', submitted: 216, paid: 190, denialReason: null, processingDays: 14, daysAgo: 118 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: '59', outcome: 'paid', submitted: 216, paid: 185, denialReason: null, processingDays: 16, daysAgo: 88 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: '59', outcome: 'paid', submitted: 216, paid: 188, denialReason: null, processingDays: 15, daysAgo: 58 });
  rows.push({ payer: 'Blue Cross Blue Shield', cpt: '97110', icd: 'F82', modifier: '59', outcome: 'denied', submitted: 216, paid: null, denialReason: 'Duplicate claim submission', processingDays: 9, daysAgo: 38 });

  // --- UnitedHealthcare extra for payer trend (need 5+ total) ---
  rows.push({ payer: 'UnitedHealthcare', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 155, denialReason: null, processingDays: 25, daysAgo: 135 });
  rows.push({ payer: 'UnitedHealthcare', cpt: '97110', icd: 'F82', modifier: null, outcome: 'paid', submitted: 216, paid: 150, denialReason: null, processingDays: 22, daysAgo: 110 });
  rows.push({ payer: 'UnitedHealthcare', cpt: '97110', icd: 'F82', modifier: null, outcome: 'denied', submitted: 216, paid: null, denialReason: 'Prior authorization required', processingDays: 45, daysAgo: 5 });

  // Insert all rows
  for (const r of rows) {
    const paidVal = r.paid !== null ? `'${r.paid.toFixed(2)}'` : 'NULL';
    const denialVal = r.denialReason ? `'${r.denialReason.replace(/'/g, "''")}'` : 'NULL';
    const modVal = r.modifier ? `'${r.modifier}'` : 'NULL';
    try {
      await db.execute(sql.raw(`
        INSERT INTO ai_learning_data (practice_id, cpt_code, icd10_code, payer_name, submitted_amount, paid_amount, outcome, denial_reason, modifier, processing_days, created_at)
        VALUES (${practiceId}, '${r.cpt}', '${r.icd}', '${r.payer.replace(/'/g, "''")}', '${r.submitted.toFixed(2)}', ${paidVal}, '${r.outcome}', ${denialVal}, ${modVal}, ${r.processingDays}, NOW() - INTERVAL '${r.daysAgo} days')
      `));
    } catch (e: any) { console.error(`Seed AI learning data error: ${e.message}`); }
  }
  console.log(`  Seeded ${rows.length} AI learning data entries for insights`);
}

/**
 * One-shot backfill: populate cpt_codes.therapy_category based on code.
 * Idempotent — only writes when the column is NULL. Runs on every boot
 * so newly-seeded codes in older deployments pick up the mapping too.
 *
 * Mapping reference (Stedi remediation plan, Phase 2):
 *   OT:   97533, 97129, 97130, 97537, 97165–97168
 *   PT:   97116, 97161–97164
 *   ST:   92507, 92508, 92521, 92522, 92523, 92524, 92526
 *   MH:   90791, 90832, 90834, 90837, 90846, 90847
 *   GEN:  97110, 97112, 97140, 97530, 97535, 97542, 97750 (both OT + PT)
 */
async function backfillCptTherapyCategories(db: any) {
  const mapping: Record<string, string[]> = {
    OT: ['97533', '97129', '97130', '97537', '97165', '97166', '97167', '97168'],
    PT: ['97116', '97161', '97162', '97163', '97164'],
    ST: ['92507', '92508', '92521', '92522', '92523', '92524', '92526'],
    MH: ['90791', '90832', '90834', '90837', '90846', '90847'],
    GENERAL: ['97110', '97112', '97140', '97530', '97535', '97542', '97750'],
  };

  for (const [category, codes] of Object.entries(mapping)) {
    if (codes.length === 0) continue;
    await db.execute(sql`
      UPDATE cpt_codes
         SET therapy_category = ${category}
       WHERE code IN (${sql.raw(codes.map(c => `'${c}'`).join(','))})
         AND (therapy_category IS NULL OR therapy_category = '')
    `);
  }
}

/**
 * Seed the system-default SOAP intervention templates. Idempotent — only
 * inserts rows that don't exist yet (matched on practice_id IS NULL +
 * category + name). System defaults have practice_id = NULL and are
 * shared by every practice. Practices add their own custom rows with
 * practice_id set + is_custom = true.
 */
async function seedSoapInterventionTemplates(db: any) {
  type Tmpl = { name: string; description?: string };

  // Activity-level items live in (O) Activities Performed (ACTIVITY_CATEGORIES
  // in client/src/pages/soap-notes.tsx). The Interventions library is
  // reserved for higher-level, cross-discipline templates that don't fit
  // an exercise-with-assessment model — patient/family education, programs,
  // equipment trials, consultation. Keep this list lean.
  const byCategory: Record<string, Tmpl[]> = {
    'Education & Training': [
      { name: 'Caregiver Education', description: 'Parent / caregiver education on therapy goals or strategies' },
      { name: 'Home Exercise Program — Issued', description: 'New HEP provided to patient/caregiver' },
      { name: 'Home Exercise Program — Reviewed', description: 'Existing HEP reviewed, progress checked' },
      { name: 'Self-Regulation Strategy Coaching', description: 'Patient coached on regulation strategies' },
      { name: 'Patient / Family Goal Review', description: 'Reviewed therapy goals with family' },
    ],
    'Programs & Trials': [
      { name: 'Sensory Diet Trial', description: 'Trialed sensory diet activities or schedule' },
      { name: 'Brushing Protocol Trial', description: 'Wilbarger or similar brushing protocol trialed' },
      { name: 'Joint Compression Protocol', description: 'Joint compression protocol provided' },
      { name: 'Listening Program Trial', description: 'Therapeutic Listening / similar audio program trialed' },
    ],
    'Equipment & AAC': [
      { name: 'Adaptive Equipment Trial', description: 'Trialed adaptive equipment (utensil, grip, etc.)' },
      { name: 'AAC Device Setup / Programming', description: 'Programmed or configured AAC device' },
      { name: 'AAC Use During Session', description: 'Patient used AAC throughout session' },
      { name: 'Weighted / Compression Garment Trial', description: 'Trialed weighted vest, compression garment, etc.' },
    ],
    'Consultation & Coordination': [
      { name: 'School / Teacher Consultation', description: 'Consulted with school staff about patient progress' },
      { name: 'Care Team Coordination', description: 'Coordinated with PT/OT/ST or physician on care plan' },
      { name: 'Environmental Modification Recommendation', description: 'Recommended home/school environment modifications' },
      { name: 'Re-evaluation / Progress Note', description: 'Formal re-evaluation or progress note completed' },
    ],
  };

  // One-time cleanup: prior versions seeded activity-level duplicates
  // (Speech Therapy ×2, ADLs, Core/Fine Motor, Executive Function,
  // Lycra/Platform/Obstacle). Those now live in (O) Activities Performed
  // exclusively. Remove the system-default rows from this table so the
  // Interventions library stops showing them. We only delete rows with
  // practice_id IS NULL — practice-custom rows (if any) are preserved.
  const LEGACY_CATEGORIES = [
    'Speech Therapy — Evaluation',
    'Speech Therapy — Treatment',
    'ADLs & Self-Care',
    'Core & Gross Motor Play',
    'Fine Motor / Tabletop',
    'Executive Function',
    'Lycra Swing',
    'Platform Swing',
    'Obstacle Course',
  ];
  try {
    const placeholders = LEGACY_CATEGORIES.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
    const result: any = await db.execute(sql`
      DELETE FROM soap_intervention_templates
       WHERE practice_id IS NULL
         AND category IN (${sql.raw(placeholders)})
    `);
    const deletedCount = result?.rowCount ?? result?.rows?.length ?? 0;
    if (deletedCount > 0) {
      console.log(`  Removed ${deletedCount} legacy intervention templates (now in (O) Activities Performed)`);
    }
  } catch (e: any) {
    console.warn(`  legacy intervention cleanup failed: ${e.message}`);
  }

  let insertedCount = 0;
  let sortOrder = 0;
  for (const [category, items] of Object.entries(byCategory)) {
    for (const t of items) {
      sortOrder += 1;
      try {
        const existing: any = await db.execute(sql`
          SELECT 1 FROM soap_intervention_templates
           WHERE practice_id IS NULL
             AND category = ${category}
             AND name = ${t.name}
           LIMIT 1
        `);
        const hasRow = Array.isArray((existing as any).rows)
          ? (existing as any).rows.length > 0
          : (existing as any).length > 0;
        if (!hasRow) {
          await db.execute(sql`
            INSERT INTO soap_intervention_templates
              (practice_id, category, name, description, is_active, is_custom, sort_order)
            VALUES (NULL, ${category}, ${t.name}, ${t.description ?? null}, true, false, ${sortOrder})
          `);
          insertedCount++;
        }
      } catch (e: any) {
        console.warn(`  intervention template seed ${category}/${t.name} failed: ${e.message}`);
      }
    }
  }
  if (insertedCount > 0) {
    console.log(`  Seeded ${insertedCount} SOAP intervention templates`);
  }
}

/**
 * Seed benchmark insurance rates for the most common pediatric therapy payers,
 * so the Reimbursement page + Rates page have data out of the box instead of
 * showing empty dropdowns. These are industry-ballpark numbers, NOT contracted
 * rates — practices should replace them with their own negotiated values via
 * Settings → Rates as soon as they know them.
 *
 * Seed is idempotent — only inserts a rate if (payer, cpt) doesn't already
 * exist. So once a practice overrides with their real rate, the override is
 * preserved on every subsequent boot.
 *
 * Sources for benchmarks: public Medicare PFS + typical commercial multipliers
 * for pediatric OT/PT/ST. Treat as order-of-magnitude, not to-the-penny.
 */
async function seedBenchmarkInsuranceRates(db: any) {
  // Top pediatric therapy payers + benchmark in-network rates for the 15
  // CPTs therapy practices bill most often. All amounts in USD. Rank 1 =
  // highest reimbursement for that payer (drives the Rates page sort).
  type Rate = {
    cpt: string;
    inNetwork: number;
    outOfNetwork?: number;
    copay?: number;
    coinsurance?: number;
  };
  const benchmarksByPayer: Record<string, Rate[]> = {
    'Aetna': [
      { cpt: '97530', inNetwork: 88, outOfNetwork: 120, copay: 30, coinsurance: 20 },
      { cpt: '97110', inNetwork: 72, outOfNetwork: 100, copay: 30, coinsurance: 20 },
      { cpt: '97112', inNetwork: 76, outOfNetwork: 105, copay: 30, coinsurance: 20 },
      { cpt: '97533', inNetwork: 82, outOfNetwork: 115 },
      { cpt: '97140', inNetwork: 58, outOfNetwork: 85 },
      { cpt: '92507', inNetwork: 95, outOfNetwork: 130, copay: 30, coinsurance: 20 },
      { cpt: '97165', inNetwork: 135, outOfNetwork: 180 },
      { cpt: '97161', inNetwork: 125, outOfNetwork: 170 },
    ],
    'Blue Cross Blue Shield': [
      { cpt: '97530', inNetwork: 85, outOfNetwork: 118, copay: 25, coinsurance: 20 },
      { cpt: '97110', inNetwork: 70, outOfNetwork: 98, copay: 25, coinsurance: 20 },
      { cpt: '97112', inNetwork: 74, outOfNetwork: 103, copay: 25, coinsurance: 20 },
      { cpt: '97533', inNetwork: 80, outOfNetwork: 112 },
      { cpt: '97140', inNetwork: 56, outOfNetwork: 82 },
      { cpt: '92507', inNetwork: 92, outOfNetwork: 128, copay: 25, coinsurance: 20 },
      { cpt: '97165', inNetwork: 130, outOfNetwork: 175 },
      { cpt: '97161', inNetwork: 122, outOfNetwork: 165 },
    ],
    'UnitedHealthcare': [
      { cpt: '97530', inNetwork: 82, outOfNetwork: 115, copay: 35, coinsurance: 20 },
      { cpt: '97110', inNetwork: 68, outOfNetwork: 95, copay: 35, coinsurance: 20 },
      { cpt: '97112', inNetwork: 72, outOfNetwork: 100, copay: 35, coinsurance: 20 },
      { cpt: '97533', inNetwork: 78, outOfNetwork: 108 },
      { cpt: '97140', inNetwork: 55, outOfNetwork: 80 },
      { cpt: '92507', inNetwork: 90, outOfNetwork: 125, copay: 35, coinsurance: 20 },
      { cpt: '97165', inNetwork: 128, outOfNetwork: 170 },
      { cpt: '97161', inNetwork: 120, outOfNetwork: 160 },
    ],
    'Cigna': [
      { cpt: '97530', inNetwork: 84, outOfNetwork: 116, copay: 30, coinsurance: 20 },
      { cpt: '97110', inNetwork: 69, outOfNetwork: 96, copay: 30, coinsurance: 20 },
      { cpt: '97112', inNetwork: 73, outOfNetwork: 101, copay: 30, coinsurance: 20 },
      { cpt: '92507', inNetwork: 91, outOfNetwork: 126, copay: 30, coinsurance: 20 },
      { cpt: '97165', inNetwork: 129, outOfNetwork: 172 },
      { cpt: '97161', inNetwork: 121, outOfNetwork: 162 },
    ],
    'Horizon BCBS NJ': [
      { cpt: '97530', inNetwork: 86, outOfNetwork: 119, copay: 25, coinsurance: 20 },
      { cpt: '97110', inNetwork: 71, outOfNetwork: 99, copay: 25, coinsurance: 20 },
      { cpt: '97112', inNetwork: 75, outOfNetwork: 104, copay: 25, coinsurance: 20 },
      { cpt: '97533', inNetwork: 81, outOfNetwork: 114 },
      { cpt: '92507', inNetwork: 93, outOfNetwork: 129, copay: 25, coinsurance: 20 },
      { cpt: '97165', inNetwork: 132, outOfNetwork: 176 },
      { cpt: '97161', inNetwork: 124, outOfNetwork: 166 },
    ],
    'Anthem BCBS': [
      { cpt: '97530', inNetwork: 83, outOfNetwork: 117, copay: 30, coinsurance: 20 },
      { cpt: '97110', inNetwork: 69, outOfNetwork: 97, copay: 30, coinsurance: 20 },
      { cpt: '97112', inNetwork: 73, outOfNetwork: 102, copay: 30, coinsurance: 20 },
      { cpt: '97533', inNetwork: 79, outOfNetwork: 111 },
      { cpt: '92507', inNetwork: 91, outOfNetwork: 127, copay: 30, coinsurance: 20 },
      { cpt: '97165', inNetwork: 127, outOfNetwork: 171 },
      { cpt: '97161', inNetwork: 119, outOfNetwork: 161 },
    ],
    'Medicaid': [
      { cpt: '97530', inNetwork: 52 },
      { cpt: '97110', inNetwork: 44 },
      { cpt: '97112', inNetwork: 46 },
      { cpt: '97533', inNetwork: 50 },
      { cpt: '92507', inNetwork: 58 },
      { cpt: '97165', inNetwork: 85 },
      { cpt: '97161', inNetwork: 78 },
    ],
  };

  let insertedCount = 0;
  for (const [payer, rates] of Object.entries(benchmarksByPayer)) {
    for (const rate of rates) {
      // Rank = position in the rates array for this payer (best → worst by
      // in-network rate). Used on the Rates page for sorting.
      const rank = rates.slice().sort((a, b) => b.inNetwork - a.inNetwork).indexOf(rate) + 1;
      try {
        const inserted: any = await db.execute(sql`
          INSERT INTO insurance_rates
            (insurance_provider, cpt_code, in_network_rate, out_of_network_rate,
             copay_amount, coinsurance_percent, reimbursement_rank,
             source_document, deductible_applies)
          VALUES
            (${payer}, ${rate.cpt}, ${rate.inNetwork},
             ${rate.outOfNetwork ?? null}, ${rate.copay ?? null},
             ${rate.coinsurance ?? 20}, ${rank},
             'benchmark-seed (replace with contracted rate)', true)
          ON CONFLICT DO NOTHING
        `);
        if ((inserted as any)?.rowCount > 0) insertedCount++;
      } catch (e: any) {
        // If the table doesn't have a unique constraint covering (provider, cpt),
        // ON CONFLICT DO NOTHING won't match. Fall back to a SELECT-then-INSERT
        // to stay idempotent.
        try {
          const existing: any = await db.execute(sql`
            SELECT 1 FROM insurance_rates
             WHERE insurance_provider = ${payer} AND cpt_code = ${rate.cpt}
             LIMIT 1
          `);
          const hasRow = Array.isArray((existing as any).rows)
            ? (existing as any).rows.length > 0
            : (existing as any).length > 0;
          if (!hasRow) {
            await db.execute(sql`
              INSERT INTO insurance_rates
                (insurance_provider, cpt_code, in_network_rate, out_of_network_rate,
                 copay_amount, coinsurance_percent, reimbursement_rank,
                 source_document, deductible_applies)
              VALUES
                (${payer}, ${rate.cpt}, ${rate.inNetwork},
                 ${rate.outOfNetwork ?? null}, ${rate.copay ?? null},
                 ${rate.coinsurance ?? 20}, ${rank},
                 'benchmark-seed (replace with contracted rate)', true)
            `);
            insertedCount++;
          }
        } catch (innerErr: any) {
          console.warn(`  rate seed ${payer}/${rate.cpt} failed: ${innerErr.message}`);
        }
      }
    }
  }
  if (insertedCount > 0) {
    console.log(`  Seeded ${insertedCount} benchmark insurance rates across ${Object.keys(benchmarksByPayer).length} payers`);
  }
}

export async function seedDatabase(options?: { force?: boolean }) {
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    // Wait for database to be ready
    const db = await getDb();

    // Always run — idempotent, just backfills therapy_category on CPT codes
    // that don't have one yet. Fast (<10 rows).
    try {
      await backfillCptTherapyCategories(db);
    } catch (err) {
      console.warn('  CPT therapy-category backfill skipped:', err instanceof Error ? err.message : err);
    }

    // Phase 6 follow-up — seed benchmark insurance rates so the Reimbursement
    // and Rates pages aren't empty for new practices. Idempotent; only inserts
    // (payer, cpt) combos that don't already exist, preserving any rates a
    // practice has entered themselves.
    try {
      await seedBenchmarkInsuranceRates(db);
    } catch (err) {
      console.warn('  Benchmark insurance rates seed skipped:', err instanceof Error ? err.message : err);
    }

    // SOAP intervention templates — system-default activity library that
    // therapists pick from on the SOAP note form. Idempotent.
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS soap_intervention_templates (
          id SERIAL PRIMARY KEY,
          practice_id INTEGER REFERENCES practices(id),
          category VARCHAR(80) NOT NULL,
          name VARCHAR(200) NOT NULL,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          is_custom BOOLEAN DEFAULT FALSE,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_soap_intervention_templates_practice ON soap_intervention_templates (practice_id, is_active)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_soap_intervention_templates_category ON soap_intervention_templates (category)`);
      await seedSoapInterventionTemplates(db);
    } catch (err) {
      console.warn('  SOAP intervention templates seed skipped:', err instanceof Error ? err.message : err);
    }

    // Run schema migrations for new columns (safe to run multiple times)
    console.log("Running schema migrations...");

    // Patient table migrations - ensure varchar columns for encrypted PHI storage
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_id VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS policy_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS group_number VARCHAR`);
    // Fix column types: fields need text type to hold encrypted JSON or string member IDs
    // Drop any FK constraints on insurance_id first (old schema had integer FK to insurances table)
    try {
      await db.execute(sql`ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_insurance_id_insurances_id_fk`);
      await db.execute(sql`ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_insurance_id_fkey`);
    } catch (e) { /* constraint may not exist */ }

    // Test patient cleanup completed — ids 1-12 have been removed

    const columnsToText = [
      'first_name', 'last_name', 'email', 'phone', 'address',
      'insurance_provider', 'insurance_id', 'policy_number', 'group_number',
      'secondary_insurance_provider', 'secondary_insurance_member_id',
      'secondary_insurance_policy_number', 'secondary_insurance_group_number',
    ];
    for (const col of columnsToText) {
      try {
        await db.execute(sql.raw(`ALTER TABLE patients ALTER COLUMN ${col} TYPE text USING ${col}::text`));
      } catch (e) {
        // Column may not exist yet or already be text
      }
    }
    console.log("Column type migrations complete");
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_policy_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_member_id VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_group_number VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_relationship VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_subscriber_name VARCHAR`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_subscriber_dob DATE`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone_type VARCHAR DEFAULT 'mobile'`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR DEFAULT 'email'`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_given BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_date TIMESTAMP`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_data JSONB`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE patients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);

    // User table migrations
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS npi_number VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS digital_signature TEXT`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_uploaded_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_id VARCHAR`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signature TEXT`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signed_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signed_name VARCHAR`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_credentials VARCHAR`);
    await db.execute(sql`ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS signature_ip_address VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_provider VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_external_id VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS supervisor_id VARCHAR`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_cosign BOOLEAN DEFAULT FALSE`);
    console.log("Schema migrations complete");

    // Ensure a practice exists FIRST — everything else depends on having a practice ID
    let practiceId: number;
    const existingPractice = await db.execute(sql`SELECT id FROM practices LIMIT 1`);
    if (existingPractice.rows && existingPractice.rows.length > 0) {
      practiceId = parseInt(existingPractice.rows[0].id as string, 10);
      console.log(`Using existing practice (id: ${practiceId})`);
    } else {
      const [practice] = await db.insert(practices).values({
        name: "Healing Hands Occupational Therapy",
        npi: "1234567890",
        taxId: "12-3456789",
        address: "123 Therapy Lane, Wellness City, WC 12345",
        phone: "(555) 123-4567",
        email: "admin@healinghands.com",
      }).returning();
      practiceId = practice.id;
      console.log(`Created sample practice (id: ${practiceId})`);
    }

    if (!isProduction) {
      const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || 'demo1234';
      const demoReviewerPassword = process.env.DEMO_REVIEWER_PASSWORD || 'TherapyDemo2024#';

      const existingDemo = await db.execute(sql`SELECT id FROM users WHERE email = 'demo@therapybill.com'`);
      if (!existingDemo.rows || existingDemo.rows.length === 0) {
        console.log("Creating demo user...");
        const demoHash = await hashPassword(demoAdminPassword);
        await db.insert(users).values({
          id: "demo-user-001",
          email: "demo@therapybill.com",
          firstName: "Demo",
          lastName: "Admin",
          practiceId: practiceId,
          role: "admin",
          passwordHash: demoHash,
          emailVerified: true,
        }).onConflictDoNothing();
        console.log("Demo user created: demo@therapybill.com");
      } else {
        await db.execute(sql`UPDATE users SET role = 'admin', practice_id = ${practiceId} WHERE email = 'demo@therapybill.com' AND (role != 'admin' OR practice_id IS NULL)`);
        console.log("Demo user already exists");
      }

      const existingReviewer = await db.execute(sql`SELECT id FROM users WHERE email = 'reviewer1@demo.com'`);
      if (!existingReviewer.rows || existingReviewer.rows.length === 0) {
        console.log("Creating reviewer user...");
        const reviewerHash = await hashPassword(demoReviewerPassword);
        await db.insert(users).values({
          id: "reviewer-user-001",
          email: "reviewer1@demo.com",
          firstName: "Reviewer",
          lastName: "Demo",
          practiceId: practiceId,
          role: "admin",
          passwordHash: reviewerHash,
          emailVerified: true,
        }).onConflictDoNothing();
        console.log("Reviewer user created: reviewer1@demo.com");
      } else {
        await db.execute(sql`UPDATE users SET role = 'admin', practice_id = ${practiceId} WHERE email = 'reviewer1@demo.com' AND (role != 'admin' OR practice_id IS NULL)`);
        console.log("Reviewer user already exists - ensured admin role");
      }

      await db.execute(sql`UPDATE users SET role = 'admin', practice_id = ${practiceId} WHERE email = 'reviewer2@demo.com' AND (role != 'admin' OR practice_id IS NULL)`);
    } else {
      console.log("Production environment — skipping demo user seeding");
    }

    // Seed demo patients only if none exist
    const existingPatientCount = await db.execute(sql`SELECT COUNT(*) as count FROM patients WHERE deleted_at IS NULL`);
    const activePatients = parseInt(existingPatientCount.rows[0]?.count || '0', 10);
    if ((options?.force || !isProduction) && activePatients === 0) {
      console.log("No patients found — seeding demo patients...");
      const demoPatients = [
        { fn: 'Mason', ln: 'Hartwell', dob: '2019-06-12', email: 'diana.hartwell@example.net', phone: '(555) 814-2937', addr: '1204 Sycamore Blvd, Brookfield, IL 60513', ins: 'Blue Cross Blue Shield', insId: 'BCBS7741928035', pol: 'GHP-88201-A', grp: 'BX-4410' },
        { fn: 'Clara', ln: 'Nguyen', dob: '2020-03-08', email: 'tran.nguyen@example.net', phone: '(555) 623-8104', addr: '387 Willowbrook Dr, Oakdale, MN 55128', ins: 'Aetna', insId: 'AET3390217864', pol: 'GHP-55032-B', grp: 'AT-7720' },
        { fn: 'Declan', ln: 'Okafor', dob: '2018-11-22', email: 'grace.okafor@example.net', phone: '(555) 471-5928', addr: '92 Ridgewood Terrace, Cary, NC 27513', ins: 'UnitedHealthcare', insId: 'UHC8856034172', pol: 'GHP-67210-C', grp: 'UH-3305' },
        { fn: 'Isla', ln: 'Brennan', dob: '2021-01-15', email: 'kevin.brennan@example.net', phone: '(555) 309-6741', addr: '5510 Hawthorn Ct, Plano, TX 75024', ins: 'Cigna', insId: 'CIG2104897563', pol: 'GHP-43018-D', grp: 'CI-9180' },
        { fn: 'Felix', ln: 'Sandoval', dob: '2017-08-30', email: 'maria.sandoval@example.net', phone: '(555) 182-4503', addr: '741 Birchwood Ave, Eugene, OR 97401', ins: 'Medicare', insId: 'MCA6627183049', pol: 'GHP-91405-E', grp: 'MC-5560' },
        { fn: 'Zara', ln: 'Lindqvist', dob: '2020-09-17', email: 'anna.lindqvist@example.net', phone: '(555) 547-3286', addr: '2038 Cedarwood Ln, Madison, WI 53711', ins: 'Humana', insId: 'HUM4415928370', pol: 'GHP-72604-F', grp: 'HU-2245' },
      ];
      for (const p of demoPatients) {
        try {
          await db.execute(sql`
            INSERT INTO patients (practice_id, first_name, last_name, date_of_birth, email, phone, address, insurance_provider, insurance_id, policy_number, group_number, created_at, updated_at)
            VALUES (${practiceId}, ${p.fn}, ${p.ln}, ${p.dob}, ${p.email}, ${p.phone}, ${p.addr}, ${p.ins}, ${p.insId}, ${p.pol}, ${p.grp}, NOW(), NOW())
          `);
        } catch (e) {
          console.error(`Failed to seed patient ${p.fn} ${p.ln}:`, e instanceof Error ? e.message : e);
        }
      }
      console.log("Sample patients seeded: 6 pediatric patients");

      // Seed practice history (appointments, claims, sessions, SOAP notes, payments)
      await seedDemoPracticeHistory(db, practiceId);
    } else if (options?.force) {
      // Force re-seed: check if practice history is missing
      const claimCount = await db.execute(sql`SELECT COUNT(*) as count FROM claims WHERE practice_id = ${practiceId}`);
      if (parseInt(claimCount.rows[0]?.count || '0', 10) === 0) {
        await seedDemoPracticeHistory(db, practiceId);
      }
    } else if (!isProduction) {
      console.log(`${activePatients} patients already exist — skipping seed`);
    }

    // Check if reference data already exists (CPT codes, ICD-10, insurances)
    const cptCount = await db.execute(sql`SELECT COUNT(*) as count FROM cpt_codes`);
    if (parseInt(cptCount.rows[0]?.count || '0', 10) > 0) {
      console.log("Database already seeded with reference data");
      return;
    }

    // Seed Common OT CPT Codes - Standard rate $289 per session
    await db.insert(cptCodes).values([
      {
        code: "97110",
        description: "Therapeutic exercises - strength, ROM, flexibility (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97112",
        description: "Neuromuscular reeducation - balance, coordination, posture (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97140",
        description: "Manual therapy - mobilization, manipulation (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97530",
        description: "Therapeutic activities - functional performance (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97535",
        description: "Self-care/ADL training - daily living activities (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97542",
        description: "Wheelchair management training (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97545",
        description: "Work hardening/conditioning (2 hours)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      // OT Evaluation codes
      {
        code: "97165",
        description: "OT evaluation - low complexity",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97166",
        description: "OT evaluation - moderate complexity",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97167",
        description: "OT evaluation - high complexity",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97168",
        description: "OT re-evaluation",
        category: "evaluation",
        baseRate: "400.00",
        billingUnits: 1,
      },
      // PT Evaluation codes
      {
        code: "97161",
        description: "PT evaluation - low complexity",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97162",
        description: "PT evaluation - moderate complexity",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97163",
        description: "PT evaluation - high complexity",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97164",
        description: "PT re-evaluation",
        category: "evaluation",
        baseRate: "400.00",
        billingUnits: 1,
      },
      // SLP Evaluation codes
      {
        code: "92521",
        description: "SLP evaluation - fluency",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "92522",
        description: "SLP evaluation - sound production",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "92523",
        description: "SLP evaluation - sound production with language",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "92524",
        description: "SLP evaluation - voice and resonance",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      // Legacy OT eval codes (replaced by 97165-97168)
      {
        code: "97003",
        description: "Occupational therapy evaluation (legacy)",
        category: "evaluation",
        baseRate: "550.00",
        billingUnits: 1,
      },
      {
        code: "97004",
        description: "Occupational therapy re-evaluation (legacy)",
        category: "evaluation",
        baseRate: "400.00",
        billingUnits: 1,
      },
    ]);

    // Seed Common ICD-10 Codes for OT
    await db.insert(icd10Codes).values([
      {
        code: "Z51.89",
        description: "Encounter for other specified aftercare",
        category: "aftercare",
      },
      {
        code: "M25.561",
        description: "Pain in right knee",
        category: "musculoskeletal",
      },
      {
        code: "M25.562",
        description: "Pain in left knee",
        category: "musculoskeletal",
      },
      {
        code: "M25.511",
        description: "Pain in right shoulder",
        category: "musculoskeletal",
      },
      {
        code: "M25.512",
        description: "Pain in left shoulder",
        category: "musculoskeletal",
      },
      {
        code: "M79.3",
        description: "Panniculitis, unspecified",
        category: "musculoskeletal",
      },
      {
        code: "G93.1",
        description: "Anoxic brain damage, not elsewhere classified",
        category: "neurological",
      },
      {
        code: "I69.351",
        description: "Hemiplegia and hemiparesis following cerebral infarction affecting right dominant side",
        category: "neurological",
      },
      {
        code: "I69.352",
        description: "Hemiplegia and hemiparesis following cerebral infarction affecting left dominant side",
        category: "neurological",
      },
      {
        code: "S72.001A",
        description: "Fracture of unspecified part of neck of right femur, initial encounter for closed fracture",
        category: "injury",
      },
      {
        code: "S72.002A",
        description: "Fracture of unspecified part of neck of left femur, initial encounter for closed fracture",
        category: "injury",
      },
      {
        code: "F84.0",
        description: "Autistic disorder",
        category: "developmental",
      },
      {
        code: "F82",
        description: "Specific developmental disorder of motor function",
        category: "developmental",
      },
    ]);

    // Seed Insurance Companies
    await db.insert(insurances).values([
      {
        name: "Medicare",
        payerCode: "00100",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Medicaid",
        payerCode: "00200",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Blue Cross Blue Shield",
        payerCode: "00300",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Aetna",
        payerCode: "00400",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Cigna",
        payerCode: "00500",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "UnitedHealth",
        payerCode: "00600",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Humana",
        payerCode: "00700",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
    ]);

    console.log("Reference data seeded successfully (CPT codes, ICD-10 codes, insurances)");

    // Seed payer crosswalk data for sub-plan routing
    const crosswalkCount = await db.execute(sql`SELECT COUNT(*) as count FROM payer_crosswalk`);
    if (parseInt(crosswalkCount.rows[0]?.count || '0', 10) === 0) {
      console.log("Seeding payer crosswalk data...");
      await db.insert(payerCrosswalk).values([
        // Aetna sub-plans
        {
          parentPayerName: "Aetna",
          subPlanName: "Aetna Better Health",
          subPlanKeywords: ["better health", "medicaid", "aetna medicaid"],
          tradingPartnerId: "AETNABH",
          stediPayerId: "AETBH01",
          notes: "Aetna Medicaid managed care plan",
          isActive: true,
        },
        {
          parentPayerName: "Aetna",
          subPlanName: "Aetna CVS Health",
          subPlanKeywords: ["cvs health", "cvs", "aetna cvs"],
          tradingPartnerId: "60054",
          stediPayerId: "60054",
          notes: "Aetna CVS Health commercial plans",
          isActive: true,
        },
        {
          parentPayerName: "Aetna",
          subPlanName: "Aetna Student Health",
          subPlanKeywords: ["student health", "student"],
          tradingPartnerId: "46299",
          stediPayerId: "46299",
          notes: "Aetna Student Health plans",
          isActive: true,
        },
        // BCBS state-specific plans
        {
          parentPayerName: "Blue Cross Blue Shield",
          subPlanName: "Anthem BCBS",
          subPlanKeywords: ["anthem", "anthem bcbs", "anthem blue cross"],
          tradingPartnerId: "00805",
          stediPayerId: "00805",
          state: "IN",
          notes: "Anthem BCBS - IN, OH, KY, WI, CT, NH, ME, CO, NV, VA, GA, MO",
          isActive: true,
        },
        {
          parentPayerName: "Blue Cross Blue Shield",
          subPlanName: "Premera Blue Cross",
          subPlanKeywords: ["premera", "premera blue cross"],
          tradingPartnerId: "00402",
          stediPayerId: "00402",
          state: "WA",
          notes: "Premera Blue Cross - Washington and Alaska",
          isActive: true,
        },
        {
          parentPayerName: "Blue Cross Blue Shield",
          subPlanName: "Highmark BCBS",
          subPlanKeywords: ["highmark", "highmark bcbs"],
          tradingPartnerId: "65391",
          stediPayerId: "65391",
          state: "PA",
          notes: "Highmark BCBS - Pennsylvania, West Virginia, Delaware",
          isActive: true,
        },
        {
          parentPayerName: "Blue Cross Blue Shield",
          subPlanName: "Horizon BCBS New Jersey",
          subPlanKeywords: ["horizon", "horizon bcbs", "horizon blue cross"],
          tradingPartnerId: "22099",
          stediPayerId: "22099",
          state: "NJ",
          notes: "Horizon BCBS of New Jersey",
          isActive: true,
        },
        {
          parentPayerName: "Blue Cross Blue Shield",
          subPlanName: "Independence Blue Cross",
          subPlanKeywords: ["independence", "independence blue cross", "ibc"],
          tradingPartnerId: "23228",
          stediPayerId: "23228",
          state: "PA",
          notes: "Independence Blue Cross - Southeast Pennsylvania",
          isActive: true,
        },
        {
          parentPayerName: "Blue Cross Blue Shield",
          subPlanName: "CareFirst BCBS",
          subPlanKeywords: ["carefirst", "carefirst bcbs"],
          tradingPartnerId: "47171",
          stediPayerId: "47171",
          state: "MD",
          notes: "CareFirst BCBS - Maryland, DC, Northern Virginia",
          isActive: true,
        },
        // UnitedHealthcare sub-plans
        {
          parentPayerName: "UnitedHealth",
          subPlanName: "UHC Community Plan",
          subPlanKeywords: ["community plan", "uhc medicaid", "united medicaid", "community"],
          tradingPartnerId: "87726",
          stediPayerId: "87726",
          notes: "UnitedHealthcare Medicaid managed care",
          isActive: true,
        },
        {
          parentPayerName: "UnitedHealth",
          subPlanName: "UHC Oxford",
          subPlanKeywords: ["oxford", "uhc oxford", "oxford health"],
          tradingPartnerId: "06111",
          stediPayerId: "06111",
          notes: "Oxford Health Plans (UHC subsidiary) - NY, NJ, CT",
          isActive: true,
        },
        {
          parentPayerName: "UnitedHealth",
          subPlanName: "UHC Optum",
          subPlanKeywords: ["optum", "optumhealth", "optum behavioral"],
          tradingPartnerId: "87726",
          stediPayerId: "87726",
          notes: "OptumHealth Behavioral Solutions",
          isActive: true,
        },
        // Cigna sub-plans
        {
          parentPayerName: "Cigna",
          subPlanName: "Evernorth (Cigna)",
          subPlanKeywords: ["evernorth", "cigna evernorth"],
          tradingPartnerId: "62308",
          stediPayerId: "62308",
          notes: "Evernorth Health Services (Cigna subsidiary)",
          isActive: true,
        },
        {
          parentPayerName: "Cigna",
          subPlanName: "Cigna Behavioral Health",
          subPlanKeywords: ["behavioral health", "cigna behavioral"],
          tradingPartnerId: "62308",
          stediPayerId: "62308",
          notes: "Cigna Behavioral Health / EAP",
          isActive: true,
        },
        // Humana sub-plans
        {
          parentPayerName: "Humana",
          subPlanName: "Humana Military (TRICARE)",
          subPlanKeywords: ["military", "tricare", "humana military"],
          tradingPartnerId: "99726",
          stediPayerId: "99726",
          notes: "Humana Military Healthcare Services (TRICARE)",
          isActive: true,
        },
        // Medicare sub-plans
        {
          parentPayerName: "Medicare",
          subPlanName: "Medicare Advantage (Aetna)",
          subPlanKeywords: ["medicare advantage", "aetna medicare", "ma aetna"],
          tradingPartnerId: "60054",
          stediPayerId: "60054",
          notes: "Medicare Advantage plans administered by Aetna",
          isActive: true,
        },
        {
          parentPayerName: "Medicare",
          subPlanName: "Medicare Advantage (UHC)",
          subPlanKeywords: ["medicare advantage uhc", "uhc medicare", "ma uhc"],
          tradingPartnerId: "87726",
          stediPayerId: "87726",
          notes: "Medicare Advantage plans administered by UnitedHealthcare",
          isActive: true,
        },
      ]);
      console.log("Payer crosswalk data seeded successfully");
    } else {
      console.log("Payer crosswalk data already exists");
    }

  } catch (error) {
    console.error("Error seeding database:", error);
  }
}