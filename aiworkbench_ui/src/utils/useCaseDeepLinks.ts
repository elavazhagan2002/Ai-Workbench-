/** Map notification types / payload to UseCaseEdit tab ids. */

export function sectionFromHashLink(link?: string | null): string | null {
  if (!link) return null;
  const raw = link.replace(/^#/, '');
  const qIndex = raw.indexOf('?');
  if (qIndex < 0) return null;
  return new URLSearchParams(raw.slice(qIndex + 1)).get('section');
}

export function withHashSection(link: string, section: string): string {
  const hadHash = link.startsWith('#');
  const raw = link.replace(/^#/, '');
  const qIndex = raw.indexOf('?');
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const params = qIndex >= 0 ? new URLSearchParams(raw.slice(qIndex + 1)) : new URLSearchParams();
  params.set('section', section);
  const next = `${path}?${params.toString()}`;
  return hadHash || link.startsWith('#') ? `#${next.replace(/^#/, '')}` : next;
}

export function workSectionForNotification(item: {
  type: string;
  link?: string | null;
  payload?: Record<string, unknown>;
}): string | null {
  const payload = item.payload || {};
  const track = typeof payload.track === 'string' ? payload.track.toLowerCase() : '';
  if (track.startsWith('tech')) return 'tech_analysis';
  if (track.startsWith('bus')) return 'business_analysis';

  switch (item.type) {
    case 'comment_added':
      return 'comments';
    case 'risk_assigned':
      return 'risks';
    case 'analysis_assigned':
    case 'analysis_send_back':
    case 'analysis_completed':
      return 'tech_analysis';
    case 'estimate_assigned':
    case 'estimate_reassigned':
    case 'ready_for_estimate':
      return 'estimate';
    case 'estimate_completed':
      return 'roi';
    case 'roi_assigned':
    case 'roi_reassigned':
      return 'roi';
    case 'roi_completed':
      return 'assessment';
    case 'assessment_assigned':
    case 'assessment_reassigned':
    case 'assessment_completed':
      return 'assessment';
    default:
      break;
  }

  if (item.type.includes('estimate')) return 'estimate';
  if (item.type.includes('roi')) return 'roi';
  if (item.type.includes('assessment')) return 'assessment';
  if (item.type.includes('analysis')) return 'tech_analysis';

  const fromLink = sectionFromHashLink(item.link);
  if (fromLink && fromLink !== 'basic') return fromLink;
  return fromLink;
}
