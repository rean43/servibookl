import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from './firebase-config.js';

const grid = document.getElementById('servicesGrid');
const emptyState = document.getElementById('servicesEmptyState');
const resultCount = document.getElementById('serviceResultsCount');
const categoryOptions = document.getElementById('categoryFilterOptions');
const locationOptions = document.getElementById('locationFilterOptions');
const searchInput = document.getElementById('serviceSearch');
const locationInput = document.getElementById('serviceLocation');
const sortSelect = document.getElementById('serviceSort');
let params = new URLSearchParams(window.location.search);
let services = [];
const targetProviderId = params.get('providerId') || params.get('provider') || '';
const targetCategory = params.get('category') || '';
const targetSearch = params.get('search') || params.get('q') || '';
if (targetProviderId) params.set('provider', targetProviderId);
if (targetCategory) params.set('category', targetCategory);
if (targetSearch) params.set('search', targetSearch);

const categoryLabels = {
    barbershop: 'Barbershop',
    electrician: 'Electrician',
    plumbing: 'Plumbing',
    cleaning: 'House Cleaning',
    laundry: 'Laundry',
    carpentry: 'Carpentry',
};
const categoryIcons = {
    barbershop: '✂️', electrician: '⚡', plumbing: '🔧',
    cleaning: '🧹', laundry: '👕', carpentry: '🪚',
};

function normalizeCategory(value = '') {
    const key = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const aliases = {
        'house-cleaning': 'cleaning', plumber: 'plumbing', carpenter: 'carpentry',
        electrical: 'electrician', electric: 'electrician',
    };
    return aliases[key] || key;
}

function categoryLabel(value = '') {
    const key = normalizeCategory(value);
    return categoryLabels[key] || String(value).trim() || 'Other';
}

function timestampMillis(value) {
    if (value?.toMillis) return value.toMillis();
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
}

function getVisibleServices() {
    const category = normalizeCategory(params.get('category') || '');
    const provider = params.get('providerId') || params.get('provider') || '';
    const search = (params.get('search') || params.get('q') || '').trim().toLocaleLowerCase();
    const searchTerms = search.split(/\s+/).filter(Boolean);
    const location = (params.get('location') || '').trim().toLowerCase();

    const filtered = services.filter((service) => {
        if (service.status !== 'active') return false;
        if (category && normalizeCategory(service.category) !== category) return false;
        if (provider && service.providerId !== provider) return false;
        if (location && !String(service.location || '').toLowerCase().includes(location)) return false;
        const searchable = [
            service.name, service.title, service.category, categoryLabel(service.category),
            service.description, service.providerName, service.location,
        ].map((value) => String(value || '').trim().toLocaleLowerCase()).join(' ');
        return searchTerms.every((term) => searchable.includes(term));
    });

    switch (params.get('sort') || 'popular') {
        case 'price-low': filtered.sort((a, b) => Number(a.price) - Number(b.price)); break;
        case 'price-high': filtered.sort((a, b) => Number(b.price) - Number(a.price)); break;
        case 'newest': filtered.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)); break;
        case 'rating':
        case 'popular':
        default: filtered.sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0));
    }
    return filtered;
}

function makeCard(service) {
    const link = document.createElement('a');
    link.className = 'service-card-item';
    link.href = `service-details.html?id=${encodeURIComponent(service.id)}`;
    link.setAttribute('aria-label', `${service.name}, ${categoryLabel(service.category)}, view service details`);

    const imageContainer = document.createElement('div');
    imageContainer.className = 'card-image';
    if (service.imageUrl) {
        const image = document.createElement('img');
        image.src = service.imageUrl;
        image.alt = `${service.name} service`;
        image.loading = 'lazy';
        imageContainer.append(image);
    } else {
        const fallback = document.createElement('span');
        fallback.className = 'no-image';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = categoryIcons[normalizeCategory(service.category)] || '🛠️';
        imageContainer.append(fallback);
    }

    const body = document.createElement('div');
    body.className = 'card-body';
    const category = document.createElement('div');
    category.className = 'card-category';
    category.textContent = categoryLabel(service.category);
    const name = document.createElement('h2');
    name.className = 'card-name';
    name.textContent = service.name || 'Service';
    const provider = document.createElement('p');
    provider.className = 'card-provider';
    provider.textContent = `by ${service.providerName || 'Local provider'}`;
    const description = document.createElement('p');
    description.className = 'card-provider';
    description.textContent = service.description || '';

    const location = document.createElement('div');
    location.className = 'card-location';
    const locationIcon = document.createElement('span');
    locationIcon.setAttribute('aria-hidden', 'true');
    locationIcon.textContent = '📍';
    const locationText = document.createElement('span');
    locationText.textContent = service.location || 'Location not provided';
    location.append(locationIcon, locationText);

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const price = document.createElement('strong');
    price.className = 'card-price';
    const numericPrice = Number(service.price);
    price.textContent = Number.isFinite(numericPrice)
        ? `₱${numericPrice.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : 'Contact for price';
    const view = document.createElement('span');
    view.className = 'btn btn-primary';
    view.textContent = 'View Details';
    footer.append(price, view);
    body.append(category, name, provider, description, location, footer);
    link.append(imageContainer, body);
    return link;
}

function renderFilterOptions(container, existingName, values, labelFor) {
    if (!container) return;
    const queryName = existingName === 'locFilter' ? 'location' : existingName;
    const selectedValue = params.get(queryName) || '';
    const allOption = container.querySelector('input[value=""]')?.closest('.filter-option');
    container.replaceChildren();
    if (allOption) container.append(allOption);

    values.forEach((value) => {
        const option = document.createElement('div');
        option.className = 'filter-option';
        const input = document.createElement('input');
        const id = `${existingName}-${normalizeCategory(value).replace(/[^a-z0-9-]/g, '') || 'option'}`;
        input.type = 'radio';
        input.name = existingName;
        input.id = id;
        input.value = existingName === 'category' ? normalizeCategory(value) : value;
        input.checked = input.value === selectedValue;
        input.addEventListener('change', () => window.applyFilter?.());
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = labelFor(value);
        option.append(input, label);
        container.append(option);
    });
    if (!selectedValue) {
        const allInput = container.querySelector('input[value=""]');
        if (allInput) allInput.checked = true;
    }
}

function render() {
    if (!grid || !emptyState || !resultCount) return;
    const visible = getVisibleServices();
    grid.replaceChildren(...visible.map(makeCard));
    resultCount.textContent = `${visible.length} ${visible.length === 1 ? 'service' : 'services'} available`;
    emptyState.hidden = visible.length > 0;
    if (!visible.length) {
        const heading = emptyState.querySelector('h3');
        const message = emptyState.querySelector('p');
        const hasActiveServices = services.some((service) => service.status === 'active');
        if (heading) heading.textContent = hasActiveServices ? 'No matching services' : 'No services available yet';
        if (message) message.textContent = hasActiveServices
            ? 'Try changing your search or filters.'
            : 'There are no services to display right now. Please check back later.';
    }
}

function syncControls() {
    if (searchInput) searchInput.value = params.get('search') || params.get('q') || '';
    if (locationInput) locationInput.value = params.get('location') || '';
    if (sortSelect) sortSelect.value = params.get('sort') || 'popular';
    document.querySelectorAll('input[name="category"]').forEach((input) => {
        input.checked = input.value === (params.get('category') || '');
    });
    document.querySelectorAll('input[name="locFilter"]').forEach((input) => {
        if (input.value && input.value.toLowerCase() === (params.get('location') || '').toLowerCase()) input.checked = true;
    });
}

function updateFromUrl() {
    params = new URLSearchParams(window.location.search);
    const providerId = params.get('providerId') || params.get('provider') || '';
    const search = params.get('search') || params.get('q') || '';
    if (providerId) params.set('provider', providerId);
    if (search) params.set('search', search);
    syncControls();
    render();
}

syncControls();
const searchForm = document.getElementById('serviceSearchForm');
searchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = new URL(window.location.href);
    if (searchInput?.value.trim()) next.searchParams.set('search', searchInput.value.trim());
    else {
        next.searchParams.delete('search');
        next.searchParams.delete('q');
    }
    if (locationInput?.value.trim()) next.searchParams.set('location', locationInput.value.trim());
    else next.searchParams.delete('location');
    window.history.pushState({}, '', next);
    updateFromUrl();
});

window.addEventListener('popstate', updateFromUrl);

function applyFiltersFromControls() {
    const next = new URLSearchParams(params);
    const category = document.querySelector('input[name="category"]:checked')?.value || '';
    const location = document.querySelector('input[name="locFilter"]:checked')?.value || '';
    const typedLocation = locationInput?.value.trim() || '';
    const search = searchInput?.value.trim() || '';
    const sort = sortSelect?.value || '';
    for (const key of ['category', 'location', 'search', 'q', 'sort']) next.delete(key);
    if (category) next.set('category', category);
    if (typedLocation || location) next.set('location', typedLocation || location);
    if (search) next.set('search', search);
    if (sort && sort !== 'popular') next.set('sort', sort);
    params = next;
    const queryString = params.toString();
    window.history.pushState({}, '', `${window.location.pathname}${queryString ? `?${queryString}` : ''}`);
    syncControls();
    render();
}

function clearFilters() {
    params = new URLSearchParams();
    window.history.pushState({}, '', window.location.pathname);
    syncControls();
    render();
}

window.applyFilter = applyFiltersFromControls;
window.applySort = (sort) => {
    if (sortSelect) sortSelect.value = sort;
    applyFiltersFromControls();
};
document.querySelectorAll('[data-clear-filters]').forEach((button) => {
    button.addEventListener('click', clearFilters);
});

onSnapshot(query(collection(db, 'services'), where('status', '==', 'active')), (snapshot) => {
    console.log('Fetched services count:', snapshot.size);
    services = snapshot.docs.map((serviceDoc) => ({ id: serviceDoc.id, ...serviceDoc.data() }));
    const categories = [...new Set(services.map((service) => service.category).filter(Boolean))];
    const locations = [...new Set(services.map((service) => service.location).filter(Boolean))];
    renderFilterOptions(categoryOptions, 'category', categories, categoryLabel);
    renderFilterOptions(locationOptions, 'locFilter', locations, (value) => value);
    syncControls();
    render();
}, (error) => {
    console.error('Failed to load services from Firestore:', error);
    if (error.message?.includes('index')) console.error('Firestore reported an index issue:', error.message);
    resultCount && (resultCount.textContent = 'Services could not be loaded.');
    const message = emptyState?.querySelector('p');
    const heading = emptyState?.querySelector('h3');
    if (heading) heading.textContent = 'Unable to load services';
    if (message) message.textContent = error.code === 'permission-denied'
        ? 'Access was denied. Please check the Firestore services read rules.'
        : 'Please check your connection and try again.';
    if (emptyState) emptyState.hidden = false;
});
