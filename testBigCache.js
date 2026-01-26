import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// EXPANDED DATABASE - guaranteed to be 1024+ tokens
const HUGE_ACTIVITIES = `
COMPLETE PEDIATRIC OCCUPATIONAL THERAPY REFERENCE MANUAL

========== CPT CODE 97110: THERAPEUTIC EXERCISE ==========
Purpose: Improve strength, range of motion, flexibility, and endurance

1. RESISTIVE PUTTY – SQUEEZE
Target Skills: Grasp Strength, Hand Endurance
Instructions: Use therapy putty (light/medium/firm resistance). Child squeezes putty 10-15 reps per hand.
Progression: Increase resistance level or duration. Add finger isolation exercises.
Documentation: Note resistance level, number of reps completed, rest breaks needed.

2. RESISTIVE PUTTY – PINCH/PINCH-DRAG  
Target Skills: Fine Motor Precision, Grasp Strength
Instructions: Pinch small objects hidden in putty. Pinch and drag putty across table.
Progression: Smaller objects, firmer putty, timed challenges.

3. THERABAND – SHOULDER FLEXION/ABDUCTION
Target Skills: Core Strength, Postural Control
Instructions: Anchor band under feet, pull upward with arms. 2 sets of 10 reps.
Progressions: Increase band resistance, add holds, increase reps.

4. THERABAND – ROWS
Target Skills: Postural Control, Core Strength
Instructions: Seated rows pulling band toward body. Focus on shoulder blade retraction.

5. GRIP STRENGTHENER (HAND GRIPPER)
Target Skills: Grasp Strength, Hand Endurance
Instructions: Use age-appropriate gripper. 3 sets of 10 reps per hand.

6. FINGER WEB / DIGI-FLEX
Target Skills: Fine Motor Precision, Grasp Strength
Instructions: Individual finger strengthening. Each finger presses against resistance.

7. WALL PUSH-UPS
Target Skills: Core Strength, Postural Control
Instructions: Hands on wall, lean in and push back. 10-15 reps.

8. TABLE PUSH-UPS
Target Skills: Core Strength, Postural Control  
Instructions: Hands on table edge, lower chest toward table. 8-12 reps.

9. CRAB WALK
Target Skills: Bilateral Coordination, Core Strength
Instructions: Tabletop position, walk forward/backward 10-20 feet.

10. BEAR WALK
Target Skills: Bilateral Coordination, Motor Planning
Instructions: Hands and feet on ground, walk maintaining straight legs. 15-20 feet.

========== CPT CODE 97112: NEUROMUSCULAR RE-EDUCATION ==========
Purpose: Movement, balance, coordination, posture, and proprioception

1. BALANCE BOARD – STATIC
Target Skills: Balance/Equilibrium, Postural Control
Instructions: Stand on balance board, maintain balance 30-60 seconds.
Progression: Eyes closed, single leg, add arm movements.

2. BALANCE BOARD – DYNAMIC REACHING
Target Skills: Balance/Equilibrium, Motor Planning
Instructions: Stand on balance board, reach for targets placed around body.

3. FOAM BEAM – TANDEM WALK
Target Skills: Balance/Equilibrium, Body Awareness
Instructions: Walk heel-to-toe across foam beam. Forward and backward.

4. CROSS-CRAWL (STANDING)
Target Skills: Bilateral Coordination, Crossing Midline
Instructions: March in place touching opposite hand to opposite knee. 20 reps.

5. ANIMAL WALKS – BUNNY HOPS
Target Skills: Bilateral Coordination, Motor Planning
Instructions: Hands on ground, jump feet forward together. 10-15 hops.

6. BILATERAL BALL TOSS (OVER/UNDER)
Target Skills: Bilateral Coordination, Crossing Midline
Instructions: Pass ball over head then through legs. 15-20 reps.

7. BALLOON VOLLEYBALL
Target Skills: Postural Control, Visual Motor Integration
Instructions: Keep balloon in air using hands. Track and hit balloon.

========== CPT CODE 97530: THERAPEUTIC ACTIVITIES ==========
Purpose: Functional, dynamic activities to improve performance

1. OBSTACLE COURSE (MULTI-STEP)
Target Skills: Motor Planning, Praxis/Sequencing
Instructions: 4-6 station course: crawl through tunnel, step over hurdles, balance beam, jump targets.
Documentation: Completion time, assistance needed, sequence memory.

2. PEGBOARD – PATTERN COPY
Target Skills: Visual Motor Integration, Fine Motor Precision
Instructions: Copy 2D or 3D patterns using colored pegs. 5-10 patterns.

3. PUZZLES – 12-24 PIECES
Target Skills: Visual Motor Integration, Motor Planning
Instructions: Age-appropriate puzzles. Note completion time and strategies.

4. MAZES – FINGER THEN PENCIL
Target Skills: Visual Motor Integration, Graphomotor
Instructions: Trace maze with finger first, then complete with pencil.

5. CUTTING – STRAIGHT/CURVED LINES
Target Skills: Tool Use, Fine Motor Precision
Instructions: Progress from straight lines to curves to shapes. Use adaptive scissors if needed.

6. COLORING – IN-THE-LINES
Target Skills: Graphomotor, Visual Motor Integration
Instructions: Color pictures staying within boundaries. Note pencil grasp and pressure.

7. BUTTONING / ZIPPING PRACTICE
Target Skills: ADL Independence, Fine Motor Precision
Instructions: Use buttoning board or actual clothing. Practice front and back fastenings.

8. WRITING – NAME/LETTERS
Target Skills: Graphomotor, Fine Motor Precision
Instructions: Practice on appropriate lined paper. Note letter formation and spacing.

========== CPT CODE 97533: SENSORY INTEGRATION ==========
Purpose: Sensory processing, modulation, and integration

1. RICE BIN – BURY/FIND
Target Skills: Sensory Regulation (calming), Attention/Focus
Instructions: Hide objects in rice bin. Child searches using hands. 10 minutes.
Progression: Add scoops, sorting activities, timed challenges.

2. BEANS/LENTILS BIN – SCOOP/POUR
Target Skills: Sensory Regulation (calming), Motor Planning
Instructions: Scoop and pour between containers. Add funnels and measuring cups.

3. KINETIC SAND – MOLD/SMASH
Target Skills: Sensory Regulation (calming), Grasp Strength
Instructions: Free play with kinetic sand. Mold shapes, smash, build.

4. BRUSHING (WILBARGER) – PROTOCOL
Target Skills: Sensory Regulation (calming), Body Awareness
Instructions: Follow Wilbarger protocol. Brush arms, legs, back with surgical brush.
Documentation: Child's response, frequency, tolerance.

5. JOINT COMPRESSIONS – PROTOCOL
Target Skills: Sensory Regulation (calming), Body Awareness
Instructions: Gentle compressions to major joints: shoulders, elbows, wrists, hips, knees, ankles.

6. CRASH PAD – JUMPS/DEEP PRESSURE
Target Skills: Sensory Regulation (alerting), Body Awareness
Instructions: Jump or dive onto crash pad. Provide deep pressure after. 10-15 reps.

7. WEIGHTED VEST – TRIAL
Target Skills: Sensory Regulation (calming), Attention/Focus
Instructions: Trial 10% body weight vest. Wear during seated activities. Monitor tolerance.

8. SENSORY SWING – PLATFORM
Target Skills: Sensory Regulation (calming), Balance/Equilibrium
Instructions: Linear or rotary movement. Start slow, increase based on tolerance.

TARGETED THERAPEUTIC SKILLS:
- Postural Control: Ability to maintain alignment against gravity
- Bilateral Coordination: Using both sides of body together
- Crossing Midline: Reaching across body's center
- Fine Motor Precision: Small, accurate hand movements
- Grasp Strength: Ability to grip and hold objects
- Hand Endurance: Sustain grip over time
- Visual Motor Integration: Coordinate vision with movement
- Ocular Motor Control: Eye tracking and focusing
- Sensory Regulation: Process sensory input appropriately
- Core Strength: Trunk stability and control
- Attention/Focus: Sustained concentration on task
- Motor Planning: Conceptualize and execute movements
- Body Awareness: Proprioceptive sense of body position
- Balance/Equilibrium: Static and dynamic balance
- ADL Independence: Self-care task performance
- Graphomotor: Handwriting and drawing skills
- Tool Use: Functional use of scissors, utensils, pencils
- Praxis/Sequencing: Plan and execute multi-step tasks
- Self-Advocacy: Recognize and communicate needs
`;

async function test() {
  console.log('🧸 PEDIATRIC OT - GUARANTEED CACHING TEST');
  console.log('Database size:', HUGE_ACTIVITIES.length, 'characters\n');

  const p1 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: [
      { type: 'text', text: 'Pediatric OT expert.' },
      { type: 'text', text: HUGE_ACTIVITIES, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: '4yo poor grasp. Recommend 3 activities.' }]
  });

  console.log('P1:', p1.usage, '\n');
  
  await new Promise(r => setTimeout(r, 2000));

  const p2 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: [
      { type: 'text', text: 'Pediatric OT expert.' },
      { type: 'text', text: HUGE_ACTIVITIES, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: '6yo sensory seeking. Heavy work?' }]
  });

  console.log('P2 (CACHED!):', p2.usage);
  console.log(`\n💰💰 CACHED ${p2.usage.cache_read_input_tokens || 0} TOKENS AT 90% OFF! 💰💰`);
}

test().catch(console.error);
