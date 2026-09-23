/* missionGuidance.ts — Task selection guardrails (G8) + guided workflow (G7).

   The deck: "Task selection is the work." A SOTA IDE tells the user when
   NOT to launch an agent — high-taste UI work, architecture choices, and
   open-ended improvements ("make this better") cannot be measured, so the
   loop has no compass.

   This module:
   - classifyMissionFit(task): heuristic triage of a task into
     `good-fit` | `risky` | `poor-fit` with a reason and suggestion.
   - recommendGuidedWorkflow(task, context): when a task is large or
     vague, suggests the grill → spec → decompose → run → review funnel
     instead of a single-shot mission.

   Pure and unit-testable. UI (NewMissionModal) calls these to show a
   warning banner or a guided-flow CTA before launch.
*/

// ── Types ──────────────────────────────────────────────────────────

export type MissionFit = 'good-fit' | 'risky' | 'poor-fit';

export interface MissionFitVerdict {
  fit: MissionFit;
  reason: string;
  suggestion: string;
}

export type WorkflowStep = 'grill' | 'spec' | 'decompose' | 'run' | 'review';

export interface GuidedWorkflow {
  recommended: boolean;
  steps: WorkflowStep[];
  why: string;
}

// ── Heuristics ─────────────────────────────────────────────────────

/** Signals that a task is high-taste / subjective (hard to measure). */
const TASTE_SIGNALS = [
  /\b(design|motion|animation|visual|feel|polish|aesthetic|beautif|ux feel|identit)\b/i,
  /\b(brand|logo|marketing copy|copywriting|headline)\b/i,
];

/** Signals a task is an architecture decision (expensive to get wrong). */
const ARCH_SIGNALS = [
  /\b(architecture|architectur|data model|schema design|service boundary|refactor.*to|migrat.*(plan|design))\b/i,
  /\b(monolith|microservice|event-driven|event sourcing|database choice|tech stack choice)\b/i,
];

/** Signals a task is open-ended / unmeasurable. */
const OPEN_SIGNALS = [
  /\b(improve|make better|modernize|optimize(?!\s*(tests|build|perf\b))|tidy up|clean up|explore)\b/i,
  /\b(would be nice|i'd like to see|as you see fit|up to you)\b/i,
];

/** Signals a task is mechanical/repetitive (great agent fit). */
const MECHANICAL_SIGNALS = [
  /\b(refactor|migrat|upgrade|bump|update|rename|convert)\b/i,
  /\b(fix|bug|test|coverage|lint|deprecat|cleanup|remove dead)\b/i,
  /\b(add (form|table|crud|endpoint|route|page|column|field))\b/i,
];

// ── Pure logic ─────────────────────────────────────────────────────

/**
 * Classify how well a task fits an autonomous agent. Pure.
 * A task is `poor-fit` when it hits taste or architecture signals with
 * strong wording; `risky` when open-ended or weakly taste/architecture;
 * `good-fit` when mechanical/clear or none of the above.
 */
export function classifyMissionFit(task: string): MissionFitVerdict {
  const t = task.trim();
  if (!t) {
    return {
      fit: 'poor-fit',
      reason: 'La mission est vide.',
      suggestion: 'Describe the task with a measurable goal.',
    };
  }

  const taste = TASTE_SIGNALS.some((re) => re.test(t));
  const arch = ARCH_SIGNALS.some((re) => re.test(t));
  const open = OPEN_SIGNALS.some((re) => re.test(t));
  const mech = MECHANICAL_SIGNALS.some((re) => re.test(t));

  if ((taste || arch) && !mech) {
    return {
      fit: 'poor-fit',
      reason: taste
        ? 'High-stakes visual/UX task — generators tend to produce “acceptable,” not “great.”'
        : 'Architecture decision — a mistake here is costly and hard to undo.',
      suggestion: 'Make the decision yourself (or with the manager), then launch the agent on the precise implementation that follows.',
    };
  }

  if (open) {
    return {
      fit: 'risky',
      reason: 'Open-ended goal with no measurable success criteria — the loop has no compass.',
      suggestion: 'Add a concrete acceptance criterion (tests, metric, observable behavior).',
    };
  }

  if (mech) {
    return {
      fit: 'good-fit',
      reason: 'Mechanical/repetitive task with a verifiable result.',
      suggestion: 'Good fit for an agent: verifiable result, isolated increments.',
    };
  }

  return {
    fit: 'good-fit',
    reason: 'Clearly bounded task.',
    suggestion: 'Launch the mission — the judge will verify the result.',
  };
}

/**
 * Recommend a guided workflow when the task is large or vague. Pure.
 * A single-shot mission fits tasks that fit the smart zone; anything with
 * scope markers ("tout", "toutes les", "refactor global", "migrer toute…")
 * should go through the grill → spec → decompose → run → review funnel.
 */
export function recommendGuidedWorkflow(task: string): GuidedWorkflow {
  const t = task.trim().toLowerCase();
  const scopeMarkers = [
    /\b(tout|toutes?|tous|entier|entière|global|complete|complet)\b/,
    /\b(chaque|every|all|entire|full)\b/,
  ];
  const large = scopeMarkers.some((re) => re.test(t));
  const open = OPEN_SIGNALS.some((re) => re.test(t));

  if (!large && !open) {
    return { recommended: false, steps: ['run'], why: 'Mission unitaire — lancez directement.' };
  }

  return {
    recommended: true,
    steps: ['grill', 'spec', 'decompose', 'run', 'review'],
    why: large
      ? 'Broad scope: split it into smart-zone-sized steps (one step = one fresh session).'
      : 'Open-ended goal: plan first to turn assumptions into a measurable specification.',
  };
}
