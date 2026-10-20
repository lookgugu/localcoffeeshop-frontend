/**
 * Roaster-subscription interest list: the inline form (homepage, /roasters/)
 * and the confirm / unsubscribe pages (/waitlist/confirm/, /waitlist/unsubscribe/).
 *
 * Form: client checks (email present + plausible, consent ticked), then one
 * POST /waitlist/subscribe. A 202 `pending_confirmation` means the REQUEST
 * was accepted. It does not mean an email was sent: the backend answers the
 * same 202 for honeypot, suppressed and globally-unsubscribed addresses and
 * sends nothing (anti-enumeration), so the copy never promises delivery and
 * the person is NOT described as signed up. Analytics records
 * attempt / request_accepted / error only, never the address. The actual
 * provider hand-off is the backend's waitlist_confirmation_sent log.
 *
 * Confirm / unsubscribe pages: the token comes from the URL fragment, which
 * url-privacy.js has already removed from the address bar before analytics
 * loaded. Opening the page does nothing; only pressing the button POSTs.
 * `waitlist_confirmed` is tracked once, only when the backend answers
 * status `confirmed` WITH conversion `observed_new` (this request saw no
 * membership and its add succeeded). `confirmed`+`ambiguous`, replays
 * (`already_confirmed`), `suppressed` and anything else are not counted.
 * Even `observed_new` is best-effort: the provider has no conditional add,
 * so two API instances racing on one token could both observe it.
 *
 * UMD like the other public scripts: the browser initialises itself; tests
 * import initForm / initConfirmPage / initUnsubscribePage.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.LcsWaitlist = factory();
        root.LcsWaitlist.autoInit(root);
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var REQUEST_TIMEOUT_MS = 15000;
    var EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,63}$/;
    var TOKEN_RE = /^[A-Za-z0-9._-]{1,1024}$/;

    var FIELD_MESSAGES = {
        email_required: 'Enter your email address.',
        email_invalid: 'Enter a valid email address, like name@example.com.',
        consent_required: "Tick the box to agree to emails about this, or we can't add you."
    };

    var FORM_ERRORS = {
        validation: 'Please fix the highlighted fields.',
        rate_limited: 'Too many attempts. Please wait a while and try again.',
        unavailable: "The interest list isn't open yet. Please try again later.",
        provider: "We couldn't send the confirmation email just now. Please try again in a few minutes.",
        network: "We couldn't reach our server. Check your connection and try again.",
        unknown: 'Something went wrong. Please try again.'
    };

    function apiBase(win) {
        var base = (win && win.APP_CONFIG && win.APP_CONFIG.API_BASE_URL) || '/api/v1';
        return String(base).replace(/\/+$/, '');
    }

    function track(analytics, name, params) {
        try {
            if (analytics && typeof analytics.track === 'function') analytics.track(name, params);
        } catch (e) { /* analytics must never break the form */ }
    }

    /** POST JSON; resolves { status, body } or rejects with { kind: 'network' }. */
    function postJson(fetchImpl, url, payload) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
        return Promise.resolve()
            .then(function () {
                return fetchImpl(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'omit',
                    cache: 'no-store',
                    signal: controller ? controller.signal : undefined
                });
            })
            .then(function (res) {
                return Promise.resolve(res.json()).catch(function () { return null; })
                    .then(function (body) { return { status: res.status, body: body }; });
            }, function () {
                throw { kind: 'network' };
            })
            .finally(function () { if (timer) clearTimeout(timer); });
    }

    function errorKind(status, body) {
        var code = body && body.error && body.error.code;
        if (status === 400 && code === 'VALIDATION_FAILED') return 'validation';
        if (status === 429) return 'rate_limited';
        if (status === 503 || code === 'WAITLIST_UNAVAILABLE') return 'unavailable';
        if (status === 502 || code === 'WAITLIST_PROVIDER_ERROR') return 'provider';
        return 'unknown';
    }

    // -----------------------------------------------------------------------
    // Inline form
    // -----------------------------------------------------------------------

    function initForm(form, deps) {
        if (!form || form.getAttribute('data-waitlist-ready') === 'true') return null;
        form.setAttribute('data-waitlist-ready', 'true');
        deps = deps || {};
        var source = form.getAttribute('data-source');
        var section = form.closest('.waitlist') || form.parentNode;
        var email = form.querySelector('input[name="email"]');
        var consent = form.querySelector('input[name="consent"]');
        var company = form.querySelector('input[name="company"]');
        var button = form.querySelector('.waitlist-submit');
        var status = form.querySelector('.waitlist-status');
        var alertBox = form.querySelector('.waitlist-alert');
        var success = section.querySelector('.waitlist-success');
        var fields = { email: email, consent: consent };
        var submitting = false;
        var idleLabel = button.textContent;

        function errorSlot(input) {
            var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
            return ids[0] ? form.ownerDocument.getElementById(ids[0]) : null;
        }

        function setFieldError(input, message) {
            var slot = errorSlot(input);
            if (message) {
                input.setAttribute('aria-invalid', 'true');
                if (slot) { slot.textContent = message; slot.hidden = false; }
            } else {
                input.removeAttribute('aria-invalid');
                if (slot) { slot.textContent = ''; slot.hidden = true; }
            }
        }

        function showAlert(message) {
            alertBox.textContent = message || '';
            alertBox.hidden = !message;
        }

        function setBusy(busy) {
            submitting = busy;
            button.disabled = busy;
            if (busy) {
                form.setAttribute('aria-busy', 'true');
                button.textContent = 'Sending…';
                status.textContent = 'Sending your request…';
            } else {
                form.removeAttribute('aria-busy');
                button.textContent = idleLabel;
                status.textContent = '';
            }
        }

        /** Apply [{field, code}] errors; returns the first invalid input. */
        function applyFieldErrors(list) {
            var first = null;
            ['email', 'consent'].forEach(function (name) {
                var hit = list.filter(function (e) { return e.field === name; })[0];
                setFieldError(fields[name], hit ? (FIELD_MESSAGES[hit.code] || FORM_ERRORS.validation) : null);
                if (hit && !first) first = fields[name];
            });
            return first;
        }

        function clientErrors() {
            var errors = [];
            var value = email.value.trim();
            if (!value) errors.push({ field: 'email', code: 'email_required' });
            else if (value.length > 254 || !EMAIL_RE.test(value)) errors.push({ field: 'email', code: 'email_invalid' });
            if (!consent.checked) errors.push({ field: 'consent', code: 'consent_required' });
            return errors;
        }

        function fail(kind, fieldErrors) {
            setBusy(false);
            var first = fieldErrors && fieldErrors.length ? applyFieldErrors(fieldErrors) : null;
            showAlert(FORM_ERRORS[kind] || FORM_ERRORS.unknown);
            track(deps.analytics, 'waitlist_signup_error', { waitlist_source: source, error_code: kind });
            if (first) first.focus();
        }

        function succeed() {
            setBusy(false);
            showAlert('');
            email.value = ''; // don't keep the address around in the page
            form.hidden = true;
            if (success) {
                success.hidden = false;
                success.focus();
            }
            track(deps.analytics, 'waitlist_request_accepted', { waitlist_source: source });
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (submitting) return;
            showAlert('');
            var errors = clientErrors();
            var first = applyFieldErrors(errors);
            if (first) {
                first.focus();
                return;
            }
            setBusy(true);
            track(deps.analytics, 'waitlist_signup_attempt', { waitlist_source: source });
            postJson(deps.fetch, (deps.baseUrl || '/api/v1') + '/waitlist/subscribe', {
                email: email.value.trim(),
                consent: consent.checked === true,
                source: source,
                company: company ? company.value : ''
            }).then(function (res) {
                var data = res.body && res.body.success === true ? res.body.data : null;
                if (res.status === 202 && data && data.status === 'pending_confirmation') return succeed();
                var kind = res.status >= 200 && res.status < 300 ? 'unknown' : errorKind(res.status, res.body);
                fail(kind, kind === 'validation' && res.body.error.fields);
            }, function () {
                fail('network');
            });
        });

        [email, consent].forEach(function (input) {
            input.addEventListener(input === consent ? 'change' : 'input', function () {
                if (input.getAttribute('aria-invalid') === 'true') {
                    var stillBad = clientErrors().some(function (e) { return fields[e.field] === input; });
                    if (!stillBad) setFieldError(input, null);
                }
            });
        });

        return { source: source };
    }

    // -----------------------------------------------------------------------
    // Confirm / unsubscribe pages
    // -----------------------------------------------------------------------

    /** Token handed over by url-privacy.js, else read from the fragment. */
    function pageToken(win) {
        var token = null;
        try {
            if (win.LcsUrlPrivacy && typeof win.LcsUrlPrivacy.takeToken === 'function') token = win.LcsUrlPrivacy.takeToken();
            if (!token && win.location && win.location.hash) {
                token = new URLSearchParams(win.location.hash.slice(1)).get('token');
            }
        } catch (e) {
            token = null;
        }
        return token && TOKEN_RE.test(token) ? token : null;
    }

    /** Set an element's content to text, optionally followed by a link. */
    function setMessage(el, text, link) {
        el.textContent = text;
        if (link) {
            el.appendChild(el.ownerDocument.createTextNode(' '));
            var a = el.ownerDocument.createElement('a');
            a.href = link.href;
            a.textContent = link.label;
            el.appendChild(a);
            if (link.after) el.appendChild(el.ownerDocument.createTextNode(link.after));
        }
    }

    var CONTACT = { href: '/pages/contact.html', label: 'contact us', after: '.' };
    var SIGN_UP = { href: '/#waitlist-home', label: 'Sign up again', after: ' to get a new link.' };

    var TOKEN_ERRORS = {
        WAITLIST_TOKEN_EXPIRED: { text: 'This link has expired.', link: SIGN_UP, retry: false },
        WAITLIST_TOKEN_INVALID: { text: "This link isn't valid. Please use the most recent email we sent you, or", link: { href: '/#waitlist-home', label: 'sign up again', after: '.' }, retry: false },
        VALIDATION_FAILED: { text: "This link isn't valid. Please use the most recent email we sent you, or", link: { href: '/#waitlist-home', label: 'sign up again', after: '.' }, retry: false }
    };

    function initTokenPage(doc, deps, opts) {
        var root = doc.querySelector(opts.rootSelector);
        if (!root || root.getAttribute('data-waitlist-ready') === 'true') return null;
        root.setAttribute('data-waitlist-ready', 'true');
        var button = root.querySelector('[data-action="' + opts.action + '"]');
        var status = root.querySelector('[data-status]');
        var alertBox = root.querySelector('[data-alert]');
        var token = deps.token;
        var busy = false;
        var idleLabel = button.textContent;

        // A terminal result hides the button that had focus; move focus to the
        // message so keyboard and screen-reader users aren't dropped on <body>.
        function focusMessage(el) {
            el.setAttribute('tabindex', '-1');
            el.focus();
        }

        function showAlert(text, link) {
            if (!text) {
                alertBox.textContent = '';
                alertBox.hidden = true;
                return;
            }
            setMessage(alertBox, text, link);
            alertBox.hidden = false;
        }

        if (!token) {
            button.hidden = true;
            showAlert('This link is incomplete. Please open the full link from the email we sent you, or', CONTACT);
            return null;
        }

        button.addEventListener('click', function () {
            if (busy || !token) return;
            busy = true;
            button.disabled = true;
            button.textContent = opts.busyLabel;
            showAlert('');
            status.textContent = opts.busyStatus;
            postJson(deps.fetch, (deps.baseUrl || '/api/v1') + opts.path, { token: token }).then(function (res) {
                busy = false;
                button.textContent = idleLabel;
                var data = res.body && res.body.success === true ? res.body.data : null;
                var outcome = data && Object.prototype.hasOwnProperty.call(opts.outcomes, data.status) ? opts.outcomes[data.status] : null;
                if (res.status === 200 && outcome) {
                    token = null; // done with it
                    button.hidden = true;
                    setMessage(status, outcome.text, outcome.link);
                    focusMessage(status);
                    if (outcome.onShown) outcome.onShown(data);
                    return;
                }
                status.textContent = '';
                var code = res.body && res.body.error && res.body.error.code;
                var tokenError = TOKEN_ERRORS[code];
                if (tokenError) {
                    token = null;
                    button.hidden = true;
                    showAlert(tokenError.text, tokenError.link);
                    focusMessage(alertBox);
                    return;
                }
                button.disabled = false;
                var kind = errorKind(res.status, res.body);
                showAlert(kind === 'rate_limited' ? FORM_ERRORS.rate_limited
                    : "We couldn't complete this right now. Please try again in a few minutes.");
            }, function () {
                busy = false;
                button.textContent = idleLabel;
                button.disabled = false;
                status.textContent = '';
                showAlert(FORM_ERRORS.network);
            });
        });
        return {};
    }

    function initConfirmPage(doc, deps) {
        return initTokenPage(doc, deps, {
            rootSelector: '[data-waitlist-confirm]',
            action: 'confirm',
            path: '/waitlist/confirm',
            busyLabel: 'Confirming…',
            busyStatus: 'Confirming…',
            outcomes: {
                confirmed: {
                    text: "You're on the interest list. We'll only email you about this subscription idea, and you can unsubscribe at any time with the link in our emails.",
                    onShown: function (data) {
                        if (data.conversion === 'observed_new') {
                            track(deps.analytics, 'waitlist_confirmed', { confirm_result: 'confirmed' });
                        }
                    }
                },
                already_confirmed: { text: "You're already on the interest list. There's nothing more to do." },
                suppressed: {
                    text: "This address unsubscribed from the roaster interest list, so we didn't add it again. If you'd like to rejoin,",
                    link: CONTACT
                },
                unsubscribed_globally: {
                    text: "This address previously unsubscribed from our emails, so we haven't added it. If you'd like to join, please",
                    link: CONTACT
                }
            }
        });
    }

    function initUnsubscribePage(doc, deps) {
        return initTokenPage(doc, deps, {
            rootSelector: '[data-waitlist-unsubscribe]',
            action: 'unsubscribe',
            path: '/waitlist/unsubscribe',
            busyLabel: 'Unsubscribing…',
            busyStatus: 'Unsubscribing…',
            outcomes: {
                unsubscribed: { text: "You're unsubscribed from the roaster-subscription interest list. We won't email you about it again." },
                not_subscribed: { text: "You weren't on the list, and we won't add this address." }
            }
        });
    }

    function autoInit(win) {
        if (typeof document === 'undefined' || !win || typeof win.fetch !== 'function') return;
        var deps = {
            fetch: win.fetch.bind(win),
            analytics: win.LcsAnalytics || null,
            baseUrl: apiBase(win)
        };
        var run = function () {
            var forms = document.querySelectorAll('[data-waitlist-form]');
            for (var i = 0; i < forms.length; i++) initForm(forms[i], deps);
            if (document.querySelector('[data-waitlist-confirm]') || document.querySelector('[data-waitlist-unsubscribe]')) {
                var pageDeps = { fetch: deps.fetch, analytics: deps.analytics, baseUrl: deps.baseUrl, token: pageToken(win) };
                initConfirmPage(document, pageDeps);
                initUnsubscribePage(document, pageDeps);
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
        else run();
    }

    return {
        FIELD_MESSAGES: FIELD_MESSAGES,
        FORM_ERRORS: FORM_ERRORS,
        apiBase: apiBase,
        pageToken: pageToken,
        initForm: initForm,
        initConfirmPage: initConfirmPage,
        initUnsubscribePage: initUnsubscribePage,
        autoInit: autoInit
    };
});
