// reset
function resetTool(force = false) {
    if (!force && !confirm("Reset everything and start over?")) return;

    // Explicitly revoke Blob URLs to free RAM
    window.state.processedData.forEach(d => {
        if (d.extractedImages) d.extractedImages.forEach(img => URL.revokeObjectURL(img.dataUrl));
        if (d.inlineRenders) Object.values(d.inlineRenders).forEach(url => URL.revokeObjectURL(url));
    });

    state.processedData = [];
    state.activeDataIndex = 0;
    state.pendingFiles = [];
    window.renderDropZone();

        const o = document.getElementById('output-area');
        const p = document.getElementById('processing-state');
        const d = document.getElementById('drop-zone');
        const faq = document.querySelector('.faq-section');

        o.classList.add('hidden');
        p.classList.add('hidden');
        d.classList.remove('hidden');
        d.classList.add('section-fade-in');
        if (faq) {
            faq.classList.remove('hidden');
            faq.classList.add('section-fade-in');
        }

        document.getElementById('file-input').value = '';
        const searchInput = document.getElementById('file-tree-search');
        if (searchInput) { searchInput.value = ''; window.filterFileTree(''); }
        // reset low-conf filter
        state.showLowConfidenceOnly = false;
        const lowConfBtn = document.getElementById('btn-low-conf-filter');
        if (lowConfBtn) lowConfBtn.classList.remove('low-conf-active');
        d.scrollIntoView({ behavior: 'smooth' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showProgressState(show) {
    const el = document.getElementById('processing-state');
    const output = document.getElementById('output-area');
    const dropzone = document.getElementById('drop-zone');
    const faq = document.querySelector('.faq-section');

    if (show) {
        el.classList.remove('hidden');
        el.classList.add('section-fade-in');
        
        window.litedocStartTime = Date.now();
        const etaEl = document.getElementById('processing-eta-container');
        if (etaEl) {
            etaEl.classList.add('hidden');
            document.getElementById('processing-eta').textContent = 'Estimating time...';
        }

        const term = document.getElementById('terminal');
        if (term) term.innerHTML = '';

        output.classList.add('hidden');
        dropzone.classList.add('hidden');
        if (faq) faq.classList.add('hidden');
        const ocrIndicator = document.getElementById('ocr-indicator');
        if (ocrIndicator) ocrIndicator.classList.add('hidden');
    } else {
        el.classList.add('hidden');
        if (state.processedData.length > 0) {
            output.classList.remove('hidden');
            output.classList.add('section-fade-in');
            if (faq) faq.classList.add('hidden');
        } else {
            dropzone.classList.remove('hidden');
            dropzone.classList.add('section-fade-in');
            if (faq) faq.classList.remove('hidden');
        }
    }
}

function updateProgress(pct, title, sub) {
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('processing-percentage').textContent = `${Math.round(pct * 10) / 10}%`;
    document.getElementById('processing-title').textContent = title;
    document.getElementById('processing-subtitle').textContent = sub;
    
    const etaContainer = document.getElementById('processing-eta-container');
    const etaText = document.getElementById('processing-eta');
    if (etaContainer && window.litedocStartTime && pct > 0 && pct < 100) {
        const elapsed = Date.now() - window.litedocStartTime;
        // Wait 3 seconds and at least 1% progress to get a stable reading
        if (elapsed > 3000 && pct > 1) {
            etaContainer.classList.remove('hidden');
            const remainingMs = (elapsed / pct) * (100 - pct);
            const totalSecs = Math.max(0, Math.round(remainingMs / 1000));
            const m = Math.floor(totalSecs / 60);
            const s = totalSecs % 60;
            etaText.textContent = `ETA: ${m > 0 ? m + 'm ' : ''}${s}s`;
        }
    } else if (etaContainer && pct >= 100) {
        etaContainer.classList.add('hidden');
    }
}

window.resetTool = resetTool;
window.showProgressState = showProgressState;
window.updateProgress = updateProgress;
