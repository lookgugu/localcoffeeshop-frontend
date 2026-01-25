// Function to create state cards
function createStateCards() {
    const stateGrid = document.getElementById('stateGrid');
    const fragment = document.createDocumentFragment();

    Object.entries(US_STATES).forEach(([abbr, name]) => {
        const card = document.createElement('div');
        card.className = 'state-card';

        const link = document.createElement('a');
        link.href = `state_${abbr.toLowerCase()}.html`;

        const title = document.createElement('h2');
        title.textContent = name;

        const count = document.createElement('p');
        count.textContent = 'Loading coffee shops...';

        link.appendChild(title);
        link.appendChild(count);
        card.appendChild(link);
        fragment.appendChild(card);

        // Load coffee shop count for this state
        loadStateData(abbr, count);
    });

    stateGrid.appendChild(fragment);
}

// Function to load state data
async function loadStateData(stateAbbr, countElement) {
    try {
        const response = await fetch(`/api/states/${stateAbbr}`);
        if (response.ok) {
            const shops = await response.json();
            const count = shops.length;
            countElement.textContent = `${count} coffee shops`;
        } else {
            countElement.textContent = 'No data available';
        }
    } catch (error) {
        countElement.textContent = 'Error loading data';
        console.error(`Error loading data for ${stateAbbr}:`, error);
    }
}

// Initialize the page
document.addEventListener('DOMContentLoaded', createStateCards); 