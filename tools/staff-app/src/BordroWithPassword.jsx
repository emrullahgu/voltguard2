import React from 'react';
import BordroTakip from './BordroTakip.tsx';
import { useAuth } from './SimpleAuth';
export const BordroWithPassword = () => { const { currentUser, loading, isAuthenticated } = useAuth(); if (loading) return <p role="status">Şirket yetkisi kontrol ediliyor…</p>; if (!isAuthenticated || !currentUser?.approved) return <div role="alert" className="portal-session">Bordronuzu görmek için çalışan hesabınızla giriş yapın.</div>; return <BordroTakip />; };
