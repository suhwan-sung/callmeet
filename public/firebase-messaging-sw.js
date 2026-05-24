importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDji_UBduVXFN6HRZXOvRuvnu_WqudWp_E",
  authDomain: "callmeet-b43d9.firebaseapp.com",
  projectId: "callmeet-b43d9",
  storageBucket: "callmeet-b43d9.firebasestorage.app",
  messagingSenderId: "377713372896",
  appId: "1:377713372896:web:43fe2098878d6f3cf1ea85"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification;
  const data = payload.data || {};
  self.registration.showNotification(title, {
    body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    vibrate: [200, 100, 200],
    data: data,
    tag: data.type || 'general'
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(windowClients => {
      if(windowClients.length > 0) {
        const client = windowClients[0];
        client.postMessage({
          type: 'NAVIGATE',
          tab: data.type === 'chat' ? 'chat'
              : data.type === 'share' ? 'shared'
              : data.type === 'friend' ? 'friends'
              : 'calendar',
          friendId: data.friendId || null
        });
        return client.focus();
      }
      let url = 'https://callmeet.vercel.app/';
      if(data.type === 'chat' && data.friendId)
        url = `https://callmeet.vercel.app/?tab=chat&friendId=${data.friendId}`;
      else if(data.type === 'share')
        url = `https://callmeet.vercel.app/?tab=shared`;
      else if(data.type === 'friend')
        url = `https://callmeet.vercel.app/?tab=friends`;
      return clients.openWindow(url);
    })
  );
});
