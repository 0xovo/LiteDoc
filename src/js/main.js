/**
 * LiteDoc Central Orchestrator
 * Resolves load-order crashes and securely manages module mounting.
 */

// 3. Safely Mount Modules on Boot
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Boot] Mounting LiteDoc sub-modules...');

    // 0. (Service Worker registration removed for standalone HTML release)

    // Auto-inject logic removed because it conflicts with the build script bundler.
    // Core scripts are bundled inline.

    // 2. PDF.js Worker Initialization (delayed to ensure pdf.js is loaded)
    if (typeof pdfjsLib !== 'undefined') {
        // Configure comprehensive PDF.js options for maximum format support
        pdfjsLib.GlobalWorkerOptions.workerPort = null;

        // Default worker URL (build.py will patch this with a data URI)
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        }

        // If the worker is already configured (e.g. inlined as a data URI or pointing to a CDN by the build script), skip detection
        const currentSrc = pdfjsLib.GlobalWorkerOptions.workerSrc || '';
        if (currentSrc.startsWith('data:') || currentSrc.startsWith('http')) {
            console.info('[Boot] PDF.js worker already configured.');
        } else if (window.location.protocol === 'file:') {
            console.info('[Boot] Running on file:// protocol. Using CDN for PDF.js worker.');
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        } else {
            try {
                // Try local worker first, but catch the 404 to avoid console noise if possible
                // Using { method: 'HEAD' } is better than a full GET but still shows 404 in most browsers
                const res = await fetch('js/pdf.worker.min.js', { method: 'HEAD' });
                if (res.ok || res.status === 0) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';
                } else {
                    throw new Error('Local worker not found');
                }
            } catch (e) {
                console.info('[Boot] Local PDF.js worker not found or inaccessible. Falling back to CDN...');
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
            }
        }

        console.info('[Boot] PDF.js worker configured successfully.');
    }

    try {
        // Execute modular initialization if the modules define them
        if (typeof window.initUI === 'function') window.initUI();
        if (typeof window.initOCR === 'function') window.initOCR();
        if (typeof window.initAddons === 'function') window.initAddons();

        // Verify critical components loaded
        if (typeof window.executePdfConversion !== 'function' && typeof window.startConversionLogic !== 'function') {
            console.warn('[Boot] pdf-parser.js has not registered the conversion engine yet.');
        }

        // Fire and forget: Precache OCR models in the background
        if (window.__litedocOCR && typeof window.__litedocOCR.precacheModels === 'function') {
            if (!window.__litedocAddons || window.__litedocAddons.ocrEnabled()) {
                window.__litedocOCR.precacheModels();
            }
        }

        console.log('[Boot] Sequence complete.');
    } catch (error) {
        console.error('[Boot] Critical module initialization failure:', error);
        if (typeof window.showAlert === 'function') {
            window.showAlert('Initialization Error', 'A critical module failed to load. Please check the console and refresh the page.');
        }
    }

    // 4. LiteDoc Animated Loading Screen Overlay State Machine
    const overlay = document.getElementById('litedoc-loader-overlay');
    const frame = document.getElementById('litedoc-loader-frame');
    const logo = document.getElementById('loader-logo');
    const md = document.getElementById('loader-md');
    const pdf = document.getElementById('loader-pdf');
    const scanner = document.getElementById('loader-scanner');
    const mainApp = document.getElementById('main-app-content');

    if (overlay && frame) {
        if (localStorage.getItem('litedoc-disable-animation') === 'true') {
            overlay.remove();
            if (mainApp) {
                mainApp.style.opacity = '1';
                mainApp.style.transform = 'scale(1)';
                mainApp.style.position = 'static';
                mainApp.style.pointerEvents = 'auto';
            }
            return;
        }

        // Phase: 'pdf' (initial state held for 300ms)
        setTimeout(() => {
            // Phase: 'scanning' (Scanner line moves and wipes down PDF)
            if (pdf) pdf.classList.add('animate-wipe');
            if (scanner) {
                scanner.style.display = 'block';
                scanner.classList.add('animate-scan');
            }

            // After 600ms scan duration
            setTimeout(() => {
                // Phase: 'md' (Markdown icon revealed)
                if (pdf) pdf.style.opacity = '0';
                if (scanner) scanner.style.display = 'none';

                // After 400ms viewing markdown
                setTimeout(() => {
                    // Phase: 'logo' (Morph to litedoc.xyz pill)
                    frame.style.width = '12rem';
                    frame.style.height = '3rem';
                    frame.style.borderRadius = '9999px';
                    if (md) md.style.opacity = '0';
                    if (logo) {
                        logo.style.opacity = '1';
                        logo.style.transform = 'scale(1)';
                        logo.style.pointerEvents = 'auto';
                    }

                    // After 600ms viewing logo pill
                    setTimeout(() => {
                        // Phase: 'fadeText' (Text fades out before window expansion)
                        if (logo) {
                            logo.style.transition = 'opacity 200ms ease, transform 200ms ease';
                            logo.style.opacity = '0';
                            logo.style.transform = 'scale(0.95)';
                            logo.style.pointerEvents = 'none';
                        }

                        // After 200ms text fade duration
                        setTimeout(() => {
                            // Phase: 'expand' (Frame expands to screen edges, UI scales up with spring bounce)
                            overlay.style.backgroundColor = 'transparent';
                            overlay.style.pointerEvents = 'none';

                            frame.style.width = '100vw';
                            frame.style.height = '100vh';
                            frame.style.borderRadius = '0px';
                            frame.style.border = '0px solid transparent';
                            frame.style.backgroundColor = 'transparent';
                            frame.style.boxShadow = 'none';

                            if (mainApp) {
                                mainApp.classList.remove('opacity-0', 'scale-95', 'fixed', 'inset-0', 'overflow-hidden', 'pointer-events-none');
                                mainApp.classList.add('opacity-100', 'scale-100');
                                mainApp.style.opacity = '1';
                                mainApp.style.transform = 'scale(1)';
                                mainApp.style.position = 'relative';
                                mainApp.style.inset = 'auto';
                                mainApp.style.overflow = 'visible';
                                mainApp.style.pointerEvents = 'auto';
                            }

                            // After 500ms expand transition completes
                            setTimeout(() => {
                                // Phase: 'complete' (Unmount loader automatically)
                                overlay.remove();
                                if (mainApp) {
                                    mainApp.style.position = '';
                                    mainApp.style.overflow = '';
                                    mainApp.style.inset = '';
                                }
                            }, 500); // Wait for expand transition
                        }, 200); // Duration of text fade
                    }, 600); // Time to look at logo
                }, 400); // Time to look at markdown
            }, 600); // Duration of scan
        }, 300); // Initial delay
    }
});

// 4. Central Conversion Pipeline Hook for dropzone.js
window.startConversion = async function (filesToProcess) {
    if (typeof window.executePdfConversion === 'function') {
        return await window.executePdfConversion(filesToProcess);
    } else {
        console.error('[Orchestrator] PDF Parser module is missing or crashed during load.');
        if (typeof window.showAlert === 'function') {
            window.showAlert('System Error', 'The PDF Parser module failed to load. Please ensure your script tags are correct in index.html.');
        }
    }
};

// 5. Progressive Web App (PWA) Support
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
});

window.installPWA = async function() {
    if (deferredPrompt) {
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again, throw it away
        deferredPrompt = null;
    } else {
        // Fallback for iOS / Desktop without prompt
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;
        let message = "To install this app:\n\nSelect 'Install App' or 'Add to Home Screen' from your browser menu.";
        
        if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
            message = "To install on your iPhone/iPad:\n\nTap the Share button at the bottom of Safari, then select 'Add to Home Screen'.";
        } else if (/android/i.test(userAgent)) {
            message = "To install on Android:\n\nTap the browser menu (⋮), then select 'Install App' or 'Add to Home Screen'.";
        } else if (/Macintosh|Mac OS X/.test(userAgent)) {
            message = "To install on your Mac:\n\nClick the install icon in the Safari/Chrome address bar, or select 'Install App' from the browser menu.";
        } else if (/Windows/.test(userAgent)) {
            message = "To install on Windows:\n\nClick the install icon in the Chrome/Edge address bar, or select 'Install App' from the browser menu.";
        }

        if (typeof window.showAlert === 'function') {
            window.showAlert("Install App", message);
        } else {
            alert(message);
        }
    }
};

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.log('[PWA] Service worker registered.', reg.scope);
        }).catch(err => {
            console.log('[PWA] Service worker registration failed:', err);
        });
    });
}