// API Configuration - uses relative URL to work in any environment
const API_BASE_URL = window.location.origin.includes('localhost')
    ? 'http://localhost:3000/api'
    : '/api';

let allCoffeeShops = [];
let states = new Set();

// Function to get state name from code
function getStateName(stateCode) {
    const stateNames = {
        'AK': 'Alaska', 'AL': 'Alabama', 'AR': 'Arkansas', 'AZ': 'Arizona',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'IA': 'Iowa',
        'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'MA': 'Massachusetts', 'MD': 'Maryland',
        'ME': 'Maine', 'MI': 'Michigan', 'MN': 'Minnesota', 'MO': 'Missouri',
        'MS': 'Mississippi', 'MT': 'Montana', 'NC': 'North Carolina', 'ND': 'North Dakota',
        'NE': 'Nebraska', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
        'NV': 'Nevada', 'NY': 'New York', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VA': 'Virginia', 'VT': 'Vermont', 'WA': 'Washington', 'WI': 'Wisconsin',
        'WV': 'West Virginia', 'WY': 'Wyoming'
    };
    return stateNames[stateCode] || stateCode;
}

// Function to extract state code from filename
function getStateFromFilename(filename) {
    const match = filename.match(/state_([a-z]{2})\.json$/);
    return match ? match[1].toUpperCase() : null;
}

// Function to load all coffee shops from API
async function loadAllCoffeeShops() {
    try {
        // Fetch states from API instead of JSON files
        const response = await fetch(`${API_BASE_URL}/states`);
        const statesData = await response.json();

        // Extract state codes
        statesData.forEach(state => {
            if (state.state) {
                states.add(state.state);
            }
        });

        // Populate state dropdowns
        const stateDropdowns = document.querySelectorAll('#shop-state, #update-state');
        stateDropdowns.forEach(dropdown => {
            Array.from(states).sort().forEach(stateCode => {
                const option = document.createElement('option');
                option.value = stateCode;
                option.textContent = getStateName(stateCode);
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
    const formattedAddress = `${address}, ${city}, ${getStateName(state)} ${zip}`;

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
        // Send to server
        const response = await fetch(`${API_BASE_URL}/coffee-shops`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ shop: newShop }),
        });

        const result = await response.json();

        if (result.success) {
            // Show success message
            const successMessage = document.getElementById('add-success');
            successMessage.style.display = 'block';

            // Reset form
            resetForm('add-form');

            // Hide success message after 3 seconds
            setTimeout(() => {
                successMessage.style.display = 'none';
            }, 3000);
        } else {
            // Show error message
            const errorMessage = document.getElementById('add-error');
            errorMessage.textContent = result.message;
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Error adding coffee shop:', error);
        const errorMessage = document.getElementById('add-error');
        errorMessage.textContent = 'Error adding coffee shop. Please try again.';
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
    const formattedAddress = `${address}, ${city}, ${getStateName(state)} ${zip}`;

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
        // Send to server
        const response = await fetch(`${API_BASE_URL}/coffee-shops/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ shop: updatedShop }),
        });

        const result = await response.json();

        if (result.success) {
            // Show success message
            const successMessage = document.getElementById('update-success');
            successMessage.style.display = 'block';

            // Reset form
            resetForm('update-form');

            // Hide success message after 3 seconds
            setTimeout(() => {
                successMessage.style.display = 'none';
            }, 3000);
        } else {
            // Show error message
            const errorMessage = document.getElementById('update-error');
            errorMessage.textContent = result.message;
            errorMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Error updating coffee shop:', error);
        const errorMessage = document.getElementById('update-error');
        errorMessage.textContent = 'Error updating coffee shop. Please try again.';
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
