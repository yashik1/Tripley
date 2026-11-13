import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMembers } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

type Kind = 'mission' | 'scavenger' | 'soundtrack' | 'food';
type Entry = { id:string; kind:Kind; title:string; details:string; created_by:string; assigned_to:string|null; is_complete:boolean; completed_by:string|null };
type Vote = { id:string; award_key:string; voter_id:string; nominee_id:string };
const features = [
 ['wheel','🎡','Spin the Adventure Wheel','Let the group decide what to do next'],
 ['mission','🕵️','Secret Missions','Give a friend a fun undercover task'],
 ['scavenger','🧭','Adventure Scavenger Hunt','Collect moments and complete challenges'],
 ['awards','🏆','Trip Awards','Vote for the people who made the trip'],
 ['soundtrack','🎵','Trip Soundtrack','Save the songs attached to your memories'],
 ['food','🍜','Food Explorer','Keep a shared list of local dishes and finds'],
 ['timeline','📖','Living Trip Timeline','A growing record of the fun you shared'],
] as const;
const awards = [['food_scout','Food Scout'],['photo_pro','Photo Pro'],['human_gps','Human GPS'],['adventure_seeker','Adventure Seeker'],['best_planner','Best Planner'],['comic_relief','Comic Relief'],['early_bird','Early Bird'],['last_ready','Last Ready']] as const;
const hunt = ['Find a hidden local street-art piece','Try a dish you cannot pronounce yet','Take a group photo with a local landmark','Find the best view in the area','Ask a local for one place tourists miss','Spot something in the trip colour','Find a market or independent shop','Capture a funny travel sign'];

export default function TripFunScreen() {
 const {id}=useLocalSearchParams<{id:string}>();
 const membersQuery=useMembers(id), members=membersQuery.data??[];
 const [user,setUser]=useState(''),[feature,setFeature]=useState(''),[entries,setEntries]=useState<Entry[]>([]),[votes,setVotes]=useState<Vote[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[title,setTitle]=useState(''),[details,setDetails]=useState(''),[assignee,setAssignee]=useState('');
 const load=useCallback(async()=>{
  if(!id)return; setLoading(true);
  const [auth,e,v]=await Promise.all([supabase.auth.getUser(),supabase.from('trip_fun_entries').select('*').eq('trip_id',id).order('created_at',{ascending:false}),supabase.from('trip_fun_votes').select('*').eq('trip_id',id)]);
  setUser(auth.data.user?.id??''); if(e.error)Alert.alert('Could not load Trip Fun',e.error.message); else setEntries((e.data??[]) as Entry[]);
  if(!v.error)setVotes((v.data??[]) as Vote[]); setLoading(false);
 },[id]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(!id)return;const channel=supabase.channel('trip-fun-screen:'+id).on('postgres_changes',{event:'*',schema:'public',table:'trip_fun_entries',filter:'trip_id=eq.'+id},()=>{void load()}).on('postgres_changes',{event:'*',schema:'public',table:'trip_fun_votes',filter:'trip_id=eq.'+id},()=>{void load()}).subscribe();return()=>{void supabase.removeChannel(channel)}},[id,load]);
 const add=async(kind:Kind,preset?:string)=>{
  const name=(preset??title).trim(); if(!name||!user)return;
  if(kind==='mission'&&!assignee){Alert.alert('Choose a traveller','Secret missions need someone to receive them.');return}
  setSaving(true); const {error}=await supabase.from('trip_fun_entries').insert({trip_id:id,kind,title:name,details:details.trim(),created_by:user,assigned_to:kind==='mission'?assignee:null});
  setSaving(false); if(error)Alert.alert('Could not save',error.message);else{setTitle('');setDetails('');setAssignee('');await load()}
 };
 const complete=async(e:Entry)=>{const done=!e.is_complete;const {error}=await supabase.from('trip_fun_entries').update({is_complete:done,completed_by:done?user:null,completed_at:done?new Date().toISOString():null}).eq('id',e.id);if(error)Alert.alert('Could not update',error.message);else await load()};
 const vote=async(key:string,nominee:string)=>{
  if(!user||nominee===user)return;const old=votes.find(v=>v.award_key===key&&v.voter_id===user);
  const result=old?await supabase.from('trip_fun_votes').update({nominee_id:nominee}).eq('id',old.id):await supabase.from('trip_fun_votes').insert({trip_id:id,award_key:key,voter_id:user,nominee_id:nominee});
  if(result.error)Alert.alert('Could not save vote',result.error.message);else await load();
 };
 const name=(uid:string)=>members.find(m=>m.user_id===uid)?.profile?.display_name||'Traveller';
 const visible=useMemo(()=>entries.filter(e=>feature==='mission'?e.kind==='mission':feature==='scavenger'?e.kind==='scavenger':feature==='soundtrack'?e.kind==='soundtrack':feature==='food'?e.kind==='food':true),[entries,feature]);
 const wheel=()=>{const options=['Try a local café or bakery','Take a scenic walk somewhere new','Visit a market','Find a viewpoint for sunset','Try a food you have never had','Explore a neighbourhood without a plan','Play a group photo challenge','Ask a local for a recommendation',...entries.filter(e=>e.kind==='food'||e.kind==='scavenger').map(e=>e.title)];Alert.alert('🎡 The wheel picked…',options[Math.floor(Math.random()*options.length)])};
 const kind:Kind|null=feature==='mission'?'mission':feature==='scavenger'?'scavenger':feature==='soundtrack'?'soundtrack':feature==='food'?'food':null;
 const addLabel=feature==='mission'?'Assign mission':feature==='scavenger'?'Add hunt challenge':feature==='soundtrack'?'Save song':'Add food find';
 return <ScrollView contentContainerStyle={{padding:18,gap:14,backgroundColor:'#F7F8FC',minHeight:'100%'}}>
  <View style={{gap:5}}><Text style={{color:'#17233B',fontSize:27,fontWeight:'800'}}>Trip Fun ✨</Text><Text style={{color:'#64748B',fontSize:14,lineHeight:21}}>Little games, shared discoveries and memories that make this trip yours.</Text></View>
  {!feature?<View style={{gap:10}}>{features.map(f=><Pressable key={f[0]} onPress={()=>setFeature(f[0])} style={tile}><Text style={{fontSize:27}}>{f[1]}</Text><View style={{flex:1,gap:3}}><Text style={tileTitle}>{f[2]}</Text><Text style={muted}>{f[3]}</Text></View><Text style={{color:'#64748B',fontSize:20}}>›</Text></Pressable>)}<Text style={{color:'#94A3B8',fontSize:11,textAlign:'center'}}>All Trip Fun activities are currently included in the free plan.</Text></View>:
  <View style={{gap:13}}>
   <Pressable onPress={()=>setFeature('')}><Text style={{color:'#315FC4',fontWeight:'700'}}>‹ All Trip Fun features</Text></Pressable>
   <View style={{backgroundColor:'#EAF0FF',borderRadius:17,padding:16,gap:5}}><Text style={{fontSize:25}}>{features.find(f=>f[0]===feature)?.[1]}</Text><Text style={{fontSize:20,fontWeight:'800',color:'#17233B'}}>{features.find(f=>f[0]===feature)?.[2]}</Text><Text style={muted}>{features.find(f=>f[0]===feature)?.[3]}</Text></View>
   {feature==='wheel'?<View style={panel}><Text style={{fontSize:56,textAlign:'center'}}>🎡</Text><Text style={muted}>Can't decide? Let chance choose an activity for the group.</Text><Pressable onPress={wheel} style={primary}><Text style={white}>Spin the wheel</Text></Pressable></View>:
   feature==='awards'?<View style={{gap:10}}>{awards.map(([key,label])=>{const mine=votes.find(v=>v.award_key===key&&v.voter_id===user);return <View key={key} style={panel}><Text style={tileTitle}>🏅 {label}</Text><Text style={muted}>{mine?'Your vote is saved. Tap another name to change it.':'Who deserves this one?'}</Text>{members.map(m=>{const n=m.user_id, count=votes.filter(v=>v.award_key===key&&v.nominee_id===n).length;return <Pressable key={n} disabled={n===user} onPress={()=>void vote(key,n)} style={[voteRow,mine?.nominee_id===n?{backgroundColor:'#EAF0FF'}:null]}><Text style={{color:n===user?'#94A3B8':'#26344D'}}>{m.profile?.display_name||'Traveller'}{n===user?' (you)':''}</Text><Text style={{color:'#315FC4',fontWeight:'700'}}>{count} votes {mine?.nominee_id===n?'✓':''}</Text></Pressable>})}</View>})}</View>:
   feature==='timeline'?<View style={{gap:9}}>{visible.length?visible.map(e=><EntryCard key={e.id} e={e} name={name} complete={()=>void complete(e)}/>):<Empty text="Your trip story will appear here as you add food finds, songs, missions and challenges."/>}</View>:
   <View style={{gap:12}}>
    {feature==='scavenger'?<View style={panel}><Text style={tileTitle}>Starter challenges</Text>{hunt.map((h,i)=><Pressable key={h} onPress={()=>void add('scavenger',h)} style={{paddingVertical:8,borderBottomWidth:i===hunt.length-1?0:1,borderColor:'#EEF1F6'}}><Text style={{color:'#315FC4'}}>＋ {h}</Text></Pressable>)}<Pressable onPress={()=>router.push(`/trip/${id}/post/new`)} style={{padding:10,backgroundColor:'#EAF0FF',borderRadius:9}}><Text style={{color:'#315FC4',fontWeight:'700'}}>📸 Add photo proof in the trip feed</Text></Pressable></View>:null}
    <View style={panel}><Text style={tileTitle}>{addLabel}</Text><TextInput value={title} onChangeText={setTitle} placeholder={feature==='mission'?'e.g. Get the group to say “wow”':feature==='soundtrack'?'Song title — artist':feature==='food'?'Dish or place name':'Challenge title'} placeholderTextColor="#94A3B8" style={input}/><TextInput value={details} onChangeText={setDetails} placeholder={feature==='soundtrack'?'Music link or memory (optional)':'Add a note (optional)'} placeholderTextColor="#94A3B8" multiline style={[input,{minHeight:70,textAlignVertical:'top'}]}/>
    {feature==='mission'?<View style={{gap:7}}><Text style={muted}>Assign to</Text>{members.filter(m=>m.user_id!==user).map(m=><Pressable key={m.user_id} onPress={()=>setAssignee(m.user_id)} style={[voteRow,assignee===m.user_id?{backgroundColor:'#EAF0FF'}:null]}><Text style={{color:'#26344D'}}>{m.profile?.display_name||'Traveller'} {assignee===m.user_id?'✓':''}</Text></Pressable>)}</View>:null}
    <Pressable disabled={saving||!title.trim()} onPress={()=>kind&&void add(kind)} style={[primary,{opacity:saving||!title.trim()?0.5:1}]}><Text style={white}>{saving?'Saving…':addLabel}</Text></Pressable></View>
    <View style={{gap:9}}>{visible.map(e=><EntryCard key={e.id} e={e} name={name} complete={()=>void complete(e)}/>)}{!visible.length?<Empty text="Nothing here yet. Add the first one above and it will be shared with the trip."/>:null}</View>
   </View>}
   {loading?<ActivityIndicator color="#315FC4"/>:null}
  </View>}
 </ScrollView>;
}
function EntryCard({e,name,complete}:{e:Entry;name:(id:string)=>string;complete:()=>void}){return <View style={panel}><Text style={tileTitle}>{e.kind==='mission'?'🤫':e.kind==='scavenger'?'🧭':e.kind==='food'?'🍽️':'🎵'} {e.title}</Text>{e.details?<Text style={muted}>{e.details}</Text>:null}<Text style={{color:'#94A3B8',fontSize:11}}>{e.kind==='mission'?'Secret mission':'Added by '+name(e.created_by)}{e.assigned_to?' · For '+name(e.assigned_to):''}</Text>{e.kind==='mission'||e.kind==='scavenger'?<Pressable onPress={complete} style={{alignSelf:'flex-start',backgroundColor:e.is_complete?'#E8F7EF':'#EAF0FF',padding:9,borderRadius:9}}><Text style={{color:e.is_complete?'#18794E':'#315FC4',fontWeight:'700'}}>{e.is_complete?'✓ Completed':'Mark complete'}</Text></Pressable>:null}</View>}
function Empty({text}:{text:string}){return <View style={panel}><Text style={[muted,{textAlign:'center',lineHeight:20}]}>{text}</Text></View>}
const tile={backgroundColor:'#FFFFFF',borderRadius:17,padding:16,borderWidth:1,borderColor:'#E5EAF2',flexDirection:'row',alignItems:'center',gap:13} as const;
const tileTitle={color:'#17233B',fontWeight:'700',fontSize:15} as const;
const muted={color:'#64748B',fontSize:13} as const;
const panel={backgroundColor:'#FFFFFF',borderRadius:15,padding:14,gap:9,borderWidth:1,borderColor:'#E8EDF5'} as const;
const input={backgroundColor:'#F7F8FC',borderColor:'#E5EAF2',borderWidth:1,borderRadius:10,padding:12,color:'#17233B',fontSize:14} as const;
const primary={backgroundColor:'#315FC4',borderRadius:11,padding:13,alignItems:'center'} as const;
const white={color:'#FFFFFF',fontWeight:'800',textAlign:'center'} as const;
const voteRow={padding:9,borderRadius:9,backgroundColor:'#F7F8FC',flexDirection:'row',justifyContent:'space-between'} as const;
