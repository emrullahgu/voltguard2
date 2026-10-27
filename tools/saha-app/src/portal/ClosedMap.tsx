import React from 'react'; import {View,Text} from 'react-native';
export type LatLng={latitude:number;longitude:number}; export type Region=LatLng&{latitudeDelta:number;longitudeDelta:number};
export const PROVIDER_GOOGLE='server-unconfigured'; export const PROVIDER_DEFAULT=undefined;
const Empty=()=>null; export const Marker=Empty; export const Polyline=Empty; export const Polygon=Empty; export const Circle=Empty; export const Callout=Empty;
const MapView=React.forwardRef<any,any>((props,ref)=>{React.useImperativeHandle(ref,()=>({animateToRegion(){},fitToCoordinates(){},animateCamera(){}}));return <View style={[{minHeight:180,padding:24,backgroundColor:'#e9eef4',justifyContent:'center'},props.style]}><Text accessibilityRole="alert" style={{color:'#12243a',fontSize:15,lineHeight:23}}>Harita hizmeti Ubuntu sunucusunda yapılandırılmadı. Konum verileri harita sağlayıcısına gönderilmez.</Text></View>}); export default MapView;
