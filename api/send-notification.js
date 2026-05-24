import crypto from 'crypto';

async function getAccessToken(clientEmail, privateKey) {
  const cleanKey = privateKey.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(cleanKey, 'base64url');
  const jwt = `${signingInput}.${signature}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await r.json();
  if(!data.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(data)}`);
  return data.access_token;
}

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const { token, title, body, link, data } = req.body;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if(!clientEmail||!privateKey||!projectId)
    return res.status(500).json({error:'Firebase 환경변수 없음'});
  if(!token)
    return res.status(400).json({error:'FCM 토큰 없음'});
  if(!privateKey.includes('BEGIN PRIVATE KEY'))
    return res.status(500).json({error:'PRIVATE KEY 형식 오류'});

  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const clickLink = link || 'https://callmeet.vercel.app';
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':`Bearer ${accessToken}`
        },
        body: JSON.stringify({
          message:{
            token,
            notification:{title, body},
            data: data ? Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])) : {},
            webpush:{
              notification:{
                icon:'/icon.svg',
                badge:'/icon.svg',
                vibrate:[200,100,200]
              },
              fcmOptions:{
                link: clickLink
              }
            }
          }
        })
      }
    );
    const result = await response.json();
    if(result.error) return res.status(400).json({error:result.error.message});
    res.json({success:true});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
}
