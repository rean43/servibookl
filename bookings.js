import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
    collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const listContainer = document.getElementById('bookings-list-container');
const list = document.getElementById('bookings-list');
const emptyState = document.getElementById('no-bookings-container');
const loadingState = document.getElementById('bookings-loading');
let stopListening = null;
let renderRevision = 0;
let initialAuthResolved = false;
let initialAuthUser = null;
let initialAuthPromise = null;
const cancelModal = document.getElementById('cancel-modal');
const closeCancelModalButton = document.getElementById('close-cancel-modal-btn');
const confirmCancelButton = document.getElementById('confirm-cancel-btn');
let pendingCancellation = null;

function waitForInitialAuthState() {
    if (initialAuthResolved) return Promise.resolve(initialAuthUser);
    if (initialAuthPromise) return initialAuthPromise;

    initialAuthPromise = new Promise((resolve, reject) => {
        let unsubscribe = () => {};
        unsubscribe = onAuthStateChanged(auth, (user) => {
            initialAuthResolved = true;
            initialAuthUser = user;
            unsubscribe();
            resolve(user);
        }, (error) => {
            unsubscribe();
            reject(error);
        });
    });
    return initialAuthPromise;
}

function closeCancelModal() {
    if (!cancelModal || confirmCancelButton?.disabled) return;
    cancelModal.hidden = true;
    cancelModal.classList.add('hidden');
    const trigger = pendingCancellation?.trigger;
    pendingCancellation = null;
    trigger?.focus();
}

function openCancelModal(booking, trigger) {
    if (!cancelModal) return;
    pendingCancellation = { booking, trigger };
    cancelModal.hidden = false;
    cancelModal.classList.remove('hidden');
    closeCancelModalButton?.focus();
}

closeCancelModalButton?.addEventListener('click', closeCancelModal);
cancelModal?.addEventListener('click', (event) => {
    if (event.target === cancelModal) closeCancelModal();
});
document.addEventListener('keydown', (event) => {
    if (!cancelModal || cancelModal.hidden) return;
    if (event.key === 'Escape') {
        closeCancelModal();
        return;
    }
    if (event.key === 'Tab') {
        const focusable = [closeCancelModalButton, confirmCancelButton]
            .filter((element) => element && !element.disabled);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
});

confirmCancelButton?.addEventListener('click', async () => {
    if (!pendingCancellation || confirmCancelButton.disabled) return;
    const { booking, trigger } = pendingCancellation;
    confirmCancelButton.disabled = true;
    closeCancelModalButton.disabled = true;
    confirmCancelButton.textContent = 'Cancelling…';
    try {
        await updateDoc(doc(db, 'bookings', booking.id), {
            status: 'cancelled',
            updatedAt: serverTimestamp(),
        });
        pendingCancellation = null;
        cancelModal.hidden = true;
        cancelModal.classList.add('hidden');
        trigger?.focus();
    } catch (error) {
        console.error('Unable to cancel booking:', error);
        window.alert(error.code === 'permission-denied'
            ? 'This booking could not be cancelled. Check the Firestore booking rules.'
            : error.message || 'Unable to cancel this booking.');
    } finally {
        confirmCancelButton.disabled = false;
        closeCancelModalButton.disabled = false;
        confirmCancelButton.textContent = 'Yes, Cancel Booking';
    }
});

function setCount(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
}

function formatDate(value) {
    if (!value) return 'Date not set';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? String(value)
        : new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

function formatTime(value) {
    if (!value) return 'Time not set';
    const date = new Date(`2000-01-01T${value}`);
    return Number.isNaN(date.getTime())
        ? String(value)
        : new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatPaymentMethod(value) {
    const labels = { cash: 'Cash on Service', gcash: 'GCash', maya: 'Maya', card: 'Credit/Debit Card' };
    const key = String(value || '').toLowerCase();
    return labels[key] || String(value || 'Not specified');
}

function normalizedStatus(value) {
    const status = String(value || 'pending').toLowerCase();
    return ['pending', 'confirmed', 'completed', 'cancelled'].includes(status) ? status : 'pending';
}

function makeBookingCard(booking) {
    const card = document.createElement('article');
    card.className = 'booking-card';
    card.dataset.bookingId = booking.id;

    const imageArea = document.createElement('div');
    imageArea.className = 'booking-image';
    if (typeof booking.imageUrl === 'string' && booking.imageUrl.trim()) {
        const image = document.createElement('img');
        image.src = booking.imageUrl;
        image.alt = `${booking.serviceName || 'Service'} image`;
        image.loading = 'lazy';
        image.onerror = () => {
            image.remove();
            const icon = document.createElement('span');
            icon.className = 'no-image';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '🛠️';
            imageArea.append(icon);
        };
        imageArea.append(image);
    } else {
        const icon = document.createElement('span');
        icon.className = 'no-image';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🛠️';
        imageArea.append(icon);
    }

    const info = document.createElement('div');
    info.className = 'booking-info';
    const serviceName = document.createElement('h3');
    serviceName.textContent = booking.serviceName || 'Service';
    const provider = document.createElement('p');
    provider.className = 'booking-provider';
    provider.textContent = `by ${booking.providerName || 'Service Provider'}`;
    const details = document.createElement('div');
    details.className = 'booking-details booking-meta';
    [
        `▦ ${formatDate(booking.date)}`,
        `◷ ${formatTime(booking.time)}`,
        `☰ ${booking.category || 'Service'}`,
    ].forEach((text) => {
        const item = document.createElement('span');
        item.textContent = text;
        details.append(item);
    });
    if (booking.bookingMode === 'in_store' && booking.queueNumber) {
        const queue = document.createElement('span');
        queue.className = 'booking-queue-number';
        queue.textContent = `Queue #${booking.queueNumber}`;
        details.append(queue);
    } else if (booking.bookingMode === 'home_service' && booking.serviceAddress) {
        const address = document.createElement('span');
        address.textContent = `Home service · ${booking.serviceAddress}`;
        details.append(address);
    }
    info.append(serviceName, provider, details);

    const right = document.createElement('div');
    right.className = 'booking-right';
    const status = normalizedStatus(booking.status);
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${status}`;
    statusBadge.textContent = status;
    const price = document.createElement('div');
    price.className = 'booking-price';
    const numericPrice = Number(booking.price);
    price.textContent = Number.isFinite(numericPrice)
        ? `₱${numericPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'Price unavailable';

    const paymentRow = document.createElement('div');
    paymentRow.className = 'booking-payment-row';
    const payment = document.createElement('span');
    payment.textContent = formatPaymentMethod(booking.paymentMethod);
    const paymentStatus = document.createElement('span');
    const paid = booking.paymentStatus === 'paid';
    const cashPayment = String(booking.paymentMethod || '').toLowerCase() === 'cash';
    paymentStatus.className = `status-badge ${paid ? 'pay-paid' : 'pay-pending'}`;
    paymentStatus.textContent = paid ? 'PAID' : cashPayment ? 'PAY ON SERVICE' : 'UNPAID';
    paymentRow.append(payment, paymentStatus);

    const actions = document.createElement('div');
    actions.className = 'booking-actions';
    if (status === 'pending') {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'booking-cancel-btn';
        cancelButton.textContent = 'Cancel Booking';
        cancelButton.addEventListener('click', () => openCancelModal(booking, cancelButton));
        actions.append(cancelButton);
    }

    if (!paid && !cashPayment && status !== 'cancelled') {
        const payButton = document.createElement('a');
        payButton.className = 'booking-pay-btn btn-primary';
        payButton.textContent = 'Pay Now';
        payButton.href = `pay.html?bookingId=${encodeURIComponent(booking.id)}&method=${encodeURIComponent(booking.paymentMethod || 'gcash')}`;
        actions.append(payButton);
    }

    const chatButton = document.createElement('button');
    chatButton.type = 'button';
    chatButton.className = 'booking-chat-btn btn-chat-provider';
    chatButton.dataset.action = 'chat';
    chatButton.dataset.bookingId = booking.id || '';
    chatButton.dataset.providerId = booking.providerId || booking.vendorId || '';
    chatButton.dataset.providerName = booking.providerName || booking.serviceProvider || 'Provider';
    chatButton.dataset.serviceId = booking.serviceId || '';
    chatButton.textContent = 'Chat with Provider';
    // Leave enabled when providerId is absent so the handler can recover it from the booking.
    chatButton.disabled = !chatButton.dataset.providerId && !chatButton.dataset.bookingId;
    actions.append(chatButton);
    right.append(statusBadge, price, paymentRow, actions);
    card.append(imageArea, info, right);
    return card;
}

// Booking cards are rendered dynamically, so delegate clicks from the document.
document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const chatButton = target.closest('.btn-chat-provider, button[data-action="chat"]');
    if (!chatButton || chatButton.disabled) return;

    chatButton.disabled = true;
    const previousText = chatButton.textContent;
    chatButton.textContent = 'Opening chat…';
    try {
        const currentUser = await waitForInitialAuthState();
        if (!currentUser) {
            window.alert('Please log in to chat with providers.');
            window.location.assign('login.html');
            return;
        }

        let providerId = chatButton.dataset.providerId;
        let providerName = chatButton.dataset.providerName || 'Service Provider';
        if ((!providerId || providerId === 'undefined') && chatButton.dataset.bookingId) {
            try {
                const bookingSnapshot = await getDoc(doc(db, 'bookings', chatButton.dataset.bookingId));
                if (bookingSnapshot.exists()) {
                    const bookingData = bookingSnapshot.data();
                    providerId = bookingData.providerId || bookingData.vendorId || '';
                    providerName = bookingData.providerName || bookingData.serviceProvider || providerName;
                }
            } catch (error) {
                console.error('Unable to recover provider details from booking:', error);
            }
        }
        if (!providerId || providerId === 'undefined') {
            window.alert('Cannot open chat because provider information is missing from this booking.');
            return;
        }
        if (typeof window.openServibookChat !== 'function') {
            window.alert('Chat is still loading. Please try again in a moment.');
            return;
        }

        const opened = await window.openServibookChat({
            providerId,
            serviceId: chatButton.dataset.serviceId || null,
            partnerName: providerName,
        });
        if (opened === false) chatButton.disabled = !chatButton.dataset.providerId && !chatButton.dataset.bookingId;
    } catch (error) {
        console.error('Unable to open booking conversation:', error);
        window.alert('Unable to open chat right now. Please try again.');
    } finally {
        chatButton.disabled = !chatButton.dataset.providerId && !chatButton.dataset.bookingId;
        chatButton.textContent = previousText;
    }
});

async function addServiceDetails(booking) {
    if (!booking.serviceId || (booking.category && booking.providerName && booking.imageUrl)) return booking;
    try {
        const serviceDoc = await getDoc(doc(db, 'services', booking.serviceId));
        if (!serviceDoc.exists()) return booking;
        const service = serviceDoc.data();
        return {
            ...service,
            ...booking,
            category: booking.category || service.category || '',
            providerName: booking.providerName || service.providerName || 'Service Provider',
            imageUrl: booking.imageUrl || service.imageUrl || service.image || '',
        };
    } catch (error) {
        console.warn('Could not load related booking service details:', error);
        return booking;
    }
}

async function renderBookings(snapshot) {
    const revision = ++renderRevision;
    const bookings = snapshot.docs.map((bookingDoc) => ({ id: bookingDoc.id, ...bookingDoc.data() }));

    setCount('total-bookings-count', snapshot.size);
    setCount('pending-count', bookings.filter((booking) => booking.status === 'pending').length);
    setCount('confirmed-count', bookings.filter((booking) => booking.status === 'confirmed').length);
    setCount('completed-count', bookings.filter((booking) => booking.status === 'completed').length);

    if (loadingState) loadingState.hidden = true;
    if (listContainer) listContainer.hidden = snapshot.size === 0;
    if (emptyState) emptyState.hidden = snapshot.size > 0;
    if (snapshot.size === 0) {
        if (list) list.replaceChildren();
        if (emptyState) {
            const heading = emptyState.querySelector('h3');
            const message = emptyState.querySelector('p');
            if (heading) heading.textContent = 'No bookings yet';
            if (message) message.textContent = 'Browse services and book your first appointment.';
        }
        return;
    }

    const detailedBookings = await Promise.all(bookings.map(addServiceDetails));
    if (revision !== renderRevision || !list) return;
    detailedBookings.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
    });
    list.replaceChildren(...detailedBookings.map(makeBookingCard));
}

const successBanner = document.getElementById('booking-success-banner');
if (new URLSearchParams(window.location.search).get('booking') === 'success' && successBanner) {
    const successParams = new URLSearchParams(window.location.search);
    const payment = successParams.get('payment');
    const queue = successParams.get('queue');
    const mode = successParams.get('mode');
    const paymentMessage = payment === 'cash'
        ? 'Booking submitted! Pay the provider in cash when the service is completed.'
        : `Booking submitted! Your selected payment method is ${formatPaymentMethod(payment)}.`;
    successBanner.textContent = queue
        ? `${paymentMessage} Your in-store queue number is #${queue}.`
        : mode === 'home_service' ? `${paymentMessage} The provider will visit your address.` : paymentMessage;
    successBanner.hidden = false;
}

onAuthStateChanged(auth, (user) => {
    initialAuthResolved = true;
    initialAuthUser = user;
    stopListening?.();
    stopListening = null;

    if (!user) {
        if (loadingState) loadingState.hidden = true;
        if (listContainer) listContainer.hidden = true;
        if (emptyState) emptyState.hidden = false;
        return;
    }

    if (loadingState) loadingState.hidden = false;
    if (emptyState) emptyState.hidden = true;
    const bookingsQuery = query(collection(db, 'bookings'), where('customerId', '==', user.uid));
    stopListening = onSnapshot(bookingsQuery, renderBookings, (error) => {
        console.error('Firestore Error:', error);
        if (loadingState) loadingState.hidden = true;
        if (listContainer) listContainer.hidden = true;
        if (emptyState) {
            emptyState.hidden = false;
            const heading = emptyState.querySelector('h3');
            const message = emptyState.querySelector('p');
            if (heading) heading.textContent = 'Unable to load bookings';
            if (message) message.textContent = 'Please check your connection and try again.';
        }
    });
});
