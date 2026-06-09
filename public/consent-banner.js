/**
 * Cookie Consent Banner
 * Compliant with Google Consent Mode v2 and GDPR/CCPA requirements
 *
 * Features:
 * - Floats in from bottom of browser
 * - Auto-hides after inactivity (can be re-shown)
 * - Integrates with Google Consent Mode v2
 * - Persists user preferences
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        STORAGE_KEY: 'cookie_consent',
        AUTO_HIDE_DELAY: 15000, // 15 seconds before auto-hide
        ANIMATION_DURATION: 500, // ms
        CONSENT_VERSION: '1.0'
    };

    // Initialize Google Consent Mode v2 with default denied state
    function initGoogleConsentMode() {
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        window.gtag = gtag;

        // If the HTML page already queued an initial consent default before
        // gtag config, do not reissue a later default here. Only fall back for
        // legacy pages that load the banner without the inline pre-gtag block.
        var hasInitialDefault = window.dataLayer.some(function (entry) {
            return entry && entry[0] === 'consent' && entry[1] === 'default';
        });
        if (!hasInitialDefault) {
            var defaultConsent;
            try {
                defaultConsent = window.LocalCoffeeShopConsent
                    ? window.LocalCoffeeShopConsent.getInitialConsentState()
                    : null;
            } catch (e) {
                defaultConsent = null;
            }
            defaultConsent = defaultConsent || {
                analytics_storage: 'denied',
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                functionality_storage: 'granted',
                security_storage: 'granted',
                wait_for_update: 500
            };
            gtag('consent', 'default', defaultConsent);
        }

        // Enable URL passthrough for better measurement without cookies
        gtag('set', 'url_passthrough', true);

        // Enable ads data redaction when consent denied
        gtag('set', 'ads_data_redaction', true);
    }

    // Update Google Consent Mode with user choices
    function updateGoogleConsent(consentState) {
        if (typeof window.gtag === 'function') {
            window.gtag('consent', 'update', consentState);
        }
    }

    // Save consent to localStorage
    function saveConsent(consentState) {
        const data = {
            version: CONFIG.CONSENT_VERSION,
            timestamp: new Date().toISOString(),
            consent: consentState
        };
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Could not save consent preferences:', e);
        }
    }

    // Load saved consent from localStorage
    function loadConsent() {
        try {
            const data = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                if (parsed.version === CONFIG.CONSENT_VERSION) {
                    if (window.LocalCoffeeShopConsent && window.LocalCoffeeShopConsent.normalizeConsentState) {
                        return window.LocalCoffeeShopConsent.normalizeConsentState(parsed.consent);
                    }
                    return parsed.consent;
                }
            }
        } catch (e) {
            console.warn('Could not load consent preferences:', e);
        }
        return null;
    }

    // Helper to create element with attributes
    function createElement(tag, attrs, children) {
        const el = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(key => {
                if (key === 'className') {
                    el.className = attrs[key];
                } else if (key === 'textContent') {
                    el.textContent = attrs[key];
                } else {
                    el.setAttribute(key, attrs[key]);
                }
            });
        }
        if (children) {
            children.forEach(child => {
                if (typeof child === 'string') {
                    el.appendChild(document.createTextNode(child));
                } else if (child) {
                    el.appendChild(child);
                }
            });
        }
        return el;
    }

    // Create a consent option (checkbox with label)
    function createConsentOption(id, title, description, checked, disabled) {
        const label = createElement('label', { className: 'consent-option' });

        const checkbox = createElement('input', {
            type: 'checkbox',
            id: id
        });
        if (checked) checkbox.checked = true;
        if (disabled) checkbox.disabled = true;

        const textSpan = createElement('span', { className: 'consent-option-text' });
        const strong = createElement('strong', { textContent: title });
        const small = createElement('small', { textContent: description });
        textSpan.appendChild(strong);
        textSpan.appendChild(small);

        label.appendChild(checkbox);
        label.appendChild(textSpan);

        return label;
    }

    // Create the consent banner HTML using DOM methods
    function createBanner() {
        const banner = createElement('div', {
            id: 'consent-banner',
            className: 'consent-banner',
            role: 'dialog',
            'aria-label': 'Cookie consent',
            'aria-modal': 'false'
        });

        // Main content container
        const content = createElement('div', { className: 'consent-banner-content' });

        // Text section
        const textSection = createElement('div', { className: 'consent-banner-text' });
        const title = createElement('h2', {
            className: 'consent-banner-title',
            textContent: 'We value your privacy'
        });
        const description = createElement('p', { className: 'consent-banner-description' });
        description.appendChild(document.createTextNode(
            'We use cookies to enhance your browsing experience, analyze site traffic, and personalize content. ' +
            'By clicking "Accept All", you consent to our use of cookies. '
        ));
        const learnMoreLink = createElement('a', {
            href: '/pages/privacy.html',
            className: 'consent-link',
            textContent: 'Learn more'
        });
        description.appendChild(learnMoreLink);

        textSection.appendChild(title);
        textSection.appendChild(description);

        // Actions section
        const actions = createElement('div', { className: 'consent-banner-actions' });

        const customizeBtn = createElement('button', {
            type: 'button',
            className: 'consent-btn consent-btn-customize',
            id: 'consent-customize',
            textContent: 'Customize'
        });

        const rejectBtn = createElement('button', {
            type: 'button',
            className: 'consent-btn consent-btn-reject',
            id: 'consent-reject',
            textContent: 'Reject All'
        });

        const acceptBtn = createElement('button', {
            type: 'button',
            className: 'consent-btn consent-btn-accept',
            id: 'consent-accept',
            textContent: 'Accept All'
        });

        actions.appendChild(customizeBtn);
        actions.appendChild(rejectBtn);
        actions.appendChild(acceptBtn);

        content.appendChild(textSection);
        content.appendChild(actions);

        // Details section (hidden by default)
        const details = createElement('div', {
            className: 'consent-banner-details',
            id: 'consent-details',
            hidden: 'hidden'
        });

        const options = createElement('div', { className: 'consent-options' });
        options.appendChild(createConsentOption(
            'consent-essential',
            'Essential Cookies',
            'Required for the website to function. Cannot be disabled.',
            true,
            true
        ));
        options.appendChild(createConsentOption(
            'consent-analytics',
            'Analytics Cookies',
            'Help us understand how visitors interact with our website.',
            false,
            false
        ));
        options.appendChild(createConsentOption(
            'consent-advertising',
            'Advertising Cookies',
            'Used to show you relevant ads and measure ad effectiveness.',
            false,
            false
        ));

        const detailsActions = createElement('div', { className: 'consent-details-actions' });
        const saveBtn = createElement('button', {
            type: 'button',
            className: 'consent-btn consent-btn-save',
            id: 'consent-save',
            textContent: 'Save Preferences'
        });
        detailsActions.appendChild(saveBtn);

        details.appendChild(options);
        details.appendChild(detailsActions);

        banner.appendChild(content);
        banner.appendChild(details);

        return banner;
    }

    // Show the banner with animation
    function showBanner(banner) {
        banner.classList.remove('consent-banner-hidden');
        banner.classList.add('consent-banner-visible');
        banner.removeAttribute('aria-hidden');

        // Focus on the banner for accessibility
        const firstButton = banner.querySelector('.consent-btn-accept');
        if (firstButton) {
            setTimeout(() => firstButton.focus(), CONFIG.ANIMATION_DURATION);
        }
    }

    // Hide the banner with animation
    function hideBanner(banner, permanent) {
        banner.classList.remove('consent-banner-visible');
        banner.classList.add('consent-banner-hidden');
        banner.setAttribute('aria-hidden', 'true');

        if (permanent) {
            setTimeout(() => {
                banner.remove();
            }, CONFIG.ANIMATION_DURATION);
        }
    }

    // Handle accept all
    function handleAcceptAll(banner) {
        const consentState = {
            analytics_storage: 'granted',
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'granted',
            functionality_storage: 'granted',
            security_storage: 'granted'
        };

        updateGoogleConsent(consentState);
        saveConsent(consentState);
        hideBanner(banner, true);

        // Dispatch event for other scripts
        window.dispatchEvent(new CustomEvent('consentUpdated', { detail: consentState }));
    }

    // Handle reject all
    function handleRejectAll(banner) {
        const consentState = {
            analytics_storage: 'denied',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            functionality_storage: 'granted',
            security_storage: 'granted'
        };

        updateGoogleConsent(consentState);
        saveConsent(consentState);
        hideBanner(banner, true);

        window.dispatchEvent(new CustomEvent('consentUpdated', { detail: consentState }));
    }

    // Handle save preferences
    function handleSavePreferences(banner) {
        const analyticsChecked = document.getElementById('consent-analytics').checked;
        const advertisingChecked = document.getElementById('consent-advertising').checked;

        const consentState = {
            analytics_storage: analyticsChecked ? 'granted' : 'denied',
            ad_storage: advertisingChecked ? 'granted' : 'denied',
            ad_user_data: advertisingChecked ? 'granted' : 'denied',
            ad_personalization: advertisingChecked ? 'granted' : 'denied',
            functionality_storage: 'granted',
            security_storage: 'granted'
        };

        updateGoogleConsent(consentState);
        saveConsent(consentState);
        hideBanner(banner, true);

        window.dispatchEvent(new CustomEvent('consentUpdated', { detail: consentState }));
    }

    // Toggle customize panel
    function toggleCustomize(banner) {
        const details = document.getElementById('consent-details');
        const isHidden = details.hasAttribute('hidden');

        if (isHidden) {
            details.removeAttribute('hidden');
            banner.classList.add('consent-banner-expanded');
        } else {
            details.setAttribute('hidden', '');
            banner.classList.remove('consent-banner-expanded');
        }
    }

    // Setup auto-hide behavior
    function setupAutoHide(banner) {
        var autoHideTimer;
        var hasInteracted = false;

        var resetTimer = function() {
            if (hasInteracted) return;

            clearTimeout(autoHideTimer);
            autoHideTimer = setTimeout(function() {
                if (!hasInteracted) {
                    hideBanner(banner, false);
                }
            }, CONFIG.AUTO_HIDE_DELAY);
        };

        var cancelAutoHide = function() {
            hasInteracted = true;
            clearTimeout(autoHideTimer);
        };

        // Start the timer
        resetTimer();

        // Cancel auto-hide on any interaction
        banner.addEventListener('mouseenter', cancelAutoHide);
        banner.addEventListener('focusin', cancelAutoHide);
        banner.addEventListener('click', cancelAutoHide);
        banner.addEventListener('touchstart', cancelAutoHide);

        // Allow re-showing the banner
        window.showConsentBanner = function() {
            hasInteracted = false;
            showBanner(banner);
            resetTimer();
        };
    }

    // Initialize the consent banner
    function init() {
        // Initialize Google Consent Mode first
        initGoogleConsentMode();

        // Check for existing consent
        var savedConsent = loadConsent();
        if (savedConsent) {
            // Apply saved consent without showing banner
            updateGoogleConsent(savedConsent);
            return;
        }

        // Create and show the banner
        var banner = createBanner();
        document.body.appendChild(banner);

        // Setup event listeners
        document.getElementById('consent-accept').addEventListener('click', function() {
            handleAcceptAll(banner);
        });
        document.getElementById('consent-reject').addEventListener('click', function() {
            handleRejectAll(banner);
        });
        document.getElementById('consent-customize').addEventListener('click', function() {
            toggleCustomize(banner);
        });
        document.getElementById('consent-save').addEventListener('click', function() {
            handleSavePreferences(banner);
        });

        // Handle escape key
        banner.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                hideBanner(banner, false);
            }
        });

        // Show banner after a short delay (allows page to render first)
        setTimeout(function() {
            showBanner(banner);
            setupAutoHide(banner);
        }, 1000);
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose API for manual control
    window.CookieConsent = {
        show: function() {
            if (typeof window.showConsentBanner === 'function') {
                window.showConsentBanner();
            }
        },
        reset: function() {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
            location.reload();
        },
        getConsent: loadConsent
    };

})();
