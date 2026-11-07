import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged,
    signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const googleProvider = new GoogleAuthProvider();

export async function signIn(email, password) {
    try { return await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch (error) { console.error('Firebase sign-in failed:', error); throw error; }
}

export async function signInWithGoogle({ privacyConsent = false } = {}) {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const profileRef = doc(db, 'users', user.uid);
        const profile = await getDoc(profileRef);
        if (!profile.exists()) {
            const fullName = user.displayName || 'Google User';
            await setDoc(profileRef, {
                uid: user.uid,
                full_name: fullName,
                // Keep the app's existing profile readers compatible.
                fullName,
                email: user.email,
                role: 'customer',
                photoURL: user.photoURL || '',
                createdAt: serverTimestamp(),
                ...(privacyConsent ? {
                    privacyConsent: true,
                    privacyNoticeVersion: '2026-11-07',
                    privacyConsentAt: serverTimestamp(),
                } : {}),
            });
        }
        if (privacyConsent) {
            await setDoc(profileRef, {
                privacyConsent: true,
                privacyNoticeVersion: '2026-11-07',
                privacyConsentAt: serverTimestamp(),
            }, { merge: true });
        }
        return user;
    } catch (error) {
        console.error('Google sign-in failed:', error);
        throw error;
    }
}

export async function signUp({ email, password, fullName, role = 'customer', phone = '', barangay = '', streetAddress = '', location = '', privacyConsent = false }) {
    if (!['customer', 'provider'].includes(role)) throw new Error('Choose a valid account type.');
    if (privacyConsent !== true) throw new Error('Please agree to the Privacy Policy before creating your account.');
    const cleanBarangay = barangay.trim();
    const cleanStreetAddress = streetAddress.trim();
    const completeLocation = cleanBarangay
        ? [cleanStreetAddress, cleanBarangay, 'San Jose', 'Occidental Mindoro'].filter(Boolean).join(', ')
        : location.trim();
    let credential;
    try {
        credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(credential.user, { displayName: fullName.trim() });
        await setDoc(doc(db, 'users', credential.user.uid), {
            uid: credential.user.uid,
            fullName: fullName.trim(), email: credential.user.email,
            role, phone: phone.trim() || null,
            barangay: cleanBarangay || null,
            streetAddress: cleanStreetAddress || null,
            location: completeLocation || null,
            privacyConsent: true,
            privacyNoticeVersion: '2026-11-07',
            privacyConsentAt: serverTimestamp(),
            createdAt: serverTimestamp(),
        });
        return credential.user;
    } catch (error) {
        // Avoid leaving an Auth account that has no matching Firestore profile.
        if (credential?.user) await deletePartialAccount(credential.user);
        console.error('Firebase registration failed:', error);
        throw error;
    }
}

async function deletePartialAccount(user) {
    try { await user.delete(); } catch (cleanupError) { console.error('Could not clean up incomplete account:', cleanupError); }
}

export function observeAuth(callback, onError = console.error) {
    return onAuthStateChanged(auth, callback, onError);
}

export async function signOutUser() {
    try { await signOut(auth); } catch (error) { console.error('Firebase sign-out failed:', error); throw error; }
}

function friendlyError(error) {
    const known = {
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/user-not-found': 'No account was found for that email.',
        'auth/email-already-in-use': 'Email already registered.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/popup-closed-by-user': 'Google sign-in was canceled. Please try again.',
        'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
        'auth/account-exists-with-different-credential': 'An account already exists with this email. Sign in using your original method.',
        'permission-denied': 'Your account was created but its profile could not be saved. Contact support.',
    };
    return known[error.code] || error.message || 'Unable to complete the request. Please try again.';
}

function showFormError(form, message) {
    let status = form.querySelector('[data-auth-status]');
    if (!status) {
        status = document.createElement('div');
        status.dataset.authStatus = '';
        status.className = 'alert alert-error';
        status.setAttribute('role', 'alert');
        status.setAttribute('aria-live', 'assertive');
        form.prepend(status);
    }
    status.textContent = message;
}

const loginForm = document.getElementById('loginForm');
if (loginForm) loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('[type="submit"]'); button.disabled = true;
    try {
        await signIn(loginForm.elements.email.value, loginForm.elements.password.value);
        window.location.assign('index.html');
    } catch (error) { showFormError(loginForm, friendlyError(error)); }
    finally { button.disabled = false; }
});

const registrationForm = document.getElementById('registerForm');
if (registrationForm) registrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(registrationForm);
    const consentCheckbox = document.getElementById('privacy-consent-checkbox');
    const consentError = document.getElementById('privacy-consent-error');
    if (!consentCheckbox?.checked) {
        if (consentError) consentError.hidden = false;
        consentCheckbox?.focus();
        return;
    }
    if (consentError) consentError.hidden = true;
    if (data.get('password') !== data.get('confirm_password')) { showFormError(registrationForm, 'Passwords do not match.'); return; }
    const button = registrationForm.querySelector('[type="submit"]'); button.disabled = true;
    try {
        await signUp({
            email: data.get('email'), password: data.get('password'), fullName: data.get('full_name'),
            role: data.get('role'), phone: data.get('phone') || '',
            barangay: data.get('barangay') || '', streetAddress: data.get('street_address') || '',
            privacyConsent: true,
        });
        window.location.assign('index.html');
    } catch (error) { showFormError(registrationForm, friendlyError(error)); }
    finally { button.disabled = false; }
});

const googleAuthButton = document.getElementById('google-auth-btn');
if (googleAuthButton) googleAuthButton.addEventListener('click', async () => {
    const form = loginForm || registrationForm;
    const consentCheckbox = document.getElementById('privacy-consent-checkbox');
    const consentError = document.getElementById('privacy-consent-error');
    if (consentCheckbox && !consentCheckbox.checked) {
        if (consentError) consentError.hidden = false;
        consentCheckbox.focus();
        return;
    }
    if (consentError) consentError.hidden = true;
    googleAuthButton.disabled = true;
    try {
        await signInWithGoogle({ privacyConsent: Boolean(consentCheckbox?.checked) });
        window.location.assign('index.html');
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user') {
            alert('Google sign-in was closed before it could finish. Please try again.');
        } else if (error.code !== 'auth/cancelled-popup-request') {
            showFormError(form, friendlyError(error));
        }
    } finally {
        googleAuthButton.disabled = false;
    }
});

// Registration privacy notice: require an explicit checkbox before either
// email/password registration or Google account creation can proceed.
const privacyCheckbox = document.getElementById('privacy-consent-checkbox');
const privacyModal = document.getElementById('privacy-policy-modal');
const openPrivacyButton = document.getElementById('open-privacy-modal-btn');
const closePrivacyButton = document.getElementById('close-privacy-modal-btn');
const acceptPrivacyButton = document.getElementById('accept-privacy-btn');
let privacyReturnFocus = null;

if (privacyCheckbox) {
    privacyCheckbox.addEventListener('invalid', () => {
        const consentError = document.getElementById('privacy-consent-error');
        if (consentError) consentError.hidden = false;
    });
    privacyCheckbox.addEventListener('change', () => {
        if (privacyCheckbox.checked) {
            const consentError = document.getElementById('privacy-consent-error');
            if (consentError) consentError.hidden = true;
        }
    });
}

if (privacyModal) {
    const privacyCard = privacyModal.querySelector('.modal-card');
    const closePrivacyModal = () => {
        privacyModal.classList.add('hidden');
        privacyModal.setAttribute('aria-hidden', 'true');
        privacyReturnFocus?.focus?.();
    };
    const openPrivacyModal = (trigger) => {
        privacyReturnFocus = trigger;
        privacyModal.classList.remove('hidden');
        privacyModal.setAttribute('aria-hidden', 'false');
        closePrivacyButton?.focus();
    };

    openPrivacyButton?.addEventListener('click', (event) => {
        event.preventDefault();
        openPrivacyModal(openPrivacyButton);
    });
    closePrivacyButton?.addEventListener('click', closePrivacyModal);
    privacyModal.addEventListener('click', (event) => {
        if (event.target === privacyModal) closePrivacyModal();
    });
    acceptPrivacyButton?.addEventListener('click', () => {
        if (privacyCheckbox) {
            privacyCheckbox.checked = true;
            privacyCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const consentError = document.getElementById('privacy-consent-error');
        if (consentError) consentError.hidden = true;
        closePrivacyModal();
    });
    document.addEventListener('keydown', (event) => {
        if (privacyModal.classList.contains('hidden')) return;
        if (event.key === 'Escape') {
            closePrivacyModal();
            return;
        }
        if (event.key === 'Tab' && privacyCard) {
            const focusable = [...privacyCard.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
}

// Keep navigation and role-specific areas in sync with Firebase Auth state.
observeAuth(async (user) => {
    window.servibookUser = user || null;
    let profile = null;
    if (user) {
        try {
            const snapshot = await getDoc(doc(db, 'users', user.uid));
            profile = snapshot.exists() ? snapshot.data() : null;
        } catch (error) { console.error('Unable to load the signed-in profile:', error); }
    }
    document.querySelectorAll('[data-auth-only]').forEach((element) => { element.hidden = !user; });
    document.querySelectorAll('[data-guest-only]').forEach((element) => { element.hidden = Boolean(user); });
    document.querySelectorAll('[data-role]').forEach((element) => { element.hidden = !user || profile?.role !== element.dataset.role; });
    document.querySelectorAll('.auth-user').forEach((element) => element.classList.toggle('d-none', !user));
    document.querySelectorAll('.auth-guest').forEach((element) => element.classList.toggle('d-none', Boolean(user)));
    const dashboardLink = document.querySelector('[data-dashboard-link]');
    if (dashboardLink) {
        const canOpenDashboard = profile?.role === 'admin' || profile?.role === 'provider';
        dashboardLink.href = profile?.role === 'admin' ? 'admin-dashboard.html' : 'provider-dashboard.html';
        dashboardLink.classList.toggle('d-none', !user || !canOpenDashboard);
    }
    document.querySelectorAll('.user-welcome').forEach((element) => { element.textContent = user ? `Hi, ${profile?.fullName || user.displayName || 'there'}` : ''; });
    document.querySelectorAll('.sidebar-profile h3').forEach((element) => { element.textContent = profile?.fullName || user?.displayName || ''; });
    const requiredRole = document.body.dataset.requiresRole;
    if (document.body.hasAttribute('data-requires-auth') && !user) {
        window.location.replace('login.html');
    } else if (requiredRole && profile?.role !== requiredRole) {
        window.location.replace('index.html');
    }
}, (error) => console.error('Auth state listener failed:', error));

let logoutReturnFocus = null;
function ensureLogoutModal() {
    let modal = document.getElementById('logout-modal');
    if (modal) return modal;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="logout-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="logout-modal-title">
        <div class="modal-card modal-card-dark">
          <div class="modal-icon-wrapper logout-icon-bg">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </div>
          <h3 id="logout-modal-title" class="modal-title">Log Out of SERVIBOOK?</h3>
          <p class="modal-description">Are you sure you want to log out of your account?</p>
          <div class="modal-actions">
            <button type="button" id="close-logout-modal-btn" class="btn-modal-secondary">Stay Logged In</button>
            <button type="button" id="confirm-logout-btn" class="btn-modal-primary">Yes, Log Out</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('logout-modal');
    const closeModal = () => {
        modal.classList.add('hidden');
        logoutReturnFocus?.focus?.();
    };
    document.getElementById('close-logout-modal-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });
    document.getElementById('confirm-logout-btn').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Logging Out…';
        try {
            await signOutUser();
            window.location.assign('login.html');
        } catch (error) {
            alert(error.message || 'Unable to sign out.');
        } finally {
            button.disabled = false;
            button.textContent = 'Yes, Log Out';
        }
    });
    return modal;
}

document.addEventListener('click', (event) => {
    const logoutTrigger = event.target.closest('[data-firebase-signout]');
    if (!logoutTrigger) return;
    event.preventDefault();
    logoutReturnFocus = logoutTrigger;
    const modal = ensureLogoutModal();
    modal.classList.remove('hidden');
    document.getElementById('close-logout-modal-btn').focus();
});

