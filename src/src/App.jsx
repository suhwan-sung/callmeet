import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
         GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query,
         where, getDocs, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// ── Firebase 설정 ──────────────────────────────────────────────────────────
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
const db  = getFirestore(app);
const gProvider = new GoogleAuthProvider();
const KAKAO_KEY = "70746e7a59b4775f2771d8e75b306e50";

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
const DAYS = ["일","월","화","수","목","금","토"];
function buildGrid(y,m){const f=new Date(y,m,1).getDay(),l=new Date(y,m+1,0).getDate(),g=Array(f).fill(null);for(let d=1;d<=l;d++)g.push(d);return g;}
const toDs=(y,m,d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const fmtMD=s=>{if(!s)return"";const[,mm,dd]=s.split("-");return`${+mm}/${+dd}`;};

// ── AI 일정 추출 ───────────────────────────────────────────────────────────
async function aiExtract(text){
  const today=new Date().toISOString().split("T")[0];
  const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:`Extract agreed-upon appointments from Korean text. Today:${today}. Return ONLY raw JSON array. Schema:[{"date":"YYYY-MM-DD","time":"HH:MM or null","title":"Korean","people":"or null","location":"or null","notes":"or null"}]. Return [] if none.`,messages:[{role:"user",content:`대화:\n${text}`}]})});
  const data=await res.json();
  const raw=data.content?.find(b=>b.type==="text")?.text||"[]";
  return JSON.parse(raw.replace(/```json|```/g,"").trim());
}

// ── Firestore CRUD ─────────────────────────────────────────────────────────
const saveUser=async(uid,data)=>setDoc(doc(db,"users",uid),data,{merge:true});
const getUserByEmail=async(email)=>{const q=query(collection(db,"users"),where("email","==",email));const s=await getDocs(q);return s.empty?null:{id:s.docs[0].id,...s.docs[0].data()};};
const addEvt=async(userId,ev)=>{const r=await addDoc(collection(db,"events"),{...ev,userId,createdAt:serverTimestamp()});return r.id;};
const getUserEvts=async(userId)=>{const q=query(collection(db,"events"),where("userId","==",userId));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};
const delEvt=async(id)=>deleteDoc(doc(db,"events",id));
const updEvt=async(id,data)=>setDoc(doc(db,"events",id),data,{merge:true});
const getFriends=async(userId)=>{const q=query(collection(db,"friends"),where("userId","==",userId));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};
const addFriend=async(userId,fr)=>addDoc(collection(db,"friends"),{userId,...fr});
const removeFriend=async(id)=>deleteDoc(doc(db,"friends",id));
const shareEvts=async(evs,recipIds,byName)=>{for(const rid of recipIds)for(const ev of evs)await addDoc(collection(db,"sharedEvents"),{...ev,recipientId:rid,sharedBy:byName,sharedAt:serverTimestamp(),source:"shared"});};
const getSharedEvts=async(userId)=>{const q=query(collection(db,"sharedEvents"),where("recipientId","==",userId));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));};

// ── 구글 아이콘 ────────────────────────────────────────────────────────────
function GIcon({size=20}){return(<svg width={size} height={size} viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>);}

// ── 랜딩 ──────────────────────────────────────────────────────────────────
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
          <button onClick={()=>onAuth("login")} className="w-full py-4 rounded-2xl font-bold text-base text-white transition-all" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)",boxShadow:"0 8px 32px rgba(99,102,241,0.4)"}}>로그인</button>
          <button onClick={()=>onAuth("register")} className="w-full py-4 rounded-2xl font-semibold text-base transition-all" style={{background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.9)",border:"1px solid rgba(255,255,255,0.15)"}}>회원가입</button>
        </div>
      </div>
    </div>
  );
}

// ── 인증 모달 ──────────────────────────────────────────────────────────────
function AuthModal({initialMode,onLogin,onClose}){
  const [mode,setMode]=useState(initialMode);
  const [f,setF]=useState({name:"",email:"",pw:"",pw2:""});
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const FI="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50";

  const afterAuth=async(user,extra={})=>{
    await saveUser(user.uid,{name:extra.name||user.displayName||user.email.split("@")[0],email:user.email,provider:extra.provider||"email",uid:user.uid});
    onLogin({uid:user.uid,name:extra.name||user.displayName||user.email.split("@")[0],email:user.email,provider:extra.provider||"email"});
  };

  const doLogin=async()=>{setErr("");setBusy(true);try{const r=await signInWithEmailAndPassword(auth,f.email,f.pw);await afterAuth(r.user);}catch{setErr("이메일 또는 비밀번호가 틀립니다.");}setBusy(false);};
  const doRegister=async()=>{setErr("");if(!f.name||!f.email||!f.pw)return setErr("모든 항목을 입력해주세요.");if(f.pw!==f.pw2)return setErr("비밀번호가 일치하지 않습니다.");setBusy(true);try{const r=await createUserWithEmailAndPassword(auth,f.email,f.pw);await afterAuth(r.user,{name:f.name});}catch(e){setErr(e.code==="auth/email-already-in-use"?"이미 가입된 이메일입니다.":"가입 중 오류가 발생했습니다.");}setBusy(false);};
  const doGoogle=async()=>{setBusy(true);try{const r=await signInWithPopup(auth,gProvider);await afterAuth(r.user,{provider:"google"});}catch{setErr("구글 로그인 중 오류가 발생했습니다.");}setBusy(false);};
  const doKakao=async()=>{
    if(!window.Kakao?.isInitialized())window.Kakao?.init(KAKAO_KEY);
    window.Kakao?.Auth?.login({success:async(a)=>{window.Kakao.API.request({url:"/v2/user/me",success:async(res)=>{const kid=String(res.id),nick=res.kakao_account?.profile?.nickname||"카카오사용자",email=`kakao_${kid}@callmeet.app`,pw=`kakao_${kid}_secure`;try{await signInWithEmailAndPassword(auth,email,pw).then(r=>afterAuth(r.user,{name:nick,provider:"kakao"}));}catch{await createUserWithEmailAndPassword(auth,email,pw).then(r=>afterAuth(r.user,{name:nick,provider:"kakao"}));}},fail:()=>setErr("카카오 정보를 가져오지 못했습니다.")});},fail:()=>setErr("카카오 로그인 중 오류가 발생했습니다.")});
  };

  return(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-black text-gray-900">{mode==="login"?"로그인":mode==="register"?"가입 방법 선택":"이메일로 가입"}</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl w-8 h-8 flex items-center justify-center">×</button>
        </div>
        {mode==="login"&&(
          <div className="space-y-3">
            <input className={FI} type="email" placeholder="이메일" value={f.email} onChange={e=>setF({...f,email:e.target.value})} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
            <input className={FI} type="password" placeholder="비밀번호" value={f.pw} onChange={e=>setF({...f,pw:e.target.value})} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
            {err&&<p className="text-red-500 text-xs">{err}</p>}
            <button onClick={doLogin} disabled={busy} className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{busy?"로그인 중...":"로그인"}</button>
            <div className="flex items-center gap-2"><div className="flex-1 h-px bg-gray-200"/><span className="text-xs text-gray-400">또는</span><div className="flex-1 h-px bg-gray-200"/></div>
            <button onClick={doGoogle} className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2.5 border border-gray-200 hover:bg-gray-50"><GIcon size={18}/>Google로 로그인</button>
            <button onClick={doKakao} className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2" style={{background:"#FEE500",color:"#1a1a1a"}}><span className="text-lg">💬</span>카카오로 로그인</button>
            <p className="text-center text-xs text-gray-400 pt-1">계정이 없으신가요? <button onClick={()=>{setMode("register");setErr("");}} className="text-indigo-600 font-bold">회원가입</button></p>
          </div>
        )}
        {mode==="register"&&(
          <div className="space-y-3">
            <button onClick={()=>setMode("register-email")} className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 hover:shadow-md transition-all border-gray-200">
              <span className="text-2xl">✉️</span><div><div className="font-bold text-gray-800 text-sm">이메일로 가입</div><div className="text-xs text-gray-400">이메일과 비밀번호로 계정 생성</div></div>
            </button>
            <button onClick={doGoogle} className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 hover:shadow-md transition-all border-red-100">
              <GIcon size={28}/><div><div className="font-bold text-gray-800 text-sm">Google로 가입</div><div className="text-xs text-gray-400">Google 계정으로 빠른 가입</div></div>
            </button>
            <button onClick={doKakao} className="w-full text-left p-4 rounded-2xl border-2 flex items-center gap-3 hover:shadow-md transition-all border-yellow-200 bg-yellow-50">
              <span className="text-2xl">💬</span><div><div className="font-bold text-gray-800 text-sm">카카오로 가입</div><div className="text-xs text-gray-400">카카오 계정으로 빠른 가입</div></div>
            </button>
            <p className="text-center text-xs text-gray-400 pt-1">이미 계정이 있으신가요? <button onClick={()=>{setMode("login");setErr("");}} className="text-indigo-600 font-bold">로그인</button></p>
          </div>
        )}
        {mode==="register-email"&&(
          <div className="space-y-3">
            <button onClick={()=>setMode("register")} className="text-xs text-gray-400 hover:text-gray-600 mb-1">← 뒤로</button>
            <input className={FI} placeholder="이름" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>
            <input className={FI} type="email" placeholder="이메일" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>
            <input className={FI} type="password" placeholder="비밀번호 (6자 이상)" value={f.pw} onChange={e=>setF({...f,pw:e.target.value})}/>
            <input className={FI} type="password" placeholder="비밀번호 확인" value={f.pw2} onChange={e=>setF({...f,pw2:e.target.value})} onKeyDown={e=>e.key==="Enter"&&doRegister()}/>
            {err&&<p className="text-red-500 text-xs">{err}</p>}
            <button onClick={doRegister} disabled={busy} className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{busy?"가입 중...":"가입하기"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 일정 확인 모달 ─────────────────────────────────────────────────────────
function ConfirmModal({events,onConfirm,onCancel}){
  const [sel,setSel]=useState(new Set(events.map((_,i)=>i)));
  const [eds,setEds]=useState(events.map(e=>({...e})));
  const [editIdx,setEditIdx]=useState(null);
  const toggle=i=>{const s=new Set(sel);s.has(i)?s.delete(i):s.add(i);setSel(s);};
  const upd=(i,k,v)=>{const n=[...eds];n[i]={...n[i],[k]:v};setEds(n);};
  return(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl flex flex-col max-h-[88vh]">
        <div className="p-5 border-b border-gray-100">
          <h3 className="font-black text-gray-900 text-base">일정 등록 확인</h3>
          <p className="text-xs text-gray-400 mt-0.5">등록할 일정을 선택하고 수정할 수 있습니다</p>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {eds.map((ev,i)=>(
            <div key={i} className={`rounded-2xl border-2 p-3 transition-all ${sel.has(i)?"border-indigo-400 bg-indigo-50/50":"border-gray-200 bg-gray-50 opacity-50"}`}>
              <div className="flex items-start gap-2">
                <button onClick={()=>toggle(i)} className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all" style={sel.has(i)?{background:"#6366f1",borderColor:"#6366f1"}:{borderColor:"#d1d5db"}}>
                  {sel.has(i)&&<svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  {editIdx===i?(
                    <div className="space-y-1.5">
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white" value={ev.title} onChange={e=>upd(i,"title",e.target.value)}/>
                      <div className="flex gap-1">
                        <input type="date" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white" value={ev.date||""} onChange={e=>upd(i,"date",e.target.value)}/>
                        <input type="time" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white" value={ev.time||""} onChange={e=>upd(i,"time",e.target.value)}/>
                      </div>
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white" placeholder="참석자" value={ev.people||""} onChange={e=>upd(i,"people",e.target.value)}/>
                      <input className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none bg-white" placeholder="장소" value={ev.location||""} onChange={e=>upd(i,"location",e.target.value)}/>
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

// ── 공유 모달 ──────────────────────────────────────────────────────────────
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
            {friends.length===0?<p className="text-xs text-gray-400 py-3 text-center bg-gray-50 rounded-xl">친구 탭에서 먼저 친구를 추가하세요</p>:(
              <div className="space-y-2">{friends.map(fr=>(
                <button key={fr.id} onClick={()=>togF(fr.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${selF.has(fr.id)?"border-indigo-400 bg-indigo-50":"border-gray-200"}`}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{background:selF.has(fr.id)?"#6366f1":"#9ca3af"}}>{fr.name[0]}</div>
                  <div className="flex-1"><div className="font-semibold text-gray-800 text-sm">{fr.name}</div><div className="text-xs text-gray-400">{fr.email}</div></div>
                  {selF.has(fr.id)&&<span style={{color:"#6366f1"}} className="font-bold">✓</span>}
                </button>
              ))}</div>
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">공유할 일정</h4>
            {allEvents.length===0?<p className="text-xs text-gray-400 py-3 text-center bg-gray-50 rounded-xl">등록된 일정이 없습니다</p>:(
              <div className="space-y-2">{allEvents.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(ev=>(
                <button key={ev.id} onClick={()=>togE(ev.id)} className={`w-full text-left p-3 rounded-xl border-2 transition-all ${selE.has(ev.id)?"border-indigo-400 bg-indigo-50":"border-gray-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="font-semibold text-gray-800 text-sm">{ev.title}</div><div className="text-xs text-gray-400 mt-0.5">📅 {ev.date}{ev.time?` · 🕐 ${ev.time}`:""}</div></div>
                    {selE.has(ev.id)&&<span style={{color:"#6366f1"}} className="font-bold shrink-0">✓</span>}
                  </div>
                </button>
              ))}</div>
            )}
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

// ── 이벤트 카드 ────────────────────────────────────────────────────────────
const SRC={manual:{bg:"#f1f5f9",text:"#64748b",label:"직접입력"},call:{bg:"#eff6ff",text:"#3b82f6",label:"통화"},voice:{bg:"#f5f3ff",text:"#7c3aed",label:"음성"},message:{bg:"#f0fdf4",text:"#16a34a",label:"메시지"},shared:{bg:"#fff7ed",text:"#ea580c",label:"공유"}};
function EventCard({ev,onEdit,onDelete,onSelect,isSelected}){
  const src=ev.source||"manual";const st=SRC[src]||SRC.manual;
  return(
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${isSelected?"ring-2":"ring-0"}`} style={{borderColor:isSelected?"#6366f1":"#f1f5f9"}}>
      <div className="flex items-start p-3 gap-2">
        {onSelect&&<button onClick={onSelect} className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all" style={isSelected?{background:"#6366f1",borderColor:"#6366f1"}:{borderColor:"#d1d5db"}}>{isSelected&&<svg className="w-3 h-3 text-white" viewBox="0 0 12 10" fill="none"><path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold" style={{background:st.bg,color:st.text}}>{st.label}</span>
            <span className="font-semibold text-gray-800 text-sm truncate">{ev.title}</span>
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {ev.time&&<span className="text-xs text-gray-400">🕐 {ev.time}</span>}
            {ev.people&&<span className="text-xs text-gray-400">👤 {ev.people}</span>}
            {ev.location&&<span className="text-xs text-gray-400">📍 {ev.location}</span>}
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
  const [f,setF]=useState({title:ev?.title||"",date:ev?.date||defaultDate||new Date().toISOString().split("T")[0],time:ev?.time||"",people:ev?.people||"",location:ev?.location||"",notes:ev?.notes||""});
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
function CalendarTab({events,friends,onAddEv,onEditEv,onDelEv,onShare}){
  const now=new Date();
  const [y,setY]=useState(now.getFullYear());
  const [m,setM]=useState(now.getMonth());
  const [sel,setSel]=useState(now.getDate());
  const [selIds,setSelIds]=useState(new Set());
  const [showShare,setShowShare]=useState(false);
  const [editModal,setEditModal]=useState(null);
  const grid=buildGrid(y,m);
  const evsByDay=d=>events.filter(e=>{if(!e.date)return false;const[ey,em,ed]=e.date.split("-").map(Number);return ey===y&&em===m+1&&ed===d;});
  const selEvs=evsByDay(sel);
  const monthEvs=events.filter(e=>{if(!e.date)return false;const[ey,em]=e.date.split("-").map(Number);return ey===y&&em===m+1;}).sort((a,b)=>a.date.localeCompare(b.date));
  const togSel=id=>{const s=new Set(selIds);s.has(id)?s.delete(id):s.add(id);setSelIds(s);};
  return(
    <div className="p-3">
      {selIds.size>0&&<div className="rounded-2xl p-3 mb-3 flex items-center justify-between" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}><span className="text-sm font-bold text-white">{selIds.size}개 선택됨</span><div className="flex gap-2"><button onClick={()=>setShowShare(true)} className="text-xs bg-white font-bold px-3 py-1.5 rounded-lg" style={{color:"#6366f1"}}>친구에게 공유</button><button onClick={()=>setSelIds(new Set())} className="text-xs text-white/70">해제</button></div></div>}
      <div className="flex items-center justify-between mb-3">
        <button onClick={()=>{if(m===0){setY(y-1);setM(11);}else setM(m-1);setSel(1);}} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500 text-xl font-bold">‹</button>
        <h2 className="font-black text-gray-800">{y}년 {m+1}월</h2>
        <button onClick={()=>{if(m===11){setY(y+1);setM(0);}else setM(m+1);setSel(1);}} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-500 text-xl font-bold">›</button>
      </div>
      <div className="grid grid-cols-7 mb-1">{DAYS.map((d,i)=><div key={d} className={`text-center text-xs font-bold py-1 ${i===0?"text-red-400":i===6?"text-blue-400":"text-gray-400"}`}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-0.5 mb-4">
        {grid.map((d,i)=>{
          if(!d)return<div key={`x${i}`}/>;
          const evs=evsByDay(d),isTd=y===now.getFullYear()&&m===now.getMonth()&&d===now.getDate(),isSel=d===sel,dow=i%7;
          return<button key={d} onClick={()=>setSel(d)} className={`flex flex-col items-center justify-start py-1.5 rounded-xl min-h-[52px] transition-all ${isSel?"shadow-md":"hover:bg-gray-100"}`} style={isSel?{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}:isTd?{background:"#eef2ff",border:"1px solid #a5b4fc"}:{}}>
            <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isSel?"text-white":isTd?"text-indigo-600":dow===0?"text-red-400":dow===6?"text-blue-400":"text-gray-700"}`}>{d}</span>
            {evs.length>0&&<div className="flex gap-0.5 mt-0.5">{evs.slice(0,3).map((_,ei)=><div key={ei} className="w-1.5 h-1.5 rounded-full" style={{background:isSel?"rgba(255,255,255,0.7)":"#6366f1"}}/>)}</div>}
          </button>;
        })}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-700 text-sm">{m+1}월 {sel}일 <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{background:"#eef2ff",color:"#6366f1"}}>{selEvs.length}</span></h3>
          <button onClick={()=>setEditModal({date:toDs(y,m,sel)})} className="text-xs px-3 py-1.5 rounded-lg font-bold text-white" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>+ 추가</button>
        </div>
        {selEvs.length===0?<p className="text-xs text-gray-400 text-center py-3">일정 없음</p>:<div className="space-y-2">{selEvs.map(ev=><EventCard key={ev.id} ev={ev} isSelected={selIds.has(ev.id)} onSelect={()=>togSel(ev.id)} onEdit={()=>setEditModal({ev})} onDelete={()=>onDelEv(ev.id)}/>)}</div>}
      </div>
      {monthEvs.length>0&&<div><p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">이번 달 ({monthEvs.length})</p><div className="space-y-1.5">{monthEvs.map(ev=><div key={ev.id} className="flex items-start gap-2"><span className="text-xs text-gray-400 w-9 shrink-0 pt-2.5 text-right font-medium">{fmtMD(ev.date)}</span><div className="flex-1"><EventCard ev={ev} isSelected={selIds.has(ev.id)} onSelect={()=>togSel(ev.id)} onEdit={()=>setEditModal({ev})} onDelete={()=>onDelEv(ev.id)}/></div></div>)}</div></div>}
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
  const recRef=useRef(null);
  const analyze=async(t,src)=>{if(!t.trim()||loading)return;setLoading(true);try{const evs=await aiExtract(t);if(evs.length===0)alert("합의된 일정을 찾지 못했습니다.");else setConfirmEvs(evs.map(e=>({...e,source:src})));}catch{alert("분석 중 오류가 발생했습니다.");}setLoading(false);};
  const startVoice=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("Chrome 브라우저에서만 음성 인식이 가능합니다.");return;}const r=new SR();r.lang="ko-KR";r.continuous=true;r.interimResults=true;r.onresult=e=>{const t=Array.from(e.results).map(r=>r[0].transcript).join("");setVoiceText(t);};r.onerror=()=>setIsRec(false);r.onend=()=>setIsRec(false);r.start();recRef.current=r;setIsRec(true);setVoiceText("");};
  const stopVoice=()=>{recRef.current?.stop();setIsRec(false);};
  const METHODS=[{id:"call",icon:"📞",title:"통화 녹음",desc:"통화 녹음 텍스트 붙여넣기",col:"blue"},{id:"direct",icon:"⌨️",title:"직접 입력",desc:"일정 직접 작성",col:"slate"},{id:"voice",icon:"🎙️",title:"음성 입력",desc:"말로 일정 추가 (Chrome)",col:"violet"},{id:"message",icon:"💬",title:"문자/카카오",desc:"대화 내용 붙여넣기",col:"emerald"}];
  const COLORS={blue:{bg:"#eff6ff",border:"#bfdbfe",btn:"#2563eb"},slate:{bg:"#f8fafc",border:"#cbd5e1",btn:"#475569"},violet:{bg:"#f5f3ff",border:"#c4b5fd",btn:"#7c3aed"},emerald:{bg:"#f0fdf4",border:"#a7f3d0",btn:"#059669"}};
  const [dForm,setDF]=useState({title:"",date:new Date().toISOString().split("T")[0],time:"",people:"",location:"",notes:""});
  const FI="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50";
  if(!method)return(<div className="p-4"><h2 className="font-black text-gray-900 mb-1">일정 추가</h2><p className="text-xs text-gray-400 mb-4">원하는 방법을 선택하세요</p><div className="grid grid-cols-2 gap-3">{METHODS.map(({id,icon,title,desc,col})=>{const c=COLORS[col];return<button key={id} onClick={()=>setMethod(id)} className="text-left p-4 rounded-2xl border-2 hover:shadow-md transition-all" style={{background:c.bg,borderColor:c.border}}><div className="text-3xl mb-2">{icon}</div><div className="font-bold text-gray-800 text-sm">{title}</div><div className="text-xs text-gray-500 mt-0.5">{desc}</div></button>;})}</div></div>);
  const cur=METHODS.find(x=>x.id===method);const cc=COLORS[cur.col];
  return(
    <div className="p-4">
      <button onClick={()=>{setMethod(null);setText("");setVoiceText("");}} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-4 font-medium">← 뒤로</button>
      <h2 className="font-black text-gray-900 mb-4">{cur.icon} {cur.title}</h2>
      {method==="call"&&<div className="space-y-3"><div className="rounded-2xl p-4" style={{background:"#eff6ff",border:"1px solid #bfdbfe"}}><p className="font-bold text-blue-800 text-sm mb-2">📱 통화 녹음 변환 방법</p><div className="space-y-1 text-xs text-blue-700"><div><span className="font-bold">iOS: </span>TapeACall 등 앱 사용 후 텍스트 변환</div><div><span className="font-bold">Android: </span>기본 통화 녹음 → 클로바 노트로 변환</div></div></div><textarea className="w-full rounded-2xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 resize-none" rows={8} style={{background:"#f8fafc",border:"1px solid #e2e8f0"}} placeholder={"통화 텍스트를 붙여넣으세요.\n\n예시:\nA: 다음 주 화요일 오전 10시에 미팅 가능하세요?\nB: 네, 부천시청 앞 카페에서 만나요."} value={text} onChange={e=>setText(e.target.value)}/><button onClick={()=>analyze(text,"call")} disabled={loading||!text.trim()} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>{loading?"🔍 AI 분석 중...":"🤖 일정 자동 추출"}</button></div>}
      {method==="direct"&&<div className="space-y-3"><input className={FI} placeholder="일정 제목 *" value={dForm.title} onChange={e=>setDF({...dForm,title:e.target.value})}/><div className="flex gap-2"><input type="date" className={`${FI} flex-1`} value={dForm.date} onChange={e=>setDF({...dForm,date:e.target.value})}/><input type="time" className={`${FI} flex-1`} value={dForm.time} onChange={e=>setDF({...dForm,time:e.target.value})}/></div><input className={FI} placeholder="참석자" value={dForm.people} onChange={e=>setDF({...dForm,people:e.target.value})}/><input className={FI} placeholder="장소" value={dForm.location} onChange={e=>setDF({...dForm,location:e.target.value})}/><textarea className={`${FI} resize-none`} rows={2} placeholder="메모" value={dForm.notes} onChange={e=>setDF({...dForm,notes:e.target.value})}/><button onClick={()=>{if(dForm.title&&dForm.date)setConfirmEvs([{...dForm,source:"manual"}]);}} disabled={!dForm.title||!dForm.date} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>일정 등록 확인</button></div>}
      {method==="voice"&&<div className="space-y-4"><div className="rounded-2xl p-6 text-center" style={{background:"#f5f3ff",border:"1px solid #c4b5fd"}}><button onClick={isRec?stopVoice:startVoice} className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 transition-all shadow-xl" style={{background:isRec?"#ef4444":"linear-gradient(135deg,#7c3aed,#6d28d9)",boxShadow:isRec?"0 0 30px rgba(239,68,68,0.5)":"0 0 30px rgba(124,58,237,0.4)"}}><span className="text-5xl">{isRec?"⏹":"🎙️"}</span></button><p className="font-bold text-gray-700 text-sm">{isRec?"녹음 중... 탭하여 중지":"버튼을 눌러 말씀하세요"}</p><p className="text-xs text-gray-400 mt-1">예: "다음주 월요일 오후 3시에 홍부장님과 미팅"</p></div>{voiceText&&<div className="bg-white rounded-2xl border border-gray-200 p-3"><p className="text-xs text-gray-400 mb-1 font-medium">인식된 텍스트</p><p className="text-sm text-gray-700">{voiceText}</p></div>}{voiceText&&!isRec&&<button onClick={()=>analyze(voiceText,"voice")} disabled={loading} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>{loading?"🔍 분석 중...":"🤖 일정 추출"}</button>}</div>}
      {method==="message"&&<div className="space-y-3"><div className="flex gap-2">{["📱 문자 (SMS)","💬 카카오톡"].map((l,i)=><span key={i} className="flex-1 text-center text-xs py-2 rounded-xl font-semibold" style={{background:i===0?"#f1f5f9":"#FEF3C7",color:i===0?"#475569":"#92400E"}}>{l}</span>)}</div><textarea className="w-full rounded-2xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 resize-none" rows={9} style={{background:"#f8fafc",border:"1px solid #e2e8f0"}} placeholder={"카카오톡 또는 문자 대화를 복사해 붙여넣으세요.\n\n예시:\n홍길동: 이번주 금요일 저녁 7시 어때요?\n나: 좋아요! 어디서 만날까요?\n홍길동: 부천역 2번 출구 앞에서요.\n나: 알겠어요, 그때 봐요!"} value={text} onChange={e=>setText(e.target.value)}/><button onClick={()=>analyze(text,"message")} disabled={loading||!text.trim()} className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-40" style={{background:cc.btn}}>{loading?"🔍 분석 중...":"🤖 일정 자동 추출"}</button></div>}
      {confirmEvs&&<ConfirmModal events={confirmEvs} onConfirm={async evs=>{await onAddEvents(evs);setConfirmEvs(null);setText("");setVoiceText("");setMethod(null);setDF({title:"",date:new Date().toISOString().split("T")[0],time:"",people:"",location:"",notes:""}); }} onCancel={()=>setConfirmEvs(null)}/>}
    </div>
  );
}

// ── 친구 탭 ───────────────────────────────────────────────────────────────
function FriendsTab({user,friends,onChange}){
  const [email,setEmail]=useState("");const [err,setErr]=useState("");const [suc,setSuc]=useState("");const [busy,setBusy]=useState(false);
  const add=async()=>{setErr("");setSuc("");setBusy(true);const t=email.trim().toLowerCase();if(!t){setErr("이메일을 입력해주세요.");setBusy(false);return;}if(t===user.email){setErr("본인을 추가할 수 없습니다.");setBusy(false);return;}if(friends.find(f=>f.email===t)){setErr("이미 추가된 친구입니다.");setBusy(false);return;}const found=await getUserByEmail(t);if(!found){setErr("가입되지 않은 이메일입니다.");setBusy(false);return;}await addFriend(user.uid,{friendId:found.id,name:found.name,email:found.email});const upd=await getFriends(user.uid);onChange(upd);setSuc(`${found.name}님과 친구가 되었습니다! 🎉`);setEmail("");setBusy(false);};
  const remove=async(docId)=>{await removeFriend(docId);const upd=await getFriends(user.uid);onChange(upd);};
  return(
    <div className="p-4">
      <h2 className="font-black text-gray-900 mb-4">👥 친구 관리</h2>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 className="font-bold text-gray-700 text-sm mb-3">친구 추가</h3>
        <div className="flex gap-2"><input className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50" placeholder="상대방 이메일 주소" value={email} onChange={e=>{setEmail(e.target.value);setErr("");setSuc("");}} onKeyDown={e=>e.key==="Enter"&&add()}/><button onClick={add} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 shrink-0" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}>{busy?"...":"추가"}</button></div>
        {err&&<p className="text-red-500 text-xs mt-2">⚠️ {err}</p>}
        {suc&&<p className="text-xs mt-2 font-medium" style={{color:"#059669"}}>✓ {suc}</p>}
      </div>
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">친구 ({friends.length})</h3>
      {friends.length===0?<div className="text-center py-12 text-gray-400"><div className="text-5xl mb-3">👥</div><p className="text-sm font-medium text-gray-500">친구가 없습니다</p><p className="text-xs mt-1">이메일로 친구를 추가해보세요</p></div>:<div className="space-y-2">{friends.map(fr=><div key={fr.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex items-center gap-3"><div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{background:"linear-gradient(135deg,#6366f1,#818cf8)"}}>{fr.name[0]}</div><div className="flex-1 min-w-0"><div className="font-bold text-gray-800 text-sm">{fr.name}</div><div className="text-xs text-gray-400 truncate">{fr.email}</div></div><button onClick={()=>remove(fr.id)} className="text-xs text-red-300 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-all">삭제</button></div>)}</div>}
    </div>
  );
}

// ── 공유함 탭 ─────────────────────────────────────────────────────────────
function SharedTab({user}){
  const [shared,setShared]=useState([]);const [loading,setLoading]=useState(true);
  useEffect(()=>{(async()=>{const s=await getSharedEvts(user.uid);setShared(s.sort((a,b)=>(a.date||"").localeCompare(b.date||"")));setLoading(false);})();},[user.uid]);
  if(loading)return<div className="flex items-center justify-center py-20 text-gray-400 text-sm">불러오는 중...</div>;
  if(shared.length===0)return<div className="flex flex-col items-center justify-center py-20 text-gray-400 px-6 text-center"><div className="text-5xl mb-3">📭</div><p className="text-sm font-medium text-gray-500">공유받은 일정 없음</p><p className="text-xs mt-1">친구가 일정을 공유하면 여기에 표시됩니다</p></div>;
  return(<div className="p-4"><h2 className="font-black text-gray-900 mb-4">📬 공유받은 일정 <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-semibold" style={{background:"#fff7ed",color:"#ea580c"}}>{shared.length}</span></h2><div className="space-y-1.5">{shared.map((ev,i)=><div key={i} className="flex items-start gap-2"><span className="text-xs text-gray-400 w-9 shrink-0 pt-2.5 text-right font-medium">{fmtMD(ev.date)}</span><div className="flex-1"><EventCard ev={{...ev,source:"shared"}}/></div></div>)}</div></div>);
}

// ── 메인 앱 ───────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(null);
  const [events,setEvents]=useState([]);
  const [friends,setFriends]=useState([]);
  const [tab,setTab]=useState("calendar");
  const [authMode,setAuthMode]=useState(null);
  const [ready,setReady]=useState(false);

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async(u)=>{
      if(u){
        const uDoc=await getDoc(doc(db,"users",u.uid));
        const uData=uDoc.exists()?uDoc.data():{uid:u.uid,name:u.displayName||u.email?.split("@")[0]||"사용자",email:u.email||"",provider:"email"};
        setUser(uData);
        setEvents(await getUserEvts(u.uid));
        setFriends(await getFriends(u.uid));
      }else{setUser(null);setEvents([]);setFriends([]);}
      setReady(true);
    });
    return()=>unsub();
  },[]);

  const handleLogin=async(uData)=>{setUser(uData);setEvents(await getUserEvts(uData.uid));setFriends(await getFriends(uData.uid));setAuthMode(null);};
  const handleLogout=async()=>{await signOut(auth);setUser(null);setEvents([]);setFriends([]);setTab("calendar");};

  const addEvents=async(evs)=>{const newEvs=[];for(const e of evs){const id=await addEvt(user.uid,e);newEvs.push({...e,id,userId:user.uid});}setEvents(prev=>[...prev,...newEvs]);};
  const editEvent=async(id,data)=>{await updEvt(id,data);setEvents(prev=>prev.map(e=>e.id===id?{...e,...data}:e));};
  const delEvent=async(id)=>{await delEvt(id);setEvents(prev=>prev.filter(e=>e.id!==id));};
  const handleShare=async(evs,frs)=>{try{await shareEvts(evs,frs.map(f=>f.friendId||f.id),user.name);return{success:true};}catch{return{error:"공유 중 오류가 발생했습니다."};} };

  if(!ready)return<div className="min-h-screen flex items-center justify-center" style={{background:"linear-gradient(135deg,#0f0c29,#24243e)"}}><div className="text-center"><div className="text-5xl mb-3">📞</div><p className="text-indigo-300 text-sm">CallMeet 로딩 중...</p></div></div>;
  if(!user)return<><Landing onAuth={m=>setAuthMode(m)}/>{authMode&&<AuthModal initialMode={authMode} onLogin={handleLogin} onClose={()=>setAuthMode(null)}/>}</>;

  const TABS=[{id:"calendar",icon:"📅",label:"일정표"},{id:"add",icon:"✏️",label:"추가"},{id:"friends",icon:"👥",label:"친구"},{id:"shared",icon:"📬",label:"공유함"}];
  return(
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#6366f1,#4f46e5)"}}><span className="text-sm">📞</span></div>
          <span className="font-black text-gray-900 tracking-tight">CallMeet</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl" style={{background:"#f1f5f9"}}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold" style={{background:"linear-gradient(135deg,#6366f1,#818cf8)"}}>{user.name[0]}</div>
            <span className="text-xs text-gray-700 font-semibold max-w-[80px] truncate">{user.name}</span>
            {user.provider==="google"&&<GIcon size={12}/>}
            {user.provider==="kakao"&&<span className="text-xs">💬</span>}
          </div>
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-500 p-1.5">로그아웃</button>
        </div>
      </header>
      <nav className="bg-white border-b border-gray-100 flex sticky top-[53px] z-10">
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} className="flex-1 py-2.5 flex flex-col items-center gap-0.5 text-xs font-bold border-b-2 transition-all" style={{borderBottomColor:tab===t.id?"#6366f1":"transparent",color:tab===t.id?"#6366f1":"#9ca3af"}}><span className="text-base leading-none">{t.icon}</span><span>{t.label}</span></button>)}
      </nav>
      <div className="flex-1 overflow-auto pb-6">
        {tab==="calendar"&&<CalendarTab events={events} friends={friends} onAddEv={ev=>addEvents([ev])} onEditEv={editEvent} onDelEv={delEvent} onShare={handleShare}/>}
        {tab==="add"&&<AddTab onAddEvents={addEvents}/>}
        {tab==="friends"&&<FriendsTab user={user} friends={friends} onChange={setFriends}/>}
        {tab==="shared"&&<SharedTab user={user}/>}
      </div>
    </div>
  );
}
