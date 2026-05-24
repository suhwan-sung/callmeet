export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const { token, title, body } = req.body;
  const serverKey = process.env.FCM_SERVER_KEY;
  if (!serverKey) return res.status(500).json({error:'FCM 키 없음'});
  try {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${serverKey}`
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body, icon: '/icon.svg' },
        webpush: { notification: { icon: '/icon.svg', badge: '/icon.svg' } }
      })
    });
    const data = await response.json();
    res.json({ success: true, data });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
