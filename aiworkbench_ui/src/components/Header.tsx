import { FileText, Settings, User, LogOut, Moon, Sun, Edit, Bug, X, HelpCircle, KeyRound, BookOpen, LayoutDashboard, Boxes, Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Toast from './Toast';
import HoverTip from './HoverTip';
import NotificationBell from './NotificationBell';
import sciagenLogo from '../assets/images/sciagen_white.png';
import { api } from '../lib/api';
import TotpEnrollmentCard from './auth/TotpEnrollmentCard';

const APP_VERSION = ((import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '1.0.1');

interface HeaderProps {
  onNavigate: (page: 'domains' | 'audit' | 'settings' | 'blogs' | 'dashboard') => void;
  currentPage: string;
  onOpenNotificationLink?: (link: string) => void;
}

export default function Header({ onNavigate, currentPage, onOpenNotificationLink }: HeaderProps) {
  const { user, signOut, hasPermission, updateProfile, applyUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showTotpModal, setShowTotpModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ user_name: '', organization: '', user_image: '' as string | null });
  const [changePasswordForm, setChangePasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSuccessToast, setChangePasswordSuccessToast] = useState('');
  const [currentPasswordFieldMessage, setCurrentPasswordFieldMessage] = useState('');
  const [currentPasswordVerifying, setCurrentPasswordVerifying] = useState(false);
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportForm, setReportForm] = useState({ report_type: 'bug' as 'bug' | 'feature', comments: '' });
  const [reportScreenshot, setReportScreenshot] = useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const applyHeight = () => {
      document.documentElement.style.setProperty('--wb-header-height', `${el.offsetHeight}px`);
    };
    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--wb-header-height');
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUserMenu]);

  function openProfileModal() {
    setProfileForm({
      user_name: user?.user_name || '',
      organization: (user as any)?.organization || '',
      user_image: user?.user_image ?? null
    });
    setError('');
    setShowUserMenu(false);
    setShowProfileModal(true);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      await updateProfile({
        user_name: profileForm.user_name,
        organization: profileForm.organization,
        user_image: profileForm.user_image
      });
      setShowProfileModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  function openChangePasswordModal() {
    setShowUserMenu(false);
    setShowChangePasswordModal(true);
    setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    setChangePasswordError('');
    setCurrentPasswordFieldMessage('');
    setCurrentPasswordVerifying(false);
  }

  async function handleCurrentPasswordBlur() {
    const value = changePasswordForm.oldPassword.trim();
    if (!value) {
      setCurrentPasswordFieldMessage('Current password is required.');
      return;
    }
    setCurrentPasswordFieldMessage('');
    setCurrentPasswordVerifying(true);
    try {
      await api.verifyCurrentPassword(value);
    } catch (err: any) {
      setCurrentPasswordFieldMessage(err.message || 'Current password is incorrect.');
    } finally {
      setCurrentPasswordVerifying(false);
    }
  }

  function getPasswordRuleStates(password: string) {
    return {
      minLength: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangePasswordError('');
    setChangePasswordSuccessToast('');

    const oldPassword = changePasswordForm.oldPassword.trim();
    const newPassword = changePasswordForm.newPassword;
    const confirmPassword = changePasswordForm.confirmPassword;

    if (!oldPassword) {
      setChangePasswordError('Current password is required.');
      return;
    }
    if (!newPassword) {
      setChangePasswordError('New password is required.');
      return;
    }

    const rules = getPasswordRuleStates(newPassword);
    const missing = [
      !rules.minLength ? 'minimum 8 characters' : '',
      !rules.uppercase ? 'one uppercase letter' : '',
      !rules.lowercase ? 'one lowercase letter' : '',
      !rules.number ? 'one number' : '',
      !rules.special ? 'one special character' : '',
    ].filter(Boolean);
    if (missing.length > 0) {
      setChangePasswordError(`Password must include ${missing.join(', ')}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('New password and confirm password do not match.');
      return;
    }

    setChangePasswordSaving(true);
    try {
      const response = await api.changePassword(oldPassword, newPassword, confirmPassword);
      setShowChangePasswordModal(false);
      setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setCurrentPasswordFieldMessage('');
      setChangePasswordSuccessToast(response.message || 'Password changed successfully.');
    } catch (err: any) {
      setChangePasswordError(err.message || 'Failed to change password.');
    } finally {
      setChangePasswordSaving(false);
    }
  }

  function openReportModal() {
    setReportForm({ report_type: 'bug', comments: '' });
    setReportScreenshot(null);
    setReportSuccess(false);
    setShowReportModal(true);
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    setReportSubmitting(true);
    try {
      await api.submitFeedback({
        report_type: reportForm.report_type,
        comments: reportForm.comments.trim() || undefined,
        screenshot: reportScreenshot || undefined,
      });
      setReportSuccess(true);
      setTimeout(() => {
        setShowReportModal(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to submit');
    } finally {
      setReportSubmitting(false);
    }
  }

  return (
    <>
    <header ref={headerRef} className="wb-header">
      <div className="px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <HoverTip label="Go to Dashboard" align="start">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-3 text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
          >
            <img src={sciagenLogo} alt="Sciagen" className="h-9 w-auto object-contain" />
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold text-white tracking-tight truncate">
                AI Governance Workbench
              </h1>
              <p className="text-[11px] text-slate-300/90">
                Unified AI Engineering Platform
                {APP_VERSION && <span className="ml-1">· v{APP_VERSION}</span>}
              </p>
            </div>
          </button>
          </HoverTip>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {(hasPermission('dashboard_enterprise') ||
            hasPermission('dashboard_domain') ||
            hasPermission('dashboard_individual') ||
            user?.role?.role_name === 'portal_admin') && (
            <HoverTip label="Dashboards">
            <button
              onClick={() => onNavigate('dashboard')}
              className={`p-2.5 rounded-xl transition-colors ${
                currentPage === 'dashboard'
                  ? 'bg-cyan-500 text-navy-950'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
              aria-label="Dashboards"
            >
              <LayoutDashboard className="w-5 h-5" />
            </button>
            </HoverTip>
          )}
          <HoverTip label="Domains">
          <button
            onClick={() => onNavigate('domains')}
            className={`p-2.5 rounded-xl transition-colors ${
              currentPage === 'domains' || currentPage === 'usecases' || currentPage === 'usecase-detail' || currentPage === 'usecase-edit'
                ? 'bg-cyan-500 text-navy-950'
                : 'text-slate-200 hover:bg-white/10'
            }`}
            aria-label="Domains"
          >
            <Boxes className="w-5 h-5" />
          </button>
          </HoverTip>
{hasPermission('audit_access') && (
            <HoverTip label="Audit trail">
            <button
              onClick={() => onNavigate('audit')}
              className={`p-2.5 rounded-xl transition-colors ${
                currentPage === 'audit'
                  ? 'bg-cyan-500 text-navy-950'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
              aria-label="Audit trail"
            >
              <FileText className="w-5 h-5" />
            </button>
            </HoverTip>
          )}
          <HoverTip label="Contact support">
          <a
            href="https://www.sciagen.ai/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2.5 rounded-xl transition-colors text-slate-200 hover:bg-white/10"
            aria-label="Contact support"
          >
            <HelpCircle className="w-5 h-5" />
          </a>
          </HoverTip>

          {hasPermission('view_blog') && (
            <HoverTip label="Blogs and articles">
            <button
              onClick={() => onNavigate('blogs')}
              className={`p-2.5 rounded-xl transition-colors ${
                currentPage === 'blogs'
                  ? 'bg-cyan-500 text-navy-950'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
              aria-label="Blogs and articles"
            >
              <BookOpen className="w-5 h-5" />
            </button>
            </HoverTip>
          )}

          {hasPermission('settings_access') && (
            <HoverTip label="Settings">
            <button
              onClick={() => onNavigate('settings')}
              className={`p-2.5 rounded-xl transition-colors ${
                currentPage === 'settings'
                  ? 'bg-cyan-500 text-navy-950'
                  : 'text-slate-200 hover:bg-white/10'
              }`}
              aria-label="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            </HoverTip>
          )}

          <HoverTip label="Report a bug or request a feature">
          <button
            onClick={openReportModal}
            className="p-2.5 text-slate-200 hover:bg-white/10 rounded-xl transition-colors"
            aria-label="Report a bug or request a feature"
          >
            <Bug className="w-5 h-5" />
          </button>
          </HoverTip>

          <HoverTip label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <button
            onClick={toggleTheme}
            className="p-2.5 text-slate-200 hover:bg-white/10 rounded-xl transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          </HoverTip>

          <NotificationBell
            onOpen={() => setShowUserMenu(false)}
            onOpenLink={onOpenNotificationLink}
            forceClose={showUserMenu}
          />

          <div className="relative" ref={menuRef}>
            <HoverTip label="Account menu" align="end" disabled={showUserMenu}>
            <button
              onClick={() => {
                setShowUserMenu(!showUserMenu);
              }}
              className="flex min-w-0 max-w-[12rem] items-center gap-2 rounded-xl p-2 text-slate-200 transition-colors hover:bg-white/10"
              aria-label="Account menu"
            >
              {user?.user_image ? (
                <img src={user.user_image} alt={user.user_name} className="w-8 h-8 rounded-full object-cover border-2 border-cyan-400/40" />
              ) : (
                <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-navy-950" />
                </div>
              )}
              <span className="min-w-0 truncate text-sm font-medium">{user?.user_name}</span>
            </button>
            </HoverTip>

            {showUserMenu && (
              <div className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-line bg-surface-elevated py-1 shadow-panel dark:shadow-panel-dark">
                <div className="min-w-0 border-b border-line px-4 py-2">
                  <p className="truncate text-sm font-medium text-ink" title={user?.user_name}>{user?.user_name}</p>
                  <p className="truncate text-xs text-ink-muted" title={user?.user_email}>{user?.user_email}</p>
                </div>
                <button
                  onClick={openProfileModal}
                  className="w-full px-4 py-2 text-left text-sm text-ink-muted hover:bg-surface-muted flex items-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  Edit Profile
                </button>
                <button
                  onClick={openChangePasswordModal}
                  className="w-full px-4 py-2 text-left text-sm text-ink-muted hover:bg-surface-muted flex items-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  Change Password
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowTotpModal(true);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-ink-muted hover:bg-surface-muted flex items-center gap-2"
                >
                  <Smartphone className="w-4 h-4" />
                  {user?.totp_enabled ? 'Authenticator app' : 'Set up authenticator'}
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    signOut();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-surface-muted flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>

    {createPortal(
      <>
      {showProfileModal && (
        <div className="wb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
          <div className="wb-modal p-6 max-w-md">
              <h3 id="profile-modal-title" className="font-display text-xl font-semibold text-ink mb-4">Edit Profile</h3>

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Email (read-only)
                  </label>
                  <input
                    type="email"
                    value={user?.user_email || ''}
                    readOnly
                    title={user?.user_email || ''}
                    className="w-full min-w-0 truncate px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Name (25 chars max) *
                  </label>
                  <input
                    type="text"
                    value={profileForm.user_name}
                    onChange={(e) => setProfileForm({ ...profileForm, user_name: e.target.value })}
                    maxLength={25}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Organization
                  </label>
                  <input
                    type="text"
                    value={profileForm.organization}
                    onChange={(e) => setProfileForm({ ...profileForm, organization: e.target.value })}
                    maxLength={100}
                    placeholder="e.g. Engineering"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Photo
                  </label>
                  <div className="flex min-w-0 items-center gap-4">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          const r = new FileReader();
                          r.onload = () => setProfileForm({ ...profileForm, user_image: r.result as string });
                          r.readAsDataURL(f);
                        }
                      }}
                      className="min-w-0 w-full max-w-xs text-sm text-slate-600 dark:text-slate-400 file:mr-2 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-300"
                    />
                    {profileForm.user_image && (
                      <img
                        src={profileForm.user_image}
                        alt="Profile preview"
                        className="w-14 h-14 rounded-full object-cover border-2 border-slate-200 dark:border-slate-700"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                  </div>
                  <input
                    type="url"
                    value={profileForm.user_image || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, user_image: e.target.value || null })}
                    placeholder="Or paste image URL"
                    className="mt-2 w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  />
                </div>

                <Toast message={error} onDismiss={() => setError('')} type="error" autoDismissMs={3000} />

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowProfileModal(false)}
                    className="wb-btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="wb-btn-primary flex-1"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
          </div>
        </div>
      )}

      {showTotpModal && (
        <div className="wb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="totp-modal-title">
          <div className="wb-modal max-w-lg p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 id="totp-modal-title" className="font-display text-xl font-semibold text-ink">Authenticator app</h3>
                <p className="mt-1 text-sm text-ink-muted">Use a 6-digit app code when you sign in from an unknown network.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowTotpModal(false)}
                className="rounded-lg p-1 text-ink-muted hover:bg-surface-muted"
                aria-label="Close authenticator setup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <TotpEnrollmentCard
              key={user?.totp_enabled ? 'enabled' : 'setup'}
              alreadyEnabled={Boolean(user?.totp_enabled)}
              showSkip={false}
              onCancel={() => setShowTotpModal(false)}
              onFinished={(nextUser) => {
                applyUser(nextUser);
                setShowTotpModal(false);
              }}
            />
          </div>
        </div>
      )}

      {showChangePasswordModal && (
        <div className="wb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
          <div className="wb-modal p-6 max-w-md">
              <h3 id="password-modal-title" className="font-display text-xl font-semibold text-ink mb-4">Change Password</h3>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={changePasswordForm.oldPassword}
                    onChange={(e) => {
                      setChangePasswordForm((p) => ({ ...p, oldPassword: e.target.value }));
                      setCurrentPasswordFieldMessage('');
                    }}
                    onBlur={handleCurrentPasswordBlur}
                    maxLength={72}
                    disabled={currentPasswordVerifying}
                    className="wb-input disabled:opacity-60"
                    required
                  />
                  {currentPasswordVerifying ? (
                    <p className="mt-1 text-xs text-ink-subtle">Checking current password…</p>
                  ) : null}
                  {currentPasswordFieldMessage ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
                      {currentPasswordFieldMessage}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={changePasswordForm.newPassword}
                    onChange={(e) => setChangePasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                    maxLength={72}
                    className="wb-input"
                    required
                  />
                  <p className="mt-1 text-xs text-ink-subtle">
                    Minimum 8 chars, with uppercase, lowercase, number, and special character.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={changePasswordForm.confirmPassword}
                    onChange={(e) => setChangePasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    maxLength={72}
                    className="wb-input"
                    required
                  />
                </div>

                <Toast message={changePasswordError} onDismiss={() => setChangePasswordError('')} type="error" autoDismissMs={4000} />

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowChangePasswordModal(false)}
                    className="wb-btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changePasswordSaving}
                    className="wb-btn-primary flex-1"
                  >
                    {changePasswordSaving ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
          </div>
        </div>
      )}

      {showReportModal && (
        <div className="wb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
          <div className="wb-modal max-w-lg">
            <div className="flex items-center justify-between p-4 border-b border-line">
              <h3 id="report-modal-title" className="font-display text-lg font-semibold text-ink">Report bug or request feature</h3>
              <button type="button" onClick={() => setShowReportModal(false)} className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            {reportSuccess ? (
              <div className="p-6 text-center text-emerald-600 dark:text-emerald-400 font-medium">Thank you. Your report has been submitted.</div>
            ) : (
              <form onSubmit={handleSubmitReport} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">Type</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="report_type"
                        checked={reportForm.report_type === 'bug'}
                        onChange={() => setReportForm((f) => ({ ...f, report_type: 'bug' }))}
                        className="rounded-full border-line text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="text-ink">Bug</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="report_type"
                        checked={reportForm.report_type === 'feature'}
                        onChange={() => setReportForm((f) => ({ ...f, report_type: 'feature' }))}
                        className="rounded-full border-line text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="text-ink">Feature request</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">Comments (optional)</label>
                  <textarea
                    value={reportForm.comments}
                    onChange={(e) => setReportForm((f) => ({ ...f, comments: e.target.value }))}
                    placeholder="Describe the issue or feature..."
                    rows={4}
                    className="wb-input resize-y"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-muted mb-2">Screenshot (optional)</label>
                  <p className="text-xs text-ink-subtle mb-2">Attach a screenshot to help us understand the issue.</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const r = new FileReader();
                        r.onload = () => setReportScreenshot(r.result as string);
                        r.readAsDataURL(f);
                      } else {
                        setReportScreenshot(null);
                      }
                    }}
                    className="w-full text-sm text-ink-muted file:mr-2 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-navy-50 file:text-navy-700 dark:file:bg-navy-900/40 dark:file:text-cyan-300"
                  />
                  {reportScreenshot && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={reportScreenshot} alt="Screenshot" className="max-h-20 rounded-lg border border-line" />
                      <button type="button" onClick={() => setReportScreenshot(null)} className="text-sm text-red-600 dark:text-red-400 hover:underline">Remove</button>
                    </div>
                  )}
                </div>
                <Toast message={error} onDismiss={() => setError('')} type="error" autoDismissMs={3000} />
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowReportModal(false)} className="wb-btn-secondary flex-1">
                    Cancel
                  </button>
                  <button type="submit" disabled={reportSubmitting} className="wb-btn-primary flex-1">
                    {reportSubmitting ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <Toast
        message={changePasswordSuccessToast}
        onDismiss={() => setChangePasswordSuccessToast('')}
        type="success"
        autoDismissMs={4000}
      />
      </>,
      document.body
    )}
    </>
  );
}
