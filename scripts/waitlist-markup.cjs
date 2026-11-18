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

// The roaster count in the copy comes from the data, so it can't go stale:
// when data/roasters.json changes, the homepage copy test fails until the
// homepage is regenerated.
const ROASTER_COUNT = require('../data/roasters.json').roasters.length;

// Approved copy: campaigns/subscription-interest/interest-form.md
// (home = variant A, roasters = variant C). The section-specific lines are
// here; everything else is shared.
const COPY = {
    home: {
        heading: 'A coffee subscription from your local roasters. Want one?',
        intro: `<p>The big coffee clubs pick beans from roasters across the country, or around the world. We're exploring a monthly box from independent roasters close to home, and we're asking before we build anything.</p>
            <p class="waitlist-link"><a href="/roasters/">See the ${ROASTER_COUNT} New England roasters we've checked so far &rarr;</a></p>`,
        fine: 'Interest list only: no payment, no order, no commitment. Price, roasters and timing are not decided yet, and it may not launch.',
        afterSuccess: `<p class="waitlist-link">While you wait: <a href="/roasters/">browse the ${ROASTER_COUNT} roasters &rarr;</a></p>`,
    },
    roasters: {
        heading: 'Want a monthly box from roasters like these?',
        intro: `<p>These ${ROASTER_COUNT} roasters, from Portland to Providence, all sell beans on their own websites, and we've checked each one against it. We're exploring a subscription that brings independent local roasters together in one monthly box.</p>`,
        fine: 'Interest list only: no payment, no order, no commitment. Which roasters would take part is not decided, and it may not launch.',
        afterSuccess: '',
    },
};

function renderWaitlistSection(source) {
    if (!SOURCES.includes(source)) throw new Error(`unknown waitlist source: ${source}`);
    const id = (name) => `waitlist-${name}-${source}`;
    const copy = COPY[source];
    return `<section class="waitlist" id="waitlist-${source}" aria-labelledby="${id('heading')}">
            <h2 id="${id('heading')}">${copy.heading}</h2>
            ${copy.intro}
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
                <button type="submit" class="waitlist-submit">Email me if it happens</button>
                <p class="waitlist-fine">${copy.fine}</p>
                <p class="waitlist-status" role="status" aria-live="polite"></p>
            </form>
            <div class="waitlist-success" tabindex="-1" hidden>
                <h3>Check your inbox</h3>
                <p>If the address you entered can join, a confirmation link is on its way. You're not on the list until you open that email and press "Confirm my interest". The link expires in 48 hours.</p>
                <p>No email after a few minutes? Check your spam folder, or try again later.</p>${copy.afterSuccess ? `
                ${copy.afterSuccess}` : ''}
            </div>
            <p class="waitlist-privacy">We'll send one email asking you to confirm, and you're not on the list until you do. We use your address only for this, through our email provider, Resend. <a href="/pages/privacy.html#waitlist">How we handle it</a> · <a href="/pages/contact.html">Questions or support</a></p>
        </section>`;
}

module.exports = { renderWaitlistSection, SOURCES };
