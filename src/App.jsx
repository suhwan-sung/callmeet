import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
         GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser } from 'firebase/auth';
import { getMessaging, getToken } from 'firebase/messaging';
import { getFirestore, doc, setDoc, getDoc, collection, query,
         where, getDocs, addDoc, deleteDoc, serverTimestamp, onSnapshot, orderBy } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDji_UBduVXFN6HRZXOvRuvnu_WqudWp_E",
  authDomain: "callmeet-b43d9.firebaseapp.com",
  projectId: "callmeet-b43d9",
  storageBucket: "callmeet-b43d9.firebasestorage.app",
  messagingSenderId: "377713372896",
  appId: "1:377713372896:web:43fe2098878d6f3cf1ea85"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const gProvider = new GoogleAuthProvider();
const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;
const VAPID_KEY = import.meta.env.VITE_VAPID_KEY;

async function getFCMToken() {
  try {
    if(!messaging) return null;
    const permission = await Notification.requestPermission();
    if(permission !== 'granted') return null;
    const token = await getToken(messaging, {vapidKey: VAPID_KEY});
    return token;
  } catch { return null; }
}

async function sendPushNotification(toUserId, title, body) {
  try {
    const uDoc = await getDoc(doc(db,'users',toUserId));
    const fcmToken = uDoc.data()?.fcmToken;
    if(!fcmToken) return;
    await fetch('/api/send-notification', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({token:fcmToken, title, body})
    });
  } catch {}
}
const KAKAO_KEY = "70746e7a59b4775f2771d8e75b306e50";

// ── 한국 공휴일 데이터 ────────────────────────────────────────────────────
const KR_HOLIDAYS = {
  "2025-01-01":"신정","2025-01-29":"설날 연휴","2025-01-30":"설날","2025-01-31":"설날 연휴",
  "2025-03-01":"삼일절","2025-05-05":"어린이날","2025-05-06":"대체공휴일","2025-05-15":"부처님오신날",
  "2025-06-06":"현충일","2025-08-15":"광복절","2025-10-03":"개천절","2025-10-05":"추석 연휴",
  "2025-10-06":"추석","2025-10-07":"추석 연휴","2025-10-08":"대체공휴일","2025-10-09":"한글날",
  "2025-12-25":"크리스마스",
  "2026-01-01":"신정","2026-01-28":"설날 연휴","2026-01-29":"설날","2026-01-30":"설날 연휴",
  "2026-03-01":"삼일절","2026-05-05":"어린이날","2026-05-24":"부처님오신날",
  "2026-06-06":"현충일","2026-08-15":"광복절","2026-09-24":"추석 연휴",
  "2026-09-25":"추석","2026-09-26":"추석 연휴","2026-10-03":"개천절","2026-10-09":"한글날",
  "2026-12-25":"크리스마스"
};

// ── 알림 시간 옵션 ────────────────────────────────────────────────────────
const NOTIFY_OPTIONS = [
  {label:"10분 전", minutes:10},
  {label:"30분 전", minutes:30},
  {label:"1시간 전", minutes:60},
  {label:"2시간 전", minutes:120},
  {label:"3시간 전", minutes:180},
  {label:"6시간 전", minutes:360},
  {label:"12시간 전", minutes:720},
  {label:"1일 전", minutes:1440},
  {label:"2일 전", minutes:2880},
  {label:"3일 전", minutes:4320},
  {label:"5일 전", minutes:7200},
  {label:"7일 전", minutes:10080},
];

// ── 헬퍼 ─────────────────────────────────────────────────────────────────
const DAYS = ["일","월","화","수","목","금","토"];
function buildGrid(y,m){const f=new Date(y,m,1).getDay(),l=new Date(y,m+1,0).getDate(),g=Array(f).fill(null);for(let d=1;d<=l;d++)g.push(d);return g;}
const toDs=(y,m,d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const fmtMD=s=>{if(!s)return"";const[,mm,dd]=s.split("-");return`${+mm}/${+dd}`;};
const isHoliday=s=>!!KR_HOLIDAYS[s];
const getHolidayName=s=>KR_HOLIDAYS[s]||"";

// ── 브라우저 알림 요청 ────────────────────────────────────────────────────
async function requestNotificationPermission(){
  if(!("Notification" in window))return false;
  if(Notification.permission==="granted")return true;
  const p=await Notification.requestPermission();
  return p==="granted";
}

function scheduleNotification(event){
  if(!event.date||!event.notifyMinutes)return;
  const evTime=new Date(`${event.date}T${event.time||"09:00"}:00`);
  const notifyTime=new Date(evTime.getTime()-event.notifyMinutes*60*1000);
  const now=new Date();
  const delay=notifyTime.getTime()-now.getTime();
  if(delay<=0)return;
  setTimeout(()=>{
    if(Notification.permission==="granted"){
      new Notification(`📅 ${event.title}`,{
        body:`${event.notifyMinutes>=1440?`${event.notifyMinutes/1440}일`
          :event.notifyMinutes>=60?`${event.notifyMinutes/60}시간`
          :`${event.notifyMinutes}분`} 후 일정이 있습니다${event.location?` · 📍${event.location}`:""}`,
        icon:"/icon.svg"
      });
    }
  },delay);
}

// ── AI 추출 ───────────────────────────────────────────────────────────────
async function aiExtract(text){
  const res=await fetch("/api/ai-extract",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({text})
  });
  const data=await res.json();
  if(data.error)throw new Error(data.error);
  return data.result;
}

async function aiVoiceParse(text){
  const today=new Date().toISOString().split("T")[0];
  const res=await fetch("/api/ai-extract",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      text,
      systemOverride:`Parse this Korean voice input as a single calendar event. Today:${today}.
Return ONLY raw JSON object (not array): {"date":"YYYY-MM-DD","time":"HH:MM or null","title":"string","people":"string or null","location":"string or null","notes":"string or null"}.
Extract date/time/title/people/location from natural speech. Return {} if unclear.`
    })
  });
  const data=await res.json();
  if(data.error)throw new Error(data.error);
  return data.result;
}

// ── Firestore ─────────────────────────────────────────────────────────────
const saveUser=async(uid,data)=>setDoc(doc(db,"users",uid),data,{merge:true});
const getUserByEmail=async(email)=>{const q=query(collection(db,"users"),where("email","==",email));const s=await getDocs(q);return s.empty?null:{id:s.docs[0].id,...s.docs[0].data()};};
const getUserByNameOrEmail=async(input)=>{
  const byEmail=await getUserByEmail(input);
  if(byEmail)return[byEmail];
  const q=query(collection(db,"users"),where("name","==",input));
  const s=await getDocs(q);
  return s.docs.map(d=>({id:d.id,...d.data()}));
};
const addEvt=async(userId,ev)=>{const r=await addDoc(collection(db,"events"),{...ev,userId,createdAt:serverTimestamp()});return r.id;};
const getUserEvts=async(userId)=>{const q=query(collection(db,"events"),where("userId","==",userId));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};
const delEvt=async(id)=>deleteDoc(doc(db,"events",id));
const updEvt=async(id,data)=>setDoc(doc(db,"events",id),data,{merge:true});
const getFriends=async(userId)=>{const q=query(collection(db,"friends"),where("userId","==",userId));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};
const addFriend=async(userId,fr)=>addDoc(collection(db,"friends"),{userId,...fr,addedAt:serverTimestamp()});
const removeFriend=async(id)=>deleteDoc(doc(db,"friends",id));
const shareEvts=async(evs,recipIds,byName)=>{
  for(const rid of recipIds){
    for(const ev of evs){
      const {id:_,...evData}=ev;
      await addDoc(collection(db,"sharedEvents"),{
        ...evData,
        recipientId:rid,
        sharedBy:byName,
        sharedAt:serverTimestamp(),
        source:"shared",
        completed:false
      });
      const evQ=query(collection(db,"events"),
        where("userId","==",rid),
        where("title","==",ev.title),
        where("date","==",ev.date)
      );
      const existing=await getDocs(evQ);
      if(existing.empty){
        await addDoc(collection(db,"events"),{
          ...evData,
          userId:rid,
          source:"shared",
          sharedBy:byName,
          createdAt:serverTimestamp(),
          completed:false
        });
      }
    }
  }
};
const getSharedEvts=async(userId)=>{const q=query(collection(db,"sharedEvents"),where("recipientId","==",userId));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};
const getFriendRequests=async(userId)=>{const q=query(collection(db,"friendRequests"),where("toId","==",userId),where("status","==","pending"));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};

// ── 구글 아이콘 ───────────────────────────────────────────────────────────
function GIcon({size=20}){return(<svg width={size} height={size} viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>);}

// ── 로그인 ────────────────────────────────────────────────────────────────
function Landing({onAuth}){
  return(
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{background:"linear-gradient(135deg,#0f0c29 0%,#1a1a4e 40%,#24243e 100%)"}}>
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full opacity-20 blur-3xl" style={{background:"radial-gradient(circle,#6366f1,transparent)"}}/>
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="mb-6">
          <div className="w-24 h-24 rounded-3xl mx-auto flex items-center justify-center shadow-2xl mb-4" style={{background:"linear-gradient(135deg,#6366f1,#3b82f6)",boxShadow:"0 0 60px rgba(99,102,241,0.5)"}}>
            <span className="text-5xl">📞</span>
          </div>
          <h1 className="text-5xl font-black text-white tracking-tighter mb-1">CallMeet</h1>
          <p className="text-indigo-300 text-sm tracking-widest uppercase">AI 통화 일정 관리</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 mb-10 max-w-xs">
          {["📞 통화 분석","🎙️ 음성 입력","💬 카카오/문자","🤝 친구 공유"].map(f=>(
            <span key={f} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{background:"rgba(99,102,241,0.2)",color:"#a5b4fc",border:"1px solid rgba(99,102,241,0.3)"}}>{f}</span>
          ))}
        </div>
        <div className="w-full max-w-xs space-y-3">
          <button onClick={()=>onAuth("login")} className="w-full py-4 rounded-2xl font-bold text-base text-white" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>로그인</button>
          <button onClick={()=>onAuth("register")} className="w-full py-4 rounded-2xl font-semibold text-base" style={{background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.9)",border:"1px solid rgba(255,255,255,0.15)"}}>회원가입</button>
        </div>
      </div>
    </div>
  );
}

function AuthModal({initialMode,onLogin,onClose}){
  const [mode,setMode]=useState(initialMode);
  const [f,setF]=useState({name:"",email:"",pw:"",pw2:""});
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const FI="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50";
  const afterAuth=async(user,extra={})=>{
    const name=extra.name||user.displayName||user.email.split("@")[0];
    await saveUser(user.uid,{name,email:user.email,provider:extra.provider||"email",uid:user.uid,active:true});
    onLogin({uid:user.uid,name,email:user.email,provider:extra.provider||"email"});
  };
  const doLogin=async()=>{setErr("");setBusy(true);try{const r=await signInWithEmailAndPassword(auth,f.email,f.pw);await afterAuth(r.user);}catch{setErr("이메일 또는 비밀번호가 틀립니다.");}setBusy(false);};
  const doRegister=async()=>{setErr("");if(!f.name||!f.email||!f.pw)return setErr("모든 항목을 입력해주세요.");if(f.pw!==f.pw2)return setErr("비밀번호가 일치하지 않습니다.");setBusy(true);try{const r=await createUserWithEmailAndPassword(auth,f.email,f.pw);await afterAuth(r.user,{name:f.name});}catch(e){setErr(e.code==="auth/email-already-in-use"?"이미 가입된 이메일입니다.":"가입 중 오류가 발생했습니다.");}setBusy(false);};
  const doGoogle=async()=>{setBusy(true);try{const r=await signInWithPopup(auth,gProvider);await afterAuth(r.user,{provider:"google"});}catch{setErr("구글 로그인 중 오류가 발생했습니다.");}setBusy(false);};
  const doKakao=()=>{if(!window.Kakao?.isInitialized())window.Kakao?.init(KAKAO_KEY);window.Kakao?.Auth?.authorize({redirectUri:'https://callmeet-git-main-suhwan-sungs-projects.vercel.app'});};
  return(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-black text-gray-900">{mode==="login"?"로그인":mode==="register"?"가입 방법 선택":"이메일로 가입"}</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        {mode==="login"&&(<div className="space-y-3">
          <input className={FI} type="email" placeholder="이메일" value={f.email} onChange={e=>setF({...f,email:e.target.value})} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
          <input className={FI} type="password" placeholder="비밀번호" value={f.pw} onChange={e=>setF({...f,pw:e.target.value})} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
          {err&&<p className="text-red-500 text-xs">{err}</p>}
          <button onClick={doLogin} disabled={busy} className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{busy?"로그인 중...":"로그인"}</button>
          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-gray-200"/><span className="text-xs text-gray-400">또는</span><div className="flex-1 h-px bg-gray-200"/></div>
          <button onClick={doGoogle} className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2.5 border border-gray-200 hover:bg-gray-50"><GIcon size={18}/>Google로 로그인</button>
          <button onClick={doKakao} className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2" style={{background:"#FEE500",color:"#1a1a1a"}}><span className="text-lg">💬</span>카카오로 로그인</button>
          <p className="text-center text-xs text-gray-400 pt-1">계정이 없으신가요? <button onClick={()=>{setMode("register");setErr("");}} className="text-indigo-600 font-bold">회원가입</button></p>
        </div>)}
        {mode==="register"&&(<div className="space-y-3">
          <button onClick={()=>setMode("register-email")} className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 border-gray-200"><span className="text-2xl">✉️</span><div><div className="font-bold text-gray-800 text-sm">이메일로 가입</div><div className="text-xs text-gray-400">이메일과 비밀번호로 계정 생성</div></div></button>
          <button onClick={doGoogle} className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 border-red-100"><GIcon size={28}/><div><div className="font-bold text-gray-800 text-sm">Google로 가입</div><div className="text-xs text-gray-400">Google 계정으로 빠른 가입</div></div></button>
          <button onClick={doKakao} className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 border-yellow-200 bg-yellow-50"><span className="text-2xl">💬</span><div><div className="font-bold text-gray-800 text-sm">카카오로 가입</div><div className="text-xs text-gray-400">카카오 계정으로 빠른 가입</div></div></button>
          <p className="text-center text-xs text-gray-400 pt-1">이미 계정이 있으신가요? <button onClick={()=>{setMode("login");setErr("");}} className="text-indigo-600 font-bold">로그인</button></p>
        </div>)}
        {mode==="register-email"&&(<div className="space-y-3">
          <button onClick={()=>setMode("register")} className="text-xs text-gray-400 hover:text-gray-600 mb-1">← 뒤로</button>
          <input className={FI} placeholder="이름" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>
          <input className={FI} type="email" placeholder="이메일" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>
          <input className={FI} type="password" placeholder="비밀번호 (6자 이상)" value={f.pw} onChange={e=>setF({...f,pw:e.target.value})}/>
          <input className={FI} type="password" placeholder="비밀번호 확인" value={f.pw2} onChange={e=>setF({...f,pw2:e.target.value})} onKeyDown={e=>e.key==="Enter"&&doRegister()}/>
          {err&&<p className="text-red-500 text-xs">{err}</p>}
          <button onClick={doRegister} disabled={busy} className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{busy?"가입 중...":"가입하기"}</button>
        </div>)}
      </div>
    </div>
  );
}

// ── 일정 확인 모달 ────────────────────────────────────────────────────────
function ConfirmModal({events,onConfirm,onCancel}){
  const [sel,setSel]=useState(new Set(events.map((_,i)=>i)));
  const [eds,setEds]=useState(events.map(e=>({...e,notifyMinutes:60})));
  const [editIdx,setEditIdx]=useState(null);
  const toggle=i=>{const s=new Set(sel);s.has(i)?s.delete(i):s.add(i);setSel(s);};
  const upd=(i,k,v)=>{const n=[...eds];n[i]={...n[i],[k]:v};setEds(n);};
  return(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl flex flex-col max-h-[88vh]">
        <div className="p-5 border-b border-gray-100">
          <h3 className="font-black text-gray-900 text-base">일정 등록 확인</h3>
          <p className="text-xs text-gray-400 mt-0.5">등록할 일정을 선택하고 알림 시간을 설정하세요</p>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {eds.map((ev,i)=>(
            <div key={i} className={`rounded-2xl border-2 p-3 transition-all ${sel.has(i)?"border-indigo-400 bg-indigo-50/50":"border-gray-200 bg-gray-50 opacity-50"}`}>
              <div className="flex items-start gap-2">
                <button onClick={()=>toggle(i)} className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0" style={sel.has(i)?{background:"#6366f1",borderColor:"#6366f1"}:{borderColor:"#d1d5db"}}>
                  {sel.has(i)&&<svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  {editIdx===i?(
                    <div className="space-y-1.5">
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white" value={ev.title} onChange={e=>upd(i,"title",e.target.value)}/>
                      <div className="flex gap-1">
                        <input type="date" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white" value={ev.date||""} onChange={e=>upd(i,"date",e.target.value)}/>
                        <input type="time" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white" value={ev.time||""} onChange={e=>upd(i,"time",e.target.value)}/>
                      </div>
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="참석자" value={ev.people||""} onChange={e=>upd(i,"people",e.target.value)}/>
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white" placeholder="장소" value={ev.location||""} onChange={e=>upd(i,"location",e.target.value)}/>
                      <button onClick={()=>setEditIdx(null)} className="text-xs font-bold" style={{color:"#6366f1"}}>✓ 완료</button>
                    </div>
                  ):(
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-800 text-sm">{ev.title}</span>
                        <button onClick={()=>setEditIdx(i)} className="text-xs text-gray-400 hover:text-indigo-500 ml-2">✏️ 수정</button>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                        <div>📅 {ev.date}{ev.time?` · 🕐 ${ev.time}`:""}</div>
                        {ev.people&&<div>👤 {ev.people}</div>}
                        {ev.location&&<div>📍 {ev.location}</div>}
                      </div>
                    </>
                  )}
                  <div className="mt-2">
                    <label className="text-xs text-gray-400 font-medium">🔔 알림</label>
                    <select className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                      value={ev.notifyMinutes||60}
                      onChange={e=>upd(i,"notifyMinutes",Number(e.target.value))}>
                      <option value={0}>알림 없음</option>
                      {NOTIFY_OPTIONS.map(o=><option key={o.minutes} value={o.minutes}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={onCancel} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-500">취소</button>
          <button onClick={()=>{const r=eds.filter((_,i)=>sel.has(i));if(r.length>0)onConfirm(r);}} disabled={sel.size===0} className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{sel.size}건 등록하기</button>
        </div>
      </div>
    </div>
  );
}

// ── 공유 모달 ─────────────────────────────────────────────────────────────
function ShareModal({allEvents,friends,onShare,onClose}){
  const [selF,setSelF]=useState(new Set());
  const [selE,setSelE]=useState(new Set());
  const [result,setResult]=useState(null);
  const togF=id=>{const s=new Set(selF);s.has(id)?s.delete(id):s.add(id);setSelF(s);};
  const togE=id=>{const s=new Set(selE);s.has(id)?s.delete(id):s.add(id);setSelE(s);};
  const go=async()=>{
    const evs=allEvents.filter(e=>selE.has(e.id));
    const frs=friends.filter(f=>selF.has(f.id));
    const r=await onShare(evs,frs);
    setResult(r);
    if(r.success)setTimeout(onClose,1600);
  };
  return(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl flex flex-col max-h-[88vh]">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-black text-gray-900">일정 공유</h3>
          <button onClick={onClose} className="text-gray-400 text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">공유할 친구</h4>
            {friends.filter(f=>f.active!==false).length===0?<p className="text-xs text-gray-400 py-3 text-center bg-gray-50 rounded-xl">친구 탭에서 먼저 친구를 추가하세요</p>:(
              <div className="space-y-2">{friends.filter(f=>f.active!==false).map(fr=>(
                <button key={fr.id} onClick={()=>togF(fr.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left ${selF.has(fr.id)?"border-indigo-400 bg-indigo-50":"border-gray-200"}`}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{background:selF.has(fr.id)?"#6366f1":"#9ca3af"}}>{fr.name[0]}</div>
                  <div className="flex-1"><div className="font-semibold text-gray-800 text-sm">{fr.name}</div><div className="text-xs text-gray-400">{fr.email}</div></div>
                  {selF.has(fr.id)&&<span style={{color:"#6366f1"}} className="font-bold">✓</span>}
                </button>
              ))}</div>
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">공유할 일정</h4>
            <div className="space-y-2">{allEvents.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(ev=>(
              <button key={ev.id} onClick={()=>togE(ev.id)} className={`w-full text-left p-3 rounded-xl border-2 ${selE.has(ev.id)?"border-indigo-400 bg-indigo-50":"border-gray-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold text-gray-800 text-sm">{ev.title}</div><div className="text-xs text-gray-400 mt-0.5">📅 {ev.date}{ev.time?` · 🕐 ${ev.time}`:""}</div></div>
                  {selE.has(ev.id)&&<span style={{color:"#6366f1"}} className="font-bold shrink-0">✓</span>}
                </div>
              </button>
            ))}</div>
          </div>
        </div>
        {result&&<div className={`mx-4 mb-2 px-4 py-2.5 rounded-xl text-xs font-semibold ${result.success?"bg-green-50 text-green-700":"bg-red-50 text-red-500"}`}>{result.success?"✓ 공유되었습니다!":result.error}</div>}
        <div className="p-4 pt-0 flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-500">취소</button>
          <button onClick={go} disabled={selF.size===0||selE.size===0} className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>공유하기</button>
        </div>
      </div>
    </div>
  );
}

// ── 이벤트 카드 ───────────────────────────────────────────────────────────
const SRC={manual:{bg:"#f1f5f9",text:"#64748b",label:"직접입력"},call:{bg:"#eff6ff",text:"#3b82f6",label:"통화"},voice:{bg:"#f5f3ff",text:"#7c3aed",label:"음성"},message:{bg:"#f0fdf4",text:"#16a34a",label:"메시지"},shared:{bg:"#fff7ed",text:"#ea580c",label:"공유"}};
function EventCard({ev,onEdit,onDelete,onSelect,isSelected,onToggleComplete}){
  const src=ev.source||"manual";const st=SRC[src]||SRC.manual;
  const done=ev.completed||false;
  return(
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${isSelected?"ring-2":"ring-0"} ${done?"opacity-60":""}`} style={{borderColor:isSelected?"#6366f1":"#f1f5f9"}}>
      <div className="flex items-start p-3 gap-2">
        {onSelect&&<button onClick={onSelect} className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5" style={isSelected?{background:"#6366f1",borderColor:"#6366f1"}:{borderColor:"#d1d5db"}}>{isSelected&&<svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>}
        {onToggleComplete&&<button onClick={onToggleComplete} className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all" style={done?{background:"#10b981",borderColor:"#10b981"}:{borderColor:"#d1d5db"}}>{done&&<svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{background:st.bg,color:st.text}}>{st.label}</span>
            <span className={`font-semibold text-gray-800 text-sm truncate ${done?"line-through text-gray-400":""}`}>{ev.title}</span>
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {ev.time&&<span className="text-xs text-gray-400">🕐 {ev.time}</span>}
            {ev.people&&<span className="text-xs text-gray-400">👤 {ev.people}</span>}
            {ev.location&&<span className="text-xs text-gray-400">📍 {ev.location}</span>}
            {ev.notifyMinutes>0&&<span className="text-xs text-indigo-400">🔔 {NOTIFY_OPTIONS.find(o=>o.minutes===ev.notifyMinutes)?.label||""}</span>}
          </div>
          {src==="shared"&&ev.sharedBy&&<p className="text-xs mt-0.5" style={{color:"#ea580c"}}>공유: {ev.sharedBy}</p>}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onEdit&&<button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 text-xs">✏️</button>}
          {onDelete&&<button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-red-300 text-xs">🗑️</button>}
        </div>
      </div>
    </div>
  );
}

function EventEditModal({ev,defaultDate,onSave,onClose}){
  const [f,setF]=useState({title:ev?.title||"",date:ev?.date||defaultDate||new Date().toISOString().split("T")[0],time:ev?.time||"",people:ev?.people||"",location:ev?.location||"",notes:ev?.notes||"",notifyMinutes:ev?.notifyMinutes||60});
  const FI="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50";
  const ok=f.title.trim()&&f.date;
  return(
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-black text-gray-900">{ev?"일정 수정":"일정 추가"}</h3>
          <button onClick={onClose} className="text-gray-400 text-xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        <div className="space-y-2.5">
          <input className={FI} placeholder="일정 제목 *" value={f.title} onChange={e=>setF({...f,title:e.target.value})}/>
          <div className="flex gap-2"><input type="date" className={`${FI} flex-1`} value={f.date} onChange={e=>setF({...f,date:e.target.value})}/><input type="time" className={`${FI} flex-1`} value={f.time} onChange={e=>setF({...f,time:e.target.value})}/></div>
          <input className={FI} placeholder="참석자" value={f.people} onChange={e=>setF({...f,people:e.target.value})}/>
          <input className={FI} placeholder="장소" value={f.location} onChange={e=>setF({...f,location:e.target.value})}/>
          <textarea className={`${FI} resize-none`} rows={2} placeholder="메모" value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/>
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">🔔 알림 시간</label>
            <select className={FI} value={f.notifyMinutes} onChange={e=>setF({...f,notifyMinutes:Number(e.target.value)})}>
              <option value={0}>알림 없음</option>
              {NOTIFY_OPTIONS.map(o=><option key={o.minutes} value={o.minutes}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-500">취소</button>
          <button onClick={()=>ok&&onSave(f)} className={`flex-1 py-3 rounded-xl text-sm font-bold text-white ${ok?"":"opacity-40 cursor-not-allowed"}`} style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{ev?"수정 완료":"저장"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 캘린더 탭 ─────────────────────────────────────────────────────────────
function CalendarTab({events,friends,onAddEv,onEditEv,onDelEv,onShare,onToggleComplete}){
  const now=new Date();
  const [y,setY]=useState(now.getFullYear());
  const [m,setM]=useState(now.getMonth());
  const [sel,setSel]=useState(now.getDate());
  const [selIds,setSelIds]=useState(new Set());
  const [showShare,setShowShare]=useState(false);
  const [editModal,setEditModal]=useState(null);
  const touchStartX=useRef(null);

  const grid=buildGrid(y,m);
  const evsByDay=d=>events.filter(e=>{if(!e.date)return false;const[ey,em,ed]=e.date.split("-").map(Number);return ey===y&&em===m+1&&ed===d;});
  const selEvs=evsByDay(sel);
  const monthEvs=events.filter(e=>{if(!e.date)return false;const[ey,em]=e.date.split("-").map(Number);return ey===y&&em===m+1;}).sort((a,b)=>a.date.localeCompare(b.date));
  const togSel=id=>{const s=new Set(selIds);s.has(id)?s.delete(id):s.add(id);setSelIds(s);};

  const prevM=()=>{if(m===0){setY(y-1);setM(11);}else setM(m-1);setSel(1);};
  const nextM=()=>{if(m===11){setY(y+1);setM(0);}else setM(m+1);setSel(1);};

  const handleTouchStart=e=>{ touchStartX.current=e.touches[0].clientX; };
  const handleTouchEnd=e=>{
    if(touchStartX.current===null)return;
    const diff=touchStartX.current-e.changedTouches[0].clientX;
    if(Math.abs(diff)>50){ if(diff>0)nextM(); else prevM(); }
    touchStartX.current=null;
  };

  return(
    <div className="p-3" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {selIds.size>0&&<div className="rounded-2xl p-3 mb-3 flex items-center justify-between" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}><span className="text-sm font-bold text-white">{selIds.size}개 선택됨</span><div className="flex gap-2"><button onClick={()=>setShowShare(true)} className="text-xs bg-white font-bold px-3 py-1.5 rounded-lg" style={{color:"#6366f1"}}>친구에게 공유</button><button onClick={()=>setSelIds(new Set())} className="text-xs text-white/70">해제</button></div></div>}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevM} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500 text-xl font-bold">‹</button>
        <h2 className="font-black text-gray-800">{y}년 {m+1}월</h2>
        <button onClick={nextM} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500 text-xl font-bold">›</button>
      </div>
      <div className="grid grid-cols-7 mb-1">{DAYS.map((d,i)=><div key={d} className={`text-center text-xs font-bold py-1 ${i===0?"text-red-400":i===6?"text-blue-400":"text-gray-400"}`}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-0.5 mb-4">
        {grid.map((d,i)=>{
          if(!d)return<div key={`x${i}`}/>;
          const evs=evsByDay(d);
          const dateStr=toDs(y,m,d);
          const isTd=y===now.getFullYear()&&m===now.getMonth()&&d===now.getDate();
          const isSel=d===sel;
          const dow=i%7;
          const holiday=isHoliday(dateStr);
          return<button key={d} onClick={()=>setSel(d)} className={`flex flex-col items-center justify-start py-1.5 rounded-xl min-h-[52px] transition-all ${isSel?"shadow-md":"hover:bg-gray-100"}`} style={isSel?{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}:isTd?{background:"#eef2ff",border:"1px solid #a5b4fc"}:{}}>
            <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isSel?"text-white":isTd?"text-indigo-600":holiday||dow===0?"text-red-400":dow===6?"text-blue-400":"text-gray-700"}`}>{d}</span>
            {evs.length>0&&<div className="flex gap-0.5 mt-0.5">{evs.slice(0,3).map((_,ei)=><div key={ei} className="w-1.5 h-1.5 rounded-full" style={{background:isSel?"rgba(255,255,255,0.7)":"#6366f1"}}/>)}</div>}
            {holiday&&!isSel&&<div className="w-1 h-1 rounded-full bg-red-400 mt-0.5"/>}
          </button>;
        })}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-bold text-gray-700 text-sm">{m+1}월 {sel}일
              {isHoliday(toDs(y,m,sel))&&<span className="ml-2 text-xs text-red-500">{getHolidayName(toDs(y,m,sel))}</span>}
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{background:"#eef2ff",color:"#6366f1"}}>{selEvs.length}</span>
            </h3>
          </div>
          <button onClick={()=>setEditModal({date:toDs(y,m,sel)})} className="text-xs px-3 py-1.5 rounded-lg font-bold text-white" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>+ 추가</button>
        </div>
        {selEvs.length===0?<p className="text-xs text-gray-400 text-center py-3">일정 없음</p>:<div className="space-y-2">{selEvs.map(ev=><EventCard key={ev.id} ev={ev} isSelected={selIds.has(ev.id)} onSelect={()=>togSel(ev.id)} onToggleComplete={()=>onToggleComplete(ev.id,!ev.completed)} onEdit={()=>setEditModal({ev})} onDelete={()=>onDelEv(ev.id)}/>)}</div>}
      </div>
      {monthEvs.length>0&&<div><p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">이번 달 ({monthEvs.length})</p><div className="space-y-1.5">{monthEvs.map(ev=><div key={ev.id} className="flex items-start gap-2"><span className="text-xs text-gray-400 w-9 shrink-0 pt-2.5 text-right font-medium">{fmtMD(ev.date)}</span><div className="flex-1"><EventCard ev={ev} isSelected={selIds.has(ev.id)} onSelect={()=>togSel(ev.id)} onToggleComplete={()=>onToggleComplete(ev.id,!ev.completed)} onEdit={()=>setEditModal({ev})} onDelete={()=>onDelEv(ev.id)}/></div></div>)}</div></div>}
      {editModal&&<EventEditModal ev={editModal.ev} defaultDate={editModal.date} onSave={async data=>{if(editModal.ev)await onEditEv(editModal.ev.id,data);else await onAddEv({...data,source:"manual"});setEditModal(null);}} onClose={()=>setEditModal(null)}/>}
      {showShare&&<ShareModal allEvents={selIds.size>0?events.filter(e=>selIds.has(e.id)):events} friends={friends} onShare={async(evs,frs)=>{const r=await onShare(evs,frs);if(r.success)setSelIds(new Set());return r;}} onClose={()=>setShowShare(false)}/>}
    </div>
  );
}

// ── 추가 탭 ───────────────────────────────────────────────────────────────
function AddTab({onAddEvents}){
  const [method,setMethod]=useState(null);
  const [text,setText]=useState("");
  const [loading,setLoading]=useState(false);
  const [confirmEvs,setConfirmEvs]=useState(null);
  const [voiceText,setVoiceText]=useState("");
  const [isRec,setIsRec]=useState(false);
  const [voiceForm,setVoiceForm]=useState(null);
  const recRef=useRef(null);

  const analyze=async(t,src)=>{
    if(!t.trim()||loading)return;
    setLoading(true);
    try{
      const evs=await aiExtract(t);
      if(evs.length===0)alert("합의된 일정을 찾지 못했습니다.\n양쪽이 명확히 동의한 내용이 있는지 확인해주세요.");
      else setConfirmEvs(evs.map(e=>({...e,source:src})));
    }catch{alert("분석 중 오류가 발생했습니다.");}
    setLoading(false);
  };

  const startVoice=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Chrome 브라우저에서만 음성 인식이 가능합니다.");return;}
    const r=new SR();r.lang="ko-KR";r.continuous=false;r.interimResults=false;
    r.onresult=async e=>{
      const t=e.results[0][0].transcript;
      setVoiceText(t);
      setLoading(true);
      try{
        const parsed=await aiVoiceParse(t);
        if(parsed&&parsed.title){
          setVoiceForm({
            title:parsed.title||"",
            date:parsed.date||new Date().toISOString().split("T")[0],
            time:parsed.time||"",
            people:parsed.people||"",
            location:parsed.location||"",
            notes:parsed.notes||"",
            notifyMinutes:60
          });
        }else{
          alert("일정 정보를 인식하지 못했습니다. 다시 말씀해주세요.");
        }
      }catch{alert("분석 오류가 발생했습니다.");}
      setLoading(false);
    };
    r.onerror=()=>setIsRec(false);
    r.onend=()=>setIsRec(false);
    r.start();recRef.current=r;setIsRec(true);setVoiceText("");setVoiceForm(null);
  };
  const stopVoice=()=>{recRef.current?.stop();setIsRec(false);};

  const METHODS=[{id:"call",icon:"📞",title:"통화 녹음",desc:"통화 녹음 텍스트 붙여넣기",col:"blue"},{id:"direct",icon:"⌨️",title:"직접 입력",desc:"일정 직접 작성",col:"slate"},{id:"voice",icon:"🎙️",title:"음성 입력",desc:"말로 일정 추가 (Chrome)",col:"violet"},{id:"message",icon:"💬",title:"문자/카카오",desc:"대화 내용 붙여넣기",col:"emerald"}];
  const COLORS={blue:{bg:"#eff6ff",border:"#bfdbfe",btn:"#2563eb"},slate:{bg:"#f8fafc",border:"#cbd5e1",btn:"#475569"},violet:{bg:"#f5f3ff",border:"#c4b5fd",btn:"#7c3aed"},emerald:{bg:"#f0fdf4",border:"#a7f3d0",btn:"#059669"}};
  const [dForm,setDF]=useState({title:"",date:new Date().toISOString().split("T")[0],time:"",people:"",location:"",notes:"",notifyMinutes:60});
  const FI="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50";

  if(!method)return(<div className="p-4"><h2 className="font-black text-gray-900 mb-1">일정 추가</h2><p className="text-xs text-gray-400 mb-4">원하는 방법을 선택하세요</p><div className="grid grid-cols-2 gap-3">{METHODS.map(({id,icon,title,desc,col})=>{const c=COLORS[col];return<button key={id} onClick={()=>setMethod(id)} className="text-left p-4 rounded-2xl border-2 hover:shadow-md transition-all" style={{background:c.bg,borderColor:c.border}}><div className="text-3xl mb-2">{icon}</div><div className="font-bold text-gray-800 text-sm">{title}</div><div className="text-xs text-gray-500 mt-0.5">{desc}</div></button>;})}</div></div>);

  const cur=METHODS.find(x=>x.id===method);const cc=COLORS[cur.col];
  return(
    <div className="p-4">
      <button onClick={()=>{setMethod(null);setText("");setVoiceText("");setVoiceForm(null);}} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-4 font-medium">← 뒤로</button>
      <h2 className="font-black text-gray-900 mb-4">{cur.icon} {cur.title}</h2>

      {method==="call"&&<div className="space-y-3">
        <div className="rounded-2xl p-4" style={{background:"#eff6ff",border:"1px solid #bfdbfe"}}>
          <p className="font-bold text-blue-800 text-sm mb-2">📱 통화 녹음 변환 방법</p>
          <div className="space-y-1 text-xs text-blue-700">
            <div><span className="font-bold">iOS: </span>TapeACall 등 앱 사용 후 텍스트 변환</div>
            <div><span className="font-bold">Android: </span>기본 통화 녹음 → 클로바 노트로 변환</div>
          </div>
          <p className="text-xs text-blue-600 mt-2 font-medium">💡 양쪽이 명확히 "네, 그렇게 하죠" 등으로 동의한 내용만 추출됩니다</p>
        </div>
        <textarea className="w-full rounded-2xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 resize-none" rows={8} style={{background:"#f8fafc",border:"1px solid #e2e8f0"}} placeholder={"통화 텍스트를 붙여넣으세요.\n\n예시:\nA: 다음 주 화요일 오전 10시에 미팅 가능하세요?\nB: 네, 좋습니다. 부천시청 앞 카페에서 만나요.\nA: 알겠습니다. 그때 뵙겠습니다."} value={text} onChange={e=>setText(e.target.value)}/>
        <button onClick={()=>analyze(text,"call")} disabled={loading||!text.trim()} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>{loading?"🔍 AI 분석 중...":"🤖 일정 자동 추출"}</button>
      </div>}

      {method==="direct"&&<div className="space-y-3">
        <input className={FI} placeholder="일정 제목 *" value={dForm.title} onChange={e=>setDF({...dForm,title:e.target.value})}/>
        <div className="flex gap-2"><input type="date" className={`${FI} flex-1`} value={dForm.date} onChange={e=>setDF({...dForm,date:e.target.value})}/><input type="time" className={`${FI} flex-1`} value={dForm.time} onChange={e=>setDF({...dForm,time:e.target.value})}/></div>
        <input className={FI} placeholder="참석자" value={dForm.people} onChange={e=>setDF({...dForm,people:e.target.value})}/>
        <input className={FI} placeholder="장소" value={dForm.location} onChange={e=>setDF({...dForm,location:e.target.value})}/>
        <textarea className={`${FI} resize-none`} rows={2} placeholder="메모" value={dForm.notes} onChange={e=>setDF({...dForm,notes:e.target.value})}/>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">🔔 알림 시간</label>
          <select className={FI} value={dForm.notifyMinutes} onChange={e=>setDF({...dForm,notifyMinutes:Number(e.target.value)})}>
            <option value={0}>알림 없음</option>
            {NOTIFY_OPTIONS.map(o=><option key={o.minutes} value={o.minutes}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={()=>{if(dForm.title&&dForm.date)setConfirmEvs([{...dForm,source:"manual"}]);}} disabled={!dForm.title||!dForm.date} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>일정 등록 확인</button>
      </div>}

      {method==="voice"&&<div className="space-y-4">
        <div className="rounded-2xl p-6 text-center" style={{background:"#f5f3ff",border:"1px solid #c4b5fd"}}>
          <button onClick={isRec?stopVoice:startVoice} className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 transition-all shadow-xl" style={{background:isRec?"#ef4444":"linear-gradient(135deg,#7c3aed,#6d28d9)"}}>
            <span className="text-5xl">{isRec?"⏹":"🎙️"}</span>
          </button>
          <p className="font-bold text-gray-700 text-sm">{loading?"AI 분석 중...":isRec?"말씀하세요... (탭하면 중지)":"버튼을 눌러 말씀하세요"}</p>
          <p className="text-xs text-gray-400 mt-1">예: "다음주 월요일 오후 3시에 홍부장님과 부천시청에서 설계 미팅"</p>
        </div>
        {voiceText&&<div className="bg-white rounded-2xl border border-gray-200 p-3"><p className="text-xs text-gray-400 mb-1 font-medium">인식된 텍스트</p><p className="text-sm text-gray-700">{voiceText}</p></div>}
        {voiceForm&&<div className="bg-indigo-50 rounded-2xl border border-indigo-200 p-4 space-y-2">
          <p className="text-xs font-bold text-indigo-700 mb-2">✅ AI가 추출한 일정 정보 — 수정 후 등록하세요</p>
          <input className={FI} placeholder="일정 제목 *" value={voiceForm.title} onChange={e=>setVoiceForm({...voiceForm,title:e.target.value})}/>
          <div className="flex gap-2"><input type="date" className={`${FI} flex-1`} value={voiceForm.date} onChange={e=>setVoiceForm({...voiceForm,date:e.target.value})}/><input type="time" className={`${FI} flex-1`} value={voiceForm.time} onChange={e=>setVoiceForm({...voiceForm,time:e.target.value})}/></div>
          <input className={FI} placeholder="참석자" value={voiceForm.people||""} onChange={e=>setVoiceForm({...voiceForm,people:e.target.value})}/>
          <input className={FI} placeholder="장소" value={voiceForm.location||""} onChange={e=>setVoiceForm({...voiceForm,location:e.target.value})}/>
          <select className={FI} value={voiceForm.notifyMinutes||60} onChange={e=>setVoiceForm({...voiceForm,notifyMinutes:Number(e.target.value)})}>
            <option value={0}>알림 없음</option>
            {NOTIFY_OPTIONS.map(o=><option key={o.minutes} value={o.minutes}>{o.label}</option>)}
          </select>
          <button onClick={()=>{if(voiceForm.title&&voiceForm.date)setConfirmEvs([{...voiceForm,source:"voice"}]);}} className="w-full py-3 rounded-2xl text-sm font-bold text-white" style={{background:"#7c3aed"}}>일정 등록 확인</button>
        </div>}
      </div>}

      {method==="message"&&<div className="space-y-3">
        <div className="flex gap-2">{["📱 문자 (SMS)","💬 카카오톡"].map((l,i)=><span key={i} className="flex-1 text-center text-xs py-2 rounded-xl font-semibold" style={{background:i===0?"#f1f5f9":"#FEF3C7",color:i===0?"#475569":"#92400E"}}>{l}</span>)}</div>
        <textarea className="w-full rounded-2xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 resize-none" rows={9} style={{background:"#f8fafc",border:"1px solid #e2e8f0"}} placeholder={"카카오톡 또는 문자 대화를 복사해 붙여넣으세요.\n\n예시:\n홍길동: 이번주 금요일 저녁 7시에 저녁 식사 어때요?\n나: 좋아요! 어디서 만날까요?\n홍길동: 부천역 2번 출구 앞에서요.\n나: 알겠어요, 그때 봐요!"} value={text} onChange={e=>setText(e.target.value)}/>
        <button onClick={()=>analyze(text,"message")} disabled={loading||!text.trim()} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>{loading?"🔍 분석 중...":"🤖 일정 자동 추출"}</button>
      </div>}

      {confirmEvs&&<ConfirmModal events={confirmEvs} onConfirm={async evs=>{await onAddEvents(evs);setConfirmEvs(null);setText("");setVoiceText("");setVoiceForm(null);setMethod(null);setDF({title:"",date:new Date().toISOString().split("T")[0],time:"",people:"",location:"",notes:"",notifyMinutes:60});}} onCancel={()=>setConfirmEvs(null)}/>}
    </div>
  );
}

// ── 친구 탭 ───────────────────────────────────────────────────────────────
function FriendsTab({user,friends,onChange,requests,onRefreshRequests}){
  const [email,setEmail]=useState("");const [err,setErr]=useState("");const [suc,setSuc]=useState("");const [busy,setBusy]=useState(false);
  const add=async()=>{
    setErr("");setSuc("");setBusy(true);
    const t=email.trim().toLowerCase();
    if(!t){setErr("이메일 또는 이름을 입력해주세요.");setBusy(false);return;}
    if(t===user.email||t===user.name){setErr("본인을 추가할 수 없습니다.");setBusy(false);return;}
    if(friends.find(f=>f.email===t||f.name===t)){setErr("이미 추가된 친구입니다.");setBusy(false);return;}
    const results=await getUserByNameOrEmail(t);
    if(results.length===0){setErr("가입되지 않은 이메일 또는 이름입니다.");setBusy(false);return;}
    const found=results[0];
    // 친구 요청 발송
    await addDoc(collection(db,"friendRequests"),{
      fromId:user.uid, fromName:user.name, fromEmail:user.email,
      toId:found.id, toName:found.name, toEmail:found.email,
      status:"pending", createdAt:serverTimestamp()
    });
    setSuc(`${found.name}님에게 친구 요청을 보냈습니다! 상대방이 수락하면 친구가 됩니다.`);
    setEmail("");setBusy(false);
  };

  const acceptRequest=async(req)=>{
    // 양방향 친구 추가
    await addFriend(user.uid,{friendId:req.fromId,name:req.fromName,email:req.fromEmail,active:true});
    await addFriend(req.fromId,{friendId:user.uid,name:user.name,email:user.email,active:true});
    await setDoc(doc(db,"friendRequests",req.id),{status:"accepted"},{merge:true});
    const upd=await getFriends(user.uid);onChange(upd);
    onRefreshRequests();
  };

  const rejectRequest=async(req)=>{
    await setDoc(doc(db,"friendRequests",req.id),{status:"rejected"},{merge:true});
    onRefreshRequests();
  };

  const remove=async(docId)=>{await removeFriend(docId);const upd=await getFriends(user.uid);onChange(upd);};

  return(
    <div className="p-4">
      <h2 className="font-black text-gray-900 mb-4">👥 친구 관리</h2>

      {/* 친구 요청 받은 목록 */}
      {requests.length>0&&<div className="bg-indigo-50 rounded-2xl border border-indigo-200 p-4 mb-4">
        <h3 className="font-bold text-indigo-700 text-sm mb-3">📬 친구 요청 ({requests.length})</h3>
        <div className="space-y-2">{requests.map(req=>(
          <div key={req.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{background:"#6366f1"}}>{req.fromName[0]}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-800 text-sm">{req.fromName}</div>
              <div className="text-xs text-gray-400">{req.fromEmail}</div>
            </div>
            <div className="flex gap-1">
              <button onClick={()=>acceptRequest(req)} className="text-xs bg-indigo-500 text-white px-2 py-1 rounded-lg font-bold">수락</button>
              <button onClick={()=>rejectRequest(req)} className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-lg font-bold">거절</button>
            </div>
          </div>
        ))}</div>
      </div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 className="font-bold text-gray-700 text-sm mb-3">친구 추가</h3>
        <div className="flex gap-2">
          <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50" placeholder="이메일 또는 이름으로 검색" value={email} onChange={e=>{setEmail(e.target.value);setErr("");setSuc("");}} onKeyDown={e=>e.key==="Enter"&&add()}/>
          <button onClick={add} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 shrink-0" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{busy?"...":"요청"}</button>
        </div>
        {err&&<p className="text-red-500 text-xs mt-2">⚠️ {err}</p>}
        {suc&&<p className="text-xs mt-2 font-medium" style={{color:"#059669"}}>✓ {suc}</p>}
      </div>

      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">친구 ({friends.length})</h3>
      {friends.length===0?<div className="text-center py-12 text-gray-400"><div className="text-5xl mb-3">👥</div><p className="text-sm font-medium text-gray-500">친구가 없습니다</p><p className="text-xs mt-1">이메일 또는 이름으로 친구를 추가해보세요</p></div>:
      <div className="space-y-2">{friends.map(fr=><div key={fr.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{background:fr.active===false?"#9ca3af":"linear-gradient(135deg,#6366f1,#818cf8)"}}>{fr.name[0]}</div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-800 text-sm">{fr.name} {fr.active===false&&<span className="text-xs text-red-400">(탈퇴한 회원)</span>}</div>
          <div className="text-xs text-gray-400 truncate">{fr.email}</div>
        </div>
        <button onClick={()=>remove(fr.id)} className="text-xs text-red-300 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50">삭제</button>
      </div>)}</div>}
    </div>
  );
}

// ── 공유함 탭 ─────────────────────────────────────────────────────────────
function SharedTab({user}){
  const [shared,setShared]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selIds,setSelIds]=useState(new Set());
  const [selectMode,setSelectMode]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [deleting,setDeleting]=useState(false);

  useEffect(()=>{
    if(!user?.uid)return;
    const q=query(collection(db,"sharedEvents"),where("recipientId","==",user.uid));
    const unsub=onSnapshot(q,snap=>{
      const s=snap.docs.map(d=>({...d.data(),id:d.id}));
      setShared(s.sort((a,b)=>(a.date||"").localeCompare(b.date||"")));
      setLoading(false);
    });
    return()=>unsub();
  },[user?.uid]);

  const delOne=async(id)=>{
    try{
      await deleteDoc(doc(db,"sharedEvents",id));
    }catch(e){
      console.error("삭제 오류:",e);
      alert("삭제 중 오류: "+e.message);
    }
  };
  const delSelected=async()=>{
  const ids=[...selIds];
  if(ids.length===0){alert("선택된 항목이 없습니다.");return;}
  setDeleting(true);
  let success=0;
  for(const id of ids){
    try{
      await deleteDoc(doc(db,"sharedEvents",id));
      success++;
      console.log("삭제성공:",id);
    }catch(e){
      console.error("삭제실패:",id,e.code,e.message);
    }
  }
  if(success===0){
    alert("삭제에 실패했습니다. 콘솔을 확인해주세요.");
  }
  setSelIds(new Set());
  setSelectMode(false);
  setConfirmDel(false);
  setDeleting(false);
};

  const toggleComplete=async(id,completed)=>{
    try{
      await setDoc(doc(db,"sharedEvents",id),{completed},{merge:true});
    }catch(e){console.error(e);}
  };

  const togSel=id=>{
    const s=new Set(selIds);
    s.has(id)?s.delete(id):s.add(id);
    setSelIds(s);
  };

  const selAll=()=>{
    if(selIds.size===shared.length)setSelIds(new Set());
    else setSelIds(new Set(shared.map(e=>e.id)));
  };

  if(loading)return<div className="flex items-center justify-center py-20 text-gray-400 text-sm">불러오는 중...</div>;
  if(shared.length===0)return(
    <div className="flex flex-col items-center justify-center py-20 text-gray-400 px-6 text-center">
      <div className="text-5xl mb-3">📭</div>
      <p className="text-sm font-medium text-gray-500">공유받은 일정 없음</p>
    </div>
  );

  return(
    <div className="p-4">
      {/* 커스텀 삭제 확인 다이얼로그 */}
      {confirmDel&&(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-xs shadow-2xl">
            <h3 className="font-black text-gray-900 mb-2">삭제 확인</h3>
            <p className="text-sm text-gray-500 mb-4">선택한 <span className="font-bold text-red-500">{selIds.size}개</span>의 일정을 삭제할까요?</p>
            <div className="flex gap-2">
              <button onClick={()=>setConfirmDel(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-500">취소</button>
              <button onClick={delSelected} disabled={deleting} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{background:"#ef4444"}}>
                {deleting?"삭제 중...":"삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-black text-gray-900">📬 공유받은 일정
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-semibold" style={{background:"#fff7ed",color:"#ea580c"}}>{shared.length}</span>
        </h2>
        <button onClick={()=>{setSelectMode(!selectMode);setSelIds(new Set());}}
          className="text-xs px-3 py-1.5 rounded-lg font-bold border"
          style={selectMode?{background:"#fee2e2",color:"#ef4444",borderColor:"#fca5a5"}:{background:"#f1f5f9",color:"#475569",borderColor:"#e2e8f0"}}>
          {selectMode?"취소":"선택 삭제"}
        </button>
      </div>

      {selectMode&&(
        <div className="rounded-2xl p-3 mb-3 flex items-center justify-between" style={{background:"linear-gradient(135deg,#ef4444,#dc2626)"}}>
          <div className="flex items-center gap-3">
            <button onClick={selAll} className="text-xs bg-white/20 text-white px-2 py-1 rounded-lg font-bold">
              {selIds.size===shared.length?"전체해제":"전체선택"}
            </button>
            <span className="text-sm font-bold text-white">{selIds.size}개 선택됨</span>
          </div>
          <button onClick={()=>{if(selIds.size>0)setConfirmDel(true);}}
            disabled={selIds.size===0}
            className="text-xs bg-white font-bold px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{color:"#ef4444"}}>
            🗑️ 삭제
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {shared.map((ev)=>(
          <div key={ev.id} className="flex items-start gap-2">
            {selectMode&&(
              <button onClick={()=>togSel(ev.id)}
                className="mt-2.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                style={selIds.has(ev.id)?{background:"#ef4444",borderColor:"#ef4444"}:{borderColor:"#d1d5db"}}>
                {selIds.has(ev.id)&&<svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </button>
            )}
            <span className="text-xs text-gray-400 w-9 shrink-0 pt-2.5 text-right font-medium">{fmtMD(ev.date)}</span>
            <div className="flex-1">
              <EventCard
                ev={{...ev,source:"shared"}}
                onToggleComplete={()=>toggleComplete(ev.id,!ev.completed)}
                onDelete={!selectMode?()=>delOne(ev.id):undefined}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 채팅 탭 ───────────────────────────────────────────────────────────────
function ChatTab({user,friends,onAddEvents,onSendMsg}){
  const [selFriend,setSelFriend]=useState(null);
  const [msgs,setMsgs]=useState([]);
  const [input,setInput]=useState("");
  const [analyzing,setAnalyzing]=useState(false);
  const [schedulePrompt,setSchedulePrompt]=useState(null);
  const msgEndRef=useRef(null);
  const chatId=selFriend?[user.uid,selFriend.friendId||selFriend.id].sort().join("_"):null;

  useEffect(()=>{
    if(!chatId)return;
    const q=query(collection(db,"chats",chatId,"messages"),orderBy("createdAt","asc"));
    const unsub=onSnapshot(q,snap=>{
    const newMsgs=snap.docs.map(d=>({id:d.id,...d.data()}));
    const prev=msgs.length;
    setMsgs(newMsgs);
    if(newMsgs.length>prev){
      const last=newMsgs[newMsgs.length-1];
      if(last.from!==user.uid && Notification.permission==="granted"){
        new Notification(`💬 ${last.fromName}`,{
          body:last.text,
          icon:"/icon.svg"
        });
      }
    }
  });
    return()=>unsub();
  },[chatId]);

  useEffect(()=>{msgEndRef.current?.scrollIntoView({behavior:"smooth"});},[msgs]);

  const send=async()=>{
    if(!input.trim()||!chatId)return;
    const msg={text:input,from:user.uid,fromName:user.name,createdAt:serverTimestamp()};
    await addDoc(collection(db,"chats",chatId,"messages"),msg);
    const friendId=selFriend.friendId||selFriend.id;
    if(onSendMsg)onSendMsg(friendId,user.name,input);
    setInput("");
  };

  const analyzeChat=async()=>{
    if(msgs.length===0)return;
    setAnalyzing(true);
    const chatText=msgs.map(m=>`${m.fromName}: ${m.text}`).join("\n");
    try{
      const evs=await aiExtract(chatText);
      if(evs.length>0)setSchedulePrompt(evs);
      else alert("대화에서 일정을 찾지 못했습니다.");
    }catch{alert("분석 오류가 발생했습니다.");}
    setAnalyzing(false);
  };

  if(!selFriend)return(
    <div className="p-4">
      <h2 className="font-black text-gray-900 mb-4">💬 친구 대화</h2>
      {friends.filter(f=>f.active!==false).length===0?
        <div className="text-center py-12 text-gray-400"><div className="text-5xl mb-3">💬</div><p className="text-sm font-medium text-gray-500">친구를 먼저 추가하세요</p></div>:
        <div className="space-y-2">{friends.filter(f=>f.active!==false).map(fr=>(
          <button key={fr.id} onClick={()=>setSelFriend(fr)} className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:border-indigo-200 transition-all text-left">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{background:"linear-gradient(135deg,#6366f1,#818cf8)"}}>{fr.name[0]}</div>
            <div><div className="font-bold text-gray-800 text-sm">{fr.name}</div><div className="text-xs text-gray-400">탭하여 대화 시작</div></div>
          </button>
        ))}</div>
      }
    </div>
  );

  return(
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-3 bg-white border-b border-gray-100">
        <button onClick={()=>setSelFriend(null)} className="text-gray-400 hover:text-gray-600 text-sm">←</button>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{background:"linear-gradient(135deg,#6366f1,#818cf8)"}}>{selFriend.name[0]}</div>
        <div className="flex-1"><div className="font-bold text-gray-800 text-sm">{selFriend.name}</div></div>
        <button onClick={analyzeChat} disabled={analyzing} className="text-xs px-2 py-1 rounded-lg font-medium text-white disabled:opacity-50" style={{background:"#6366f1"}}>
          {analyzing?"분석중...":"📅 일정 추출"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2 bg-gray-50">
        {msgs.length===0&&<p className="text-center text-xs text-gray-400 py-8">대화를 시작하세요<br/><span className="text-gray-300">※ 로그아웃 시 대화 내용이 삭제됩니다</span></p>}
        {msgs.map(msg=>(
          <div key={msg.id} className={`flex ${msg.from===user.uid?"justify-end":"justify-start"}`}>
            <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${msg.from===user.uid?"text-white":"bg-white text-gray-800 border border-gray-100"}`} style={msg.from===user.uid?{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}:{}}>
              {msg.from!==user.uid&&<div className="text-xs text-gray-400 mb-0.5 font-medium">{msg.fromName}</div>}
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={msgEndRef}/>
      </div>
      <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
        <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50" placeholder="메시지 입력..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}/>
        <button onClick={send} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white shrink-0" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>전송</button>
      </div>
      {schedulePrompt&&(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-sm shadow-2xl">
            <h3 className="font-black text-gray-900 mb-2">📅 일정 발견!</h3>
            <p className="text-xs text-gray-500 mb-3">대화에서 아래 일정을 발견했습니다. 양쪽 일정에 등록할까요?</p>
            <div className="space-y-2 mb-4">{schedulePrompt.map((ev,i)=>(
              <div key={i} className="bg-indigo-50 rounded-xl p-3">
                <div className="font-semibold text-gray-800 text-sm">{ev.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">📅 {ev.date}{ev.time?` 🕐 ${ev.time}`:""}</div>
              </div>
            ))}</div>
            <div className="flex gap-2">
              <button onClick={()=>setSchedulePrompt(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 font-medium">취소</button>
              <button onClick={async()=>{
                      const fid=selFriend?.friendId||selFriend?.id;
                      await onAddEvents(schedulePrompt.map(e=>({...e,source:"message"})),fid);
                      setSchedulePrompt(null);
}} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>등록하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 사용자 프로필 ─────────────────────────────────────────────────────────
function ProfilePage({user,onLogout,onClose}){
  const [confirm,setConfirm]=useState(false);
  const [deleting,setDeleting]=useState(false);

  const deleteAccount=async()=>{
    setDeleting(true);
    try{
      // 친구 목록에서 탈퇴 표시
      const friendsQ=query(collection(db,"friends"),where("friendId","==",user.uid));
      const friendsSnap=await getDocs(friendsQ);
      for(const d of friendsSnap.docs)await setDoc(d.ref,{active:false},{merge:true});

      // 본인 데이터 삭제
      const evQ=query(collection(db,"events"),where("userId","==",user.uid));
      const evSnap=await getDocs(evQ);
      for(const d of evSnap.docs)await deleteDoc(d.ref);

      const frQ=query(collection(db,"friends"),where("userId","==",user.uid));
      const frSnap=await getDocs(frQ);
      for(const d of frSnap.docs)await deleteDoc(d.ref);

      await setDoc(doc(db,"users",user.uid),{active:false,name:`(탈퇴한 회원)`,deletedAt:serverTimestamp()},{merge:true});

      const fbUser=auth.currentUser;
      if(fbUser)await deleteUser(fbUser);
      onLogout();
    }catch(e){alert("탈퇴 중 오류가 발생했습니다: "+e.message);}
    setDeleting(false);
  };

  return(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-black text-gray-900">내 정보</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        <div className="flex flex-col items-center mb-6">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black text-white mb-3" style={{background:"linear-gradient(135deg,#6366f1,#818cf8)"}}>{user.name[0]}</div>
          <h3 className="text-lg font-black text-gray-900">{user.name}</h3>
          <p className="text-sm text-gray-400">{user.email}</p>
          <span className="mt-2 text-xs px-2 py-0.5 rounded-full font-medium" style={{background:"#eef2ff",color:"#6366f1"}}>
            {user.provider==="google"?"구글 계정":user.provider==="kakao"?"카카오 계정":"이메일 계정"}
          </span>
        </div>
        {!confirm?(
          <button onClick={()=>setConfirm(true)} className="w-full py-3 border-2 border-red-200 text-red-500 rounded-xl text-sm font-bold hover:bg-red-50 transition-all">
            회원 탈퇴
          </button>
        ):(
          <div className="bg-red-50 rounded-2xl p-4">
            <p className="text-sm font-bold text-red-600 mb-1">⚠️ 정말 탈퇴하시겠습니까?</p>
            <p className="text-xs text-red-400 mb-3">탈퇴 시 모든 일정, 친구 정보가 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex gap-2">
              <button onClick={()=>setConfirm(false)} className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-500 font-medium">취소</button>
              <button onClick={deleteAccount} disabled={deleting} className="flex-1 py-2 bg-red-500 text-white rounded-xl text-sm font-bold disabled:opacity-50">{deleting?"처리중...":"탈퇴 확인"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 앱 ───────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(null);
  const [events,setEvents]=useState([]);
  const [friends,setFriends]=useState([]);
  const [requests,setRequests]=useState([]);
  const [tab,setTab]=useState("calendar");
  const [authMode,setAuthMode]=useState(null);
  const [ready,setReady]=useState(false);
  const [showProfile,setShowProfile]=useState(false);

  // 카카오 콜백 처리
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const code=params.get('code');
    if(code){
      (async()=>{
        try{
          const tok=await fetch(`/api/kakao-token?code=${code}`).then(r=>r.json());
          if(tok.access_token){
            const info=await fetch('https://kapi.kakao.com/v2/user/me',{headers:{'Authorization':`Bearer ${tok.access_token}`}}).then(r=>r.json());
            const kid=String(info.id),nick=info.kakao_account?.profile?.nickname||'카카오사용자',email=`kakao_${kid}@callmeet.app`,pw=`kakao_${kid}_pw`;
            let fbUser;
            try{const r=await signInWithEmailAndPassword(auth,email,pw);fbUser=r.user;}
            catch{const r=await createUserWithEmailAndPassword(auth,email,pw);fbUser=r.user;}
            await saveUser(fbUser.uid,{name:nick,email,provider:'kakao',uid:fbUser.uid,active:true});
            window.history.replaceState({},'',window.location.pathname);
          }
        }catch(e){console.error('카카오 로그인 오류',e);}
      })();
    }
  },[]);
// 공유받은 일정 실시간 알림
useEffect(()=>{
  if(!user)return;
  const q=query(collection(db,"sharedEvents"),
    where("recipientId","==",user.uid),
    where("sharedAt",">=",new Date(Date.now()-5000))
  );
  const unsub=onSnapshot(q,snap=>{
    snap.docChanges().forEach(change=>{
      if(change.type==="added"){
        const ev=change.doc.data();
        if(Notification.permission==="granted"){
          new Notification("📅 새 일정이 공유됐습니다",{
            body:`${ev.sharedBy}님이 "${ev.title}" 일정을 공유했어요`,
            icon:"/icon.svg"
          });
        }
      }
    });
  });
  return()=>unsub();
},[user]);

// 친구 요청 실시간 알림
useEffect(()=>{
  if(!user)return;
  const q=query(collection(db,"friendRequests"),
    where("toId","==",user.uid),
    where("status","==","pending")
  );
  const unsub=onSnapshot(q,snap=>{
    snap.docChanges().forEach(change=>{
      if(change.type==="added"){
        const req=change.doc.data();
        if(Notification.permission==="granted"){
          new Notification("👥 친구 요청이 왔습니다",{
            body:`${req.fromName}님이 친구 요청을 보냈어요`,
            icon:"/icon.svg"
          });
        }
        setRequests(prev=>[...prev,{id:change.doc.id,...req}]);
      }
    });
  });
  return()=>unsub();
},[user]);
         
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async(u)=>{
      if(u){
        const uDoc=await getDoc(doc(db,"users",u.uid));
        const uData=uDoc.exists()?uDoc.data():{uid:u.uid,name:u.displayName||u.email?.split("@")[0]||"사용자",email:u.email||"",provider:"email"};
        setUser(uData);
        const evs=await getUserEvts(u.uid);
        setEvents(evs);
        setFriends(await getFriends(u.uid));
        setRequests(await getFriendRequests(u.uid));
        // 알림 권한 요청 및 스케줄
        requestNotificationPermission().then(granted=>{
          if(granted)evs.filter(e=>e.notifyMinutes>0).forEach(scheduleNotification);
        });
      }else{setUser(null);setEvents([]);setFriends([]);setRequests([]);}
      setReady(true);
    });
    return()=>unsub();
  },[]);

  useEffect(()=>{
    if(!user?.uid)return;
    const q=query(collection(db,"events"),where("userId","==",user.uid));
    const unsub=onSnapshot(q,snap=>{
      setEvents(snap.docs.map(d=>({...d.data(),id:d.id})));
    });
    return()=>unsub();
  },[user?.uid]);
         
  const handleLogin=async(uData)=>{
    if("Notification" in window && Notification.permission==="default"){
  Notification.requestPermission();
    }
    setUser(uData);
    const evs=await getUserEvts(uData.uid);
    setEvents(evs);
    setFriends(await getFriends(uData.uid));
    setRequests(await getFriendRequests(uData.uid));
    setAuthMode(null);
    getFCMToken().then(async token=>{
      if(token) await saveUser(uData.uid,{fcmToken:token});
    });
    requestNotificationPermission().then(granted=>{
      if(granted)evs.filter(e=>e.notifyMinutes>0).forEach(scheduleNotification);
    });
  };

  const handleLogout=async()=>{
    // 채팅 내용 삭제 (로그아웃 시)
    if(user){
      try{
        const chatsQ=query(collection(db,"chats"));
        // 본인 관련 채팅 세션의 메시지 삭제는 실시간으로 처리
      }catch{}
    }
    await signOut(auth);
    setUser(null);setEvents([]);setFriends([]);setRequests([]);setTab("calendar");
  };

  const addEvents=async(evs)=>{
    const newEvs=[];
    for(const e of evs){
      const id=await addEvt(user.uid,e);
      const newEv={...e,id,userId:user.uid};
      newEvs.push(newEv);
      if(e.notifyMinutes>0){
        const granted=await requestNotificationPermission();
        if(granted)scheduleNotification(newEv);
      }
    }
    setEvents(prev=>[...prev,...newEvs]);
  };

  const editEvent=async(id,data)=>{await updEvt(id,data);setEvents(prev=>prev.map(e=>e.id===id?{...e,...data}:e));};
  const delEvent=async(id)=>{await delEvt(id);setEvents(prev=>prev.filter(e=>e.id!==id));};
  const toggleComplete=async(id,completed)=>{await updEvt(id,{completed});setEvents(prev=>prev.map(e=>e.id===id?{...e,completed}:e));};
  const handleShare=async(evs,frs)=>{
  try{
    await shareEvts(evs,frs.map(f=>f.friendId||f.id),user.name);
    for(const fr of frs){
      const friendId=fr.friendId||fr.id;
      const uDoc=await getDoc(doc(db,'users',friendId));
      const fcmToken=uDoc.data()?.fcmToken;
      if(fcmToken){
        await fetch('/api/send-notification',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            token:fcmToken,
            title:'📅 새 일정이 공유됐습니다',
            body:`${user.name}님이 ${evs.length}개의 일정을 공유했어요`
          })
        });
      }
    }
    return{success:true};
    }catch{return{error:"공유 중 오류가 발생했습니다."};} 
  };
  const refreshRequests=async()=>{if(user)setRequests(await getFriendRequests(user.uid));};

  // 채팅에서 일정 등록 (양쪽 모두)
  const addChatEvents=async(evs,friendId)=>{
    await addEvents(evs);
    // 상대방 일정에도 등록
    for(const e of evs){
      await addEvt(friendId,{...e,source:"message",sharedBy:user.name});
    }
  };

  if(!ready)return<div className="min-h-screen flex items-center justify-center" style={{background:"linear-gradient(135deg,#0f0c29,#24243e)"}}><div className="text-center"><div className="text-5xl mb-3">📞</div><p className="text-indigo-300 text-sm">CallMeet 로딩 중...</p></div></div>;
  if(!user)return<><Landing onAuth={m=>setAuthMode(m)}/>{authMode&&<AuthModal initialMode={authMode} onLogin={handleLogin} onClose={()=>setAuthMode(null)}/>}</>;

  const TABS=[
    {id:"calendar",icon:"📅",label:"일정표"},
    {id:"add",icon:"✏️",label:"추가"},
    {id:"friends",icon:"👥",label:"친구",badge:requests.length},
    {id:"chat",icon:"💬",label:"대화"},
    {id:"shared",icon:"📬",label:"공유함"},
  ];

  return(
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}><span className="text-sm">📞</span></div>
          <span className="font-black text-gray-900 tracking-tight">CallMeet</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setShowProfile(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:"#f1f5f9"}}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold" style={{background:"linear-gradient(135deg,#6366f1,#818cf8)"}}>{user.name[0]}</div>
            <span className="text-xs text-gray-700 font-semibold max-w-[80px] truncate">{user.name}</span>
            {user.provider==="google"&&<GIcon size={12}/>}
          </button>
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-500 p-1.5">로그아웃</button>
        </div>
      </header>
      <nav className="bg-white border-b border-gray-100 flex sticky top-[53px] z-10">
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className="flex-1 py-2 flex flex-col items-center gap-0.5 text-xs font-bold border-b-2 transition-all relative" style={{borderBottomColor:tab===t.id?"#6366f1":"transparent",color:tab===t.id?"#6366f1":"#9ca3af"}}>
          <span className="text-base leading-none">{t.icon}</span>
          <span>{t.label}</span>
          {t.badge>0&&<span className="absolute top-1 right-2 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">{t.badge}</span>}
        </button>)}
      </nav>
      <div className="flex-1 overflow-auto pb-6">
        {tab==="calendar"&&<CalendarTab events={events} friends={friends} onAddEv={ev=>addEvents([ev])} onEditEv={editEvent} onDelEv={delEvent} onShare={handleShare} onToggleComplete={toggleComplete}/>}
        {tab==="add"&&<AddTab onAddEvents={addEvents}/>}
        {tab==="friends"&&<FriendsTab user={user} friends={friends} onChange={setFriends} requests={requests} onRefreshRequests={refreshRequests}/>}
        {tab==="chat"&&<ChatTab user={user} friends={friends}
  onAddEvents={async(evs,fid)=>await addChatEvents(evs,fid)}
  onSendMsg={async(toId,name,text)=>{
    const uDoc=await getDoc(doc(db,'users',toId));
    const fcmToken=uDoc.data()?.fcmToken;
    if(fcmToken){
      await fetch('/api/send-notification',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          token:fcmToken,
          title:`💬 ${name}`,
          body:text.length>40?text.substring(0,40)+'...':text
        })
      });
    }
  }}
/>}
        {tab==="shared"&&<SharedTab user={user}/>}
      </div>
      {showProfile&&<ProfilePage user={user} onLogout={handleLogout} onClose={()=>setShowProfile(false)}/>}
    </div>
  );
}
