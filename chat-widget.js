import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const mount = document.getElementById('servibookChatMount');
if (mount) {
    try {
        const response = await fetch('includes/chat-widget.html?v=3');
        if (!response.ok) throw new Error(`Chat widget request failed (${response.status}).`);
        mount.innerHTML = await response.text();
        await import('./chat.js?v=3');

        const button = document.getElementById('chatToggle');
        const label = button?.querySelector('span');
        onAuthStateChanged(auth, async (user) => {
            let isProvider = false;
            if (user) {
                try {
                    const profile = await getDoc(doc(db, 'users', user.uid));
                    isProvider = profile.exists() && profile.data().role === 'provider';
                } catch (profileError) {
                    console.error('Could not determine chat button role:', profileError);
                }
            }

            button?.classList.toggle('provider-chat-mode', isProvider);
            if (button) {
                button.setAttribute('aria-label', isProvider ? 'Open chat' : 'Need help? Open live chat');
                button.title = isProvider ? 'Open chat' : 'Need help? Chat here';
            }
            if (label) label.textContent = '💬 Need Help? Chat Here';
        }, (authError) => console.error('Could not check chat button account:', authError));
    } catch (error) {
        console.error('Unable to initialize the chat widget:', error);
    }
}
