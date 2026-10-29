import type { CaseFact, Hypothesis } from './types.js';
import type { AssessmentResult } from '../integrations/meta/provider.js';
import { isUnknownValue } from './facts.js';
// Citation membership alone cannot establish semantic entailment. Until a
// reviewed claim catalog exists, reduce generated hypotheses to observed issue
// areas. Do not expose unvalidated model-specific prose, parts, prices or odds.
export function groundedIssueAreas(result: AssessmentResult, facts: CaseFact[]): Hypothesis[] {
  const observations = new Set(['problem_description','failure_stage','drain_observation','error_code','display_reading','cooling_scope','sound_observation','leak_observation','load_observation']);
  const ids = new Set(facts.filter(f => observations.has(f.key) && !isUnknownValue(f.value)).map(f => f.id));
  const category = facts.find(f => f.key === 'appliance_category')?.value;
  const area = ({washer:'Washer complaint',washing_machine:'Washer complaint',refrigerator:'Cooling complaint',freezer:'Cooling complaint',dishwasher:'Dishwasher complaint'} as Record<string,string>)[String(category)] ?? 'Appliance complaint';
  const supporting = [...new Set(result.hypotheses.flatMap(h=>h.supportingFactIds).filter(id=>ids.has(id)))];
  if (!supporting.length) return [];
  return [{ issueArea: `${area} — cause requires technician diagnosis`, priority:'primary', evidenceStrength:'limited',
    supportingFactIds:supporting,contradictingFactIds:[],sourceChunkIds:[],
    limitations:['General intake issue area only. No model-specific cause or failed component has been verified. Sources below support intake preparation, not a diagnosis.'] }];
}
