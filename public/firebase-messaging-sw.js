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
  const { title, body, icon } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: icon || '/icon.svg',
    badge: '/icon.svg'
  });
});
