import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { Alert } from 'react-native';
import { visitsRepo, StoredVisit } from '../services/data/visitsRepo';
import { useAuth } from './AuthContext';

export interface VisitState {
  id: string; revision: number; customerId: string; customerName: string;
  startTime: string; startLocation: { lat: number; lng: number }; isActive: boolean;
}
interface VisitContextValue {
  activeVisit: VisitState | null;
  checkIn: (customerId: string, customerName: string) => Promise<boolean>;
  checkOut: (notes?: string, photos?: string[]) => Promise<boolean>;
  loading: boolean;
}
const VisitContext = createContext<VisitContextValue | undefined>(undefined);
function activeState(saved: StoredVisit): VisitState | null {
  const v=saved.visit;
  return v&&!v.end_at ? {id:v.id,revision:saved.revision,customerId:v.customer_id,customerName:v.customer_name,
    startTime:v.start_at,startLocation:{lat:Number(v.start_lat),lng:Number(v.start_lng)},isActive:true} : null;
}
export function VisitProvider({ children }: { children: React.ReactNode }) {
  const [activeVisit,setActiveVisit]=useState<VisitState|null>(null);
  const [loading,setLoading]=useState(false);
  const {user}=useAuth();
  const owner=useRef<string|null>(null),busy=useRef(false);
  owner.current=user?.id??null;
  useEffect(()=>{
    let current=true;const id=user?.id;setActiveVisit(null);
    if(!id){busy.current=false;setLoading(false);return;}
    busy.current=true;setLoading(true);
    visitsRepo.active().then(saved=>{if(current&&owner.current===id)setActiveVisit(activeState(saved));})
      .catch(error=>{if(current&&owner.current===id)Alert.alert('Ziyaret yüklenemedi',error.message||'Şirket sunucusunu kontrol edip yeniden deneyin.');})
      .finally(()=>{if(current&&owner.current===id){busy.current=false;setLoading(false);}});
    return()=>{current=false;busy.current=false;};
  },[user?.id]);
  const checkIn=async(customerId:string,_customerName:string)=>{
    const id=owner.current;if(!id||busy.current)return false;
    busy.current=true;setLoading(true);
    try{
      const permission=await Location.requestForegroundPermissionsAsync();
      if(permission.status!=='granted')throw new Error('Konum izni olmadan ziyaret başlatılamaz.');
      const location=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      if(owner.current!==id)return false;
      const saved=await visitsRepo.start(customerId,location.coords.latitude,location.coords.longitude);
      if(owner.current!==id)return false;
      const active=activeState(saved);if(!active)throw new Error('Aktif ziyaret sunucudan doğrulanamadı.');
      setActiveVisit(active);return true;
    }catch(error:any){if(owner.current===id)Alert.alert('Ziyaret başlatılamadı',error.message||'Sunucu kaydı doğrulanamadı. Kayıtları yenileyip kontrol edin.');return false;}
    finally{if(owner.current===id){busy.current=false;setLoading(false);}}
  };
  const checkOut=async(notes?:string,photos?:string[])=>{
    const id=owner.current,visit=activeVisit;if(!id||!visit||busy.current)return false;
    busy.current=true;setLoading(true);
    try{
      const location=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      if(owner.current!==id)return false;
      const saved=await visitsRepo.finish(visit.id,visit.revision,location.coords.latitude,location.coords.longitude,notes,photos);
      if(owner.current!==id)return false;
      if(saved.visit?.status!=='completed'||!saved.visit.end_at)throw new Error('Ziyaret çıkışı sunucudan doğrulanamadı.');
      setActiveVisit(null);Alert.alert('Başarılı',`${visit.customerName} ziyareti tamamlandı.`);return true;
    }catch(error:any){if(owner.current===id)Alert.alert('Ziyaret tamamlanamadı',error.message||'Sunucu kaydı doğrulanamadı. Kayıtları yenileyip kontrol edin.');return false;}
    finally{if(owner.current===id){busy.current=false;setLoading(false);}}
  };
  return <VisitContext.Provider value={{activeVisit,checkIn,checkOut,loading}}>{children}</VisitContext.Provider>;
}
export function useVisit(){const ctx=useContext(VisitContext);if(!ctx)throw new Error('useVisit must be used within VisitProvider');return ctx;}
