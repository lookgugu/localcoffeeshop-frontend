// Google Analytics Configuration
// Fetches configuration from server to avoid exposing credentials in source code

// Initialize Google Analytics
(async function() {
    try {
        // Fetch configuration from server
        const response = await fetch('/api/v1/config');
        if (!response.ok) {
            console.warn('Failed to fetch analytics configuration');
            return;
        }

        const config = await response.json();
        const GA_MEASUREMENT_ID = config.gaMeasurementId;

        // Only load Google Analytics if a valid measurement ID is configured
        if (GA_MEASUREMENT_ID && GA_MEASUREMENT_ID.trim() !== '') {
            // Create and inject the Google Analytics script
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
            document.head.appendChild(script);

            // Initialize dataLayer and gtag function
            window.dataLayer = window.dataLayer || [];
            function gtag() {
                dataLayer.push(arguments);
            }

            // Make gtag available globally
            window.gtag = gtag;

            // Initialize Google Analytics
            gtag('js', new Date());
            gtag('config', GA_MEASUREMENT_ID, {
                // Optional: Add custom configuration
                'send_page_view': true,
                'anonymize_ip': true // Enable IP anonymization for privacy
            });

            console.log('Google Analytics initialized');
        } else {
            console.log('Google Analytics not initialized. Set GA_MEASUREMENT_ID environment variable to enable.');
        }
    } catch (error) {
        console.warn('Error initializing Google Analytics:', error.message);
    }
})();
