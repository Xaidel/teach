import { createServerFn } from '@tanstack/react-start'

import {
  AddConceptEdgeInputSchema,
  ConceptLanguageSearchSchema,
  DraftConceptsInputSchema,
  RemoveConceptEdgeInputSchema,
  SetConceptStatusInputSchema,
  UpdateConceptInputSchema,
} from './concepts.schema'
import {
  addConceptEdge,
  draftConcepts,
  getConceptReview,
  getUsableConceptGraph,
  removeConceptEdge,
  setConceptStatus,
  updateConcept,
} from './concepts.server'

/** Loads one language's Concept Graph review view for the review route. */
export const getConceptReviewFn = createServerFn({ method: 'GET' })
  .validator(ConceptLanguageSearchSchema)
  .handler(({ data }) => {
    return getConceptReview(data)
  })

/** Drafts a broad initial Concept Graph via the AI Teacher Engine. */
export const draftConceptsFn = createServerFn({ method: 'POST' })
  .validator(DraftConceptsInputSchema)
  .handler(({ data }) => {
    return draftConcepts(data.language)
  })

/** Marks a concept approved (or back to draft) from the review UI. */
export const setConceptStatusFn = createServerFn({ method: 'POST' })
  .validator(SetConceptStatusInputSchema)
  .handler(({ data }) => {
    return setConceptStatus(data)
  })

/** Corrects a concept's slug or difficulty during review. */
export const updateConceptFn = createServerFn({ method: 'POST' })
  .validator(UpdateConceptInputSchema)
  .handler(({ data }) => {
    return updateConcept(data)
  })

/** Adds an edge from a concept to an existing concept during review. */
export const addConceptEdgeFn = createServerFn({ method: 'POST' })
  .validator(AddConceptEdgeInputSchema)
  .handler(({ data }) => {
    return addConceptEdge(data)
  })

/** Removes an edge during review. */
export const removeConceptEdgeFn = createServerFn({ method: 'POST' })
  .validator(RemoveConceptEdgeInputSchema)
  .handler(({ data }) => {
    return removeConceptEdge(data)
  })

/** Loads the Class A/Class B usable projection of one language's graph. */
export const getUsableConceptGraphFn = createServerFn({ method: 'GET' })
  .validator(ConceptLanguageSearchSchema)
  .handler(({ data }) => {
    return getUsableConceptGraph(data)
  })
