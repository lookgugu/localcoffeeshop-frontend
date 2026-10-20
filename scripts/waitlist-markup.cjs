/**
 * Markup for the roaster-subscription interest form — the single source of
 * truth. scripts/roasters.cjs embeds renderWaitlistSection('roasters') in the
 * generated /roasters/ page; public/html/index.html carries a verbatim copy
 * of renderWaitlistSection('home') (tests/unit/waitlist-pages.test.js fails
 * if it drifts). public/waitlist.js adds the behaviour.
 *
 * Interest only: no price, checkout, partnership or launch promise. Inline
 * (not a popup), explicit opt-in (consent box starts unchecked), labelled
 * fields with error slots wired through aria-describedby, a polite status
 * region and an assertive alert region.
 */

const SOURCES = ['home', 'roasters'];

function renderWaitlistSection(source) {
    if (!SOURCES.includes(source)) throw new Error(`unknown waitlist source: ${source}`);
    const id = (name) => `waitlist-${name}-${source}`;
    return `<section class="waitlist" id="waitlist-${source}" aria-labelledby="${id('heading')}">
            <h2 id="${id('heading')}">Interested in a monthly coffee subscription from local roasters?</h2>
            <p>We're exploring a monthly subscription featuring beans from independent local roasters. Join the interest list and we'll email you if the idea moves forward.</p>
            <p class="waitlist-fine">This is an interest list only: no payment, no order and no commitment. Price, participating roasters and timing are not decided, and it may not launch.</p>
            <form class="waitlist-form" data-waitlist-form data-source="${source}" novalidate>
                <div class="waitlist-alert" role="alert" hidden></div>
                <div class="waitlist-field">
                    <label for="${id('email')}">Email address</label>
                    <input type="email" id="${id('email')}" name="email" autocomplete="email" inputmode="email" maxlength="254" spellcheck="false" required aria-describedby="${id('email-error')}">
                    <p class="waitlist-field-error" id="${id('email-error')}" hidden></p>
                </div>
                <div class="waitlist-field waitlist-consent">
                    <input type="checkbox" id="${id('consent')}" name="consent" value="yes" required aria-describedby="${id('consent-error')}">
                    <label for="${id('consent')}">Email me about this subscription idea. I can unsubscribe at any time.</label>
                    <p class="waitlist-field-error" id="${id('consent-error')}" hidden></p>
                </div>
                <div class="waitlist-hp" aria-hidden="true">
                    <label for="${id('company')}">Company (leave this blank)</label>
                    <input type="text" id="${id('company')}" name="company" tabindex="-1" autocomplete="off">
                </div>
                <button type="submit" class="waitlist-submit">Join the interest list</button>
                <p class="waitlist-status" role="status" aria-live="polite"></p>
            </form>
            <div class="waitlist-success" tabindex="-1" hidden>
                <h3>Check your inbox</h3>
                <p>If the address you entered can join, a confirmation link is on its way. You're not on the list until you open that email and press "Confirm my interest". The link expires in 48 hours.</p>
                <p>No email after a few minutes? Check your spam folder, or try again later.</p>
            </div>
            <p class="waitlist-privacy">We'll send one email asking you to confirm, and you're not on the list until you do. We use your address only for this, through our email provider, Resend. <a href="/pages/privacy.html#waitlist">How we handle it</a> · <a href="/pages/contact.html">Questions or support</a></p>
        </section>`;
}

module.exports = { renderWaitlistSection, SOURCES };
