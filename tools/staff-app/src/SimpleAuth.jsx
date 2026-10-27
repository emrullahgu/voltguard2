import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { bootstrapCompany, clearStaffClientState, forgetRememberedDevices, getStaffIdentity, supabase } from './supabaseClient.js';
import { privateStorage } from './privateStorage.js';

const Context = createContext(null);
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('Çalışan oturumu bulunamadı.');
  return value;
}
function loginUrl() { return '/calisan/giris.html'; }

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const alive = useRef(true);
  const leaving = useRef(false);

  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    clearStaffClientState();
    if (alive.current) setCurrentUser(null);
    window.location.replace(loginUrl());
  }, []);

  const recheck = useCallback(async () => {
    try {
      const data = await bootstrapCompany({ force: true });
      if (alive.current && !leaving.current) { setCurrentUser(data.user); setAuthError(''); }
      return data.user;
    } catch (error) {
      if (error.status === 401 || error.status === 403) leave();
      else if (alive.current) setAuthError(error.message || 'Çalışan oturumu doğrulanamadı.');
      return null;
    } finally { if (alive.current) setLoading(false); }
  }, [leave]);

  useEffect(() => {
    alive.current = true;
    recheck();
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (!alive.current || leaving.current) return;
      if (event === 'SIGNED_OUT') leave();
      else setCurrentUser(getStaffIdentity());
    });
    const focus = () => recheck();
    const timer = setInterval(() => { if (!document.hidden) recheck(); }, 30000);
    window.addEventListener('focus', focus);
    return () => { alive.current = false; data.subscription.unsubscribe(); window.removeEventListener('focus', focus); clearInterval(timer); };
  }, [recheck, leave]);

  const signOut = async () => {
    if (!window.dispatchEvent(new CustomEvent('vg:before-sign-out', { cancelable: true }))) {
      const error = new Error('SahaTakip kayıtları kaydedilmeden oturum kapatılamaz. Kaydı tamamlayıp yeniden deneyin.');
      setAuthError(error.message); throw error;
    }
    const { error } = await supabase.auth.signOut();
    if (error) { setAuthError(error.message); throw error; }
    leave();
  };
  const updateUser = async (id, updates) => {
    if (id !== currentUser?.id) throw new Error('Yalnızca kendi profilinizi düzenleyebilirsiniz.');
    const name = String(updates.name || '').trim();
    if ([...name].length < 2 || [...name].length > 120) throw new Error('Adınız 2–120 karakter olmalı.');
    const { error } = await supabase.from('users').update({ name }).eq('id', id).select('id,name,email,company,role,approved,can_access_bordro').single();
    if (error) throw error;
    return recheck();
  };
  const changeOwnPassword = async (oldPassword, newPassword) => {
    if ([...newPassword].length < 12 || [...newPassword].length > 64 || new TextEncoder().encode(newPassword).length > 72) throw new Error('Yeni şifre 12–64 karakter olmalı.');
    await privateStorage.flush();
    const { error } = await supabase.rpc('app_change_own_password', { p_old: oldPassword, p_new: newPassword });
    if (error) throw error;
    leave();
  };
  const signIn = async () => { window.location.replace(loginUrl()); throw new Error('Şifre ve doğrulayıcı kodu için çalışan giriş ekranını kullanın.'); };
  const forgetDevices = async () => { await privateStorage.flush(); await forgetRememberedDevices(); leave(); };
  const register = async () => { throw new Error('Çalışan hesabını şirket yöneticisi davet eder.'); };

  return <Context.Provider value={{ currentUser, loading, authError, recheck, signIn, signOut, updateUser,
    changeOwnPassword, forgetDevices, isAuthenticated: !!currentUser, register }}>{children}</Context.Provider>;
}
