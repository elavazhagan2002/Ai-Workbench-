/**
 * API Client for AI Governance Workbench
 * 
 * Authentication:
 * - Client credentials: JWT token in Authorization header (for all API calls)
 * - User sessions: HTTP-only cookies (automatically handled by browser)
 */
import { AI_SERVICES_UNAVAILABLE_MESSAGE } from '../utils/aiUserMessage';
import { logger } from '../utils/logger';
import type {
  ContactSupportPayload,
  ContactSupportResponse,
  DocumentType,
  SystemConfig,
  OrganizationType,
  Role,
  Permission,
  Domain,
  UseCase,
  UseCaseDocument,
  DocumentationQualitySectionScore,
  DocumentationQualitySectionScoreEntry,
  UseCaseDocumentationQualityAnalysis,
  UseCaseDocumentationQualitySummary,
  User,
} from '../types';
// In dev, use /api (Vite proxy) so requests are same-origin and session cookies work
// IMPORTANT: For session cookies to work, we MUST use the proxy (/api) in dev mode
// Direct requests to http://localhost:8000/api won't send cookies due to SameSite restrictions
const API_BASE_URL = import.meta.env.DEV 
  ? '/api'  // Always use proxy in dev mode for cookies to work
  : (import.meta.env.VITE_API_URL || 'http://localhost:8000/api');

// Client credentials for frontend authentication.
// In dev, fallback so app works without .env; in production build, VITE_CLIENT_SECRET must be set.
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID || 'ai-workbench-frontend';
const CLIENT_SECRET = import.meta.env.VITE_CLIENT_SECRET
  ?? (import.meta.env.DEV ? 'ai-workbench' : undefined);

interface JWTToken {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number; // Timestamp when access token expires
  refresh_expires_at: number; // Timestamp when refresh token expires
}

export type PasswordStrength = 'weak' | 'medium' | 'strong';
export type UsernameAvailabilityCode = 'AVAILABLE' | 'TAKEN' | 'REQUIRED' | 'TOO_SHORT' | 'TOO_LONG';

export interface UsernameAvailabilityResult {
  username?: string;
  available: boolean | null;
  valid: boolean;
  code?: UsernameAvailabilityCode;
  message?: string;
}

export interface PasswordPolicyChecks {
  minLength: boolean | null;
  uppercase: boolean | null;
  lowercase: boolean | null;
  number: boolean | null;
  special: boolean | null;
}

export interface PasswordValidationResult {
  valid: boolean;
  strength: PasswordStrength | null;
  score: number | null;
  checks: PasswordPolicyChecks;
  message?: string;
  errors: string[];
  feedback: string[];
}

export interface LoginSuccessResponse {
  status: 'LOGIN_SUCCESS';
  user: User;
  message?: string;
  totp_setup_suggested?: boolean;
}

export type LoginMfaMethod = 'email_passcode' | 'totp';

export interface LoginMfaRequiredResponse {
  status: 'MFA_REQUIRED';
  message?: string;
  challenge_id: string;
  method: LoginMfaMethod;
  methods?: LoginMfaMethod[];
  default_method?: LoginMfaMethod;
}

export type SignInResponse = LoginSuccessResponse | LoginMfaRequiredResponse;

export interface TotpSetupResponse {
  secret: string;
  otpauth_url: string;
  qr_data_uri: string;
  issuer?: string;
}

export interface TotpActionResponse {
  message?: string;
  totp_enabled: boolean;
  user: User;
}

export interface SwitchLoginMfaMethodResponse {
  message?: string;
  method: LoginMfaMethod;
  methods: LoginMfaMethod[];
  challenge_id: string;
}

export interface ForgotPasswordResponse {
  message?: string;
}

export interface VerifyForgotPasswordPasscodeResponse {
  message?: string;
  reset_token: string;
  expires_in: number;
}

export interface ResetPasswordResponse {
  message?: string;
}

export interface ChangePasswordResponse {
  message?: string;
}

export interface BlogPost {
  blog_post_id: string;
  title: string;
  kind: string;
  content_format: string;
  published: boolean;
  published_at: string | null;
  summary: string | null;
  created_by: string | null;
  created_dt: string;
  modified_dt: string;
}

export type UiNavigationAction = 'domain_opened' | 'use_cases_opened' | 'blog_post_opened';

export interface UiNavigationEventPayload {
  action: UiNavigationAction;
  domain_id?: string;
  domain_name?: string;
  domain_short_name?: string;
  blog_post_id?: string;
  blog_title?: string;
  blog_kind?: string;
}

export interface UseCaseDocumentPreview {
  preview_available: boolean;
  document_type?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
  preview_url?: string | null;
  html_content?: string | null;
  content_base64?: string | null;
  message?: string | null;
  detail?: string | null;
  blob?: Blob | null;
  raw?: Record<string, unknown>;
}

export type UseCaseEnhancementFieldName =
  | 'description'
  | 'intended_use'
  | 'expected_benefits'
  | 'solution_design_overview'
  | 'risk_description'
  | 'mitigation_strategy';

export interface UseCaseEnhancementContext {
  use_case_name?: string;
  title?: string;
  department?: string;
  domain?: string;
  related_fields?: Record<string, string>;
}

export interface UseCaseEnhancementRequest {
  field_name: UseCaseEnhancementFieldName;
  text: string;
  max_length: number;
  context?: UseCaseEnhancementContext;
}

export interface UseCaseEnhancementResult {
  suggestion: string;
}

function sanitizeUseCaseEnhancementContext(
  context?: UseCaseEnhancementContext
): UseCaseEnhancementContext | undefined {
  if (!context) return undefined;

  const relatedFieldsEntries = Object.entries(context.related_fields ?? {}).filter(([, value]) => {
    return typeof value === 'string' && value.trim().length > 0;
  });

  const sanitizedContext: UseCaseEnhancementContext = {};
  const contextEntries = Object.entries(context).filter(([key, value]) => {
    if (key === 'related_fields') return false;
    return typeof value === 'string' && value.trim().length > 0;
  });

  for (const [key, value] of contextEntries) {
    sanitizedContext[key as keyof Omit<UseCaseEnhancementContext, 'related_fields'>] = value.trim();
  }

  if (relatedFieldsEntries.length > 0) {
    sanitizedContext.related_fields = Object.fromEntries(
      relatedFieldsEntries.map(([key, value]) => [key, value.trim()])
    );
  }

  return Object.keys(sanitizedContext).length > 0 ? sanitizedContext : undefined;
}
function sanitizeUseCaseEnhancementSuggestion(value: string): string {
  let suggestion = value.trim();

  suggestion = suggestion.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const leadingLabelPatterns = [
    /^(?:ai\s+)?suggestion\s*:\s*/i,
    /^(?:improved|enhanced|revised|refined|updated|suggested)\s+(?:field\s+)?text\s*:\s*/i,
    /^(?:improved|enhanced|revised|refined|updated)\s+(?:benefits?|description|content|version)\s*:\s*/i,
  ];

  for (const pattern of leadingLabelPatterns) {
    suggestion = suggestion.replace(pattern, '').trim();
  }

  return suggestion;
}
function extractUseCaseEnhancementSuggestion(payload: unknown, fallbackText: string): string {
  if (typeof payload === 'string' && payload.trim()) {
    return sanitizeUseCaseEnhancementSuggestion(payload);
  }

  if (payload && typeof payload === 'object') {
    const candidateKeys = [
      'suggestion',
      'suggestion_text',
      'enhanced_text',
      'text',
      'content',
      'result',
    ] as const;

    for (const key of candidateKeys) {
      const candidate = (payload as Record<string, unknown>)[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return sanitizeUseCaseEnhancementSuggestion(candidate);
      }
    }
  }

  if (fallbackText.trim()) {
    return sanitizeUseCaseEnhancementSuggestion(fallbackText);
  }

  return '';
}

function dedupeMessages(messages: string[]): string[] {
  return Array.from(new Set(messages.map((message) => message.trim()).filter(Boolean)));
}

function formatApiErrorLocation(value: unknown): string {
  if (!Array.isArray(value)) return '';

  return value
    .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    .map((part) => String(part).trim())
    .filter(Boolean)
    .filter((part) => part !== 'body' && part !== 'query' && part !== 'path')
    .join('.');
}

function collectApiErrorMessages(payload: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(payload)) {
    return dedupeMessages(payload.flatMap((item) => collectApiErrorMessages(item, seen)));
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (seen.has(payload as object)) {
    return [];
  }
  seen.add(payload as object);

  const record = payload as Record<string, unknown>;
  const msg = typeof record.msg === 'string' ? record.msg.trim() : '';
  if (msg) {
    const location = formatApiErrorLocation(record.loc);
    return [location ? `${location}: ${msg}` : msg];
  }

  const preferredKeys = ['detail', 'message', 'error', 'reason'] as const;
  const preferredMessages = dedupeMessages(
    preferredKeys.flatMap((key) => collectApiErrorMessages(record[key], seen))
  );
  if (preferredMessages.length > 0) {
    return preferredMessages;
  }

  return dedupeMessages(
    Object.entries(record)
      .filter(([key]) => key !== 'loc' && key !== 'type' && key !== 'ctx')
      .flatMap(([, value]) => collectApiErrorMessages(value, seen))
  );
}

function extractApiErrorMessage(payload: unknown, fallbackText: string): string {
  const messages = collectApiErrorMessages(payload);
  if (messages.length > 0) {
    return messages.join('; ');
  }

  if (fallbackText.trim()) {
    return fallbackText.trim();
  }

  return '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\r?\n+/)
      .map((item) => item.replace(/^[\s\-*]+/, '').trim())
      .filter(Boolean);
  }

  return [];
}

function readBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'available', 'valid', 'passed'].includes(normalized)) return true;
    if (['false', 'no', '0', 'taken', 'invalid', 'failed'].includes(normalized)) return false;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return null;
}

function readRecordBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = readBooleanValue(record[key]);
    if (value !== null) return value;
  }

  return null;
}

function readRecordString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
}

function normalizeUsernameAvailabilityCode(value: unknown): UsernameAvailabilityCode | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toUpperCase();
  if (
    normalized === 'AVAILABLE' ||
    normalized === 'TAKEN' ||
    normalized === 'REQUIRED' ||
    normalized === 'TOO_SHORT' ||
    normalized === 'TOO_LONG'
  ) {
    return normalized;
  }

  return undefined;
}

function normalizePasswordStrength(value: unknown): PasswordStrength | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized.includes('strong')) return 'strong';
    if (normalized.includes('medium') || normalized.includes('moderate')) return 'medium';
    if (normalized.includes('weak')) return 'weak';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 3) return 'strong';
    if (value >= 2) return 'medium';
    if (value >= 0) return 'weak';
  }

  return null;
}

function normalizePasswordFeedback(value: unknown): string[] {
  const directFeedback = normalizeStringArray(value);
  if (directFeedback.length > 0) return directFeedback;

  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  return dedupeMessages([
    ...normalizeStringArray(record.warning),
    ...normalizeStringArray(record.suggestions),
    ...normalizeStringArray(record.messages),
  ]);
}

function readPasswordRuleCheck(record: Record<string, unknown>, keys: string[]): boolean | null {
  const directValue = readRecordBoolean(record, keys);
  if (directValue !== null) return directValue;

  const checks = record.checks || record.rules || record.requirements || record.policy || record.validation;
  if (checks && typeof checks === 'object') {
    return readRecordBoolean(checks as Record<string, unknown>, keys);
  }

  return null;
}

function normalizeUsernameAvailabilityResult(value: unknown): UsernameAvailabilityResult {
  if (!value || typeof value !== 'object') {
    return { available: null, valid: false };
  }

  const payload = value as Record<string, unknown>;
  const code = normalizeUsernameAvailabilityCode(payload.code ?? payload.status);
  const username = readRecordString(payload, ['username', 'user_name']);
  const exists = readRecordBoolean(payload, ['exists', 'username_exists', 'is_taken', 'taken']);
  const available =
    readRecordBoolean(payload, ['available', 'is_available', 'username_available']) ??
    (code === 'AVAILABLE' ? true : code === 'TAKEN' ? false : null) ??
    (exists === null ? null : !exists);
  const valid =
    readRecordBoolean(payload, ['valid', 'is_valid', 'valid_username', 'username_valid']) ??
    (code ? !['REQUIRED', 'TOO_SHORT', 'TOO_LONG'].includes(code) : null) ??
    (available !== null);
  const message = readRecordString(payload, ['message', 'detail', 'error', 'reason']);

  return { username, available, valid, code, message };
}

function normalizePasswordValidationResult(value: unknown): PasswordValidationResult {
  const emptyChecks: PasswordPolicyChecks = {
    minLength: null,
    uppercase: null,
    lowercase: null,
    number: null,
    special: null,
  };

  if (!value || typeof value !== 'object') {
    return { valid: false, strength: null, score: null, checks: emptyChecks, errors: [], feedback: [] };
  }

  const payload = value as Record<string, unknown>;
  const checks: PasswordPolicyChecks = {
    minLength: readPasswordRuleCheck(payload, ['min_length', 'minLength', 'minimum_length', 'has_min_length', 'length']),
    uppercase: readPasswordRuleCheck(payload, ['uppercase', 'has_uppercase', 'upper_case']),
    lowercase: readPasswordRuleCheck(payload, ['lowercase', 'has_lowercase', 'lower_case']),
    number: readPasswordRuleCheck(payload, ['number', 'has_number', 'digit', 'has_digit', 'numeric']),
    special: readPasswordRuleCheck(payload, ['special', 'has_special', 'special_character', 'has_special_character', 'symbol']),
  };
  const valid =
    readRecordBoolean(payload, ['valid', 'is_valid', 'meets_policy', 'meets_requirements', 'password_valid']) ??
    Object.values(checks).every((check) => check === true);
  const strength = normalizePasswordStrength(
    payload.strength ?? payload.password_strength ?? payload.score ?? payload.strength_score ?? payload.level
  );
  const score = toFiniteNumber(payload.score ?? payload.strength_score);
  const message = readRecordString(payload, ['message', 'detail', 'error', 'reason']);
  const errors = [
    ...normalizeStringArray(payload.errors),
    ...normalizeStringArray(payload.missing_requirements),
    ...normalizeStringArray(payload.violations),
  ];
  const feedback = dedupeMessages([
    ...normalizePasswordFeedback(payload.feedback),
    ...normalizeStringArray(payload.suggestions),
  ]);

  return { valid, strength, score, checks, message, errors, feedback };
}

function buildLocalPasswordValidationResult(password: string): PasswordValidationResult {
  const checks: PasswordPolicyChecks = {
    minLength: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const errors = [
    checks.minLength ? '' : 'Password must be at least 8 characters',
    checks.uppercase ? '' : 'Password must contain at least one uppercase letter',
    checks.lowercase ? '' : 'Password must contain at least one lowercase letter',
    checks.number ? '' : 'Password must contain at least one number',
    checks.special ? '' : 'Password must contain at least one special character',
  ].filter(Boolean);
  const passedCount = Object.values(checks).filter(Boolean).length;
  const valid = errors.length === 0;

  return {
    valid,
    strength: valid ? (password.length >= 12 ? 'strong' : 'medium') : 'weak',
    score: passedCount,
    checks,
    errors,
    feedback: [],
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeDocumentationQualitySummary(value: unknown): UseCaseDocumentationQualitySummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Record<string, unknown>;

  return {
    overall_score: toFiniteNumber(payload.overall_score) ?? 0,
    strengths_count: toFiniteNumber(payload.strengths_count) ?? 0,
    improvements_count: toFiniteNumber(payload.improvements_count) ?? 0,
    status_label:
      typeof payload.status_label === 'string' && payload.status_label.trim()
        ? payload.status_label.trim()
        : 'Not analyzed',
    analyzed_at:
      typeof payload.analyzed_at === 'string' && payload.analyzed_at.trim()
        ? payload.analyzed_at
        : null,
    is_stale: typeof payload.is_stale === 'boolean' ? payload.is_stale : Boolean(payload.is_stale),
  };
}

function normalizeDocumentationQualitySectionScores(
  value: unknown
): UseCaseDocumentationQualityAnalysis['section_scores'] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is DocumentationQualitySectionScoreEntry => {
      return Boolean(entry) && typeof entry === 'object';
    });
  }

  if (value && typeof value === 'object') {
    return value as Record<string, DocumentationQualitySectionScore>;
  }

  return {};
}

function normalizeDocumentationQualityAnalysis(payloadBody: unknown): UseCaseDocumentationQualityAnalysis {
  if (!payloadBody || typeof payloadBody !== 'object') {
    throw new Error('AI documentation analysis returned an unexpected response.');
  }

  const payload = payloadBody as Record<string, unknown>;

  return {
    overall_score: toFiniteNumber(payload.overall_score) ?? 0,
    section_scores: normalizeDocumentationQualitySectionScores(payload.section_scores),
    strengths: normalizeStringArray(payload.strengths),
    improvement_suggestions: normalizeStringArray(payload.improvement_suggestions),
    documentation_quality_summary: normalizeDocumentationQualitySummary(payload.documentation_quality_summary),
  };
}

class ApiClient {
  private baseUrl: string;
  private jwtToken: JWTToken | null = null;
  private initPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private onSessionExpired: (() => void) | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Load token from storage if available
    this.loadTokenFromStorage();
    // Initialize client authentication on creation if no valid token
    this.initializeClientAuth();
  }

  /**
   * Set callback for when session expires (401 errors on user endpoints)
   */
  setSessionExpiredHandler(handler: () => void) {
    this.onSessionExpired = handler;
  }

  /**
   * Load JWT token from storage
   */
  private loadTokenFromStorage(): void {
    const storedToken = sessionStorage.getItem('jwt_token');
    if (storedToken) {
      try {
        const token: JWTToken = JSON.parse(storedToken);
        // Check if access token is still valid
        if (token.expires_at && Date.now() < token.expires_at) {
          this.jwtToken = token;
          return;
        }
        
        if (token.refresh_expires_at && Date.now() < token.refresh_expires_at) {
          this.jwtToken = token;
          return;
        }
        
        sessionStorage.removeItem('jwt_token');
      } catch (e) {
      
        sessionStorage.removeItem('jwt_token');
      }
    }
  }

  /**
   * Save JWT token to stor age
   */
  private saveTokenToStorage(token: JWTToken): void {
    this.jwtToken = token;
    sessionStorage.setItem('jwt_token', JSON.stringify(token));
  }

  /**
   * Initialize client credentials authentication (handshake)
   */
  private async initializeClientAuth(): Promise<void> {
    // If we have a valid token, no need to authenticate
    if (this.jwtToken && this.jwtToken.expires_at && Date.now() < this.jwtToken.expires_at) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.performClientAuthInit().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  private async performClientAuthInit(): Promise<void> {
    // If refresh token is valid, try to refresh first
    if (this.jwtToken && this.jwtToken.refresh_expires_at && Date.now() < this.jwtToken.refresh_expires_at) {
      try {
        await this.refreshAccessToken();
        return;
      } catch (error) {
        logger.debug('Failed to refresh token, will authenticate', error);
      }
    }

    // Perform handshake
    try {
      await this.authenticateClient();
    } catch (error) {
      logger.error('Failed to initialize client authentication', error);
    }
  }

  /**
   * Authenticate with client credentials (handshake)
   */
  private async authenticateClient(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/client-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(extractApiErrorMessage(error, `Client authentication failed: ${response.status}`));
    }

    const data = await response.json();
    const token: JWTToken = {
      ...data,
      expires_at: Date.now() + (data.expires_in * 1000),
      refresh_expires_at: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days for refresh token
    };
    
    this.saveTokenToStorage(token);
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    // If already refreshing, wait for that promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.jwtToken || !this.jwtToken.refresh_token) {
      throw new Error('No refresh token available');
    }

    // Check if refresh token is still valid
    if (this.jwtToken.refresh_expires_at && Date.now() >= this.jwtToken.refresh_expires_at) {
      throw new Error('Refresh token expired');
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            refresh_token: this.jwtToken!.refresh_token,
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          // If refresh fails, clear token and re-authenticate
          sessionStorage.removeItem('jwt_token');
          this.jwtToken = null;
          throw new Error(extractApiErrorMessage(error, `Token refresh failed: ${response.status}`));
        }

        const data = await response.json();
        const token: JWTToken = {
          ...data,
          expires_at: Date.now() + (data.expires_in * 1000),
          refresh_expires_at: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days for refresh token
        };
        
        this.saveTokenToStorage(token);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Get valid JWT access token (with automatic refresh)
   */
  private async getClientToken(): Promise<string> {
    // If we don't have a token, perform handshake
    if (!this.jwtToken) {
      await this.initializeClientAuth();
      if (!this.jwtToken) {
        throw new Error('Client authentication failed. Please refresh the page.');
      }
    }

    // If access token is expired or expiring soon (within 5 minutes), try to refresh
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (!this.jwtToken.expires_at || Date.now() >= this.jwtToken.expires_at - bufferTime) {
      // Check if refresh token is still valid
      if (this.jwtToken.refresh_expires_at && Date.now() < this.jwtToken.refresh_expires_at) {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          logger.error('Failed to refresh token, re-authenticating', error);
          // If refresh fails, try to re-authenticate
          await this.authenticateClient();
        }
      } else {
        // Refresh token expired, re-authenticate
        await this.authenticateClient();
      }
    }

    if (!this.jwtToken || !this.jwtToken.access_token) {
      throw new Error('Client authentication failed. Please refresh the page.');
    }

    return this.jwtToken.access_token;
  }

  /**
   * Make authenticated API request
   * Cookies are automatically sent by the browser for user sessions
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Ensure client token is available
    let token: string;
    try {
      token = await this.getClientToken();
    } catch (error: any) {
      logger.error(`Failed to get client token for request: ${endpoint}`, error);
      throw new Error('Client authentication required. Please refresh the page.');
    }

    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
      credentials: 'include', // Important: Include cookies for session management
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      const errorMessage = extractApiErrorMessage(error, `HTTP error! status: ${response.status}`);
      
      // Handle 401 errors (session expired)
      if (response.status === 401) {
        // Check if this is a user-specific endpoint (not public/auth endpoints)
        const isUserEndpoint = !endpoint.includes('/auth/client-login') && 
                               !endpoint.includes('/auth/refresh') &&
                               !endpoint.includes('/auth/signin') &&
                               !endpoint.includes('/auth/forgot-password') &&
                               !endpoint.includes('/auth/reset-password') &&
                               !endpoint.includes('/auth/change-password');
        
        if (isUserEndpoint && this.onSessionExpired) {
          // Session expired on a user endpoint - clear session
          logger.warn(`Session expired on ${endpoint}, clearing user session`);
          this.onSessionExpired();
        } else {
          // 401 on public/auth endpoints is expected
          logger.debug(`API request returned 401 (expected if not logged in): ${endpoint}`, {
            status: response.status,
            error: errorMessage
          });
        }
      } else {
        // Log other errors as errors
        logger.error(`API request failed: ${endpoint}`, {
          status: response.status,
          statusText: response.statusText,
          error: errorMessage
        });
      }
      
      throw new Error(errorMessage);
    }

    return response.json();
  }

  // Auth endpoints (require client JWT from client-login)

  async signIn(email: string, password: string): Promise<SignInResponse> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const err = await response.json();
        errorDetail = extractApiErrorMessage(err, errorDetail);
      } catch {
        // ignore
      }
      logger.debug('Sign-in failed', { status: response.status, detail: errorDetail });
      throw new Error(errorDetail || `Sign-in failed (${response.status})`);
    }

    const data = await response.json();
    if (data?.status === 'MFA_REQUIRED' && data?.challenge_id) {
      const asMethod = (value: unknown): LoginMfaMethod => (value === 'totp' ? 'totp' : 'email_passcode');
      const methods = Array.isArray(data.methods) && data.methods.length
        ? data.methods.map(asMethod)
        : [asMethod(data.method)];
      return {
        status: 'MFA_REQUIRED',
        challenge_id: data.challenge_id,
        method: asMethod(data.method || data.default_method),
        methods,
        default_method: asMethod(data.default_method || data.method),
        message: data.message,
      };
    }

    if (!data?.user) {
      logger.error('Invalid sign-in response', data);
      throw new Error('Invalid response from server');
    }

    return {
      ...data,
      status: 'LOGIN_SUCCESS',
      user: data.user,
      totp_setup_suggested: Boolean(data.totp_setup_suggested),
    };
  }

  async verifyLoginPasscode(challengeId: string, passcode: string): Promise<LoginSuccessResponse> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/auth/verify-login-passcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ challenge_id: challengeId, passcode }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      const errorDetail = extractApiErrorMessage(error, response.statusText);
      throw new Error(errorDetail || 'Invalid or expired code');
    }

    const data = await response.json();
    if (!data?.user) {
      logger.error('Invalid login passcode verification response', data);
      throw new Error('Invalid response from server');
    }

    return {
      ...data,
      status: 'LOGIN_SUCCESS',
      user: data.user,
      totp_setup_suggested: Boolean(data.totp_setup_suggested),
    };
  }

  async resendLoginPasscode(challengeId: string): Promise<{ message?: string }> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/auth/resend-login-passcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ challenge_id: challengeId }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorDetail = extractApiErrorMessage(body, response.statusText);
      throw new Error(errorDetail || 'Failed to resend code');
    }

    return body as { message?: string };
  }

  async switchLoginMfaMethod(challengeId: string, method: LoginMfaMethod): Promise<SwitchLoginMfaMethodResponse> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/auth/switch-login-mfa-method`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ challenge_id: challengeId, method }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(extractApiErrorMessage(data, response.statusText) || 'Could not switch verification method');
    }
    return data as SwitchLoginMfaMethodResponse;
  }

  async setupTotp(): Promise<TotpSetupResponse> {
    return this.request('/auth/mfa/totp/setup', { method: 'POST', body: JSON.stringify({}) });
  }

  async confirmTotp(passcode: string): Promise<TotpActionResponse> {
    return this.request('/auth/mfa/totp/confirm', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
  }

  async skipTotp(): Promise<TotpActionResponse> {
    return this.request('/auth/mfa/totp/skip', { method: 'POST', body: JSON.stringify({}) });
  }

  async disableTotp(password: string, passcode: string): Promise<TotpActionResponse> {
    return this.request('/auth/mfa/totp/disable', {
      method: 'POST',
      body: JSON.stringify({ password, passcode }),
    });
  }

  async getCurrentUser() {
    return this.request('/auth/user');
  }

  /** Public stats for login page showcase (no auth required). */
async getPublicStats(): Promise<{ domains_count: number; use_cases_count: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/public-stats`);
      if (!response.ok) return { domains_count: 0, use_cases_count: 0 };
      return response.json();
    } catch {
      return { domains_count: 0, use_cases_count: 0 };
    }
  }

  /** Public app summary for contact page. */
  async getPublicAppSummary(): Promise<{
    domains_count: number;
    use_cases_count: number;
    demo_use_cases_count: number;
    status_counts: Record<string, number>;
    domain_summaries: Array<{
      domain_id: string;
      domain_name: string;
      use_cases_count: number;
      demo_count: number;
    }>;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/public/app-summary`);
      if (!response.ok) return {
        domains_count: 0,
        use_cases_count: 0,
        demo_use_cases_count: 0,
        status_counts: {},
        domain_summaries: []
      };
      return response.json();
    } catch {
      return {
        domains_count: 0,
        use_cases_count: 0,
        demo_use_cases_count: 0,
        status_counts: {},
        domain_summaries: []
      };
    }
  }

  /** Public featured use cases showcase. */
  async getPublicFeaturedUseCases(): Promise<Array<{
    use_case_id: string;
    use_case_name: string;
    use_case_title: string;
    status: string;
    has_demo: boolean;
    domain_name: string;
  }>> {
    try {
      const response = await fetch(`${this.baseUrl}/public/featured-use-cases`);
      if (!response.ok) return [];
      return response.json();
    } catch {
      return [];
    }
  }

  /** Public contact support form submission. */
  async submitContactSupportForm(payload: ContactSupportPayload): Promise<ContactSupportResponse> {
    const response = await fetch(`${this.baseUrl}/support/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractApiErrorMessage(body, response.statusText || 'Failed to submit support request.');
      throw new Error(msg);
    }
    return body as ContactSupportResponse;
  }

  /** Public organization types for self-registration form (no auth required). */
  async getPublicOrganizationTypes(): Promise<{ org_type_id: string; name: string }[]> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/public-organization-types`);
      if (!response.ok) return [];
      return response.json();
    } catch {
      return [];
    }
  }

  /** Public domains for anonymous idea submission (no auth required). */
  async getPublicDomains(): Promise<{ domain_id: string; domain_name: string }[]> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/public-domains`);
      if (!response.ok) return [];
      return response.json();
    } catch {
      return [];
    }
  }

  /** Submit an anonymous idea (no auth required; rate limited). */
  async submitAnonymousIdea(data: {
    domain_id: string;
    idea_text: string;
    submitted_by_email?: string;
    submitted_by_organization?: string;
  }): Promise<{ message: string; idea_id: string }> {
    const response = await fetch(`${this.baseUrl}/auth/anonymous-ideas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractApiErrorMessage(body, response.statusText);
      if (response.status === 429) throw new Error('Too many submissions. Please try again later.');
      throw new Error(msg);
    }
    return body as { message: string; idea_id: string };
  }

  /** Self-registration (no auth required; rate limited). Returns message. */
  async selfRegister(data: {
    user_name: string;
    email: string;
    password: string;
    organization: string;
    organization_type: string;
    interested_domain_id: string;
    website?: string;
    form_opened_at?: number;
    turnstile_token?: string;
  }): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/auth/self-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractApiErrorMessage(body, response.statusText);
      if (response.status === 429) throw new Error('Too many registration attempts. Please try again later.');
      throw new Error(msg);
    }
    return body as { message: string };
  }

  /** Check public username availability during self-registration. */
  async checkUsername(username: string, signal?: AbortSignal): Promise<UsernameAvailabilityResult> {
    const response = await fetch(`${this.baseUrl}/auth/check-username?${new URLSearchParams({ username })}`, {
      method: 'GET',
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractApiErrorMessage(body, response.statusText);
      if (response.status === 400 || response.status === 422) {
        const normalized = normalizeUsernameAvailabilityResult(body);
        return {
          ...normalized,
          available: normalized.available ?? false,
          valid: normalized.valid === true ? true : false,
          message: normalized.message || msg || 'Username is invalid',
        };
      }
      throw new Error(msg || 'Failed to validate username');
    }

    return normalizeUsernameAvailabilityResult(body);
  }

  /** Validate password policy and strength during self-registration. */
  async validatePassword(password: string, signal?: AbortSignal): Promise<PasswordValidationResult> {
    const response = await fetch(`${this.baseUrl}/auth/validate-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractApiErrorMessage(body, response.statusText);
      if (response.status === 404) {
        return buildLocalPasswordValidationResult(password);
      }
      if (response.status === 400 || response.status === 422) {
        const normalized = normalizePasswordValidationResult(body);
        return {
          ...normalized,
          valid: false,
          strength: normalized.strength ?? 'weak',
          message: normalized.message || msg || 'Password does not meet policy',
          errors: normalized.errors.length > 0 ? normalized.errors : msg ? [msg] : [],
        };
      }
      throw new Error(msg || 'Failed to validate password');
    }

    return normalizePasswordValidationResult(body);
  }

  /** Resend passcode (no auth required; rate limited). */
  async resendPasscode(email: string): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/auth/resend-passcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),  
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = extractApiErrorMessage(body, response.statusText);
      if (response.status === 429) throw new Error('Too many resend attempts. Please try again later.');
      throw new Error(msg);
    }
    return body as { message: string };
  }

  async updateProfile(updates: { user_name?: string; organization?: string; user_image?: string | null }): Promise<User> {
    return this.request<User>('/auth/user', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async signOut() {
    try {
      await this.request('/auth/signout', {
        method: 'POST',
      });
    } catch (error) {
      logger.error('Sign out error', error);
    } finally {
      // Clear user data (session cookie is cleared by backend)
      sessionStorage.removeItem('userId');
      sessionStorage.removeItem('user');
    }
  }

  // Domain endpoints (use trailing slash to match backend and avoid redirect dropping cookies)
  async getEnterpriseDashboard() {
    return this.request<any>('/dashboard/enterprise');
  }

  async getDomainDashboard(domainId?: string) {
    const q = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : '';
    return this.request<any>(`/dashboard/domain${q}`);
  }

  async getIndividualDashboard() {
    return this.request<any>('/dashboard/individual');
  }

  async getDashboardLevels() {
    return this.request<{ levels: string[] }>('/dashboard/levels');
  }

  async getNotifications(opts?: { limit?: number; unreadOnly?: boolean; filter?: 'all' | 'unread' | 'assignments' | 'updates' }) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.unreadOnly) params.set('unread_only', 'true');
    if (opts?.filter && opts.filter !== 'all') params.set('filter', opts.filter);
    const q = params.toString();
    return this.request<{
      unread_count: number;
      items: Array<{
        notification_id: string;
        type: string;
        title: string;
        message: string;
        severity: string;
        entity_type?: string | null;
        entity_id?: string | null;
        domain_id?: string | null;
        link?: string | null;
        actions: string[];
        payload: Record<string, unknown>;
        is_read: boolean;
        read_dt?: string | null;
        created_dt?: string | null;
        actor_user_id?: string | null;
        actor_name?: string | null;
      }>;
    }>(`/notifications/${q ? `?${q}` : ''}`);
  }

  async getUnreadNotificationCount() {
    return this.request<{ unread_count: number }>('/notifications/unread-count');
  }

  async markNotificationRead(notificationId: string) {
    return this.request<{ notification_id: string; is_read: boolean; unread_count: number }>(
      `/notifications/${notificationId}/read`,
      { method: 'PATCH' }
    );
  }

  async markAllNotificationsRead() {
    return this.request<{ updated: number; unread_count: number }>('/notifications/read-all', {
      method: 'POST',
    });
  }

  async dismissAllNotifications(filter: 'all' | 'unread' | 'assignments' | 'updates' = 'all') {
    const query = new URLSearchParams({ filter }).toString();
    return this.request<{ updated: number; unread_count: number }>(
      `/notifications/dismiss-all?${query}`,
      { method: 'POST' }
    );
  }

  async dismissNotification(notificationId: string) {
    return this.request<{ notification_id: string; dismissed: boolean; unread_count: number }>(
      `/notifications/${notificationId}/dismiss`,
      { method: 'POST' }
    );
  }

  async getDomains(): Promise<Domain[]> {
    return this.request<Domain[]>('/domains/');
  }

  async createDomain(domainData: { domain_short_name: string; domain_name: string; domain_detail?: string; owner_id?: string | null }) {
    return this.request('/domains/', {
      method: 'POST',
      body: JSON.stringify(domainData),
    });
  }

  async getDomain(domainId: string): Promise<Domain> {
    return this.request<Domain>(`/domains/${domainId}`);
  }

  async updateDomain(domainId: string, domainData: { domain_short_name?: string; domain_name?: string; domain_detail?: string; owner_id?: string | null }) {
    return this.request(`/domains/${domainId}`, {
      method: 'PUT',
      body: JSON.stringify(domainData),
    });
  }

  /** Users who can be set as domain owner (have domain_owner permission). */
  async getEligibleDomainOwners() {
    return this.request<{ user_id: string; user_name: string; user_email: string }[]>('/domains/eligible-owners');
  }

  /** Users who can be assigned to a domain (have domain_access permission). */
  async getEligibleDomainAccessUsers() {
    return this.request<{ user_id: string; user_name: string; user_email: string }[]>('/domains/eligible-access-users');
  }

  /** Users assigned to this domain. */
  async getDomainAccess(domainId: string) {
    return this.request<{ user_id: string; user_name: string; user_email: string }[]>(`/domains/${domainId}/access`);
  }

  async addDomainAccess(domainId: string, userId: string) {
    return this.request(`/domains/${domainId}/access`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async removeDomainAccess(domainId: string, userId: string) {
    return this.request(`/domains/${domainId}/access/${userId}`, {
      method: 'DELETE',
    });
  }

  async getUserAssignedDomains(userId: string): Promise<Domain[]> {
    const response = await this.request<Domain[] | { domains?: Domain[]; assigned_domains?: Domain[] }>(
      `/settings/users/${userId}/domains`
    );
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.domains)) return response.domains;
    if (Array.isArray(response?.assigned_domains)) return response.assigned_domains;
    return [];
  }

  async assignDomainToUser(domainId: string, userId: string) {
    return this.addDomainAccess(domainId, userId);
  }

  async removeDomainFromUser(domainId: string, userId: string) {
    return this.removeDomainAccess(domainId, userId);
  }

  async deleteDomain(domainId: string) {
    return this.request(`/domains/${domainId}`, {
      method: 'DELETE',
    });
  }

  // Use Case endpoints
  async getUseCases(domainId: string): Promise<UseCase[]> {
    return this.request<UseCase[]>(`/use-cases/domain/${domainId}`);
  }

  async getUseCase(useCaseId: string): Promise<UseCase> {
    return this.request<UseCase>(`/use-cases/${useCaseId}`);
  }

  /** Audit logs for this use case only. Requires case_view + domain access (no audit_access). */
  async getUseCaseAuditLogs(useCaseId: string) {
    return this.request<{ audit_id: string; audit_date: string; type: string; action: string; user_id?: string; details?: any; user_name?: string }[]>(`/use-cases/${useCaseId}/audit-logs`);
  }

  /** List reference documents for a use case. */
  async getUseCaseDocuments(useCaseId: string) {
    return this.request<UseCaseDocument[]>(`/use-cases/${useCaseId}/documents`);
  }

  async getDocumentTypes(): Promise<DocumentType[]> {
    return this.request<DocumentType[]>('/use-cases/document-types');
  }

  /** Upload reference documents. Uses multipart/form-data. */
  async uploadUseCaseDocuments(
    useCaseId: string,
    files: File[],
    options?: { documentType?: string; source?: string }
  ) {
    const token = await this.getClientToken();
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    if (options?.documentType) formData.append('document_type', options.documentType);
    if (options?.source) formData.append('source', options.source);
    const response = await fetch(`${this.baseUrl}/use-cases/${useCaseId}/documents`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      const detail = err.detail;
      const message = Array.isArray(detail) ? detail.map((item: { msg?: string }) => item.msg || '').join(' ') : detail;
      throw new Error(message || `Upload failed: ${response.status}`);
    }
    return response.json();
  }

  /** Delete a reference document. */
  async deleteUseCaseDocument(useCaseId: string, documentId: number) {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/use-cases/${useCaseId}/documents/${documentId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Delete failed: ${response.status}`);
    }
  }

  /** Download a reference document (returns blob and filename for save). */
  async downloadUseCaseDocument(useCaseId: string, documentId: number, fileName?: string): Promise<{ blob: Blob; fileName: string }> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/use-cases/${useCaseId}/documents/${documentId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    if (!response.ok) throw new Error(response.statusText || 'Download failed');
    const blob = await response.blob();
    const disp = response.headers.get('Content-Disposition');
    const match = disp && /filename="?([^";]+)"?/.exec(disp);
    const name = fileName || (match ? match[1] : 'document');
    return { blob, fileName: name };
  }

  /** Preview a reference document for in-app viewing. */
  async previewUseCaseDocument(useCaseId: string, documentId: number): Promise<UseCaseDocumentPreview> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/use-cases/${useCaseId}/documents/${documentId}/preview`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, application/pdf, text/html, image/*',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null) as { detail?: string; message?: string } | null;
      const fallbackMessage = await response.text().catch(() => '');
      const errorMessage =
        errJson?.detail ||
        errJson?.message ||
        fallbackMessage ||
        response.statusText ||
        `Preview failed: ${response.status}`;
      throw new Error(errorMessage);
    }

    const responseContentType = (response.headers.get('Content-Type') || '').toLowerCase();
    if (responseContentType.includes('application/json')) {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

      const previewAvailable = typeof payload.preview_available === 'boolean'
        ? payload.preview_available
        : true;

      return {
        preview_available: previewAvailable,
        document_type:
          (typeof payload.document_type === 'string' && payload.document_type) ||
          (typeof payload.file_type === 'string' && payload.file_type) ||
          (typeof payload.type === 'string' && payload.type) ||
          null,
        mime_type:
          (typeof payload.mime_type === 'string' && payload.mime_type) ||
          (typeof payload.content_type === 'string' && payload.content_type) ||
          null,
        file_name:
          (typeof payload.file_name === 'string' && payload.file_name) ||
          (typeof payload.filename === 'string' && payload.filename) ||
          null,
        preview_url:
          (typeof payload.preview_url === 'string' && payload.preview_url) ||
          (typeof payload.url === 'string' && payload.url) ||
          (typeof payload.previewUrl === 'string' && payload.previewUrl) ||
          null,
        html_content:
          (typeof payload.html_content === 'string' && payload.html_content) ||
          (typeof payload.preview_html === 'string' && payload.preview_html) ||
          (typeof payload.html === 'string' && payload.html) ||
          (typeof payload.srcdoc === 'string' && payload.srcdoc) ||
          null,
        content_base64:
          (typeof payload.content_base64 === 'string' && payload.content_base64) ||
          (typeof payload.base64_content === 'string' && payload.base64_content) ||
          null,
        message:
          (typeof payload.message === 'string' && payload.message) ||
          (typeof payload.reason === 'string' && payload.reason) ||
          null,
        detail: typeof payload.detail === 'string' ? payload.detail : null,
        raw: payload,
      };
    }

    const blob = await response.blob();
    const mimeType = blob.type || responseContentType || null;

    return {
      preview_available: true,
      mime_type: mimeType,
      blob,
    };
  }

  /** Upload or replace demo video (.mp4) for a use case. */
  async uploadUseCaseDemo(useCaseId: string, file: File) {
    const token = await this.getClientToken();
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${this.baseUrl}/use-cases/${useCaseId}/demo`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Upload failed: ${response.status}`);
    }
    return response.json() as Promise<{ use_case_id: string; has_demo: boolean }>;
  }

  /** Delink the mapped demo video association from a use case (does not delete library file). */
  async deleteUseCaseDemo(useCaseId: string) {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/use-cases/${useCaseId}/demo`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Delete failed: ${response.status}`);
    }

    if (response.status === 204) {
      return { use_case_id: useCaseId, has_demo: false, demo_video_path: null };
    }

    const data = await response.json().catch(() => null) as {
      use_case_id?: string;
      has_demo?: boolean;
      demo_video_path?: string | null;
    } | null;

    return {
      use_case_id: data?.use_case_id ?? useCaseId,
      has_demo: data?.has_demo ?? false,
      demo_video_path: data?.demo_video_path ?? null,
    };
  }

  /** List available demo videos (from DEMO_VIDEOS_ROOT). */
  async getDemoVideos() {
    // Use a nested path segment so it doesn't collide with /use-cases/{use_case_id}
    return this.request<{ path: string; name: string; size_bytes?: number }[]>('/use-cases/demo/videos');
  }

  /** Map an existing demo video (by relative path) to a use case. */
  async mapUseCaseDemo(useCaseId: string, demoPath: string) {
    return this.request<{ use_case_id: string; has_demo: boolean }>(`/use-cases/${useCaseId}/demo/map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demo_path: demoPath }),
    });
  }

  /** Get the streaming URL for a use case demo video. */
  getUseCaseDemoUrl(useCaseId: string): string {
    // Always use /api prefix; Nginx/Vite proxy will handle routing in dev and prod.
    return `/api/use-cases/${useCaseId}/demo`;
  }

  /** Score draft registration fields (create-time quality). */
  async draftUseCaseQuality(payload: {
    title: string;
    department: string;
    description: string;
    expected_benefits: string;
    intended_use?: string | null;
  }): Promise<{
    overall_score: number;
    status_label: string;
    fields: Array<{ field_name: string; score: number; feedback: string }>;
    improvement_suggestions: string[];
  }> {
    let token: string;
    try {
      token = await this.getClientToken();
    } catch (error: unknown) {
      logger.error('Failed to get client token for draft quality request', error);
      throw new Error('Client authentication required. Please refresh the page.');
    }

    const response = await fetch(`${this.baseUrl}/v1/ai/draft-usecase-quality`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const rawText = await response.text().catch(() => '');
    let body: any = {};
    if (rawText) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { detail: rawText };
      }
    }
    if (!response.ok) {
      throw new Error(
        (typeof body?.detail === 'string' && body.detail) ||
          AI_SERVICES_UNAVAILABLE_MESSAGE
      );
    }
    return body;
  }

  /** Enhance a supported use case field and return suggestion text without saving it. */
  async enhanceUseCaseField(payload: UseCaseEnhancementRequest): Promise<UseCaseEnhancementResult> {
    let token: string;
    try {
      token = await this.getClientToken();
    } catch (error: any) {
      logger.error('Failed to get client token for AI enhance request', error);
      throw new Error('Client authentication required. Please refresh the page.');
    }

    const context = sanitizeUseCaseEnhancementContext(payload.context);
    const requestBody = {
      field_name: payload.field_name,
      text: payload.text,
      max_length: payload.max_length,
      ...(context ? { context } : {}),
    };

    const response = await fetch(`${this.baseUrl}/v1/ai/enhance-usecase-field`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(requestBody),
    });

    const rawText = await response.text().catch(() => '');
    let payloadBody: unknown = rawText;

    if (rawText) {
      try {
        payloadBody = JSON.parse(rawText) as unknown;
      } catch {
        payloadBody = rawText;
      }
    }

    if (!response.ok) {
      const payloadErrorMessage = payloadBody && typeof payloadBody === 'object'
        ? (
            (typeof (payloadBody as { detail?: unknown }).detail === 'string' && (payloadBody as { detail: string }).detail) ||
            (typeof (payloadBody as { message?: unknown }).message === 'string' && (payloadBody as { message: string }).message) ||
            ''
          )
        : '';

      const errorMessage =
        payloadErrorMessage ||
        rawText ||
        response.statusText ||
        `HTTP error! status: ${response.status}`;

      if (response.status === 401) {
        if (this.onSessionExpired) {
          logger.warn('Session expired on AI enhance request, clearing user session');
          this.onSessionExpired();
        }
        throw new Error('Client authentication required. Please refresh the page.');
      }

      logger.error('AI enhance request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorMessage,
      });

      if (response.status === 403 && errorMessage.startsWith('You do not have permission')) {
        throw new Error(errorMessage);
      }

      throw new Error(AI_SERVICES_UNAVAILABLE_MESSAGE);
    }

    const suggestion = extractUseCaseEnhancementSuggestion(payloadBody, rawText);
    if (!suggestion) {
      throw new Error('AI returned an empty suggestion. Please try again.');
    }

    return { suggestion };
  }

  private async requestUseCaseDocumentationQuality(
    useCaseId: string,
    method: 'GET' | 'POST',
    allowMissing: boolean = false,
  ): Promise<UseCaseDocumentationQualityAnalysis | null> {
    let token: string;
    try {
      token = await this.getClientToken();
    } catch (error: unknown) {
      logger.error('Failed to get client token for documentation quality request', error);
      throw new Error('Client authentication required. Please refresh the page.');
    }

    const response = await fetch(`${this.baseUrl}/v1/ai/use-cases/${useCaseId}/documentation-quality`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
    });

    const rawText = await response.text().catch(() => '');
    let payloadBody: unknown = rawText;

    if (rawText) {
      try {
        payloadBody = JSON.parse(rawText) as unknown;
      } catch {
        payloadBody = rawText;
      }
    }

    if (allowMissing && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errorMessage =
        extractApiErrorMessage(payloadBody, rawText) ||
        response.statusText ||
        `HTTP error! status: ${response.status}`;

      if (response.status === 401) {
        if (this.onSessionExpired) {
          logger.warn('Session expired on documentation quality request, clearing user session');
          this.onSessionExpired();
        }
        throw new Error('Client authentication required. Please refresh the page.');
      }

      logger.error('Documentation quality request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorMessage,
      });

      if (response.status === 403 && errorMessage.startsWith('You do not have permission')) {
        throw new Error(errorMessage);
      }

      throw new Error(AI_SERVICES_UNAVAILABLE_MESSAGE);
    }

    return normalizeDocumentationQualityAnalysis(payloadBody);
  }

  /** Fetch the latest saved admin-only AI documentation quality analysis for a use case. */
  async getSavedUseCaseDocumentationQuality(useCaseId: string): Promise<UseCaseDocumentationQualityAnalysis | null> {
    return this.requestUseCaseDocumentationQuality(useCaseId, 'GET', true);
  }

  /** Recalculate, persist, and return the latest admin-only AI documentation quality analysis for a use case. */
  async analyzeUseCaseDocumentationQuality(useCaseId: string): Promise<UseCaseDocumentationQualityAnalysis> {
    const result = await this.requestUseCaseDocumentationQuality(useCaseId, 'POST');
    if (!result) {
      throw new Error('AI documentation analysis returned an unexpected response.');
    }
    return result;
  }

  /** Users eligible for Technical Owner (tech_architect with domain access). */
  async getEligibleTechnicalOwners(domainId?: string) {
    const query = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : '';
    return this.request<{ user_id: string; user_name: string; user_email: string; role_name?: string }[]>(
      `/use-cases/eligible-technical-owners${query}`
    );
  }

  /** Users eligible for Business Owner (business_reviewer with domain access). */
  async getEligibleBusinessOwners(domainId?: string) {
    const query = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : '';
    return this.request<{ user_id: string; user_name: string; user_email: string; role_name?: string }[]>(
      `/use-cases/eligible-business-owners${query}`
    );
  }

  async getAnalysisFieldOptions() {
    return this.request<Record<string, string[]>>('/use-cases/analysis/field-options');
  }

  async assignAnalysis(
    useCaseId: string,
    payload: { technical_owner: string; business_owner: string; due_date: string },
  ) {
    return this.request(`/use-cases/${useCaseId}/analysis/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async completeAnalysisTrack(useCaseId: string, track: 'technical' | 'business') {
    return this.request(`/use-cases/${useCaseId}/analysis/complete`, {
      method: 'POST',
      body: JSON.stringify({ track }),
    });
  }

  async rejectAnalysisAssignment(useCaseId: string, track: 'technical' | 'business', note: string) {
    return this.request(`/use-cases/${useCaseId}/analysis/reject`, {
      method: 'POST',
      body: JSON.stringify({ track, note }),
    });
  }

  async sendBackAnalysisTrack(useCaseId: string, track: 'technical' | 'business', note: string) {
    return this.request(`/use-cases/${useCaseId}/analysis/send-back`, {
      method: 'POST',
      body: JSON.stringify({ track, note }),
    });
  }

  async getEstimateFieldOptions() {
    return this.request<{
      currency_options: string[];
      default_currency: string;
      line_types: Record<string, string[]>;
      line_labels: Record<string, string>;
      line_keys: string[];
    }>('/use-cases/estimate/field-options');
  }

  async assignEstimate(useCaseId: string, payload: { estimate_owner: string; due_date: string }) {
    return this.request(`/use-cases/${useCaseId}/estimate/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async saveEstimate(useCaseId: string, estimate_data: Record<string, unknown>) {
    return this.request(`/use-cases/${useCaseId}/estimate`, {
      method: 'PUT',
      body: JSON.stringify({ estimate_data }),
    });
  }

  async completeEstimate(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/estimate/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getEligibleRoiOwners(domainId?: string) {
    const query = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : '';
    return this.request<{ user_id: string; user_name: string; user_email: string; role_name?: string }[]>(
      `/use-cases/eligible-roi-owners${query}`
    );
  }

  async getEligibleAssessmentOwners(domainId?: string) {
    const query = domainId ? `?domain_id=${encodeURIComponent(domainId)}` : '';
    return this.request<{ user_id: string; user_name: string; user_email: string; role_name?: string }[]>(
      `/use-cases/eligible-assessment-owners${query}`
    );
  }

  async getRoiFieldOptions() {
    return this.request<{
      currency_options: string[];
      default_currency: string;
      saving_categories: string[];
    }>('/use-cases/roi/field-options');
  }

  async assignRoi(useCaseId: string, payload: { roi_owner: string; due_date: string }) {
    return this.request(`/use-cases/${useCaseId}/roi/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async saveRoi(useCaseId: string, roi_data: Record<string, unknown>) {
    return this.request(`/use-cases/${useCaseId}/roi`, {
      method: 'PUT',
      body: JSON.stringify({ roi_data }),
    });
  }

  async completeRoi(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/roi/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async assignAiAssessment(useCaseId: string, payload: { assessment_owner: string; due_date: string }) {
    return this.request(`/use-cases/${useCaseId}/ai-assessment/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async completeAiAssessment(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/ai-assessment/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async createUseCase(useCaseData: any) {
    return this.request('/use-cases/', {
      method: 'POST',
      body: JSON.stringify(useCaseData),
    });
  }

  async updateUseCase(useCaseId: string, useCaseData: any) {
    return this.request(`/use-cases/${useCaseId}`, {
      method: 'PUT',
      body: JSON.stringify(useCaseData),
    });
  }

  /** Move use case to another domain. Requires case_edit and access to both domains. */
  async moveUseCase(useCaseId: string, targetDomainId: string) {
    return this.request(`/use-cases/${useCaseId}/move`, {
      method: 'PUT',
      body: JSON.stringify({ target_domain_id: targetDomainId }),
    });
  }

  async deleteUseCase(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}`, {
      method: 'DELETE',
    });
  }

  // Use Case Data Requirements
  async getUseCaseData(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/data`);
  }

  async createUseCaseData(useCaseId: string, data: any) {
    return this.request(`/use-cases/${useCaseId}/data`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUseCaseData(useCaseId: string, dataReqId: number, data: any) {
    return this.request(`/use-cases/${useCaseId}/data/${dataReqId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUseCaseData(useCaseId: string, dataReqId: number) {
    return this.request(`/use-cases/${useCaseId}/data/${dataReqId}`, {
      method: 'DELETE',
    });
  }

  // Use Case Risk Reviews (merged risks + reviews)
  async getUseCaseRiskReviews(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/risk-reviews`);
  }

  async createUseCaseRiskReview(useCaseId: string, data: any) {
    return this.request(`/use-cases/${useCaseId}/risk-reviews`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUseCaseRiskReview(useCaseId: string, riskReviewId: number, data: any) {
    return this.request(`/use-cases/${useCaseId}/risk-reviews/${riskReviewId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUseCaseRiskReview(useCaseId: string, riskReviewId: number) {
    return this.request(`/use-cases/${useCaseId}/risk-reviews/${riskReviewId}`, {
      method: 'DELETE',
    });
  }

  // Use case assessment checklist
  async getUseCaseAssessment(
    useCaseId: string,
    options?: { includeHistory?: boolean; includeParticipants?: boolean },
  ) {
    const params = new URLSearchParams();
    if (options?.includeHistory) params.set('include_history', 'true');
    if (options?.includeParticipants) params.set('include_participants', 'true');
    const query = params.toString();
    return this.request(`/use-cases/${useCaseId}/assessment${query ? `?${query}` : ''}`);
  }

  async initiateUseCaseAssessment(useCaseId: string, data?: { force_new?: boolean }) {
    return this.request(`/use-cases/${useCaseId}/assessment`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async saveUseCaseAssessmentResponse(
    useCaseId: string,
    templateItemId: number,
    data: {
      template_item_id: number;
      area_id: number;
      sno: string;
      selected_labels: string[];
      comment?: string;
    },
  ) {
    return this.request(`/use-cases/${useCaseId}/assessment/responses/${templateItemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async closeUseCaseAssessment(useCaseId: string, data: { confirm: boolean; overall_findings?: string }) {
    return this.request(`/use-cases/${useCaseId}/assessment/close`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async cancelUseCaseAssessment(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/assessment`, {
      method: 'DELETE',
    });
  }

  async aiPrefillUseCaseAssessment(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/assessment/ai-prefill`, {
      method: 'POST',
    });
  }

  async getUseCaseAssessmentHistory(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/assessment/history`);
  }

  // Use Case Comments (with rating; any user with view can add)
  async getUseCaseComments(useCaseId: string) {
    return this.request(`/use-cases/${useCaseId}/comments`);
  }

  async createUseCaseComment(useCaseId: string, data: { comment?: string; rating?: number }) {
    return this.request(`/use-cases/${useCaseId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUseCaseComment(useCaseId: string, commentId: number, data: { rating?: number }) {
    return this.request(`/use-cases/${useCaseId}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verifyForgotPasswordPasscode(email: string, passcode: string): Promise<VerifyForgotPasswordPasscodeResponse> {
    return this.request('/auth/forgot-password/verify-passcode', {
      method: 'POST',
      body: JSON.stringify({ email, passcode }),
    });
  }

  async resetPassword(email: string, resetToken: string, newPassword: string): Promise<ResetPasswordResponse> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email,
        reset_token: resetToken,
        new_password: newPassword,
      }),
    });
  }

  async changePassword(oldPassword: string, newPassword: string, confirmPassword: string): Promise<ChangePasswordResponse> {
    return this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      }),
    });
  }

  /** Check current password without changing it. 401 means wrong password (session is not cleared). */
  async verifyCurrentPassword(password: string): Promise<{ valid: boolean }> {
    return this.request('/auth/verify-current-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  private async userFetchJson<T>(
    endpoint: string,
    init: RequestInit & { parseJson?: boolean } = {}
  ): Promise<T> {
    const token = await this.getClientToken();
    const { parseJson = true, ...rest } = init;
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(rest.headers as Record<string, string>),
      },
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      const errorMessage = extractApiErrorMessage(error, `HTTP error! status: ${response.status}`);
      if (response.status === 401 && this.onSessionExpired) {
        const isUserEndpoint =
          !endpoint.includes('/auth/client-login') &&
          !endpoint.includes('/auth/refresh') &&
          !endpoint.includes('/auth/signin') &&
          !endpoint.includes('/auth/forgot-password') &&
          !endpoint.includes('/auth/reset-password') &&
          !endpoint.includes('/auth/change-password');
        if (isUserEndpoint) {
          this.onSessionExpired();
        }
      }
      throw new Error(errorMessage);
    }
    if (!parseJson || response.status === 204) {
      return undefined as T;
    }
    return response.json();
  }

  async listBlogPosts(includeUnpublished = false): Promise<BlogPost[]> {
    const suffix = includeUnpublished ? '?include_unpublished=true' : '/';
    return this.request<BlogPost[]>(`/blogs${suffix}`);
  }

  async createBlogPost(params: {
    title: string;
    kind: 'blog' | 'article';
    published: boolean;
    file: File;
  }): Promise<BlogPost> {
    const token = await this.getClientToken();
    const fd = new FormData();
    fd.append('title', params.title.trim());
    fd.append('kind', params.kind);
    fd.append('published', params.published ? 'true' : 'false');
    fd.append('file', params.file);
    const response = await fetch(`${this.baseUrl}/blogs/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      body: fd,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(extractApiErrorMessage(error, `HTTP error! status: ${response.status}`));
    }
    return response.json();
  }

  async updateBlogPost(
    blogPostId: string,
    body: { title?: string; published?: boolean }
  ): Promise<BlogPost> {
    return this.request<BlogPost>(`/blogs/${blogPostId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async deleteBlogPost(blogPostId: string): Promise<void> {
    await this.userFetchJson<void>(`/blogs/${blogPostId}`, { method: 'DELETE', parseJson: false });
  }

  async fetchBlogContentBlob(blogPostId: string): Promise<Blob> {
    const token = await this.getClientToken();
    const response = await fetch(`${this.baseUrl}/blogs/${blogPostId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(extractApiErrorMessage(error, `HTTP error! status: ${response.status}`));
    }
    return response.blob();
  }

  // Settings endpoints

  async getSystemConfig(): Promise<SystemConfig> {
    return this.request<SystemConfig>('/settings/config');
  }

  async updateSystemConfig(configData: SystemConfig['config_data']): Promise<SystemConfig> {
    return this.request<SystemConfig>('/settings/config', {
      method: 'PUT',
      body: JSON.stringify(configData),
    });
  }

  /** Paginated users (for Settings). Returns { users, total }. */
  async getUsers(limit: number = 10, offset: number = 0) {
    return this.request<{ users: any[]; total: number }>(
      `/settings/users?limit=${limit}&offset=${offset}`
    );
  }

  /** All users (no pagination) for directory search / filter. */
  async getAllUsers() {
    return this.request<any[]>('/settings/users/all');
  }

  /** Pending registrations (is_active=false) for admin approval. */
  async getPendingUsers() {
    return this.request<unknown[]>('/settings/users/pending');
  }

  /** Bulk approve pending users by user IDs. */
  async approveUsers(userIds: string[]) {
    return this.request<{ approved: number; message: string }>('/settings/users/approve', {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds }),
    });
  }

  /** Bulk reject pending users by user IDs. */
  async rejectUsers(userIds: string[]) {
    return this.request<{ rejected: number; message: string }>('/settings/users/reject', {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds }),
    });
  }

  // Organization types (settings)
  async getOrganizationTypes(): Promise<OrganizationType[]> {
  return this.request<OrganizationType[]>('/settings/organization-types');
}

  async createOrganizationType(data: { name: string; description?: string | null }) {
    return this.request('/settings/organization-types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateOrganizationType(orgTypeId: string, data: { name?: string; description?: string | null }) {
    return this.request(`/settings/organization-types/${orgTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteOrganizationType(orgTypeId: string) {
    return this.request(`/settings/organization-types/${orgTypeId}`, {
      method: 'DELETE',
    });
  }

  async getSettingsDocumentTypes(): Promise<DocumentType[]> {
    return this.request<DocumentType[]>('/settings/document-types');
  }

  async createDocumentType(data: { name: string; description?: string | null }) {
    return this.request<DocumentType>('/settings/document-types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDocumentType(docTypeId: string, data: { name?: string; description?: string | null }) {
    return this.request<DocumentType>(`/settings/document-types/${docTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDocumentType(docTypeId: string) {
    return this.request(`/settings/document-types/${docTypeId}`, {
      method: 'DELETE',
    });
  }

  // AI Assessment Checklist templates (settings)
  async getAssessmentChecklistTemplates() {
    return this.request('/settings/assessment-checklist/templates');
  }

  async getAssessmentChecklistTemplate(templateId: string) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}`);
  }

  async createAssessmentChecklistTemplate(data: {
    name: string;
    clone_from_template_id?: string;
    areas?: unknown[];
  }) {
    return this.request('/settings/assessment-checklist/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async importAssessmentChecklistTemplate(file: File) {
    const token = await this.getClientToken();
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${this.baseUrl}/settings/assessment-checklist/templates/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(extractApiErrorMessage(error, `Import failed: ${response.status}`));
    }
    return response.json();
  }

  async cloneAssessmentChecklistTemplate(templateId: string, data: { name: string }) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/clone`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAssessmentChecklistTemplate(templateId: string, data: {
    name?: string;
    status?: string;
    areas?: unknown[];
    risk_classification_ranges?: unknown[];
  }) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateAssessmentChecklistTemplateSettings(templateId: string, data: {
    name?: string;
    status?: string;
    risk_classification_ranges?: unknown[];
    area_titles?: Array<{ area_id: number; title: string }>;
  }) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async addAssessmentChecklistArea(templateId: string, data: { title: string }) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/areas`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async addAssessmentChecklistItem(templateId: string, areaId: number, data: unknown) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/areas/${areaId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAssessmentChecklistItem(templateId: string, itemId: number, data: unknown) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async activateAssessmentChecklistTemplate(templateId: string) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/activate`, {
      method: 'POST',
    });
  }

  async deprecateAssessmentChecklistTemplate(templateId: string) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}/deprecate`, {
      method: 'POST',
    });
  }

  async deleteAssessmentChecklistTemplate(templateId: string) {
    return this.request(`/settings/assessment-checklist/templates/${templateId}`, {
      method: 'DELETE',
    });
  }

  async createUser(userData: any) {
    return this.request('/settings/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async updateUser(userId: string, userData: any) {
    return this.request(`/settings/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  }

  /** Delete a user permanently. Administrator only. */
  async deleteUser(userId: string): Promise<void> {
    return this.request(`/settings/users/${userId}`, {
      method: 'DELETE',
    });
  }

  async getRoles(): Promise<Role[]> {
  return this.request<Role[]>('/settings/roles');
}

  async createRole(role: any) {
    return this.request('/settings/roles', {
      method: 'POST',
      body: JSON.stringify(role),
    });
  }

  async updateRole(roleId: string, role: any) {
    return this.request(`/settings/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify(role),
    });
  }

  async deleteRole(roleId: string) {
    return this.request(`/settings/roles/${roleId}`, {
      method: 'DELETE',
    });
  }

  async getPermissions() : Promise<Permission[]> {
  return this.request<Permission[]>('/settings/permissions');
}

  async getUsersByRole(roleName: string) {
    return this.request(`/settings/users?role=${encodeURIComponent(roleName)}`);
  }

  /** List anonymous ideas (settings_access). Optional status_filter: new | qualified. */
  async getAnonymousIdeas(statusFilter?: string) {
    const q = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : '';
    return this.request<Array<{
      idea_id: string;
      domain_id: string | null;
      domain_name: string | null;
      idea_text: string;
      submitted_by_name: string | null;
      submitted_by_email: string | null;
      submitted_by_organization: string | null;
      status: string;
      qualified_use_case_id: string | null;
      created_dt: string;
    }>>(`/settings/anonymous-ideas${q}`);
  }

  /** Submit bug report or feature request (any authenticated user). Screenshot optional (base64 data URL). */
  async submitFeedback(data: {
    report_type: 'bug' | 'feature';
    comments?: string;
    screenshot?: string;
  }) {
    return this.request<{ report_id: string; report_type: string; submitted_dt: string }>(
      '/settings/feedback',
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  /** List distinct release numbers assigned to feedback (for filter dropdown). */
  async getFeedbackReleaseNumbers() {
    return this.request<string[]>('/settings/feedback/release-numbers');
  }

  /** List bug/feature reports (settings_access). releaseFilter: 'unassigned' (default) | 'all' | release number. */
  async getFeedback(releaseFilter: string = 'unassigned') {
    const q = `?release_filter=${encodeURIComponent(releaseFilter)}`;
    return this.request<Array<{
      report_id: string;
      report_type: string;
      comments: string | null;
      submitted_dt: string;
      submitted_by: string | null;
      submitted_by_name: string | null;
      submitted_by_email: string | null;
      screenshot: string | null;
      release_number: string | null;
    }>>(`/settings/feedback${q}`);
  }

  /** Update release number for a feedback item (settings_access). */
  async updateFeedbackRelease(reportId: string, data: { release_number: string | null }) {
    return this.request<{ report_id: string; release_number: string | null }>(`/settings/feedback/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  /** Qualify an idea into a use case in the selected domain (settings_access + domain access). */
  async qualifyIdea(ideaId: string, data: {
    target_domain_id: string;
    use_case_name: string;
    use_case_title?: string;
    use_case_description?: string;
    expected_benefits?: string;
    department?: string;
    ai_category?: string;
    feasibility?: string;
    intended_audience?: string;
    tags?: string[];
  }) {
    return this.request<{ message: string; use_case_id: string; domain_id: string }>(
      `/settings/anonymous-ideas/${ideaId}/qualify`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  // Audit Log endpoints
  async getAuditLogs(filters: {
    skip?: number;
    limit?: number;
    type_filter?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const queryParams = new URLSearchParams();
    for (const key in filters) {
      const value = filters[key as keyof typeof filters];
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    }
    const query = queryParams.toString();
    // Note: Router is at /api/audit, so endpoint is /audit (baseUrl already includes /api)
    return this.request(`/audit/${query ? `?${query}` : ''}`);
  }

  /** Fire-and-forget friendly: logs UI navigation (domain / use cases / blog) for audit trail. */
  async recordUiNavigationEvent(payload: UiNavigationEventPayload): Promise<void> {
    await this.userFetchJson<void>('/audit/navigation-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      parseJson: false,
    });
  }
}

// Initialize API client
const api = new ApiClient(API_BASE_URL);

export { api };
