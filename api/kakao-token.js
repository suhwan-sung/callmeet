export default async function handler(req, res) {
  const { code } = req.query;
  const response = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'bee335131e093536b4ef2457fc8a1bdd',
      redirect_uri: 'https://callmeet-git-main-suhwan-sungs-projects.vercel.app',
      code: code
    })
  });
  const data = await response.json();
  res.json(data);
}
