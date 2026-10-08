/**
 * LiteDoc - Sponsor slot (EthicalAds, hosted site only)
 *
 * EthicalAds sets no cookies and builds no profile; ads are picked from the page topic.
 * Loaded at runtime on purpose: build.py inlines any static remote <script>, and the
 * same index.html ships in the CLI and the downloadable release, which must stay ad-free.
 */
(function () {
    const EA_PUBLISHER = 'litedoc'; // publisher ID from the EthicalAds dashboard

    const host = location.hostname;
    if (host !== 'litedoc.xyz' && !host.endsWith('.litedoc.xyz')) return;
    if (navigator.webdriver) return; // headless runs (CLI, tests) never load ads

    const slot = document.getElementById('ld-ad');
    if (!slot) return;

    const ad = document.createElement('div');
    ad.setAttribute('data-ea-publisher', EA_PUBLISHER);
    ad.setAttribute('data-ea-type', 'image');
    ad.className = 'horizontal flat';
    slot.appendChild(ad);
    slot.classList.remove('hidden');

    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://media.ethicalads.io/media/client/ethicalads.min.js';
    document.body.appendChild(s);
})();
