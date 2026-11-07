import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const form = document.getElementById('contact-form');
const status = document.getElementById('contact-form-status');
const submitButton = form?.querySelector('[type="submit"]');

function setFormStatus(message, state = '') {
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

onAuthStateChanged(auth, (user) => {
    if (!user || !form) return;
    const nameInput = form.elements.name;
    const emailInput = form.elements.email;
    if (!nameInput.value.trim()) nameInput.value = user.displayName || '';
    if (!emailInput.value.trim()) emailInput.value = user.email || '';
});

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    // Quietly discard automated submissions caught by the hidden honeypot.
    if (String(data.get('website') || '').trim()) {
        form.reset();
        setFormStatus('Thanks. Your message has been received.', 'success');
        return;
    }

    const inquiry = {
        name: String(data.get('name') || '').trim(),
        email: String(data.get('email') || '').trim().toLowerCase(),
        phone: String(data.get('phone') || '').trim(),
        topic: String(data.get('topic') || '').trim(),
        message: String(data.get('message') || '').trim(),
        status: 'new',
        createdAt: serverTimestamp(),
    };
    if (!inquiry.name || !inquiry.email || !inquiry.topic || !inquiry.message) {
        setFormStatus('Complete the required fields and try again.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
    setFormStatus('Sending your message…');
    try {
        await addDoc(collection(db, 'contactInquiries'), inquiry);
        form.reset();
        setFormStatus('Thanks for contacting SERVIBOOK. Your message has been sent.', 'success');
    } catch (error) {
        console.error('Unable to send contact inquiry:', error);
        setFormStatus(error.code === 'permission-denied'
            ? 'We could not accept the message right now. Please try again later.'
            : 'Your message could not be sent. Check your connection and try again.', 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Send Message';
    }
});
