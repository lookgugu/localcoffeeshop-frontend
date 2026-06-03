// Hard dep on enums + api-client — fail loud if missing
// (script order is enforced by the HTML).
if (!window.CoffeeShopEnums) {
    throw new Error('window.CoffeeShopEnums not loaded — check script order in HTML');
}
if (!window.ApiClient) {
    throw new Error('window.ApiClient not loaded — check script order in HTML');
}
const { stateName } = window.CoffeeShopEnums;
const api = window.ApiClient;

let allCoffeeShops = [];
let states = new Set();

/**
 * Generate a fresh UUID-style idempotency key for a write request.
 * Prefers crypto.randomUUID (modern browsers); falls back to a v4-shaped
 * Math.random hex string for the few environments where it's missing.
 * One call → one key → one logical user-initiated submission.
 */
function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback: RFC4122 v4-shaped string (good enough for dedup)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Function to extract state code from filename
function getStateFromFilename(filename) {
    const match = filename.match(/state_([a-z]{2})\.json$/);
    return match ? match[1].toUpperCase() : null;
}

// Function to load all coffee shops from API
async function loadAllCoffeeShops() {
    try {
        // Fetch states from API
        const statesData = await api.get('/states');

        // Extract state codes (handle both shape `state_code` (new API) and
        // `state` (legacy)).
        (statesData || []).forEach(entry => {
            const code = entry?.state_code || entry?.state;
            if (code) states.add(code);
        });

        // Populate state dropdowns
        const stateDropdowns = document.querySelectorAll('#shop-state, #update-state');
        stateDropdowns.forEach(dropdown => {
            Array.from(states).sort().forEach(stateCode => {
                const option = document.createElement('option');
                option.value = stateCode;
                option.textContent = stateName(stateCode);
                dropdown.appendChild(option);
            });
        });
    } catch (error) {
        console.error('Error loading coffee shops:', error);
    }
}

// Function to handle tab switching
function switchTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Deactivate all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Activate selected tab and content
    document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`${tabId}-tab`).classList.add('active');

    // Reset forms when switching tabs
    resetForm('add-form');
    resetForm('update-form');
    document.getElementById('search-results').textContent = '';
    document.getElementById('search-shop').value = '';
}

// Function to reset a form
function resetForm(formId) {
    const form = document.getElementById(formId);
    form.reset();

    if (formId === 'update-form') {
        form.style.display = 'none';
        document.getElementById('search-results').textContent = '';
        document.getElementById('search-shop').value = '';
    }
}

// Function to create a search result item element
function createSearchItem(shop) {
    const div = document.createElement('div');
    div.className = 'search-item';
    div.setAttribute('data-id', shop.id || '');
    div.setAttribute('data-state', shop.state);

    const h3 = document.createElement('h3');
    h3.textContent = shop.displayName.text;
    div.appendChild(h3);

    const p = document.createElement('p');
    p.textContent = shop.formattedAddress;
    div.appendChild(p);

    return div;
}

// Function to search for coffee shops
function searchCoffeeShops() {
    const searchTerm = document.getElementById('search-shop').value.toLowerCase();
    const searchResults = document.getElementById('search-results');

    if (!searchTerm) {
        searchResults.textContent = '';
        return;
    }

    const filteredShops = allCoffeeShops.filter(shop =>
        shop.displayName.text.toLowerCase().includes(searchTerm)
    );

    // Clear existing results
    searchResults.textContent = '';

    if (filteredShops.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'search-item';
        noResults.textContent = 'No coffee shops found';
        searchResults.appendChild(noResults);
        return;
    }

    filteredShops.forEach(shop => {
        const item = createSearchItem(shop);
        item.addEventListener('click', () => {
            const shopId = item.getAttribute('data-id');
            const state = item.getAttribute('data-state');
            const shopName = item.querySelector('h3').textContent;
            const shopAddress = item.querySelector('p').textContent;

            // Find the shop in allCoffeeShops
            const foundShop = allCoffeeShops.find(s => s.displayName.text === shopName);

            if (foundShop) {
                populateUpdateForm(foundShop);
            } else {
                // If shop not found in allCoffeeShops, create a basic object
                const newShop = {
                    id: shopId,
                    displayName: { text: shopName },
                    formattedAddress: shopAddress,
                    state: state
                };
                populateUpdateForm(newShop);
            }
        });
        searchResults.appendChild(item);
    });
}

// Function to populate the update form
function populateUpdateForm(shop) {
    document.getElementById('shop-id').value = shop.id || '';
    document.getElementById('update-name').value = shop.displayName.text;
    document.getElementById('update-state').value = shop.state;

    // Parse address to get city and street
    const addressParts = shop.formattedAddress.split(',');
    if (addressParts.length >= 2) {
        const cityStateZip = addressParts[addressParts.length - 2].trim().split(' ');
        const zipCode = cityStateZip[cityStateZip.length - 1];

        document.getElementById('update-city').value = cityStateZip.slice(0, -1).join(' ');
        document.getElementById('update-zip').value = zipCode;
        document.getElementById('update-address').value = addressParts[0].trim();
    }

    // Set other fields if available
    if (shop.phoneNumber) {
        document.getElementById('update-phone').value = shop.phoneNumber;
    }

    if (shop.website) {
        document.getElementById('update-website').value = shop.website;
    }

    if (shop.priceLevel) {
        const priceInput = document.querySelector(`#update-price-${shop.priceLevel.toLowerCase().replace('price_level_', '')}`);
        if (priceInput) {
            priceInput.checked = true;
        }
    }

    if (shop.description) {
        document.getElementById('update-description').value = shop.description;
    }

    // Show the form
    document.getElementById('update-form').style.display = 'block';
}

// Function to handle form submission for adding a new coffee shop
async function handleAddSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('shop-name').value;
    const state = document.getElementById('shop-state').value;
    const city = document.getElementById('shop-city').value;
    const address = document.getElementById('shop-address').value;
    const zip = document.getElementById('shop-zip').value;
    const phone = document.getElementById('shop-phone').value;
    const website = document.getElementById('shop-website').value;
    const description = document.getElementById('shop-description').value;

    // Get selected price level
    let priceLevel = '';
    const priceRadios = document.querySelectorAll('input[name="price-level"]');
    priceRadios.forEach(radio => {
        if (radio.checked) {
            priceLevel = radio.value;
        }
    });

    // Create formatted address
    const formattedAddress = `${address}, ${city}, ${stateName(state)} ${zip}`;

    // Create new coffee shop object
    const newShop = {
        id: Date.now().toString(), // Generate a unique ID
        displayName: { text: name },
        formattedAddress: formattedAddress,
        state: state,
        phoneNumber: phone,
        website: website,
        priceLevel: priceLevel,
        description: description
    };

    try {
        // Generate a fresh idempotency key for this submit attempt. ApiClient's
        // internal retries (on 5xx / timeout / network) will reuse the same
        // key; if the user submits again after a failure, that's a NEW intent
        // and gets a NEW key. Backend candidate #7 dedups on this header.
        const idempotencyKey = generateIdempotencyKey();

        await api.post('/coffee-shops', { shop: newShop }, { idempotencyKey });

        // Show success message
        const successMessage = document.getElementById('add-success');
        successMessage.style.display = 'block';

        // Reset form
        resetForm('add-form');

        // Hide success message after 3 seconds
        setTimeout(() => {
            successMessage.style.display = 'none';
        }, 3000);
    } catch (error) {
        console.error('Error adding coffee shop:', error);
        const errorMessage = document.getElementById('add-error');
        errorMessage.textContent = (error && error.message)
            ? error.message
            : 'Error adding coffee shop. Please try again.';
        errorMessage.style.display = 'block';
    }
}

// Function to handle form submission for updating a coffee shop
async function handleUpdateSubmit(event) {
    event.preventDefault();

    const id = document.getElementById('shop-id').value;
    const name = document.getElementById('update-name').value;
    const state = document.getElementById('update-state').value;
    const city = document.getElementById('update-city').value;
    const address = document.getElementById('update-address').value;
    const zip = document.getElementById('update-zip').value;
    const phone = document.getElementById('update-phone').value;
    const website = document.getElementById('update-website').value;
    const description = document.getElementById('update-description').value;

    // Get selected price level
    let priceLevel = '';
    const priceRadios = document.querySelectorAll('input[name="update-price-level"]');
    priceRadios.forEach(radio => {
        if (radio.checked) {
            priceLevel = radio.value;
        }
    });

    // Create formatted address
    const formattedAddress = `${address}, ${city}, ${stateName(state)} ${zip}`;

    // Create updated coffee shop object
    const updatedShop = {
        id: id,
        displayName: { text: name },
        formattedAddress: formattedAddress,
        state: state,
        phoneNumber: phone,
        website: website,
        priceLevel: priceLevel,
        description: description
    };

    try {
        // Fresh idempotency key per submit attempt (see add-handler for rationale).
        const idempotencyKey = generateIdempotencyKey();

        await api.put(`/coffee-shops/${id}`, { shop: updatedShop }, { idempotencyKey });

        // Show success message
        const successMessage = document.getElementById('update-success');
        successMessage.style.display = 'block';

        // Reset form
        resetForm('update-form');

        // Hide success message after 3 seconds
        setTimeout(() => {
            successMessage.style.display = 'none';
        }, 3000);
    } catch (error) {
        console.error('Error updating coffee shop:', error);
        const errorMessage = document.getElementById('update-error');
        errorMessage.textContent = (error && error.message)
            ? error.message
            : 'Error updating coffee shop. Please try again.';
        errorMessage.style.display = 'block';
    }
}

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    // Load all coffee shops
    loadAllCoffeeShops();

    // Add tab switching functionality
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.getAttribute('data-tab'));
        });
    });

    // Add search functionality
    document.getElementById('search-shop').addEventListener('input', searchCoffeeShops);

    // Add form submission handlers
    document.getElementById('add-form').addEventListener('submit', handleAddSubmit);
    document.getElementById('update-form').addEventListener('submit', handleUpdateSubmit);
});
