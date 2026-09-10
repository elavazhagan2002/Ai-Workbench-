export interface User {
  user_id: string;
  user_image: string | null;
  user_name: string;
  user_email: string;
  /** Free-text organization label (e.g. department or company). */
  organization?: string | null;
  /** Optional organization type label selected from settings-managed list. */
  organization_type?: string | null;
  role_id: string | null;
  role?: Role;
  permissions?: string[];
  is_active?: boolean;
  registration_status?: 'pending' | 'approved' | 'rejected' | string;
}

export interface OrganizationType {
  org_type_id: string;
  name: string;
  description: string | null;
}

export interface ChecklistAnswerOption {
  label: string;
  penalty_factor: number;
}

export interface AssessmentChecklistItem {
  item_id?: number;
  sno: string;
  assessment_item: string;
  category: string;
  allowed_checklist_items: ChecklistAnswerOption[];
}

export interface RiskClassificationRange {
  level: 'Critical' | 'High' | 'Medium' | 'Low';
  min_score: number;
  max_score: number;
}

export interface AssessmentChecklistArea {
  area_id?: number;
  seq_no: number;
  title: string;
  items: AssessmentChecklistItem[];
}

export interface AssessmentChecklistTemplate {
  template_id: string;
  version_number: number;
  name: string;
  status: 'DRAFT' | 'IN REVIEW' | 'EFFECTIVE' | 'DEPRECATED';
  is_active: boolean;
  source_template_id?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_dt?: string | null;
  modified_by?: string | null;
  modified_dt?: string | null;
  question_count?: number;
  assessment_total_score?: number;
  risk_classification_ranges?: RiskClassificationRange[];
  areas?: AssessmentChecklistArea[];
}

export interface AssessmentParticipant {
  user_id: string;
  user_name: string;
  user_email?: string;
  role: string;
  last_change_dt?: string | null;
}

export interface UseCaseAssessmentResponseRecord {
  response_id?: string;
  template_item_id: number;
  area_id: number;
  sno: string;
  selected_answers: ChecklistAnswerOption[];
  comment?: string | null;
  answered_by?: { user_id: string; user_name: string } | null;
  answered_dt?: string | null;
  last_modified_by?: { user_id: string; user_name: string } | null;
  last_modified_dt?: string | null;
}

export interface UseCaseAssessmentHistoryEntry {
  history_id: string;
  template_item_id: number;
  sno: string;
  selected_answers: ChecklistAnswerOption[];
  comment?: string | null;
  changed_by?: { user_id: string; user_name: string } | null;
  changed_dt?: string | null;
  change_action: string;
}

export interface UseCaseAssessment {
  assessment_id: string;
  use_case_id: string;
  template_id: string;
  template_version_number: number;
  template_name: string;
  template_snapshot: AssessmentChecklistTemplate;
  status: 'IN_PROGRESS' | 'CLOSED';
  initiated_by?: { user_id: string; user_name: string } | null;
  initiated_dt?: string | null;
  closed_by?: { user_id: string; user_name: string } | null;
  closed_dt?: string | null;
  next_review_date?: string | null;
  total_score?: number | null;
  max_score?: number | null;
  risk_classification?: string | null;
  overall_findings?: string | null;
  area_summaries?: Array<{
    area_id: number;
    seq_no: number;
    title: string;
    question_count: number;
    score: number;
    max_score: number;
  }>;
  question_scores?: Array<{
    template_item_id: number;
    sno: string;
    assessment_item: string;
    category: string;
    score: number;
    selected_answers: ChecklistAnswerOption[];
    comment?: string | null;
  }>;
  ai_prefill_applied?: boolean;
  responses: Record<string, UseCaseAssessmentResponseRecord>;
  participants?: AssessmentParticipant[];
  history?: UseCaseAssessmentHistoryEntry[];
  use_case_name?: string;
  technical_owner?: string | null;
  business_owner?: string | null;
}

export interface Role {
  role_id: string;
  role_name: string;
  role_description: string | null;
  permissions?: string[];
}

export interface Permission {
  permission_id: string;
  permission_name: string;
  permission_type?: 'workflow' | 'usecase' | 'portal' | string;
}

export interface Domain {
  domain_id: string;
  domain_short_name: string;
  domain_name: string;
  domain_detail: string | null;
  owner_id?: string | null;
  created_by: string | null;
  created_dt: string;
  modified_by: string | null;
  modified_dt: string;
}

export interface UseCaseLink {
  link_id: number;
  url: string;
  label?: string | null;
}

export interface UseCaseDocument {
  document_id: number;
  file_name: string;
  size_bytes?: number | null;
  uploaded_dt?: string | null;
}

export interface DocumentationQualitySectionScore {
  score: number;
  max_score: number;
  reason: string;
}

export interface DocumentationQualitySectionScoreEntry extends DocumentationQualitySectionScore {
  section?: string;
  section_name?: string;
  name?: string;
  label?: string;
}

export interface UseCaseDocumentationQualitySummary {
  overall_score: number;
  strengths_count: number;
  improvements_count: number;
  status_label: string;
  analyzed_at: string | null;
  is_stale: boolean;
}

export interface UseCaseDocumentationQualityAnalysis {
  overall_score: number;
  section_scores: Record<string, DocumentationQualitySectionScore> | DocumentationQualitySectionScoreEntry[];
  strengths: string[];
  improvement_suggestions: string[];
  documentation_quality_summary?: UseCaseDocumentationQualitySummary | null;
}

export interface UseCase {
  demo_video_path: any;
  use_case_id: string;
  domain_id: string;
  use_case_name: string;
  use_case_title: string | null;
  use_case_description: string | null;
  intended_use?: string | null;
  expected_benefits: string | null;
  department: string | null;
  ai_category: 'P' | 'G' | 'A' | 'S' | null;
  feasibility: 'Yes' | 'No' | 'Yes (Difficult)' | null;
  status: 'New' | 'Analysis' | 'Review' | 'Estimate' | 'ROI' | 'AI Assessment' | 'Approved' | 'Rejected' | 'Development' | 'Testing' | 'Production' | 'Retired';
  intended_audience?: string | null;  // Target users/audience
  target_audience_type?: string[] | null;
  impacted_stakeholders?: string[] | null;
  tags?: string[];  // Multiple tags
  reference_links?: UseCaseLink[];
  documents?: UseCaseDocument[];
  technical_owner?: string | null;  // User ID of technical owner (tech_architect / portal_admin / ai_leader)
  technical_owner_name?: string | null;
  technical_owner_email?: string | null;
  technical_owner_role_name?: string | null;
  business_owner?: string | null;  // User ID of business owner (business_reviewer / ai_leader / domain_owner)
  business_owner_name?: string | null;
  business_owner_email?: string | null;
  solution_design_overview?: string | null;  // Solution design overview
  human_in_loop_strategy?: string | null;
  bias_assessment_performed?: boolean;
  protected_attributes?: string | null;
  balancing_strategy?: string | null;
  rejection_reason?: string | null;  // Required when status is Rejected
  // Analysis assignment
  analysis_assigned_by?: string | null;
  analysis_assigned_by_name?: string | null;
  analysis_assigned_dt?: string | null;
  analysis_due_date?: string | null;
  tech_analysis_completed_dt?: string | null;
  business_analysis_completed_dt?: string | null;
  tech_analysis_rejected_dt?: string | null;
  tech_analysis_rejection_note?: string | null;
  business_analysis_rejected_dt?: string | null;
  business_analysis_rejection_note?: string | null;
  // Business scoring
  frequency_of_task?: string | null;
  current_effort?: string | null;
  user_group_size?: string | null;
  efficiency_impact?: string | null;
  quality_compliance_impact?: string | null;
  user_urgency?: string | null;
  process_impact?: string | null;
  operational_compliance_risk?: string | null;
  // Technical scoring
  tool_complexity?: string | null;
  host_system_capability?: string | null;
  data_privacy_security?: string | null;
  average_rating?: number | null;  // Average of reviewer ratings (1-5)
  created_by: string | null;
  /** Display name of user who initiated this use case (resolved from created_by). */
  created_by_name?: string | null;
  created_dt: string;
  modified_by: string | null;
  modified_dt: string;
  /** True when a demo video is mapped for this use case. */
  has_demo?: boolean;
  documentation_quality_summary?: UseCaseDocumentationQualitySummary | null;
}

export interface UseCaseData {
  data_req_id: number;
  use_case_id: string;
  data_req: string | null;
  data_source: string | null;
  volume: string | null;
  data_classification?: string | null;
  data_owner?: string | null;
  data_usage?: string[] | null;
  is_pii_phi_involved?: boolean;
  dataset_type?: 'Synthetic' | 'Real' | null;
  data_lineage_available?: boolean;
  data_quality_assessed?: boolean;
  data_freshness_confirmed?: boolean;
}

export interface UseCaseRisk {
  risk_id: number;
  use_case_id: string;
  risk_category: 'Operational' | 'Business' | 'Technical' | null;
  risk_title: string | null;
  risk_description: string | null;
  risk_likelihood: 'low' | 'medium' | 'high' | 'critical' | null;
  risk_impact: 'low' | 'medium' | 'high' | 'critical' | null;
  mitigation_strategy: string | null;
  risk_status: 'open' | 'closed';
  risk_closure_comment: string | null;
}

/** Merged risk + review: risk with assignment, mitigation, closure. */
export interface UseCaseRiskReview {
  risk_review_id: number;
  use_case_id: string;
  risk_category: 'Operational' | 'Business' | 'Technical' | null;
  risk_title: string | null;
  risk_description: string | null;
  risk_likelihood: 'low' | 'medium' | 'high' | 'critical' | null;
  risk_impact: 'low' | 'medium' | 'high' | 'critical' | null;
  assigned_to: string | null;
  mitigation_strategy: string | null;
  closure_comment: string | null;
  status: 'open' | 'closed';
}

export interface UseCaseComment {
  comment_id: number;
  use_case_id: string;
  comment_date: string;
  comment_by: string;
  comment: string | null;
  user_name?: string;
  rating?: number | null;  // 1-5 star rating (on comment)
}

export interface AuditLog {
  audit_id: string;
  audit_date: string;
  type: string;
  action: string;
  user_id: string | null;
  user_name?: string | null;
  details: any;
}

export interface SystemConfig {
  config_id: string;
  config_data: {
  system_name?: string;   
    version?: string;   
    dataTable?: {
      rowsPerPage: number;
    };
    llm?: {
      provider: 'Azure' | 'Gemini' | 'OpenAI';
      azure?: {
        apiKey: string;
        endpoint: string;
        deploymentName: string;
        modelVersion?: string;
      };
      gemini?: {
        apiKey: string;
        model: string;
      };
      openai?: {
        apiKey: string;
        model: string;
        organization?: string;
      };
    };
    storage?: {
      type: 'Local' | 'GitHub' | 'AWS S3' | 'Azure Storage';
      local?: {
        folderPath: string;
      };
      github?: {
        repoOwner: string;
        repoName: string;
        branch: string;
        token: string;
      };
      awsS3?: {
        accessKeyId: string;
        secretAccessKey: string;
        region: string;
        bucket: string;
      };
      azureStorage?: {
        accountName: string;
        accountKey: string;
        containerName: string;
      };
    };
    integrations?: {
      airflow?: {
        hostUrl: string;
        username: string;
        password: string;
      };
      mlflow?: {
        hostUrl: string;
        trackingUri?: string;
      };
    };
    theme?: 'dark' | 'light';
  };
}

export interface ContactSupportPayload {
  full_name: string;
  email: string;
  company: string;
  phone: string;
  service_area: string;
  subject: string;
  message: string;
}

export interface ContactSupportResponse {
  success: boolean;
  message: string;
}

export type ViewLayout = 'cards' | 'grid';
