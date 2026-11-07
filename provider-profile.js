import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, updatePassword, updateProfile } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import {
    deleteObject, getDownloadURL, getStorage, ref, uploadBytes,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const storage = getStorage();
const form = document.getElementById('profilePhotoForm');
const fileInput = document.getElementById('profilePictureInput');
const uploadButton = document.getElementById('uploadProfilePicture');
const status = document.getElementById('profileUploadStatus');
const avatarImages = [
    document.getElementById('profileAvatarPreview'),
    document.getElementById('sidebarAvatarImage'),
].filter(Boolean);
const maxFileSize = 5 * 1024 * 1024;
const profileEditForm = document.getElementById('providerProfileForm');
const profileUpdateStatus = document.getElementById('profileUpdateStatus');
const profileBarangay = document.getElementById('profile-business-location-select');
const profileStreetAddress = document.getElementById('profile-street-address-input');

function setProfileUpdateStatus(message, state = '') {
    if (!profileUpdateStatus) return;
    profileUpdateStatus.textContent = message;
    if (state) profileUpdateStatus.dataset.state = state;
    else delete profileUpdateStatus.dataset.state;
}

function populateProfileForm(user, profile = {}) {
    if (!profileEditForm) return;
    profileEditForm.elements.full_name.value = profile.fullName || profile.full_name || user.displayName || '';
    profileEditForm.elements.email.value = profile.email || user.email || '';
    profileEditForm.elements.phone.value = profile.phone || '';

    const savedLocation = String(profile.location || '').trim();
    let barangay = String(profile.barangay || '').trim();
    if (!barangay && savedLocation) {
        barangay = Array.from(profileBarangay.options)
            .map((option) => option.value)
            .find((option) => savedLocation.toLowerCase().includes(option.toLowerCase())) || '';
    }
    profileBarangay.value = barangay;

    const openTimeInput = document.getElementById('store-open-time');
    const closeTimeInput = document.getElementById('store-close-time');
    if (openTimeInput) openTimeInput.value = profile.storeOpenTime || '';
    if (closeTimeInput) closeTimeInput.value = profile.storeCloseTime || '';
    const openDays = new Set(Array.isArray(profile.storeOpenDays) ? profile.storeOpenDays : []);
    document.querySelectorAll('input[name="store_open_days"]').forEach((input) => {
        input.checked = openDays.has(input.value);
    });

    let streetAddress = String(profile.streetAddress || profile.street_address || '').trim();
    if (!streetAddress && savedLocation) {
        const parts = savedLocation.split(',').map((part) => part.trim()).filter(Boolean);
        if (barangay) {
            const barangayIndex = parts.findIndex((part) => part.toLowerCase() === barangay.toLowerCase());
            if (barangayIndex >= 0) parts.splice(barangayIndex);
        }
        streetAddress = parts
            .filter((part) => !/^san jose$/i.test(part) && !/^occidental mindoro$/i.test(part))
            .join(', ');
    }
    profileStreetAddress.value = streetAddress;
}

let signedInUser = auth.currentUser;
let selectedFile = null;
let previewUrl = null;
let savedPhotoUrl = '';

function setStatus(message, state = '') {
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function showAvatar(url) {
    avatarImages.forEach((image) => {
        if (url) {
            image.src = url;
            image.hidden = false;
        } else {
            image.removeAttribute('src');
            image.hidden = true;
        }
    });
}

function validateImage(file) {
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!supportedTypes.includes(file.type)) return 'Choose a JPG, PNG, or WEBP image.';
    if (file.size > maxFileSize) return 'The image must be 5 MB or smaller.';
    return '';
}

onAuthStateChanged(auth, async (user) => {
    signedInUser = user;
    if (!user) return;

    try {
        const profileSnapshot = await getDoc(doc(db, 'users', user.uid));
        const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
        populateProfileForm(user, profile);
        savedPhotoUrl = profile.photoURL || user.photoURL || '';
        showAvatar(savedPhotoUrl);
    } catch (error) {
        console.error('Could not load the provider profile photo:', error);
        populateProfileForm(user);
        showAvatar(user.photoURL || '');
    }
});

profileEditForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!signedInUser) {
        setProfileUpdateStatus('Please sign in again before updating your profile.', 'error');
        return;
    }

    const fullName = profileEditForm.elements.full_name.value.trim();
    const phone = profileEditForm.elements.phone.value.trim();
    const barangay = profileBarangay.value.trim();
    const streetAddress = profileStreetAddress.value.trim();
    const newPassword = profileEditForm.elements.new_password.value;
    const storeOpenTime = document.getElementById('store-open-time')?.value || '';
    const storeCloseTime = document.getElementById('store-close-time')?.value || '';
    const storeOpenDays = Array.from(document.querySelectorAll('input[name="store_open_days"]:checked'))
        .map((input) => input.value);
    if (!fullName || !barangay) {
        setProfileUpdateStatus('Enter your name and select a barangay.', 'error');
        return;
    }
    const hasAnyStoreHours = Boolean(storeOpenTime || storeCloseTime || storeOpenDays.length);
    if (hasAnyStoreHours && (!storeOpenTime || !storeCloseTime || !storeOpenDays.length || storeCloseTime <= storeOpenTime)) {
        setProfileUpdateStatus('Set an opening time, a later closing time, and at least one open day.', 'error');
        return;
    }

    const locationParts = streetAddress ? [streetAddress] : [];
    if (barangay && !streetAddress.toLowerCase().includes(barangay.toLowerCase())) locationParts.push(barangay);
    const typedAddress = streetAddress.toLowerCase();
    if (!/san jose/i.test(typedAddress)) locationParts.push('San Jose');
    if (!/occidental mindoro/i.test(typedAddress)) locationParts.push('Occidental Mindoro');
    const location = locationParts.join(', ');
    const saveButton = profileEditForm.querySelector('[type="submit"]');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    setProfileUpdateStatus('Saving your profile…');

    try {
        await updateDoc(doc(db, 'users', signedInUser.uid), {
            fullName,
            phone: phone || null,
            barangay,
            streetAddress: streetAddress || null,
            location,
            storeOpenTime,
            storeCloseTime,
            storeOpenDays,
            updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'providers', signedInUser.uid), {
            userId: signedInUser.uid,
            providerId: signedInUser.uid,
            name: fullName,
            fullName,
            barangay,
            location,
            photoURL: savedPhotoUrl || signedInUser.photoURL || '',
            storeOpenTime,
            storeCloseTime,
            storeOpenDays,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        await updateProfile(signedInUser, { displayName: fullName });
        document.querySelectorAll('.user-welcome').forEach((element) => { element.textContent = `Hi, ${fullName}`; });
        document.querySelectorAll('.sidebar-profile h3').forEach((element) => { element.textContent = fullName; });
        const newPasswordInput = profileEditForm.elements.new_password;
        let passwordMessage = '';
        if (newPassword) {
            try {
                await updatePassword(signedInUser, newPassword);
                newPasswordInput.value = '';
                passwordMessage = ' Password updated.';
            } catch (passwordError) {
                console.error('Profile saved, but password update failed:', passwordError);
                passwordMessage = passwordError.code === 'auth/requires-recent-login'
                    ? ' Profile saved, but sign in again before changing your password.'
                    : ` Profile saved, but the password was not changed: ${passwordError.message}`;
            }
        }
        setProfileUpdateStatus(`Your profile has been updated.${passwordMessage}`, passwordMessage && newPasswordInput.value ? 'error' : 'success');
    } catch (error) {
        console.error('Could not update provider profile:', error);
        setProfileUpdateStatus(error.code === 'permission-denied'
            ? 'Access was denied while saving your profile. Please try again or contact support.'
            : error.message || 'Your profile could not be updated. Please try again.', 'error');
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Update Profile';
    }
});

fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    selectedFile = file || null;
    if (!file) {
        showAvatar(savedPhotoUrl);
        setStatus('');
        return;
    }

    const validationMessage = validateImage(file);
    if (validationMessage) {
        fileInput.value = '';
        selectedFile = null;
        showAvatar(savedPhotoUrl);
        setStatus(validationMessage, 'error');
        return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    showAvatar(previewUrl);
    setStatus(`${file.name} is ready to upload.`);
});

form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!signedInUser) {
        setStatus('Please sign in again before uploading a profile photo.', 'error');
        return;
    }
    if (!selectedFile) {
        setStatus('Choose a photo before uploading.', 'error');
        fileInput?.focus();
        return;
    }

    uploadButton.disabled = true;
    setStatus('Uploading your photo…');

    const extensionByType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const objectPath = `profilePictures/${signedInUser.uid}/profile-${Date.now()}.${extensionByType[selectedFile.type]}`;
    const imageRef = ref(storage, objectPath);

    try {
        await uploadBytes(imageRef, selectedFile, {
            contentType: selectedFile.type,
            cacheControl: 'public,max-age=3600',
        });
        const photoURL = await getDownloadURL(imageRef);

        try {
            await updateDoc(doc(db, 'users', signedInUser.uid), {
                photoURL,
                photoPath: objectPath,
                updatedAt: serverTimestamp(),
            });
            await updateProfile(signedInUser, { photoURL });
        } catch (profileError) {
            // Avoid leaving a photo in Storage without a corresponding profile update.
            try { await deleteObject(imageRef); }
            catch (cleanupError) { console.warn('Uploaded photo cleanup failed:', cleanupError); }
            throw profileError;
        }

        savedPhotoUrl = photoURL;
        selectedFile = null;
        fileInput.value = '';
        showAvatar(photoURL);
        setStatus('Your profile photo has been updated.', 'success');
    } catch (error) {
        console.error('Profile photo upload failed:', error);
        const message = error.code === 'storage/unauthorized'
            ? 'Upload permission was denied. Check that Firebase Storage rules are deployed.'
            : error.message || 'The photo could not be uploaded. Please try again.';
        showAvatar(savedPhotoUrl);
        setStatus(message, 'error');
    } finally {
        uploadButton.disabled = false;
    }
});
