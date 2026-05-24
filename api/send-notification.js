import crypto from 'crypto';

async function getAccessToken(clientEmail, privateKey) {
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
  const signature = sign.sign(privateKey.replace(/\\n/g,'\n'), 'base64url');
  const jwt = `${signingInput}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await res.json();
  return data.access_token;
}

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const { token, title, body } = req.body;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if(!clientEmail||!privateKey||!projectId) return res.status(500).json({error:'Firebase 설정 없음'});
  if(!token) return res.status(400).json({error:'FCM 토큰 없음'});
  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
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
            notification:{ title, body },
            webpush:{
              notification:{
                icon:'/icon.svg',
                badge:'/icon.svg',
                vibrate:[200,100,200]
              }
            }
          }
        })
      }
    );
    const data = await response.json();
    if(data.error) return res.status(400).json({error:data.error.message});
    res.json({ success:true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
