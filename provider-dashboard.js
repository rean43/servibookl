import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const bookingTableBody = document.getElementById('provider-bookings-list');
const recentTableBody = document.getElementById('recent-provider-bookings');
const bookingEmptyState = document.getElementById('provider-bookings-empty');
const recentEmptyState = document.getElementById('recent-bookings-empty');
const paymentTableBody = document.getElementById('provider-payment-transactions');
const paymentEmptyState = document.getElementById('provider-payments-empty');
let stopBookingsListener = null;

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
}

function formatDate(value) {
    if (!value) return 'Date not set';
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime())
        ? String(value)
        : new Intl.DateTimeFormat('en-PH', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

function formatTime(value) {
    if (!value) return 'Time not set';
    const parsed = new Date(`2000-01-01T${value}`);
    return Number.isNaN(parsed.getTime())
        ? String(value)
        : new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(parsed);
}

function formatPrice(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
        ? `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '—';
}

function formatPaymentMethod(value) {
    const labels = { cash: 'Cash on Service', gcash: 'GCash', maya: 'Maya', card: 'Credit/Debit Card' };
    const key = String(value || '').toLowerCase();
    return labels[key] || String(value || 'Not specified');
}

function formatTransactionDate(booking) {
    const createdAt = booking.createdAt?.toDate?.();
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
        return new Intl.DateTimeFormat('en-PH', {
            month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(createdAt);
    }
    return `${formatDate(booking.date)} ${formatTime(booking.time)}`;
}

function makeCell(text) {
    const cell = document.createElement('td');
    cell.textContent = text || '—';
    return cell;
}

function makeStatus(statusValue) {
    const status = String(statusValue || 'pending').toLowerCase();
    const badge = document.createElement('span');
    badge.className = `status-badge ${['pending', 'confirmed', 'completed', 'cancelled'].includes(status) ? status : 'pending'}`;
    badge.textContent = status;
    return badge;
}

function makeActionButton(label, className, booking, nextStatus) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', async () => {
        button.disabled = true;
        const originalLabel = button.textContent;
        button.textContent = 'Saving…';
        try {
            await updateDoc(doc(db, 'bookings', booking.id), {
                status: nextStatus,
                updatedAt: serverTimestamp(),
            });
        } catch (error) {
            console.error(`Unable to set booking status to ${nextStatus}:`, error);
            window.alert(error.code === 'permission-denied'
                ? 'You do not have permission to update this booking. Deploy the latest Firestore rules and try again.'
                : error.message || 'Unable to update this booking. Please try again.');
            if (button.isConnected) {
                button.disabled = false;
                button.textContent = originalLabel;
            }
        }
    });
    return button;
}

function makeBookingRow(booking) {
    const row = document.createElement('tr');
    row.append(makeCell(booking.customerName || 'Customer'));
    row.append(makeCell(booking.serviceName || 'Service'));
    row.append(makeCell(`${formatDate(booking.date)} · ${formatTime(booking.time)}`));
    const bookingPlace = booking.bookingMode === 'home_service'
        ? `Home service · ${booking.serviceAddress || 'Address not provided'}`
        : booking.bookingMode === 'in_store'
            ? `In-store · Queue #${booking.queueNumber || '—'}`
            : '—';
    row.append(makeCell(bookingPlace));
    row.append(makeCell(formatPrice(booking.price)));
    row.append(makeCell(String(booking.paymentMethod || 'Not specified').toUpperCase()));
    const statusCell = document.createElement('td');
    statusCell.append(makeStatus(booking.status));
    row.append(statusCell);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'booking-actions';
    if (booking.status === 'pending') {
        actions.append(
            makeActionButton('Accept', 'btn-confirm', booking, 'confirmed'),
            makeActionButton('Reject', 'btn-cancel-booking', booking, 'cancelled'),
        );
    } else if (booking.status === 'confirmed') {
        actions.append(makeActionButton('Complete', 'btn-complete', booking, 'completed'));
    } else {
        actions.textContent = '—';
    }
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
}

function makeRecentBookingRow(booking) {
    const row = document.createElement('tr');
    row.append(makeCell(booking.customerName || 'Customer'));
    row.append(makeCell(booking.serviceName || 'Service'));
    row.append(makeCell(formatDate(booking.date)));
    const statusCell = document.createElement('td');
    statusCell.append(makeStatus(booking.status));
    row.append(statusCell);
    return row;
}

function makePaymentRow(booking) {
    const row = document.createElement('tr');
    row.append(makeCell(booking.customerName || 'Customer'));
    row.append(makeCell(booking.serviceName || 'Service'));
    row.append(makeCell(formatPaymentMethod(booking.paymentMethod)));
    row.append(makeCell(formatPrice(booking.price)));
    const isPaid = booking.paymentStatus === 'paid';
    const isCash = String(booking.paymentMethod || '').toLowerCase().includes('cash');
    const paymentStatus = isPaid ? 'PAID' : booking.status === 'cancelled' ? 'CANCELLED' : 'PENDING';
    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = isPaid
        ? 'badge-status-paid'
        : booking.status === 'cancelled' ? 'badge-status-cancelled' : 'badge-status-pending';
    statusBadge.textContent = paymentStatus;
    statusCell.append(statusBadge);
    row.append(statusCell);
    row.append(makeCell(booking.paymentReference || '—'));
    row.append(makeCell(formatTransactionDate(booking)));

    const actionCell = document.createElement('td');
    if (!isPaid && isCash && booking.status !== 'cancelled') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-confirm-cash';
        button.dataset.bookingId = booking.id;
        button.textContent = '💵 Confirm Payment';
        button.addEventListener('click', async () => {
            if (!auth.currentUser || auth.currentUser.uid !== booking.providerId || button.disabled) return;
            button.disabled = true;
            button.textContent = 'Saving…';
            try {
                await updateDoc(doc(db, 'bookings', booking.id), {
                    paymentStatus: 'paid',
                    updatedAt: serverTimestamp(),
                });
                // The active Firestore snapshot updates this row and its summary counters.
            } catch (error) {
                console.error('Unable to confirm cash payment:', error);
                window.alert(error.code === 'permission-denied'
                    ? 'You cannot confirm this payment. Verify that you are the assigned provider and the latest booking rules are deployed.'
                    : 'Unable to confirm payment. Please try again.');
                if (button.isConnected) {
                    button.disabled = false;
                    button.textContent = '💵 Confirm Payment';
                }
            }
        });
        actionCell.append(button);
    } else {
        actionCell.textContent = '—';
    }
    row.append(actionCell);
    return row;
}

function renderBookings(snapshot) {
    const bookings = snapshot.docs.map((bookingDoc) => ({ id: bookingDoc.id, ...bookingDoc.data() }));
    bookings.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    setText('provider-total-bookings', bookings.length);
    setText('provider-pending-bookings', bookings.filter((booking) => booking.status === 'pending').length);
    setText('provider-completed-bookings', bookings.filter((booking) => booking.status === 'completed').length);
    const received = bookings
        .filter((booking) => booking.paymentStatus === 'paid')
        .reduce((total, booking) => total + (Number(booking.price) || 0), 0);
    setText('provider-total-received', formatPrice(received));
    setText('provider-pending-payments', bookings.filter((booking) =>
        booking.paymentStatus === 'pending'
        || (!booking.paymentStatus && String(booking.paymentMethod || '').toLowerCase().includes('cash')),
    ).length);

    if (bookingTableBody) bookingTableBody.replaceChildren(...bookings.map(makeBookingRow));
    if (bookingEmptyState) bookingEmptyState.hidden = bookings.length > 0;
    if (recentTableBody) recentTableBody.replaceChildren(...bookings.slice(0, 5).map(makeRecentBookingRow));
    if (recentEmptyState) recentEmptyState.hidden = bookings.length > 0;
    if (paymentTableBody) paymentTableBody.replaceChildren(...bookings.map(makePaymentRow));
    if (paymentEmptyState) paymentEmptyState.hidden = bookings.length > 0;
}

function showBookingLoadError(error) {
    console.error('Unable to load provider bookings:', error);
    if (bookingTableBody) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.textContent = 'Bookings could not be loaded. Check your connection and try again.';
        row.append(cell);
        bookingTableBody.replaceChildren(row);
    }
    if (bookingEmptyState) bookingEmptyState.hidden = true;
    if (recentTableBody) recentTableBody.replaceChildren();
    if (recentEmptyState) {
        recentEmptyState.hidden = false;
        const heading = recentEmptyState.querySelector('h3');
        const message = recentEmptyState.querySelector('p');
        if (heading) heading.textContent = 'Unable to load bookings';
        if (message) message.textContent = 'Check your connection and reload the dashboard.';
    }
    if (paymentTableBody) paymentTableBody.replaceChildren();
    if (paymentEmptyState) {
        paymentEmptyState.hidden = false;
        const heading = paymentEmptyState.querySelector('h3');
        const message = paymentEmptyState.querySelector('p');
        if (heading) heading.textContent = 'Unable to load transactions';
        if (message) message.textContent = 'Check your connection and reload the dashboard.';
    }
}

onAuthStateChanged(auth, async (user) => {
    stopBookingsListener?.();
    stopBookingsListener = null;

    if (!user) {
        window.location.replace('login.html');
        return;
    }

    try {
        const profile = await getDoc(doc(db, 'users', user.uid));
        if (!profile.exists() || profile.data().role !== 'provider') {
            window.location.replace('index.html');
            return;
        }
    } catch (error) {
        console.error('Unable to verify provider profile:', error);
        return;
    }

    const bookingsQuery = query(collection(db, 'bookings'), where('providerId', '==', user.uid));
    stopBookingsListener = onSnapshot(bookingsQuery, renderBookings, showBookingLoadError);
});
