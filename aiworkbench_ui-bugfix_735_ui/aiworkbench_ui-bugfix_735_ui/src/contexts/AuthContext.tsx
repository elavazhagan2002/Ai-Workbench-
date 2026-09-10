import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../lib/api';
import type { LoginSuccessResponse, SignInResponse } from '../lib/api';
import type { User } from '../types';
import { logger } from '../utils/logger';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<SignInResponse>;
  verifyLoginPasscode: (challengeId: string, passcode: string) => Promise<LoginSuccessResponse>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  hasPermission: (permission: string) => boolean;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Re-verify session with the server at most this often (same browser tab). */
const USER_VERIFY_TTL_MS = 15 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  function clearSession() {
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('lastLoginTime');
    sessionStorage.removeItem('userVerifiedAt');
    setUser(null);
  }

  function commitLoginSuccess(userData: User) {
    sessionStorage.setItem('userId', userData.user_id);
    sessionStorage.setItem('user', JSON.stringify(userData));
    sessionStorage.setItem('lastLoginTime', Date.now().toString());
    sessionStorage.setItem('userVerifiedAt', Date.now().toString());
    setUser(userData);
  }

  useEffect(() => {
    checkUser();
    // Set up session expired handler in API client
    api.setSessionExpiredHandler(() => {
      clearSession();
    });
  }, []);

  async function checkUser() {
    try {
      // Try to load user from session storage first
      const userStr = sessionStorage.getItem('user');
      if (userStr) {
        try {
          const userData = JSON.parse(userStr);
          
          // Check if we have a last login timestamp to determine if session might be valid
          const lastLoginTime = sessionStorage.getItem('lastLoginTime');
          const now = Date.now();
          const oneDayInMs = 24 * 60 * 60 * 1000;
          
          if (lastLoginTime && (now - parseInt(lastLoginTime)) < oneDayInMs) {
            setUser(userData);
            setLoading(false);

            const lastVerifiedAt = sessionStorage.getItem('userVerifiedAt');
            const recentlyVerified =
              lastVerifiedAt && now - parseInt(lastVerifiedAt, 10) < USER_VERIFY_TTL_MS;

            if (recentlyVerified) {
              return;
            }

            // Verify in the background so navigation is not blocked on every load.
            try {
              const currentUser = await api.getCurrentUser() as User;
              sessionStorage.setItem('userId', currentUser.user_id);
              sessionStorage.setItem('user', JSON.stringify(currentUser));
              sessionStorage.setItem('userVerifiedAt', Date.now().toString());
              setUser(currentUser);
            } catch (e: any) {
              sessionStorage.removeItem('userId');
              sessionStorage.removeItem('user');
              sessionStorage.removeItem('lastLoginTime');
              sessionStorage.removeItem('userVerifiedAt');
              setUser(null);
              if (e?.message && !e.message.includes('401') && !e.message.includes('Unauthorized')) {
                logger.warn('Error verifying user, session may have expired', e);
              }
            }
            return;
          }

          sessionStorage.removeItem('userId');
          sessionStorage.removeItem('user');
          sessionStorage.removeItem('lastLoginTime');
          sessionStorage.removeItem('userVerifiedAt');
          setUser(null);
        } catch (parseError) {
          sessionStorage.removeItem('userId');
          sessionStorage.removeItem('user');
          sessionStorage.removeItem('lastLoginTime');
          sessionStorage.removeItem('userVerifiedAt');
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error: any) {
      if (error?.message && !error.message.includes('401') && !error.message.includes('Unauthorized') && !error.message.includes('authentication')) {
        logger.error('Error during initial user check', error);
      }
      sessionStorage.removeItem('userId');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('lastLoginTime');
      sessionStorage.removeItem('userVerifiedAt');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    const response = await api.signIn(email, password);
    if (response.status === 'LOGIN_SUCCESS') {
      commitLoginSuccess(response.user);
    }
    return response;
  }

  async function verifyLoginPasscode(challengeId: string, passcode: string) {
    const response = await api.verifyLoginPasscode(challengeId, passcode);
    commitLoginSuccess(response.user);
    return response;
  }

  async function signOut() {
    try {
      await api.signOut();
    } catch (error) {
      logger.error('Error signing out', error);
    } finally {
      sessionStorage.removeItem('userId');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('lastLoginTime');
      sessionStorage.removeItem('userVerifiedAt');
      setUser(null);
    }
  }

  async function updateProfile(updates: Partial<User>) {
    if (!user) return;
    const payload: { user_name?: string; organization?: string; user_image?: string | null } = {};
    if (updates.user_name !== undefined) payload.user_name = updates.user_name;
    if (updates.organization !== undefined) payload.organization = updates.organization ?? undefined;
    if (updates.user_image !== undefined) payload.user_image = updates.user_image ?? undefined;
    const updated = await api.updateProfile(payload);
    sessionStorage.setItem('user', JSON.stringify(updated));
    sessionStorage.setItem('userVerifiedAt', Date.now().toString());
    setUser(updated);
  }

  function hasPermission(permission: string): boolean {
    return user?.permissions?.includes(permission) || false;
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, verifyLoginPasscode, signOut, updateProfile, hasPermission, clearSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
