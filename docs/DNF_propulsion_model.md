# DNF Propulsion & Oxygen Model (Draft)

This note outlines a conceptual model for Dynamic No Fins (DNF) performances. It
breaks each attempt into repeated split checkpoints and ties propulsion events
to their oxygen costs. The goal is to expose knobs that can be tuned for each
athlete style before wiring the math into simulations.

## Split-Level Propulsion Targets

Every 50 m segment (or the final partial segment) must deliver enough net thrust
to cover its distance before the split timer expires. Faster split times require
higher instantaneous power, so the propulsion recipe for an elite sprint differs
from a pacing-focused swim even if the movements look similar on video.

For each split we accumulate propulsion from the following components:

- **Wall push**: impulse at the start of the segment. Its magnitude can be
  tuned per athlete and falls off if the previous glide consumed too much O2.
- **Post-push leg kicks**: zero or more heavy kicks immediately after the wall
  to convert the push into cruising speed.
- **Arm stroke**: primary drag reduction and thrust, modeled as discrete pulls
  (the `A*` columns). Stroke power varies by swimmer and fatigue state.
- **Intra-stroke leg kicks**: one or more kicks embedded in the stroke template
  (`ST_K`), each with its own power curve.
- **Stabilizing dolphin kicks**: optional micro-kicks (`ST_DK`) used to keep the
  torso aligned while the arm recovers. They usually cost less power individually
  but add up over long distances.

The dataset captures how each athlete uses these pieces, and the current "style
template" columns are reverse-engineered by manually reviewing each race video
to estimate when kicks or strokes happened. The builder script converts these
annotated `ST_*` patterns plus the per-split arm counts into a "propulsion
ledger" so we can ask questions like "how many kicks were available after the
150 m wall?" before evaluating total distance.

## Oxygen Consumption Model

To connect propulsion to physiology we assume two main sinks for O2:

1. **Static metabolic needs**: heart, brain, and core maintenance continue even
   when propulsion pauses. This baseline draw scales with heart rate, so a spike
   from stress or aggressive pacing increases oxygen burn even before strokes
   resume.
2. **Propulsion costs**: every arm pull and kick draws from the same O2 tank, but
   the rate differs by muscle group. Arm strokes and leg kicks are modeled on a
   per-movement basis so we can simulate alternative templates (e.g., double kick
   vs. single kick styles).

Additional modifiers:

- **Heart-rate coupling**: the static term ramps up or down based on the athlete's
  instantaneous heart rate. Long glides might let the HR settle, whereas sprint
  starts could push the baseline higher.
- **Anaerobic leg transition**: once the leg muscles cross their aerobic limit,
  their O2 draw decreases. The propulsion term for legs then shifts to reflect a
  higher reliance on anaerobic metabolism, which preserves O2 for the upper body
  but introduces fatigue debt to be repaid post-surfacing.

This framework separates the "how much thrust per split" question from "how much
oxygen remains," making it easier to iterate on either side without rewriting
everything else.
