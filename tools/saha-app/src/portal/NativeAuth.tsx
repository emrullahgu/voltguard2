import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { bootstrapPortal, logoutPortal, onPortalReset, reportPortalError, PortalUser } from './api';
export type UserRole = 'admin' | 'manager' | 'engineer' | 'field';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface UserProfile { id: string; full_name: string | null; role: UserRole; email?: string | null; phone: string | null; avatar_url: string | null; approval_status?: ApprovalStatus; [key: string]: any }
interface AuthValue {
  session: { user: PortalUser } | null; user: PortalUser | null; profile: UserProfile | null; loading: boolean; isOffline: boolean; isDemoMode: boolean;
  signIn: (...args: any[]) => Promise<{error: string | null}>; signUp: (...args: any[]) => Promise<{error: string | null}>; signOut: () => Promise<void>;
  resetPassword: (...args: any[]) => Promise<{error: string | null}>; updatePassword: (...args: any[]) => Promise<{error: string | null}>; updateProfile: (...args: any[]) => Promise<{error: string | null}>;
  enterDemoMode: () => void; hasPermission: (resource: string, action: 'R'|'W') => boolean;
}
const Context = createContext<AuthValue | undefined>(undefined);
const PERMISSIONS:Record<UserRole,Record<string,'R'|'W'|'-'>>={
 admin:{customers:'W',quotes:'W',workOrders:'W',employees:'W',reports:'W',finance:'W',settings:'W'},
 manager:{customers:'W',quotes:'W',workOrders:'W',employees:'W',reports:'W',finance:'R',settings:'-'},
 engineer:{customers:'R',quotes:'W',workOrders:'W',employees:'R',reports:'R',finance:'-',settings:'-'},
 field:{customers:'R',quotes:'R',workOrders:'W',employees:'-',reports:'-',finance:'-',settings:'-'},
};
const securityPage = async () => { window.top!.location.assign('/calisan/'); return { error: 'Kimlik ve güvenlik işlemleri çalışan hesabı üzerinden yönetilir.' }; };
export function AuthProvider({children}: {children: ReactNode}) {
  const [identity, setIdentity] = useState<any>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; bootstrapPortal().then(data => { if(active) setIdentity(data); }).catch(reportPortalError).finally(() => { if(active) setLoading(false); });
    const reset = onPortalReset(() => { if(active) setIdentity(null); }); return () => { active = false; reset(); }; }, []);
  const profile = identity?.profile || null;
  const hasPermission = (resource: string, action: 'R'|'W') => {const access=PERMISSIONS[profile?.role as UserRole]?.[resource]||'-';return !!identity&&(access==='W'||(action==='R'&&access==='R'));};
  return <Context.Provider value={{ session: identity ? {user: identity.user} : null, user: identity?.user || null, profile, loading, isOffline:false, isDemoMode:false,
    signIn:securityPage, signUp:securityPage, resetPassword:securityPage, updatePassword:securityPage, updateProfile:securityPage,
    signOut:logoutPortal, enterDemoMode:() => { reportPortalError(new Error('Demo oturumu bulunmuyor. Onaylanmış çalışan hesabı gereklidir.')); }, hasPermission }}>{children}</Context.Provider>;
}
export function useAuth() { const context = useContext(Context); if(!context) throw new Error('Çalışan oturumu sağlayıcısı gerekli.'); return context; }
