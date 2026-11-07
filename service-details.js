import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
    addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const serviceId = new URLSearchParams(window.location.search).get('id');
const bookingForm = document.getElementById('booking-form');
const bookingStatus = document.getElementById('booking-status');
const serviceImageElem = document.getElementById('service-image');
const reviewForm = document.getElementById('leave-review-form');
const ratingPicker = document.getElementById('star-rating-input');
const selectedRatingInput = document.getElementById('selected-rating-value');
const reviewsList = document.getElementById('reviews-list');
const noReviewsMessage = document.getElementById('no-reviews-message');
const reviewStatus = document.getElementById('review-status');
let currentService = null;
let stopReviewsListener = null;
let storeStatusTimer = null;
let currentUserRole = '';
let latestValidReviews = [];

function setVisible(selector, visible) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.hidden = !visible;
    if (element.classList.contains('hidden')) element.classList.toggle('hidden', !visible);
}

function formatPrice(value) {
    const price = Number.parseFloat(value);
    return `₱${(Number.isFinite(price) ? price : 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

const weekdayCodes = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };
const weekdayNames = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function renderStoreStatus(service) {
    const badge = document.getElementById('store-status-badge');
    const hoursText = document.getElementById('store-hours-text');
    if (!badge || !hoursText) return;

    const openTime = String(service.storeOpenTime || '');
    const closeTime = String(service.storeCloseTime || '');
    const openDays = Array.isArray(service.storeOpenDays) ? service.storeOpenDays : [];
    if (!openTime || !closeTime || !openDays.length) {
        badge.textContent = 'HOURS NOT LISTED';
        badge.className = 'badge-store-status status-unavailable';
        hoursText.textContent = 'Contact the provider to confirm store hours.';
        return;
    }

    const dayLabels = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        .filter((day) => openDays.includes(day)).map((day) => weekdayNames[day]);
    hoursText.textContent = `${dayLabels.join(', ')} · ${openTime}–${closeTime} (Philippine time)`;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const today = weekdayCodes[values.weekday];
    const nowTime = `${values.hour}:${values.minute}`;
    const isOpen = openDays.includes(today) && nowTime >= openTime && nowTime < closeTime;
    badge.textContent = isOpen ? '🟢 OPEN NOW' : '🔴 CLOSED NOW';
    badge.className = `badge-store-status ${isOpen ? 'status-open' : 'status-closed'}`;
}

function setBookingMode(mode) {
    const homeGroup = document.getElementById('home-service-address-group');
    const homeAddress = document.getElementById('home-service-address');
    const queueInfo = document.getElementById('in-store-queue-info');
    const homeService = mode === 'home_service';
    if (homeGroup) homeGroup.hidden = !homeService;
    if (homeAddress) homeAddress.required = homeService;
    if (queueInfo) queueInfo.hidden = homeService;
}

document.querySelectorAll('input[name="booking_mode"]').forEach((input) => {
    input.addEventListener('change', () => setBookingMode(input.value));
});
setBookingMode(document.querySelector('input[name="booking_mode"]:checked')?.value || 'in_store');

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function setImage(image, url, alt) {
    if (!image) return;
    image.alt = alt;
    image.onerror = () => {
        image.onerror = null;
        image.src = 'https://via.placeholder.com/600x400?text=Image+Not+Found';
    };
    image.src = typeof url === 'string' && url.trim()
        ? url.trim()
        : 'https://via.placeholder.com/600x400?text=No+Image+Available';
}

function renderService(service) {
    currentService = service;
    if (storeStatusTimer) window.clearInterval(storeStatusTimer);
    renderStoreStatus(service);
    storeStatusTimer = window.setInterval(() => renderStoreStatus(currentService || service), 30_000);
    const title = service.name || 'Service';
    const providerName = service.providerName || 'Local Provider';
    const location = service.location || service.barangay || 'San Jose, Occidental Mindoro';
    const price = formatPrice(service.price);
    const duration = service.duration || 'N/A';
    const ratingValue = Number.parseFloat(service.rating ?? service.avg_rating ?? 0);
    const rating = Number.isFinite(ratingValue) ? ratingValue.toFixed(1) : '0.0';
    const reviewCount = Number(service.reviewCount ?? service.review_count ?? 0) || 0;

    document.title = `Servibook - ${title}`;
    const titleElement = document.getElementById('service-title');
    if (titleElement) titleElement.textContent = title;
    const category = document.getElementById('service-category');
    if (category) category.textContent = service.category || 'Service';
    const description = document.getElementById('service-description');
    if (description) description.textContent = service.description || 'Service details are not available.';
    const locationElement = document.getElementById('service-location');
    if (locationElement) locationElement.textContent = location;
    const providerElement = document.getElementById('service-provider-name');
    if (providerElement) providerElement.textContent = providerName;
    const providerInitial = document.getElementById('provider-avatar-initial');
    if (providerInitial) providerInitial.textContent = providerName.trim().charAt(0).toUpperCase() || 'P';
    const providerAvatar = document.getElementById('provider-avatar-image');
    if (providerAvatar) {
        providerAvatar.onerror = () => {
            providerAvatar.hidden = true;
            if (providerInitial) providerInitial.hidden = false;
        };
        if (service.providerPhotoURL) {
            providerAvatar.src = service.providerPhotoURL;
            providerAvatar.hidden = false;
            if (providerInitial) providerInitial.hidden = true;
        } else {
            providerAvatar.removeAttribute('src');
            providerAvatar.hidden = true;
            if (providerInitial) providerInitial.hidden = false;
        }
    }
    const summary = document.getElementById('service-rating-summary');
    if (summary) summary.textContent = `★ ${rating} (${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'})`;
    const reviewHeading = document.getElementById('review-heading');
    if (reviewHeading) reviewHeading.textContent = `Reviews (${reviewCount})`;
    const providerRating = document.getElementById('provider-rating');
    if (providerRating) providerRating.textContent = `★ ${rating}`;
    const providerLocation = document.getElementById('provider-location');
    if (providerLocation) providerLocation.textContent = location;
    const providerDuration = document.getElementById('provider-duration');
    if (providerDuration) providerDuration.textContent = duration;
    const bookingPrice = document.getElementById('booking-price');
    if (bookingPrice) bookingPrice.innerHTML = `${price} <span>/ service</span>`;
    const bookingDuration = document.getElementById('booking-duration');
    if (bookingDuration) bookingDuration.textContent = `Duration: ${duration}`;

    setImage(serviceImageElem, service.image || service.imageUrl, `${title} service image`);

    const mapElement = document.getElementById('providerDetailMap');
    const lat = Number(service.lat ?? service.latitude);
    const lng = Number(service.lng ?? service.longitude);
    if (mapElement && Number.isFinite(lat) && Number.isFinite(lng) && typeof L !== 'undefined') {
        mapElement.hidden = false;
        mapElement.dataset.lat = String(lat);
        mapElement.dataset.lng = String(lng);
        const map = L.map(mapElement).setView([lat, lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        L.marker([lat, lng]).addTo(map)
            .bindPopup(`${escapeHtml(providerName)}<br>${escapeHtml(location)}`)
            .openPopup();
    }
}

function updateRatingSummary(average, count) {
    const rating = count ? average.toFixed(1) : '0.0';
    const summary = document.getElementById('service-rating-summary');
    if (summary) summary.textContent = '★ ' + rating + ' (' + count + ' ' + (count === 1 ? 'review' : 'reviews') + ')';
    const heading = document.getElementById('review-heading');
    if (heading) heading.textContent = 'Reviews (' + count + ')';
    const providerRating = document.getElementById('provider-rating');
    if (providerRating) providerRating.textContent = '★ ' + rating;
}

function formatReviewDate(value) {
    const date = value && value.toDate ? value.toDate() : null;
    if (!date || Number.isNaN(date.getTime())) return 'Recently';
    return new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function makeReviewCard(review) {
    const card = document.createElement('article');
    card.className = 'review-card';
    const header = document.createElement('div');
    header.className = 'review-header';
    const reviewUser = document.createElement('div');
    reviewUser.className = 'review-user';
    const avatar = document.createElement('div');
    avatar.className = 'review-avatar';
    avatar.textContent = (review.customerName || 'C').trim().charAt(0).toUpperCase() || 'C';
    const identity = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'review-name';
    name.textContent = review.customerName || 'Customer';
    const date = document.createElement('div');
    date.className = 'review-date';
    date.textContent = formatReviewDate(review.createdAt);
    identity.append(name, date);
    reviewUser.append(avatar, identity);
    const stars = document.createElement('div');
    stars.className = 'review-stars review-stars-text';
    stars.setAttribute('aria-label', review.rating + ' out of 5 stars');
    stars.textContent = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
    header.append(reviewUser, stars);
    const comment = document.createElement('p');
    comment.className = 'review-comment';
    comment.textContent = review.comment || '';
    card.append(header, comment);

    if (review.providerReply) {
        const reply = document.createElement('div');
        reply.className = 'provider-review-reply';
        const replyTitle = document.createElement('strong');
        replyTitle.className = 'provider-review-reply-title';
        replyTitle.textContent = 'Provider reply';
        const replyText = document.createElement('p');
        replyText.textContent = review.providerReply;
        reply.append(replyTitle, replyText);
        card.append(reply);
    }

    const user = auth.currentUser;
    const canReply = Boolean(user && currentUserRole === 'provider'
        && currentService?.providerId && currentService.providerId === user.uid);
    if (canReply) {
        const replyForm = document.createElement('form');
        replyForm.className = 'provider-reply-form';
        replyForm.dataset.reviewId = review.id;
        replyForm.dataset.hasReply = String(Boolean(review.providerReply));
        const replyLabel = document.createElement('label');
        replyLabel.className = 'visually-hidden';
        replyLabel.htmlFor = `provider-reply-${review.id}`;
        replyLabel.textContent = 'Write a reply to this review';
        const replyInput = document.createElement('textarea');
        replyInput.id = `provider-reply-${review.id}`;
        replyInput.name = 'providerReply';
        replyInput.maxLength = 2000;
        replyInput.rows = 2;
        replyInput.required = true;
        replyInput.placeholder = 'Reply to this customer…';
        replyInput.value = review.providerReply || '';
        const replyActions = document.createElement('div');
        replyActions.className = 'provider-reply-actions';
        const replyStatus = document.createElement('span');
        replyStatus.className = 'provider-reply-status';
        replyStatus.setAttribute('role', 'status');
        const replyButton = document.createElement('button');
        replyButton.type = 'submit';
        replyButton.className = 'btn-provider-reply';
        replyButton.textContent = review.providerReply ? 'Update Reply' : 'Post Reply';
        replyActions.append(replyStatus, replyButton);
        replyForm.append(replyLabel, replyInput, replyActions);
        card.append(replyForm);
    }
    return card;
}

function renderReviews() {
    if (reviewsList) reviewsList.replaceChildren(...latestValidReviews.map(makeReviewCard));
}

function watchServiceReviews(id) {
    stopReviewsListener?.();
    const reviewsQuery = query(collection(db, 'reviews'), where('serviceId', '==', id));
    stopReviewsListener = onSnapshot(reviewsQuery, (snapshot) => {
        const reviews = snapshot.docs.map((reviewDoc) => ({ id: reviewDoc.id, ...reviewDoc.data() }));
        reviews.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        const validReviews = reviews.filter((review) => Number.isInteger(Number(review.rating)) && Number(review.rating) >= 1 && Number(review.rating) <= 5);
        const average = validReviews.length
            ? validReviews.reduce((sum, review) => sum + Number(review.rating), 0) / validReviews.length
            : 0;
        updateRatingSummary(average, validReviews.length);
        latestValidReviews = validReviews;
        renderReviews();
        if (noReviewsMessage) {
            noReviewsMessage.textContent = 'No reviews yet.';
            noReviewsMessage.hidden = validReviews.length > 0;
        }
    }, (error) => {
        console.error('Unable to load service reviews:', error);
        if (noReviewsMessage) {
            noReviewsMessage.textContent = 'Reviews could not be loaded right now.';
            noReviewsMessage.hidden = false;
        }
    });
}

reviewsList?.addEventListener('submit', async (event) => {
    const replyForm = event.target.closest('.provider-reply-form');
    if (!replyForm) return;
    event.preventDefault();
    const user = auth.currentUser;
    const replyInput = replyForm.elements.providerReply;
    const reply = replyInput.value.trim();
    const replyStatus = replyForm.querySelector('.provider-reply-status');
    const submitButton = replyForm.querySelector('[type="submit"]');
    if (!user || currentUserRole !== 'provider' || currentService?.providerId !== user.uid) {
        if (replyStatus) replyStatus.textContent = 'Only this service’s provider can reply.';
        return;
    }
    if (!reply || !replyForm.dataset.reviewId) {
        if (replyStatus) replyStatus.textContent = 'Enter a reply before posting.';
        replyInput.focus();
        return;
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Saving…';
    }
    if (replyStatus) replyStatus.textContent = '';
    try {
        await updateDoc(doc(db, 'reviews', replyForm.dataset.reviewId), {
            providerReply: reply,
            providerReplyAt: serverTimestamp(),
        });
        replyForm.dataset.hasReply = 'true';
        if (replyStatus) replyStatus.textContent = 'Reply saved.';
    } catch (error) {
        console.error('Unable to save provider reply:', error);
        if (replyStatus) replyStatus.textContent = error.code === 'permission-denied'
            ? 'You do not have permission to reply to this review.'
            : 'Could not save your reply. Please try again.';
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = replyForm.dataset.hasReply === 'true' ? 'Update Reply' : 'Post Reply';
        }
    }
});

function paintRating(value) {
    ratingPicker?.querySelectorAll('.star-btn').forEach((star) => {
        const active = Number(star.dataset.value) <= value;
        star.classList.toggle('is-active', active);
        star.classList.remove('is-preview');
        star.setAttribute('aria-checked', String(Number(star.dataset.value) === value));
        star.tabIndex = Number(star.dataset.value) === (value || 1) ? 0 : -1;
    });
}

function selectRating(value, moveFocus = false) {
    const rating = Math.max(1, Math.min(5, Number(value)));
    if (!Number.isInteger(rating)) return;
    if (selectedRatingInput) selectedRatingInput.value = String(rating);
    paintRating(rating);
    if (moveFocus) ratingPicker?.querySelector('[data-value="' + rating + '"]')?.focus();
}

ratingPicker?.querySelectorAll('.star-btn').forEach((star) => {
    star.addEventListener('click', () => selectRating(star.dataset.value));
    star.addEventListener('mouseenter', () => {
        const value = Number(star.dataset.value);
        ratingPicker.querySelectorAll('.star-btn').forEach((item) => {
            item.classList.toggle('is-preview', Number(item.dataset.value) <= value);
        });
    });
    star.addEventListener('keydown', (event) => {
        const current = Number(star.dataset.value);
        const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(5, current + 1)
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(1, current - 1)
                : event.key === 'Home' ? 1 : event.key === 'End' ? 5 : null;
        if (next !== null) {
            event.preventDefault();
            selectRating(next, true);
        }
    });
});
ratingPicker?.addEventListener('mouseleave', () => paintRating(Number(selectedRatingInput?.value) || 0));
ratingPicker?.addEventListener('focusout', (event) => {
    if (!ratingPicker.contains(event.relatedTarget)) paintRating(Number(selectedRatingInput?.value) || 0);
});

function setReviewStatus(message, state = '') {
    if (!reviewStatus) return;
    reviewStatus.textContent = message;
    if (state) reviewStatus.dataset.state = state;
    else delete reviewStatus.dataset.state;
}

reviewForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    const rating = Number(selectedRatingInput?.value);
    const comment = reviewForm.elements.comment.value.trim();
    if (!user) return setReviewStatus('Please sign in before submitting a review.', 'error');
    if (!currentService?.id) return setReviewStatus('Service details are not available. Refresh and try again.', 'error');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        ratingPicker?.querySelector('.star-btn')?.focus();
        return setReviewStatus('Choose a star rating before submitting.', 'error');
    }
    if (!comment) return setReviewStatus('Write a short comment before submitting.', 'error');

    const submitButton = reviewForm.querySelector('[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Submitting…';
    }
    try {
        const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
        const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
        const reviewId = `${currentService.id}_${user.uid}`;
        const reviewRef = doc(db, 'reviews', reviewId);
        if ((await getDoc(reviewRef)).exists()) {
            setReviewStatus('You have already submitted a review for this service.', 'error');
            return;
        }
        await setDoc(reviewRef, {
            serviceId: currentService.id,
            providerId: currentService.providerId || '',
            customerId: user.uid,
            customerName: user.displayName || profile.fullName || profile.full_name || user.email || 'Customer',
            rating,
            comment,
            createdAt: serverTimestamp(),
        });
        reviewForm.reset();
        if (selectedRatingInput) selectedRatingInput.value = '0';
        paintRating(0);
        setReviewStatus('Your review was submitted. Thank you!', 'success');
    } catch (error) {
        console.error('Unable to submit service review:', error);
        setReviewStatus(error.code === 'permission-denied'
            ? 'Your review could not be saved. Check the Firestore review rules.'
            : error.message || 'Unable to submit your review. Please try again.', 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Submit Review';
        }
    }
});

function renderRelatedService(service) {
    const link = document.createElement('a');
    link.className = 'service-card-item';
    link.href = `service-details.html?id=${encodeURIComponent(service.id)}`;

    const imageArea = document.createElement('div');
    imageArea.className = 'card-image';
    const image = document.createElement('img');
    image.loading = 'lazy';
    setImage(image, service.image || service.imageUrl, `${service.name || 'Service'} image`);
    imageArea.append(image);

    const body = document.createElement('div');
    body.className = 'card-body';
    const category = document.createElement('div');
    category.className = 'card-category';
    category.textContent = service.category || 'Service';
    const name = document.createElement('h3');
    name.className = 'card-name';
    name.textContent = service.name || 'Service';
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const price = document.createElement('div');
    price.className = 'card-price';
    price.textContent = formatPrice(service.price);
    const view = document.createElement('span');
    view.textContent = 'View →';
    footer.append(price, view);
    body.append(category, name, footer);
    link.append(imageArea, body);
    return link;
}

async function loadRelatedServices(service) {
    const grid = document.getElementById('related-services-grid');
    const section = grid?.closest('.related-section');
    if (!grid || !service) return;
    try {
        const snapshot = await getDocs(query(collection(db, 'services'), where('status', '==', 'active')));
        const matches = snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .filter((item) => item.id !== service.id && item.status === 'active')
            .sort((a, b) => Number(b.category === service.category) - Number(a.category === service.category))
            .slice(0, 3);
        grid.replaceChildren(...matches.map(renderRelatedService));
        if (section) section.hidden = matches.length === 0;
    } catch (error) {
        console.error('Unable to load related services:', error);
        if (section) section.hidden = true;
    }
}

function setBookingStatus(message, state = '') {
    if (!bookingStatus) return;
    bookingStatus.textContent = message;
    bookingStatus.hidden = !message;
    if (state) bookingStatus.dataset.state = state;
    else delete bookingStatus.dataset.state;
}

onAuthStateChanged(auth, async (user) => {
    let userRole = 'customer';
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            userRole = userDoc.exists() ? (userDoc.data().role || 'customer') : 'customer';
        } catch (error) {
            console.error('Unable to load user role:', error);
        }
    }
    currentUserRole = user ? userRole : '';
    renderReviews();

    const isCustomer = Boolean(user) && userRole === 'customer';
    const isProvider = Boolean(user) && userRole === 'provider';
    setVisible('.login-to-review-banner', !user);
    setVisible('#guest-message-btn', !user);
    setVisible('#guest-booking-banner', !user);
    setVisible('#booking-form', isCustomer);
    setVisible('#book-service-btn', isCustomer);
    setVisible('#message-provider-btn', isCustomer);
    setVisible('#leave-review-form', isCustomer);
    setVisible('#provider-booking-notice', isProvider);
    setVisible('#login-to-message-btn', !user);
});

bookingForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    const date = document.getElementById('booking-date')?.value;
    const time = document.getElementById('booking-time')?.value;
    const paymentMethod = document.getElementById('payment-method')?.value || '';
    const notes = document.getElementById('booking-notes')?.value.trim() || '';
    const bookingMode = bookingForm.querySelector('input[name="booking_mode"]:checked')?.value || 'in_store';
    const serviceAddress = document.getElementById('home-service-address')?.value.trim() || '';

    if (!user) {
        setVisible('#guest-booking-banner', true);
        setBookingStatus('Please log in before booking this service. Redirecting to login…', 'error');
        window.location.assign('login.html');
        return;
    }
    if (!date || !time) {
        setBookingStatus('Select both a booking date and time to continue.', 'error');
        return;
    }
    if (!currentService || !serviceId) {
        setBookingStatus('Service details are unavailable. Refresh the page and try again.', 'error');
        return;
    }
    if (!currentService.providerId) {
        setBookingStatus('This service does not have a provider attached yet.', 'error');
        return;
    }
    if (bookingMode === 'home_service' && !serviceAddress) {
        setBookingStatus('Enter the address where the home service should take place.', 'error');
        return;
    }

    const submitButton = document.getElementById('book-service-btn');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Creating booking…';
    }
    setBookingStatus('Creating your booking…');
    try {
        const profileDoc = await getDoc(doc(db, 'users', user.uid));
        const profile = profileDoc.exists() ? profileDoc.data() : {};
        const customerName = user.displayName || profile.fullName || profile.full_name || user.email || 'Customer';
        const bookingData = {
            serviceId,
            serviceName: currentService.name || 'Service',
            category: currentService.category || '',
            providerId: currentService.providerId,
            providerName: currentService.providerName || 'Service Provider',
            customerId: user.uid,
            customerName,
            date,
            time,
            price: Number.parseFloat(currentService.price) || 0,
            imageUrl: currentService.imageUrl || currentService.image || '',
            paymentMethod,
            notes,
            status: 'pending',
            bookingMode,
            createdAt: serverTimestamp(),
        };
        if (bookingMode === 'home_service') bookingData.serviceAddress = serviceAddress;

        let queueNumber = null;
        if (bookingMode === 'in_store') {
            // Queue counters are scoped to the selected appointment date. Retry only
            // when a concurrent batch advanced the counter after our read.
            const queueDate = date;
            const bookingRef = doc(collection(db, 'bookings'));
            const queueRef = doc(db, 'providerDailyQueues', `${currentService.providerId}_${queueDate}`);
            let assignedQueueNumber = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const queueSnapshot = await getDoc(queueRef);
                const previousQueue = queueSnapshot.exists() ? queueSnapshot.data() : null;
                const nextNumber = Number(previousQueue?.lastNumber || 0) + 1;
                const batch = writeBatch(db);
                batch.set(queueRef, {
                    providerId: currentService.providerId,
                    date: queueDate,
                    lastNumber: nextNumber,
                    lastBookingId: bookingRef.id,
                    updatedAt: serverTimestamp(),
                }, { merge: true });
                batch.set(bookingRef, {
                    ...bookingData,
                    queueDate,
                    queueNumber: nextNumber,
                });

                try {
                    await batch.commit();
                    assignedQueueNumber = nextNumber;
                    break;
                } catch (batchError) {
                    if (batchError.code !== 'permission-denied' || attempt === 4) throw batchError;
                    const latestSnapshot = await getDoc(queueRef);
                    const latestQueue = latestSnapshot.exists() ? latestSnapshot.data() : null;
                    const changedSinceRead = Boolean(latestQueue) && (
                        !previousQueue
                        || latestQueue.lastNumber !== previousQueue.lastNumber
                        || latestQueue.lastBookingId !== previousQueue.lastBookingId
                    );
                    if (!changedSinceRead) throw batchError;
                }
            }
            if (assignedQueueNumber === null) throw new Error('A queue number could not be assigned. Please try again.');
            queueNumber = assignedQueueNumber;
        } else {
            await addDoc(collection(db, 'bookings'), bookingData);
        }
        const queueParam = queueNumber ? `&queue=${encodeURIComponent(queueNumber)}` : '';
        window.location.assign(`bookings.html?booking=success&payment=${encodeURIComponent(paymentMethod)}&mode=${encodeURIComponent(bookingMode)}${queueParam}`);
    } catch (error) {
        console.error('Booking creation failed:', error);
        setBookingStatus(error.code === 'permission-denied'
            ? 'Booking was denied by Firestore rules. Update the bookings access rules and try again.'
            : error.message || 'Could not create your booking. Please try again.', 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Book Service Now';
        }
    }
});

document.getElementById('message-provider-btn')?.addEventListener('click', () => {
    startProviderConversation();
});

async function startProviderConversation() {
    const user = auth.currentUser;
    const providerId = String(currentService?.providerId || '');
    if (!user) {
        setBookingStatus('Please log in before messaging this provider.', 'error');
        return;
    }
    if (!providerId) {
        setBookingStatus('This service is missing its provider account link.', 'error');
        return;
    }
    if (providerId === user.uid) {
        setBookingStatus('You cannot start a conversation with your own account.', 'error');
        return;
    }

    const messageButton = document.getElementById('message-provider-btn');
    if (messageButton) messageButton.disabled = true;
    setBookingStatus('Opening your conversation…');
    try {
        let conversationId = '';
        try {
            const conversationQuery = query(collection(db, 'conversations'),
                where('customerId', '==', user.uid), where('providerId', '==', providerId));
            const matches = await getDocs(conversationQuery);
            conversationId = matches.docs[0]?.id || '';
        } catch (queryError) {
            // Older deployed rules only permit reads through the participants array.
            if (queryError.code !== 'permission-denied' && !queryError.message?.includes('index')) throw queryError;
            console.warn('Using the compatible participants query for existing conversations.');
        }

        // Continue an older conversation using its participants array when found.
        if (!conversationId) {
            const legacyMatches = await getDocs(query(collection(db, 'conversations'),
                where('participants', 'array-contains', user.uid)));
            conversationId = legacyMatches.docs.find((item) => item.data().participants?.includes(providerId))?.id;
        }

        const providerName = currentService.providerName || 'Service Provider';
        if (!conversationId) {
            const customerName = user.displayName || user.email || 'Customer';
            const created = await addDoc(collection(db, 'conversations'), {
                customerId: user.uid,
                customerName,
                providerId,
                providerName,
                participants: [user.uid, providerId],
                partnerNames: { [user.uid]: providerName, [providerId]: customerName },
                serviceId,
                lastMessage: 'Started a conversation',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            conversationId = created.id;
        }

        // The chat widget is mounted asynchronously from its shared HTML fragment.
        for (let attempt = 0; attempt < 30 && typeof window.openServibookChat !== 'function'; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        if (typeof window.openServibookChat !== 'function') {
            throw new Error('Chat is still loading. Please try again in a moment.');
        }
        setBookingStatus('');
        await window.openServibookChat({ conversationId, partnerName: providerName });
    } catch (error) {
        console.error('Unable to start provider conversation:', error);
        setBookingStatus(error.message || 'Unable to open the provider conversation. Please try again.', 'error');
    } finally {
        if (messageButton) messageButton.disabled = false;
    }
}

async function loadService() {
    if (!serviceId) {
        setBookingStatus('No service was selected. Return to Services and choose a listing.', 'error');
        return;
    }
    try {
        const serviceDoc = await getDoc(doc(db, 'services', serviceId));
        if (!serviceDoc.exists()) {
            setBookingStatus('This service could not be found. It may have been removed.', 'error');
            return;
        }
        let service = { id: serviceDoc.id, ...serviceDoc.data() };
        let publicProvider = {};
        let privateProfile = {};
        if (service.providerId) {
            try {
                const providerDoc = await getDoc(doc(db, 'providers', service.providerId));
                if (providerDoc.exists()) publicProvider = providerDoc.data();
            } catch (error) {
                console.warn('Could not load public provider details:', error);
            }
            if (auth.currentUser) {
                try {
                    const profileDoc = await getDoc(doc(db, 'users', service.providerId));
                    if (profileDoc.exists()) privateProfile = profileDoc.data();
                } catch (error) {
                    console.warn('Could not load provider account profile:', error);
                }
            }
        }
        const providerName = service.providerName || publicProvider.name || publicProvider.fullName
            || privateProfile.businessName || privateProfile.business_name || privateProfile.fullName || '';
        const location = service.location || publicProvider.location || privateProfile.location
            || [service.streetAddress || privateProfile.streetAddress, service.barangay || privateProfile.barangay, 'San Jose', 'Occidental Mindoro']
                .filter(Boolean).join(', ');
        service = {
            ...service,
            providerName: providerName || 'Local Provider',
            location: location || 'San Jose, Occidental Mindoro',
            providerPhotoURL: service.providerPhotoURL || service.providerPhotoUrl || publicProvider.photoURL
                || publicProvider.imageUrl || privateProfile.photoURL || '',
            storeOpenTime: service.storeOpenTime || publicProvider.storeOpenTime || privateProfile.storeOpenTime || '',
            storeCloseTime: service.storeCloseTime || publicProvider.storeCloseTime || privateProfile.storeCloseTime || '',
            storeOpenDays: service.storeOpenDays || publicProvider.storeOpenDays || privateProfile.storeOpenDays || [],
        };
        renderService(service);
        watchServiceReviews(service.id);
        await loadRelatedServices(service);
    } catch (error) {
        console.error('Unable to load service details:', error);
        setBookingStatus('Service details could not be loaded. Please refresh and try again.', 'error');
    }
}

loadService();
