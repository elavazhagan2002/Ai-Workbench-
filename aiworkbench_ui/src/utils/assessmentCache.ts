import type { UseCaseAssessment, UseCaseAssessmentHistoryEntry } from '../types';

type CachedAssessment = {
  assessment: UseCaseAssessment | null;
  fetchedAt: number;
};

const cache = new Map<string, CachedAssessment>();

export function getCachedAssessment(useCaseId: string): UseCaseAssessment | null | undefined {
  const entry = cache.get(useCaseId);
  if (!entry) return undefined;
  return entry.assessment;
}

export function setCachedAssessment(useCaseId: string, assessment: UseCaseAssessment | null): void {
  cache.set(useCaseId, { assessment, fetchedAt: Date.now() });
}

export function invalidateAssessmentCache(useCaseId: string): void {
  cache.delete(useCaseId);
}

export function mergeAssessmentHistory(
  useCaseId: string,
  history: UseCaseAssessmentHistoryEntry[],
  participants: UseCaseAssessment['participants'],
): UseCaseAssessment | null | undefined {
  const entry = cache.get(useCaseId);
  if (!entry?.assessment) return undefined;
  const merged = {
    ...entry.assessment,
    history,
    participants: participants ?? entry.assessment.participants,
  };
  cache.set(useCaseId, { assessment: merged, fetchedAt: entry.fetchedAt });
  return merged;
}
