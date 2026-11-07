import { db } from './firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const defaultCenter = { latitude: 12.3529, longitude: 121.0696 };
const geocodeCacheKey = 'servibook-provider-geocode-cache-v1';
const geocodeMemoryCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeRequest = 0;

function distanceKm(first, second) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const dLat = radians(second.latitude - first.latitude);
    const dLng = radians(second.longitude - first.longitude);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatePair(data) {
    const location = data.location;
    const point = Array.isArray(data.locationCoordinates) ? data.locationCoordinates
        : Array.isArray(location) ? location
            : location?.geopoint ? [location.geopoint.latitude, location.geopoint.longitude]
                : [data.latitude ?? data.lat, data.longitude ?? data.lng];
    const latitude = Number(point[0]);
    const longitude = Number(point[1]);
    return Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude }
        : null;
}

function extractBarangay(data, locationText) {
    if (data.barangay) return String(data.barangay);
    const parts = String(locationText || '').split(',').map((part) => part.trim()).filter(Boolean);
    const townIndex = parts.findIndex((part) => /san jose/i.test(part));
    if (townIndex > 0) return parts[townIndex - 1];
    if (townIndex === 0) return parts[0];
    return parts.length > 1 ? parts[1] : parts[0] || 'San Jose';
}

function readGeocodeCache() {
    try {
        return JSON.parse(localStorage.getItem(geocodeCacheKey) || '{}');
    } catch {
        return {};
    }
}

function saveGeocode(address, coordinates) {
    geocodeMemoryCache.set(address, coordinates);
    try {
        const cache = readGeocodeCache();
        cache[address] = coordinates;
        localStorage.setItem(geocodeCacheKey, JSON.stringify(cache));
    } catch (error) {
        console.info('Provider map geocode cache is unavailable:', error);
    }
}

function queueNominatimRequest(params) {
    const task = geocodeQueue.then(async () => {
        const elapsed = Date.now() - lastGeocodeRequest;
        if (elapsed < 1000) await new Promise((resolve) => window.setTimeout(resolve, 1000 - elapsed));
        lastGeocodeRequest = Date.now();
        return fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), {
            headers: { 'Accept-Language': 'en' },
        });
    });
    geocodeQueue = task.then(() => undefined, () => undefined);
    return task;
}

function geocodeAddress(address, barangay = '') {
    const cleanedAddress = String(address || '').trim();
    if (!cleanedAddress) return Promise.resolve(null);
    if (geocodeMemoryCache.has(cleanedAddress)) return Promise.resolve(geocodeMemoryCache.get(cleanedAddress));
    const barangayCacheKey = barangay
        ? barangay + ', San Jose, Occidental Mindoro, Philippines'
        : '';
    const cache = readGeocodeCache();
    const cached = cache[cleanedAddress] || (barangayCacheKey && cache[barangayCacheKey]);
    if (cached && Number.isFinite(Number(cached.latitude)) && Number.isFinite(Number(cached.longitude))) {
        const coordinates = { latitude: Number(cached.latitude), longitude: Number(cached.longitude) };
        geocodeMemoryCache.set(cleanedAddress, coordinates);
        return Promise.resolve(coordinates);
    }

    const params = new URLSearchParams({
        format: 'json',
        limit: '1',
        countrycodes: 'ph',
        q: cleanedAddress + ', San Jose, Occidental Mindoro, Philippines',
    });
    const task = queueNominatimRequest(params).then(async (response) => {
        if (!response.ok) throw new Error('Location lookup failed (' + response.status + ').');
        const results = await response.json();
        let match = results[0];
        if (!match && barangay && barangay.toLowerCase() !== cleanedAddress.toLowerCase()) {
            const barangayQuery = new URLSearchParams({
                format: 'json',
                limit: '1',
                countrycodes: 'ph',
                q: barangay + ', San Jose, Occidental Mindoro, Philippines',
            });
            const fallbackResponse = await queueNominatimRequest(barangayQuery);
            if (!fallbackResponse.ok) throw new Error('Barangay lookup failed (' + fallbackResponse.status + ').');
            match = (await fallbackResponse.json())[0];
        }
        if (!match) return null;
        const coordinates = { latitude: Number(match.lat), longitude: Number(match.lon) };
        if (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) return null;
        saveGeocode(cleanedAddress, coordinates);
        if (barangay) saveGeocode(barangay + ', San Jose, Occidental Mindoro, Philippines', coordinates);
        return coordinates;
    });
    return task.catch((error) => {
        console.warn('Could not locate provider address:', error);
        return null;
    });
}

function approximateTownCenter(providerId) {
    let hash = 0;
    for (const character of String(providerId)) {
        hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    }
    const angle = (Math.abs(hash) % 360) * Math.PI / 180;
    const radiusKm = 0.15 + (Math.abs(hash >> 8) % 85) / 100;
    const latitudeOffset = (radiusKm / 111) * Math.cos(angle);
    const longitudeOffset = (radiusKm / (111 * Math.cos(defaultCenter.latitude * Math.PI / 180))) * Math.sin(angle);
    return {
        latitude: defaultCenter.latitude + latitudeOffset,
        longitude: defaultCenter.longitude + longitudeOffset,
    };
}

/** Aggregate the public active service catalog into one map entry per provider. */
export async function fetchProvidersNear(center = defaultCenter, radiusKm = 50) {
    const { latitude, longitude } = center || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || !Number.isFinite(radiusKm) || radiusKm <= 0) {
        throw new TypeError('Valid center coordinates and a positive radiusKm are required.');
    }

    const servicesSnapshot = await getDocs(query(collection(db, 'services'), where('status', '==', 'active')));
    let reviewsSnapshot = null;
    try {
        reviewsSnapshot = await getDocs(collection(db, 'reviews'));
    } catch (error) {
        console.warn('Provider map ratings are unavailable until review reads are enabled:', error);
    }
    const providers = new Map();
    const serviceProviders = new Map();

    servicesSnapshot.forEach((serviceDoc) => {
        const service = serviceDoc.data();
        const providerId = String(service.providerId || '');
        if (!providerId) return;
        serviceProviders.set(serviceDoc.id, providerId);
        let provider = providers.get(providerId);
        if (!provider) {
            const location = String(service.location || service.barangay || '').trim();
            provider = {
                id: providerId,
                name: service.providerName || '',
                barangay: extractBarangay(service, location),
                location: location || 'San Jose, Occidental Mindoro',
                latitude: null,
                longitude: null,
                service_count: 0,
                ratingTotal: 0,
                review_count: 0,
                fallbackRatingTotal: 0,
                fallbackReviewCount: 0,
            };
            providers.set(providerId, provider);
        }
        provider.service_count += 1;
        const coordinates = coordinatePair(service);
        if (!provider.latitude && coordinates) {
            provider.latitude = coordinates.latitude;
            provider.longitude = coordinates.longitude;
            provider.locationAccuracy = 'saved';
        }
        const average = Number(service.avg_rating ?? service.avgRating ?? service.rating);
        const count = Number(service.review_count ?? service.reviewCount ?? 0);
        if (Number.isFinite(average) && count > 0) {
            provider.fallbackRatingTotal += average * count;
            provider.fallbackReviewCount += count;
        }
    });

    reviewsSnapshot?.forEach((reviewDoc) => {
        const review = reviewDoc.data();
        const providerId = String(review.providerId || serviceProviders.get(review.serviceId) || '');
        const rating = Number(review.rating);
        const provider = providers.get(providerId);
        if (!provider || !Number.isInteger(rating) || rating < 1 || rating > 5) return;
        provider.ratingTotal += rating;
        provider.review_count += 1;
    });

    const result = [...providers.values()];
    for (const provider of result) {
        provider.name ||= 'Local Provider';
        provider.location ||= 'San Jose, Occidental Mindoro';
        if (provider.review_count === 0 && provider.fallbackReviewCount > 0) {
            provider.ratingTotal = provider.fallbackRatingTotal;
            provider.review_count = provider.fallbackReviewCount;
        }
        provider.avg_rating = provider.review_count ? provider.ratingTotal / provider.review_count : 0;
        delete provider.ratingTotal;
        delete provider.fallbackRatingTotal;
        delete provider.fallbackReviewCount;
        if (!Number.isFinite(provider.latitude) || !Number.isFinite(provider.longitude)) {
            const coordinates = await geocodeAddress(provider.location, provider.barangay);
            if (coordinates) {
                provider.latitude = coordinates.latitude;
                provider.longitude = coordinates.longitude;
                provider.locationAccuracy = 'geocoded';
            } else {
                Object.assign(provider, approximateTownCenter(provider.id));
                provider.locationAccuracy = 'approximate';
            }
        }
    }
    return result.filter((provider) => Number.isFinite(provider.latitude)
        && Number.isFinite(provider.longitude)
        && distanceKm({ latitude, longitude }, provider) <= radiusKm);
}

function initServibookMap() {
    const mapElement = document.getElementById('providersMap');
    if (!mapElement) return;
    if (typeof L === 'undefined') {
        const message = document.getElementById('providerList');
        if (message) {
            message.hidden = false;
            message.textContent = 'The map could not be loaded. Refresh the page to try again.';
        }
        return;
    }

    const providerList = document.getElementById('providerList');
    const viewToggle = document.getElementById('providersViewToggle');
    const homeProviderGrid = document.getElementById('top-provider-grid');
    const map = L.map(mapElement).setView([defaultCenter.latitude, defaultCenter.longitude], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map);
    const userIcon = L.divIcon({
        className: 'map-marker map-marker-user',
        html: '<span>You</span>',
        iconSize: [48, 48],
        iconAnchor: [24, 24],
    });
    const providerIcon = L.divIcon({
        className: 'map-marker map-marker-provider',
        html: '<span>★</span>',
        iconSize: [42, 42],
        iconAnchor: [21, 21],
    });
    let userMarker = null;
    const providerMarkers = new Map();

    function fitMapToMarkers() {
        const layers = [...providerMarkers.values()];
        if (userMarker) layers.push(userMarker);
        if (layers.length === 1) map.setView(layers[0].getLatLng(), 14);
        else if (layers.length > 1) map.fitBounds(L.featureGroup(layers).getBounds().pad(0.2));
    }

    function providerPopup(provider) {
        const popup = document.createElement('div');
        popup.className = 'map-popup';
        const name = document.createElement('strong');
        name.textContent = provider.name;
        const barangay = document.createElement('p');
        barangay.textContent = 'Barangay: ' + provider.barangay;
        const rating = document.createElement('p');
        rating.textContent = provider.avg_rating > 0
            ? '★ ' + provider.avg_rating.toFixed(1) + ' (' + provider.review_count + ' reviews)'
            : 'No reviews yet';
        const count = document.createElement('p');
        count.textContent = provider.service_count + (provider.service_count === 1 ? ' service' : ' services');
        const accuracy = document.createElement('p');
        accuracy.className = 'map-location-accuracy';
        accuracy.textContent = provider.locationAccuracy === 'approximate'
            ? 'Approximate town-center pin; exact address could not be mapped.'
            : provider.location;
        const link = document.createElement('a');
        link.href = 'services.html?provider=' + encodeURIComponent(provider.id);
        link.textContent = 'View Services';
        popup.append(name, barangay, rating, count, accuracy, link);
        return popup;
    }

    function addProviderMarkers(providers) {
        providerMarkers.forEach((marker) => map.removeLayer(marker));
        providerMarkers.clear();
        providers.forEach((provider) => {
            const marker = L.marker([provider.latitude, provider.longitude], { icon: providerIcon })
                .addTo(map)
                .bindPopup(providerPopup(provider));
            providerMarkers.set(provider.id, marker);
        });
        fitMapToMarkers();
    }

    function renderProviderList(providers) {
        if (!providerList) return;
        providerList.replaceChildren();
        if (!providers.length) {
            const message = document.createElement('p');
            message.className = 'provider-list-empty';
            message.textContent = 'No active service providers were found in this area.';
            providerList.append(message);
            return;
        }
        const list = document.createElement('ul');
        list.className = 'provider-list-items';
        providers.forEach((provider) => {
            const item = document.createElement('li');
            item.className = 'provider-list-item';
            const name = document.createElement('h3');
            name.textContent = provider.name;
            const location = document.createElement('p');
            location.textContent = provider.location || provider.barangay;
            if (provider.locationAccuracy === 'approximate') {
                const locationNote = document.createElement('p');
                locationNote.className = 'map-location-accuracy';
                locationNote.textContent = 'Approximate town-center pin';
                item.append(name, location, locationNote);
            } else {
                item.append(name, location);
            }
            const rating = document.createElement('p');
            rating.textContent = provider.avg_rating > 0
                ? '★ ' + provider.avg_rating.toFixed(1) + ' · ' + provider.service_count + ' services'
                : provider.service_count + ' services';
            const link = document.createElement('a');
            link.className = 'btn btn-primary';
            link.href = 'services.html?provider=' + encodeURIComponent(provider.id);
            link.textContent = 'View services';
            item.append(rating, link);
            item.addEventListener('click', (event) => {
                if (event.target.closest('a')) return;
                const marker = providerMarkers.get(provider.id);
                if (marker) {
                    map.setView(marker.getLatLng(), 15);
                    marker.openPopup();
                    mapElement.hidden = false;
                    if (providerList) providerList.hidden = true;
                    viewToggle?.setAttribute('aria-pressed', 'false');
                    if (viewToggle) viewToggle.textContent = 'View as List';
                    map.invalidateSize();
                }
            });
            list.append(item);
        });
        providerList.append(list);
    }

    function renderHomeProviderCards(providers) {
        if (!homeProviderGrid) return;
        homeProviderGrid.replaceChildren();
        if (!providers.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.style.gridColumn = '1 / -1';
            const message = document.createElement('p');
            message.textContent = 'No active service providers found.';
            empty.append(message);
            homeProviderGrid.append(empty);
            return;
        }
        providers
            .slice()
            .sort((a, b) => b.avg_rating - a.avg_rating || b.service_count - a.service_count)
            .forEach((provider) => {
                const card = document.createElement('article');
                card.className = 'provider-card visible';
                const image = document.createElement('div');
                image.className = 'provider-image';
                const placeholder = document.createElement('span');
                placeholder.className = 'provider-placeholder';
                placeholder.setAttribute('aria-hidden', 'true');
                placeholder.textContent = '🧰';
                image.append(placeholder);
                if (provider.avg_rating > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'provider-badge';
                    badge.textContent = '★ ' + provider.avg_rating.toFixed(1);
                    image.append(badge);
                }
                const info = document.createElement('div');
                info.className = 'provider-info';
                const name = document.createElement('h3');
                name.className = 'provider-name';
                name.textContent = provider.name;
                const area = document.createElement('span');
                area.className = 'provider-category';
                area.textContent = provider.barangay;
                const stats = document.createElement('div');
                stats.className = 'provider-stats';
                const stat = document.createElement('div');
                stat.className = 'stat';
                const value = document.createElement('div');
                value.className = 'stat-value';
                value.textContent = String(provider.service_count);
                const label = document.createElement('div');
                label.className = 'stat-label';
                label.textContent = provider.service_count === 1 ? 'Active Service' : 'Active Services';
                stat.append(value, label);
                stats.append(stat);
                const link = document.createElement('a');
                link.className = 'book-btn';
                link.href = 'services.html?provider=' + encodeURIComponent(provider.id);
                link.textContent = 'View Services';
                info.append(name, area, stats, link);
                card.append(image, info);
                homeProviderGrid.append(card);
            });
    }

    let refreshId = 0;
    let providerDataPromise = null;
    async function refreshProviders(latitude, longitude) {
        const currentRefresh = ++refreshId;
        try {
            providerDataPromise ||= fetchProvidersNear(defaultCenter, 100);
            const allProviders = await providerDataPromise;
            if (currentRefresh !== refreshId) return;
            const providers = allProviders.filter((provider) =>
                distanceKm({ latitude, longitude }, provider) <= 100);
            renderHomeProviderCards(allProviders);
            addProviderMarkers(providers);
            renderProviderList(providers);
        } catch (error) {
            providerDataPromise = null;
            console.error('Unable to load nearby service providers:', error);
            if (providerList) {
                const message = document.createElement('p');
                message.className = 'provider-list-empty';
                message.textContent = 'Provider information is unavailable right now. Please try again later.';
                providerList.replaceChildren(message);
            }
        }
    }

    viewToggle?.addEventListener('click', () => {
        if (!providerList) return;
        const showList = providerList.hidden;
        providerList.hidden = !showList;
        mapElement.hidden = showList;
        viewToggle.setAttribute('aria-pressed', String(showList));
        viewToggle.textContent = showList ? 'Show Map' : 'View as List';
        if (!showList) map.invalidateSize();
        if (showList) providerList.focus({ preventScroll: true });
    });

    refreshProviders(defaultCenter.latitude, defaultCenter.longitude);
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(({ coords }) => {
            userMarker = L.marker([coords.latitude, coords.longitude], { icon: userIcon })
                .addTo(map).bindPopup('You are here');
            map.setView([coords.latitude, coords.longitude], 13);
            refreshProviders(coords.latitude, coords.longitude);
        }, (error) => console.info('Current location is unavailable:', error.message), {
            enableHighAccuracy: false,
            timeout: 10000,
        });
    }

    const locationInput = document.getElementById('locationInput');
    const searchButton = document.getElementById('searchBtn');
    async function searchLocation() {
        const search = locationInput?.value.trim();
        if (!search) {
            locationInput?.focus();
            return;
        }
        try {
            const params = new URLSearchParams({
                format: 'json',
                limit: '1',
                countrycodes: 'ph',
                q: search + ', Philippines',
            });
            const response = await queueNominatimRequest(params);
            if (!response.ok) throw new Error('Location search failed (' + response.status + ').');
            const results = await response.json();
            if (!results.length) return;
            const latitude = Number(results[0].lat);
            const longitude = Number(results[0].lon);
            map.setView([latitude, longitude], 14);
            if (userMarker) map.removeLayer(userMarker);
            userMarker = L.marker([latitude, longitude], { icon: userIcon }).addTo(map).bindPopup(search);
            refreshProviders(latitude, longitude);
        } catch (error) {
            console.error('Location search failed:', error);
        }
    }
    searchButton?.addEventListener('click', (event) => {
        event.preventDefault();
        searchLocation();
    });
    locationInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchLocation();
        }
    });
}

if ((document.readyState === 'loading' || document.readyState === 'interactive') && typeof L === 'undefined') {
    document.addEventListener('DOMContentLoaded', initServibookMap, { once: true });
} else {
    initServibookMap();
}
