import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const form = document.getElementById('process-payment-form');
if (form) {
    const bookingIdInput = document.getElementById('payment-booking-id');
    const selectedMethodInput = document.getElementById('selected-payment-method');
    const amountElement = document.getElementById('payment-total-amount');
    const serviceNameElement = document.getElementById('payment-service-name');
    const providerNameElement = document.getElementById('payment-provider-name');
    const appointmentElement = document.getElementById('payment-appointment');
    const methodBadge = document.getElementById('payment-method-badge');
    const statusMessage = document.getElementById('payment-status-message');
    const emoneyFields = document.getElementById('emoney-fields-wrapper');
    const cardFields = document.getElementById('card-fields-wrapper');
    const mobileLabel = document.getElementById('emoney-mobile-label');
    const mobileInput = document.getElementById('emoney-mobile-number');
    const accountNameInput = document.getElementById('emoney-account-name');
    const referenceInput = document.getElementById('emoney-reference-number');
    const cardNumberInput = document.getElementById('card-number');
    const cardholderInput = document.getElementById('cardholder-name');
    const expiryInput = document.getElementById('card-expiry');
    const cvvInput = document.getElementById('card-cvv');
    const submitButton = document.getElementById('confirm-payment-btn');
    const payLaterButton = document.getElementById('pay-later-btn');
    const successModal = document.getElementById('payment-success-modal');
    const successMethod = document.getElementById('success-modal-method');
    const successAmount = document.getElementById('success-modal-amount');
    const successReference = document.getElementById('success-modal-ref');
    const bookingsButton = document.getElementById('btn-go-to-bookings');
    const bookingId = new URLSearchParams(window.location.search).get('bookingId')
        || new URLSearchParams(window.location.search).get('id');
    let booking = null;
    let busy = false;

    const methodNames = { gcash: 'GCash', maya: 'Maya', card: 'Credit / Debit Card' };
    const setMessage = (message, type = '') => {
        if (!statusMessage) return;
        statusMessage.textContent = message;
        statusMessage.dataset.state = type;
    };
    const digits = (value) => String(value || '').replace(/\D/g, '');

    function makeDemoReference() {
        const bytes = new Uint32Array(2);
        globalThis.crypto.getRandomValues(bytes);
        const combined = `${bytes[0]}${bytes[1]}`.replace(/\D/g, '');
        return (combined + String(Date.now())).slice(0, 13).padEnd(13, '0');
    }

    function setMethod(method) {
        const safeMethod = methodNames[method] ? method : 'gcash';
        selectedMethodInput.value = safeMethod;
        methodBadge.textContent = methodNames[safeMethod];
        document.querySelectorAll('.method-tab').forEach((tab) => {
            const selected = tab.dataset.method === safeMethod;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', String(selected));
        });
        const isCard = safeMethod === 'card';
        emoneyFields.hidden = isCard;
        emoneyFields.classList.toggle('hidden', isCard);
        cardFields.hidden = !isCard;
        cardFields.classList.toggle('hidden', !isCard);
        mobileLabel.textContent = `${safeMethod === 'maya' ? 'Maya' : 'GCash'} Mobile Number *`;
        [mobileInput, accountNameInput, referenceInput].forEach((input) => { input.required = !isCard; });
        [cardNumberInput, cardholderInput, expiryInput, cvvInput].forEach((input) => { input.required = isCard; });
    }

    function setFormEnabled(enabled) {
        form.querySelectorAll('input, button').forEach((element) => {
            if (element.id !== 'selected-payment-method' && element.id !== 'payment-booking-id') element.disabled = !enabled;
        });
        document.querySelectorAll('.method-tab').forEach((tab) => { tab.disabled = !enabled; });
    }

    function formatCurrency(value) {
        return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function formatAppointment(date, time) {
        const dateLabel = date ? new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
            .format(new Date(`${date}T00:00:00`)) : 'Date not set';
        return `${dateLabel} · ${time || 'Time not set'}`;
    }

    function isValidCardNumber(value) {
        const number = digits(value);
        if (number.length < 13 || number.length > 19) return false;
        let sum = 0;
        let doubleDigit = false;
        for (let index = number.length - 1; index >= 0; index -= 1) {
            let digit = Number(number[index]);
            if (doubleDigit) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            doubleDigit = !doubleDigit;
        }
        return sum % 10 === 0;
    }

    function validatePayment(method) {
        if (method === 'gcash' || method === 'maya') {
            if (!/^09\d{9}$/.test(digits(mobileInput.value))) return 'Enter a valid 11-digit Philippine mobile number starting with 09.';
            if (!accountNameInput.value.trim()) return 'Enter the e-money account name.';
            if (!/^\d{13}$/.test(digits(referenceInput.value))) return 'Enter a 13-digit transaction reference number.';
            return '';
        }
        if (!isValidCardNumber(cardNumberInput.value)) return 'Enter a valid demo card number.';
        if (!cardholderInput.value.trim()) return 'Enter the cardholder name.';
        const expiry = expiryInput.value.trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
        if (!expiry) return 'Enter the expiry date in MM/YY format.';
        const expiryMonth = Number(expiry[1]);
        const expiryYear = 2000 + Number(expiry[2]);
        const now = new Date();
        if (expiryYear < now.getFullYear() || (expiryYear === now.getFullYear() && expiryMonth < now.getMonth() + 1)) return 'The card expiry date has passed.';
        if (!/^\d{3,4}$/.test(digits(cvvInput.value))) return 'Enter a 3- or 4-digit CVV.';
        return '';
    }

    document.querySelectorAll('.method-tab').forEach((tab) => {
        tab.addEventListener('click', () => setMethod(tab.dataset.method));
    });
    payLaterButton?.addEventListener('click', () => window.location.assign('bookings.html'));
    bookingsButton?.addEventListener('click', () => window.location.assign('bookings.html'));
    document.getElementById('btn-generate-ref')?.addEventListener('click', () => {
        referenceInput.value = makeDemoReference();
        referenceInput.focus();
    });
    mobileInput.addEventListener('input', () => { mobileInput.value = digits(mobileInput.value).slice(0, 11); });
    referenceInput.addEventListener('input', () => { referenceInput.value = digits(referenceInput.value).slice(0, 13); });
    cardNumberInput.addEventListener('input', () => {
        const value = digits(cardNumberInput.value).slice(0, 19);
        cardNumberInput.value = value.replace(/(.{4})/g, '$1 ').trim();
    });
    expiryInput.addEventListener('input', () => {
        const value = digits(expiryInput.value).slice(0, 4);
        expiryInput.value = value.length > 2 ? `${value.slice(0, 2)}/${value.slice(2)}` : value;
    });
    cvvInput.addEventListener('input', () => { cvvInput.value = digits(cvvInput.value).slice(0, 4); });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!booking || !auth.currentUser || busy) return;
        const method = selectedMethodInput.value;
        const validationMessage = validatePayment(method);
        if (validationMessage) { setMessage(validationMessage, 'error'); return; }
        if (booking.paymentStatus === 'paid') { setMessage('This booking is already marked as paid.', 'success'); return; }
        if (!['pending', 'confirmed'].includes(booking.status)) {
            setMessage('Payment is only available for pending or confirmed bookings.', 'error');
            return;
        }

        busy = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Recording simulated payment…';
        setMessage('Recording simulated payment…');
        const reference = method === 'card' ? `SIM-${makeDemoReference()}` : digits(referenceInput.value);
        try {
            await updateDoc(doc(db, 'bookings', booking.id), {
                paymentMethod: method,
                paymentStatus: 'paid',
                paymentReference: reference,
                updatedAt: serverTimestamp(),
            });
            booking.paymentMethod = method;
            booking.paymentStatus = 'paid';
            booking.paymentReference = reference;
            methodBadge.textContent = methodNames[method];
            setFormEnabled(false);
            successMethod.textContent = methodNames[method].toUpperCase();
            successAmount.textContent = formatCurrency(booking.price);
            successReference.textContent = reference;
            successModal.hidden = false;
            successModal.classList.remove('hidden');
            bookingsButton?.focus();
            setMessage('Simulated payment recorded.', 'success');
            submitButton.textContent = 'Payment Recorded';
        } catch (error) {
            console.error('Unable to record simulated payment:', error);
            setMessage(error.code === 'permission-denied'
                ? 'Firebase rules rejected this payment update. Deploy the latest booking rules and try again.'
                : 'Unable to record payment. Please try again.', 'error');
            submitButton.disabled = false;
            submitButton.textContent = 'Confirm Payment (Simulated)';
        } finally {
            busy = false;
            // Card credentials are never persisted; clear them even when Firestore fails.
            cardNumberInput.value = '';
            cardholderInput.value = '';
            expiryInput.value = '';
            cvvInput.value = '';
        }
    });

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            const returnTo = `pay.html?bookingId=${encodeURIComponent(bookingId || '')}`;
            window.location.assign(`login.html?redirect=${encodeURIComponent(returnTo)}`);
            return;
        }
        if (!bookingId) {
            setMessage('Booking ID is missing. Return to My Bookings and choose Pay Now.', 'error');
            setFormEnabled(false);
            return;
        }
        setMessage('Loading booking…');
        try {
            const bookingSnapshot = await getDoc(doc(db, 'bookings', bookingId));
            if (!bookingSnapshot.exists()) throw new Error('This booking could not be found.');
            booking = { id: bookingSnapshot.id, ...bookingSnapshot.data() };
            if (booking.customerId !== user.uid) throw new Error('You can only pay for your own bookings.');
            if (String(booking.paymentMethod || '').toLowerCase() === 'cash') {
                setMessage('This booking is set to Cash on Service. Pay the provider when the service is completed.', 'error');
                setFormEnabled(false);
                return;
            }

            bookingIdInput.value = booking.id;
            serviceNameElement.textContent = booking.serviceName || 'Service';
            providerNameElement.textContent = booking.providerName || 'Service Provider';
            amountElement.textContent = formatCurrency(booking.price);
            appointmentElement.textContent = formatAppointment(booking.date, booking.time);
            if (booking.paymentStatus === 'paid') {
                setMethod(booking.paymentMethod || 'gcash');
                setFormEnabled(false);
                submitButton.textContent = 'Payment Already Recorded';
                setMessage(`This booking is marked paid. Reference: ${booking.paymentReference || 'Recorded'}`, 'success');
                return;
            }
            const urlMethod = new URLSearchParams(window.location.search).get('method');
            const preferredMethod = ['gcash', 'maya', 'card'].includes(urlMethod) ? urlMethod : booking.paymentMethod;
            setMethod(['gcash', 'maya', 'card'].includes(preferredMethod) ? preferredMethod : 'gcash');
            setMessage('Enter the requested details to record a simulated payment.');
        } catch (error) {
            console.error('Unable to load payment booking:', error);
            setMessage(error.code === 'permission-denied'
                ? 'You do not have access to this booking. Please return to My Bookings and try again.'
                : error.message || 'Unable to load this booking.', 'error');
            setFormEnabled(false);
        }
    }, (error) => {
        console.error('Payment auth state failed:', error);
        setMessage('Unable to verify your account. Refresh the page and try again.', 'error');
    });
}
