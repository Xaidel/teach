import type { DraftConceptGraphInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform, building the Concept Graph for one programming language: a structured graph of concepts and their relationships that drives a sequential curriculum (Class A) and on-demand tactical exercises (Class B).

Produce a BROAD initial draft for the requested language — wide topic coverage, not a thin worked-example strand. Cover the language's fundamentals, core type system, memory/ownership model where applicable, standard library highlights, error handling, concurrency, async, traits/interfaces, generics, tooling-adjacent idioms, and the advanced topics an intermediate learner should meet.

Rules:
- A concept's slug is its full dotted natural identifier, prefixed with the language, e.g. "rust.ownership", "rust.async.send", "go.goroutines". Use lowercase letters, digits and underscores; dot-separate hierarchy levels.
- Give every concept a plausible difficulty on a 1-5 scale (1 = foundational, 5 = advanced).
- Prerequisites must form a DAG: never create prerequisite cycles, and never list a concept as its own prerequisite.
- Only reference slugs that exist in your own concepts list.
- Distinguish kinds: "prerequisite" edges point from a concept to another concept that must be learned BEFORE it; "related" edges link concepts that are conceptually adjacent but not ordered.
- Prefer explicit prerequisite edges over related edges — the prerequisite ordering is what powers curriculum sequencing.
- Aim for a substantial, well-connected graph (tens of concepts), with every concept reachable through its prerequisites from the language's entry points.`

const FOCUSED_SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform, filling a single gap in the Concept Graph for one programming language: a Tactical Sprint (Class B) just identified a concept in a learner's pasted snippet that has no match in the existing graph yet, and it must be usable immediately.

Rules:
- Produce EXACTLY ONE concept: the given slug, unchanged — never rename or reinterpret it.
- Give it a plausible difficulty on a 1-5 scale (1 = foundational, 5 = advanced), informed by the given description.
- Return no edges — this is a single ad-hoc concept, not a graph draft; edges are drawn later during normal Concept Graph review.`

/**
 * Builds the chat messages for a draftConceptGraph call. The prompt template
 * lives here, separate from its schema and function (issue #23 contract).
 * `input.focusConcept` set switches to the Class B runtime-gap mode
 * (ADR-0016): a single ad-hoc concept scoped to that one slug, rather than
 * a broad language draft.
 */
export function buildDraftConceptGraphMessages(
  input: DraftConceptGraphInput,
): ChatMessage[] {
  if (input.focusConcept) {
    const { slug, description } = input.focusConcept
    const userPrompt = `Language: ${input.language}
Concept slug (use exactly this slug): ${slug}
Description: ${description}

Draft this one concept for ${input.language}. Respond with a JSON object of the form {"concepts": [{"slug": "${slug}", "difficulty": <1-5>}], "edges": []}.`

    return [
      { role: 'system', content: FOCUSED_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]
  }

  const userPrompt = `Language: ${input.language}

Draft the broad initial Concept Graph for ${input.language}. Respond with a JSON object of the form {"concepts": [{"slug": "<dotted slug>", "difficulty": <1-5>}], "edges": [{"from": "<dotted slug>", "to": "<dotted slug>", "kind": "prerequisite" | "related"}]}.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
