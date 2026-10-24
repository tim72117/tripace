import type { IdeaDoc, IdeaGroupId } from './types'
import { PRODUCT_IDEAS } from './product'
import { AI_PLANNING_R1_IDEAS } from './ai-planning-r1'
import { AI_PLANNING_R2_IDEAS } from './ai-planning-r2'
import { AI_PLANNING_VISION_IDEAS } from './ai-planning-vision'
import { DESIGN_DISCUSSION_IDEAS } from './design-discussion'
import { RESEARCH_IDEAS } from './research'
import { AUDIT_IDEAS } from './audit'

export const ALL_IDEAS: IdeaDoc[] = [
  ...PRODUCT_IDEAS,
  ...AI_PLANNING_R1_IDEAS,
  ...AI_PLANNING_R2_IDEAS,
  ...AI_PLANNING_VISION_IDEAS,
  ...DESIGN_DISCUSSION_IDEAS,
  ...RESEARCH_IDEAS,
  ...AUDIT_IDEAS,
]

export function getIdea(id: string): IdeaDoc | undefined {
  return ALL_IDEAS.find((i) => i.id === id)
}

export function ideasOfGroup(group: IdeaGroupId): IdeaDoc[] {
  return ALL_IDEAS.filter((i) => i.group === group).sort((a, b) => a.order - b.order)
}
