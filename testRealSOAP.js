import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ALL_ACTIVITIES = `
PEDIATRIC OT - COMPLETE ACTIVITIES DATABASE

97110 – THERAPEUTIC EXERCISE:
Resistive Putty – Squeeze, Resistive Putty – Pinch/Pinch-Drag, Theraband – Shoulder Flex/Abd, Theraband – Rows, Grip Strengthener, Finger Web / Digi-Flex, Wall Push-Ups, Table Push-Ups, Chair/Bench Dips, Crab Walk, Bear Walk, Plank Hold, Side Plank, Wheelbarrow Walk, Prone Extension, Bridging, Sit-to-Stand Reps, Medicine Ball Press, Thera-egg Squeezes, Finger Isolation Taps, Clothespin Pinch Lines, Pinch-Flip Coins, Rice Scoop

97112 – NEUROMUSCULAR RE-EDUCATION:
Balance Board – Static, Balance Board – Dynamic, Foam Beam – Tandem Walk, Cross-Crawl, Animal Walks – Bunny Hops, Animal Walks – Bear Walk, Animal Walks – Crab Walk, Bilateral Ball Toss, Balloon Volleyball, Ladder Drills, Step-Stool Sequencing, Prone on Scooter Board, Supine Flexion Tucks, Swing – Prone Superman, Swing – Seated Linear, Target Toss While Balancing, Midline Crossing – Bean Bag Sort, Finger-to-Nose Alternation, Simon Says Sequencing, Theraband Isometrics with Balance, Yoga Flow, One-Leg Stance

97530 – THERAPEUTIC ACTIVITIES:
Obstacle Course, Pegboard – Pattern Copy, Puzzles 12-24 pieces, Mazes, Cutting Lines, Coloring In-Lines, Block Design, Lacing Cards/Shoes, Buttoning/Zipping, Feeding Practice, Writing Name/Letters, Drawing Shapes, Coin Bank, Tweezers Transfer, Stickers Placement, Playdough, Beading Patterns, Puzzle Lite, ADL Handwashing, ADL Coat On/Off, ADL Shoes/Socks, Pencil Grasp Practice

97533 – SENSORY INTEGRATION:
Rice Bin Bury/Find, Beans Bin Scoop/Pour, Kinetic Sand, Brushing Protocol, Joint Compressions, Crash Pad Jumps, Weighted Vest Trial, Body Sock, Sensory Swing Platform, Sensory Swing Lycra/Cuddle, Sensory Swing Bolster, Trampoline Jumps, Deep Pressure Roller, Oral Motor Chewelry, Oral Motor Crunchy Snacks, Fidgets Heavy Work, Proprioceptive Carry, Tactile Shaving Cream, Vibration Z-vibe, Auditory Headphones, Visual Low Lighting, Calming Corner

SKILLS: Postural Control, Bilateral Coordination, Crossing Midline, Fine Motor Precision, Grasp Strength, Hand Endurance, Visual Motor Integration, Ocular Motor Control, Sensory Regulation (calming/alerting), Core Strength, Attention/Focus, Motor Planning, Body Awareness, Balance/Equilibrium, ADL Independence, Graphomotor, Tool Use, Praxis/Sequencing, Self-Advocacy/Interoception
`;

async function test() {
  console.log('🧸 PEDIATRIC OT AI - Caching Test\n');

  const p1 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: [
      { type: 'text', text: 'You are a pediatric OT.' },
      { type: 'text', text: ALL_ACTIVITIES, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: '4yo, poor pencil grasp, hand strength. Recommend 4 activities with CPT codes.' }]
  });

  console.log('Patient 1:', p1.usage);
  console.log(p1.content[0].type === 'text' ? p1.content[0].text.substring(0, 300) : '', '...\n');
  
  await new Promise(r => setTimeout(r, 2000));

  const p2 = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: [
      { type: 'text', text: 'You are a pediatric OT.' },
      { type: 'text', text: ALL_ACTIVITIES, cache_control: { type: 'ephemeral' }}
    ],
    messages: [{ role: 'user', content: '6yo sensory seeking, poor attention. Needs heavy work then fine motor. Recommend activities.' }]
  });

  console.log('Patient 2 (CACHED!):', p2.usage);
  console.log(p2.content[0].type === 'text' ? p2.content[0].text.substring(0, 300) : '', '...\n');
  
  console.log(`💰 Cached ${p2.usage.cache_read_input_tokens || 0} tokens at 90% off!`);
}

test().catch(console.error);
