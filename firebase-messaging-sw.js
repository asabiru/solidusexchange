
self.onnotificationclick = (event) => {
    if(event.notification.data.FCM_MSG.data.click_action){
        event.notification.close();
        event.waitUntil(clients.matchAll({
            type: 'window'
        }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === '/' && 'focus' in client)
                    return client.focus();
            }
            if (clients.openWindow)
                return clients.openWindow(event.notification.data.FCM_MSG.data.click_action);
        }));
    }
};
importScripts('https://www.gstatic.com/firebasejs/8.3.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.3.2/firebase-messaging.js');

const firebaseConfig = {
    apiKey: "AIzaSyBbsDRF9elv5b_-EJE3s2iPlrLx_Y6IkGE",
    authDomain: "solid-3f66c.firebaseapp.com",
    projectId: "solid-3f66c",
    storageBucket: "solid-3f66c.firebasestorage.app",
    messagingSenderId: "471856513740",
    appId: "1:471856513740:web:1c9d4646cda56ac5f3b869",
    measurementId: "G-7QDR03JY4W"
};

const app = firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler(function (payload) {
    if (payload.notification.background && payload.notification.background == 1) {
        const title = payload.notification.title;
        const options = {
            body: payload.notification.body,
            icon: payload.notification.icon,
        };
        return self.registration.showNotification(
            title,
            options,
        );
    }
});
