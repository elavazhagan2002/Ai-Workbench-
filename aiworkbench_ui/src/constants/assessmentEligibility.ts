import type { UseCase, UseCaseDocumentationQualitySummary } from '../types';

export const MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT = 60;

export function getDocumentationQualityScore(
  summary?: UseCaseDocumentationQualitySummary | null,
): number | null {
  if (!summary || summary.overall_score == null) return null;
  return Math.round(summary.overall_score);
}

export function isAssessmentDocumentationQualityMet(
  summary?: UseCaseDocumentationQualitySummary | null,
): boolean {
  const score = getDocumentationQualityScore(summary);
  return score != null && score >= MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT;
}

export function assessmentDocumentationQualityMessage(
  summary?: UseCaseDocumentationQualitySummary | null,
): string | null {
  const score = getDocumentationQualityScore(summary);
  if (score == null) {
    return `Run AI documentation quality analysis first (minimum ${MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT}% required).`;
  }
  if (score < MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT) {
    return `Documentation quality score must be at least ${MIN_DOCUMENTATION_QUALITY_FOR_ASSESSMENT}% (current: ${score}%).`;
  }
  return null;
}

export function canShowAssessmentOnUseCase(
  hasViewPermission: boolean,
  hasAssessmentPermission: boolean,
): boolean {
  return hasViewPermission || hasAssessmentPermission;
}
