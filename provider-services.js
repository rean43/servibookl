import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
    addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const CLOUDINARY_CLOUD_NAME = "hv009ion";
const CLOUDINARY_UPLOAD_PRESET = "provider.js";
const serviceForm = document.getElementById('addServiceForm');
const serviceStatus = document.getElementById('addServiceStatus');
const previewImage = document.getElementById('imagePreview');
const servicesList = document.getElementById('providerServicesList');
const servicesEmpty = document.getElementById('providerServicesEmpty');
let stopProviderServices = null;
const editModal = document.getElementById('edit-service-modal');
const editForm = document.getElementById('edit-service-form');
let editReturnFocus = null;
const deleteModal = document.getElementById('delete-service-modal');
let pendingDeleteService = null;
let deleteReturnFocus = null;

function closeEditModal() {
    if (!editModal) return;
    editModal.classList.add('hidden');
    editReturnFocus?.focus?.();
}

function openEditModal(service, trigger) {
    if (!editModal || !editForm) return;
    editReturnFocus = trigger;
    document.getElementById('edit-service-id').value = service.id;
    document.getElementById('edit-service-name').value = service.name || '';
    const categorySelect = document.getElementById('edit-service-category');
    const category = service.category || '';
    if (category && !Array.from(categorySelect.options).some((option) => option.value === category)) {
        categorySelect.add(new Option(formatCategory(category), category));
    }
    categorySelect.value = category;
    document.getElementById('edit-service-price').value = service.price ?? '';
    document.getElementById('edit-service-duration').value = service.duration || '';
    document.getElementById('edit-service-description').value = service.description || '';
    editModal.classList.remove('hidden');
    document.getElementById('edit-service-name').focus();
}

function openDeleteModal(service, trigger) {
    if (!deleteModal) return;
    pendingDeleteService = service;
    deleteReturnFocus = trigger;
    document.getElementById('delete-service-target-name').textContent = service.name || 'this service';
    deleteModal.classList.remove('hidden');
    document.getElementById('confirm-delete-service-btn').focus();
}

function closeDeleteModal() {
    if (!deleteModal) return;
    deleteModal.classList.add('hidden');
    pendingDeleteService = null;
    deleteReturnFocus?.focus?.();
}

function showServiceStatus(message, state = '') {
    if (!serviceStatus) return;
    serviceStatus.textContent = message;
    if (state) serviceStatus.dataset.state = state;
    else delete serviceStatus.dataset.state;
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function formatCategory(value = '') {
    const labels = {
        barbershop: 'Barbershop', electrician: 'Electrician', plumbing: 'Plumbing',
        cleaning: 'House Cleaning', laundry: 'Laundry', carpentry: 'Carpentry',
    };
    const key = value.trim().toLowerCase();
    return labels[key] || value || 'Other';
}

async function uploadServiceImage(file, userId) {
    const payload = new FormData();
    payload.append('file', file);
    payload.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    payload.append('folder', `servibook/services/${userId}`);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/image/upload`, {
        method: 'POST',
        body: payload,
    });
    const result = await response.json();
    if (!response.ok || !result.secure_url) {
        throw new Error(result.error?.message || 'Cloudinary could not upload this image. Check the upload preset and try again.');
    }
    return { url: result.secure_url, publicId: result.public_id || '' };
}

function makeProviderServiceCard(service) {
    const card = createElement('article', 'my-service-card');
    const imageArea = createElement('div', 'my-service-image');
    if (service.imageUrl) {
        const image = createElement('img');
        image.src = service.imageUrl;
        image.alt = `${service.name || 'Service'} image`;
        image.loading = 'lazy';
        imageArea.append(image);
    } else {
        imageArea.append(createElement('span', 'no-image', '🛠️'));
    }

    const body = createElement('div', 'my-service-body');
    body.append(
        createElement('div', 'service-category', formatCategory(service.category)),
        createElement('h3', '', service.name || 'Service'),
        createElement('p', 'service-desc', service.description || ''),
    );
    const footer = createElement('div', 'my-service-footer');
    const price = Number(service.price);
    footer.append(createElement('span', 'price', Number.isFinite(price)
        ? `₱${price.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'Price not set'));
    const isActive = service.status === 'active';
    const statusLabel = isActive ? 'Active' : service.status === 'archived' ? 'Archived' : 'Inactive';
    const statusBadge = createElement('span', `status-badge ${isActive ? 'service-active' : 'service-inactive'}`, statusLabel);
    footer.append(statusBadge);
    body.append(footer);
    const actions = createElement('div', 'my-service-management-actions');
    const editButton = createElement('button', 'service-action-edit', 'Edit');
    editButton.type = 'button';
    editButton.addEventListener('click', () => openEditModal(service, editButton));
    const statusButton = createElement('button', 'service-action-toggle', isActive ? 'Archive' : 'Unarchive');
    statusButton.type = 'button';
    statusButton.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user || service.providerId !== user.uid) return;
        statusButton.disabled = true;
        try {
            await updateDoc(doc(db, 'services', service.id), {
                status: isActive ? 'archived' : 'active',
                updatedAt: serverTimestamp(),
            });
        } catch (error) {
            console.error('Could not update service status:', error);
            alert('The service status could not be changed. Please try again.');
        } finally {
            statusButton.disabled = false;
        }
    });
    const deleteButton = createElement('button', 'service-action-delete', 'Delete');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', () => openDeleteModal(service, deleteButton));
    actions.append(editButton, statusButton, deleteButton);
    body.append(actions);
    card.append(imageArea, body);
    return card;
}

document.getElementById('close-edit-modal-btn')?.addEventListener('click', closeEditModal);
document.getElementById('cancel-edit-btn')?.addEventListener('click', closeEditModal);
editModal?.addEventListener('click', (event) => {
    if (event.target === editModal) closeEditModal();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editModal && !editModal.classList.contains('hidden')) closeEditModal();
    if (event.key === 'Escape' && deleteModal && !deleteModal.classList.contains('hidden')) closeDeleteModal();
});
document.getElementById('close-delete-modal-btn')?.addEventListener('click', closeDeleteModal);
deleteModal?.addEventListener('click', (event) => {
    if (event.target === deleteModal) closeDeleteModal();
});
document.getElementById('confirm-delete-service-btn')?.addEventListener('click', async (event) => {
    const user = auth.currentUser;
    const service = pendingDeleteService;
    const button = event.currentTarget;
    if (!user || !service || service.providerId !== user.uid) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
        await deleteDoc(doc(db, 'services', service.id));
        closeDeleteModal();
    } catch (error) {
        console.error('Could not delete service:', error);
        alert('The service could not be deleted. Please try again.');
    } finally {
        button.disabled = false;
        button.textContent = 'Yes, Delete Service';
    }
});
editForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    const serviceId = document.getElementById('edit-service-id').value;
    const serviceName = document.getElementById('edit-service-name').value.trim();
    const category = document.getElementById('edit-service-category').value;
    const price = Number.parseFloat(document.getElementById('edit-service-price').value);
    const duration = document.getElementById('edit-service-duration').value.trim();
    const description = document.getElementById('edit-service-description').value.trim();
    const saveButton = document.getElementById('save-edit-btn');
    if (!user || !serviceId || !serviceName || !category || !Number.isFinite(price) || price < 0 || !description) return;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
        await updateDoc(doc(db, 'services', serviceId), {
            name: serviceName,
            category,
            price,
            duration,
            description,
            updatedAt: serverTimestamp(),
        });
        closeEditModal();
    } catch (error) {
        console.error('Could not save service changes:', error);
        alert('The service changes could not be saved. Please try again.');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Changes';
    }
});

function listenForProviderServices(user) {
    if (!servicesList || !servicesEmpty) return;
    stopProviderServices?.();
    servicesList.replaceChildren();
    servicesEmpty.hidden = false;
    const emptyHeading = servicesEmpty.querySelector('h3');
    const emptyMessage = servicesEmpty.querySelector('p');
    if (emptyHeading) emptyHeading.textContent = 'Loading your services…';
    if (emptyMessage) emptyMessage.textContent = '';

    const ownServicesQuery = query(collection(db, 'services'), where('providerId', '==', user.uid));
    stopProviderServices = onSnapshot(ownServicesQuery, (snapshot) => {
        const ownedServices = snapshot.docs
            .map((serviceDoc) => ({ id: serviceDoc.id, ...serviceDoc.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        servicesList.replaceChildren(...ownedServices.map(makeProviderServiceCard));
        servicesEmpty.hidden = ownedServices.length > 0;
        if (emptyHeading) emptyHeading.textContent = 'No services yet';
        if (emptyMessage) emptyMessage.textContent = 'Add your first service to start receiving bookings.';
    }, (error) => {
        console.error('Failed to load provider services:', error);
        servicesEmpty.hidden = false;
        if (emptyHeading) emptyHeading.textContent = 'Unable to load services';
        if (emptyMessage) emptyMessage.textContent = error.code === 'permission-denied'
            ? 'Access was denied. Check the Firestore services read rules.'
            : 'Please try again later.';
    });
}

onAuthStateChanged(auth, (user) => {
    stopProviderServices?.();
    stopProviderServices = null;
    if (user) listenForProviderServices(user);
});

serviceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        showServiceStatus('Please sign in again before adding a service.', 'error');
        return;
    }

    const formData = new FormData(serviceForm);
    const name = String(formData.get('name') || '').trim();
    const selectedCategory = String(formData.get('category') || '').trim();
    const customCategory = String(formData.get('custom_category') || '').trim();
    const category = selectedCategory === 'other' ? customCategory : selectedCategory;
    const description = String(formData.get('description') || '').trim();
    const barangaySelect = document.getElementById('business-location-select');
    const streetInput = document.getElementById('street-address-input');
    const barangay = String(barangaySelect?.value || formData.get('barangay') || '').trim();
    const streetAddress = String(streetInput?.value || formData.get('street_address') || '').trim();
    const streetLower = streetAddress.toLowerCase();
    const locationParts = streetAddress ? [streetAddress] : [];
    if (barangay && !streetLower.includes(barangay.toLowerCase())) locationParts.push(barangay);
    if (!/san jose/i.test(streetAddress)) locationParts.push('San Jose');
    if (!/occidental mindoro/i.test(streetAddress)) locationParts.push('Occidental Mindoro');
    const location = locationParts.join(', ');
    const price = Number.parseFloat(String(formData.get('price') || ''));
    const imageFile = formData.get('image');

    if (!name || !category || !description || !barangay || !Number.isFinite(price) || price < 0) {
        showServiceStatus('Complete the service name, category, description, price, and barangay.', 'error');
        return;
    }
    if (!(imageFile instanceof File) || imageFile.size === 0) {
        showServiceStatus('Choose a JPG or PNG image for your service.', 'error');
        return;
    }
    if (imageFile instanceof File && imageFile.size > 0) {
        const supportedTypes = ['image/jpeg', 'image/png'];
        if (!supportedTypes.includes(imageFile.type) || imageFile.size > 2 * 1024 * 1024) {
            showServiceStatus('Choose a JPG or PNG image up to 2 MB.', 'error');
            return;
        }
    }

    const submitButton = serviceForm.querySelector('[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Saving…';
    }
    showServiceStatus('Saving your service…');

    try {
        const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
        const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
        const providerName = String(
            profile.businessName || profile.business_name || profile.fullName || user.displayName || user.email || 'Local provider',
        );

        const service = {
            name,
            category,
            description,
            price,
            status: 'active',
            providerId: user.uid,
            providerName,
            providerPhotoURL: profile.photoURL || user.photoURL || '',
            createdAt: serverTimestamp(),
            location,
            barangay,
            streetAddress,
            duration: String(formData.get('duration') || ''),
        };

        const latValue = String(formData.get('lat') || '').trim();
        const lngValue = String(formData.get('lng') || '').trim();
        if (latValue && lngValue) {
            const lat = Number.parseFloat(latValue);
            const lng = Number.parseFloat(lngValue);
            if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(service, { lat, lng });
        }

        if (imageFile instanceof File && imageFile.size > 0) {
            showServiceStatus('Uploading image and saving your service…');
            const uploadedImage = await uploadServiceImage(imageFile, user.uid);
            service.imageUrl = uploadedImage.url;
            service.imagePublicId = uploadedImage.publicId;
        }

        await addDoc(collection(db, 'services'), service);
        serviceForm.reset();
        if (previewImage) {
            previewImage.removeAttribute('src');
            previewImage.style.display = 'none';
        }
        showServiceStatus('Service added and published to the catalog.', 'success');
        if (typeof window.showDashboardPage === 'function') {
            window.showDashboardPage('my-services', { updateUrl: true });
        }
    } catch (error) {
        console.error('Failed to add service:', error);
        const message = error.code === 'permission-denied'
            ? 'Firestore denied this save. Check that your account has provider access and the services rules are deployed.'
            : error.message || 'The service could not be saved. Please try again.';
        showServiceStatus(message, 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Save Service';
        }
    }
});
