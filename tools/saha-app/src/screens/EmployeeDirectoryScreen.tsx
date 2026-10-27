import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { useAppContext } from '../context/AppContext';
import RoleGuard from '../components/RoleGuard';
import EmptyState from '../components/EmptyState';
import { colors, radius, spacing, typography } from '../theme';
import { matchesAnyField } from '../utils/search';
import { FLATLIST_DEFAULTS } from '../utils/perf';

function EmployeeDirectory() {
  const navigation=useNavigation<NativeStackNavigationProp<RootStackParamList,'Employees'>>();
  const {employees,refresh,syncState}=useAppContext();
  const [query,setQuery]=useState(''),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
  const filtered=useMemo(()=>employees.filter(employee=>matchesAnyField([employee.name,employee.role],query)),[employees,query]);
  const reload=async()=>{
    if(refreshing)return;setRefreshing(true);setError('');
    try{await refresh();}catch(e:any){setError(e?.message||'Personel listesi yenilenemedi.');}finally{setRefreshing(false);}
  };
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <View style={styles.heading}><Text style={styles.title}>Personel ve hesap bağlantıları</Text><Text style={styles.description}>Personel kaydını açarak mevcut çalışan hesabı bağlantısını, puantajı ve ücret bilgilerini yönetin.</Text></View>
    <View style={styles.toolbar}><View style={styles.search}><Ionicons name="search-outline" size={18} color={colors.text.muted}/><TextInput value={query} onChangeText={setQuery} style={styles.input} placeholder="Ad veya görev ara" placeholderTextColor={colors.text.faint} accessibilityLabel="Personel ara" autoCorrect={false}/></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Personel listesini yenile" disabled={refreshing} onPress={reload} style={styles.reload}><Ionicons name="refresh-outline" size={21} color={colors.text.primary}/></TouchableOpacity></View>
    {(error||syncState==='error')&&<Text accessibilityRole="alert" style={styles.error}>{error||'Güncel personel listesi yüklenemedi. Bağlantıyı kontrol edip listeyi yenileyin.'}</Text>}
    <Text style={styles.count}>{filtered.length} personel</Text>
    <FlatList {...FLATLIST_DEFAULTS} data={filtered} keyExtractor={employee=>employee.id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload}/>}
      ListEmptyComponent={syncState==='syncing'?<ActivityIndicator color={colors.text.muted}/>:syncState==='error'||error?null:<EmptyState icon="people-outline" title={query.trim()?'Personel bulunamadı':'Henüz personel kaydı yok'} subtitle={query.trim()?'Farklı bir ad veya görevle arayın.':'Mevcut personel kayıtları yüklendiğinde burada listelenir.'}/>}
      renderItem={({item})=><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.name} personel kaydını aç`} style={styles.card} onPress={()=>navigation.navigate('EmployeeDetail',{employeeId:item.id})}>
        <View style={styles.avatar}><Ionicons name="person-outline" size={23} color={colors.text.primary}/></View><View style={styles.copy}><Text style={styles.name}>{item.name}</Text><Text style={styles.role}>{item.role||'Görev belirtilmedi'}</Text><Text style={styles.binding}>Puantaj, ücret ve hesap bağlantısı</Text></View><Ionicons name="chevron-forward" size={20} color={colors.text.muted}/>
      </TouchableOpacity>}/>
  </SafeAreaView>;
}
export default function EmployeeDirectoryScreen(){return <RoleGuard allow={['admin','manager']} fallback={<Text style={styles.error}>Personel yönetimi için yönetici veya bordro yetkisi gerekiyor.</Text>}><EmployeeDirectory/></RoleGuard>;}
const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.bg.primary},heading:{padding:spacing.lg,gap:spacing.sm},title:{fontSize:typography.xl,fontWeight:'800',color:colors.text.primary},description:{fontSize:typography.base,lineHeight:21,color:colors.text.muted},
  toolbar:{flexDirection:'row',gap:spacing.sm,paddingHorizontal:spacing.lg},search:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:spacing.sm,borderWidth:1,borderColor:colors.border.primary,borderRadius:radius.md,backgroundColor:colors.bg.secondary,paddingHorizontal:spacing.md},input:{flex:1,minWidth:0,minHeight:46,color:colors.text.primary,fontSize:typography.base},reload:{minHeight:46,minWidth:46,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border.primary,borderRadius:radius.md},
  count:{paddingHorizontal:spacing.lg,paddingVertical:spacing.md,fontSize:typography.sm,color:colors.text.muted},list:{paddingHorizontal:spacing.lg,paddingBottom:spacing.xl},card:{flexDirection:'row',alignItems:'center',gap:spacing.md,padding:spacing.md,marginBottom:spacing.sm,borderWidth:1,borderColor:colors.border.primary,borderRadius:radius.lg,backgroundColor:colors.bg.secondary},avatar:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:radius.md,backgroundColor:colors.emerald.bg},copy:{flex:1,minWidth:0,gap:4},name:{fontSize:typography.md,fontWeight:'700',color:colors.text.primary},role:{fontSize:typography.base,color:colors.text.muted},binding:{fontSize:typography.sm,color:colors.text.muted},error:{margin:spacing.lg,fontSize:typography.base,color:colors.rose.default},
});
