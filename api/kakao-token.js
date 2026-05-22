export default async function handler(req, res) {
  const { code } = req.query;
  const response = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: '70746e7a59b4775f2771d8e75b306e50',
      redirect_uri: 'https://callmeet-git-main-suhwan-sungs-projects.vercel.app',
      code: code
    })
  });
  const data = await response.json();
  res.json(data);
}
