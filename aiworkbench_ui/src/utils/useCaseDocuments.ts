import type { UseCaseDocument } from '../types';

export function isTechnicalAnalysisDocument(doc: Pick<UseCaseDocument, 'source'>): boolean {
  return (doc.source || 'reference') === 'technical_analysis';
}

export function isResourceManagementDocument(doc: Pick<UseCaseDocument, 'source' | 'file_name'>): boolean {
  if (doc.file_name?.toUpperCase().startsWith('INFOGRAPHIC__')) return false;
  return !isTechnicalAnalysisDocument(doc);
}
