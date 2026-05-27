// ─────────────────────────────────────────────
//  MeetLingo — app.js
//  Page-level logic: language/volume persistence,
//  meeting timer, translation lifecycle
// ─────────────────────────────────────────────

// ── Detect current page ───────────────────────
const PAGE = location.pathname.split('/').pop() || 'index.html';

// ════════════════════════════════════════════
//  PREFERENCES PAGE
// ════════════════════════════════════════════
if (PAGE === 'preferences.html') {

    // Restore saved language selection on page load
    const savedLang = localStorage.getItem('meetlingo_lang') || 'Spanish';
    const savedCard = document.querySelector(`.lang-card[data-lang="${savedLang}"]`);
    if (savedCard) {
        // Simulate a click so the card highlights correctly
        // (navigation.js already added the click handler; we just trigger it)
        savedCard.click();
    }

    // Restore volume slider
    const savedVol = localStorage.getItem('meetlingo_volume') || '75';
    const slider   = document.getElementById('volume-slider');
    const display  = document.getElementById('volume-display');
    if (slider) {
        slider.value      = savedVol;
        if (display) display.textContent = savedVol + '%';
    }
}

// ════════════════════════════════════════════
//  MEETING PAGE
// ════════════════════════════════════════════
if (PAGE === 'meeting.html') {

    // ── Apply saved volume ──────────────────
    const savedVol = parseInt(localStorage.getItem('meetlingo_volume') || '75', 10);
    if (window.AudioManager) {
        window.AudioManager.setVolume(savedVol);
    }

    // Timer is handled by the inline script in meeting.html (count-up via rAF)

    // ── Mic level indicator (optional visual pulse) ──
    // Polls getMicLevel() and applies a subtle opacity pulse
    // to the translating indicator to reflect live audio.
    function pollMicLevel() {
        if (!window.AudioManager) return;
        const level    = window.AudioManager.getMicLevel();
        const indicator = document.getElementById('translating-indicator');
        if (indicator) {
            // Scale opacity between 0.5 and 1 based on mic level
            indicator.style.opacity = 0.5 + (level / 100) * 0.5;
        }
        requestAnimationFrame(pollMicLevel);
    }

    // ── Start translation on page load ──────
    // Small delay so AudioContext isn't created before a user gesture.
    // We attach it to the first click/touch on the page.
    let translationStarted = false;
    function initTranslation() {
        if (translationStarted) return;
        translationStarted = true;
        document.removeEventListener('click',     initTranslation);
        document.removeEventListener('touchstart', initTranslation);

        if (window.TranslationManager) {
            window.TranslationManager.startTranslation();
            pollMicLevel();
        }
    }

    document.addEventListener('click',      initTranslation);
    document.addEventListener('touchstart', initTranslation);

    // ── Leave button → stop translation then navigate ──
    // The Leave button's click handler in navigation.js fires AFTER
    // this one because we bind first; we hook in here to call stop.
    const leaveBtn = document.getElementById('leave-btn');
    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            if (window.TranslationManager) {
                window.TranslationManager.stopTranslation();
            }
            // Navigation to ended.html is handled by navigation.js
        }, true); // capture phase — fires before bubble
    }

    // ── Mute toggle ─────────────────────────
    let muted = false;
    const muteBtn = document.querySelector('[data-mute]') ||
                    document.querySelector('button:has([data-icon="mic"])');

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            muted = !muted;
            const icon = muteBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = muted ? 'mic_off' : 'mic';
            muteBtn.style.color = muted ? '#FF4444' : '';
            // When muted, set volume to 0 on the upstream; unmute restores
            if (window.AudioManager) {
                window.AudioManager.setVolume(muted ? 0 : savedVol);
            }
        });
    }
}

// ════════════════════════════════════════════
//  HOST PAGE
// ════════════════════════════════════════════
if (PAGE === 'host.html') {

    // ── Guest counter (demo simulation) ─────
    const guestCountEl = document.getElementById('guest-count');
    const langCounts   = {
        es: document.getElementById('lang-es-count'),
        fr: document.getElementById('lang-fr-count'),
        de: document.getElementById('lang-de-count'),
        en: document.getElementById('lang-en-count'),
    };

    function updateGuests(total, es, fr, de, en) {
        if (guestCountEl) {
            guestCountEl.classList.add('count-pop');
            guestCountEl.textContent = total;
            setTimeout(() => guestCountEl.classList.remove('count-pop'), 400);
        }
        if (langCounts.es) langCounts.es.textContent = es;
        if (langCounts.fr) langCounts.fr.textContent = fr;
        if (langCounts.de) langCounts.de.textContent = de;
        if (langCounts.en) langCounts.en.textContent = en;
    }

    // Called from host.html when session is confirmed to start
    window.startHostSession = function() {
        setTimeout(() => updateGuests(3, 2, 0, 1, 0), 1200);
        setTimeout(() => updateGuests(5, 2, 1, 1, 1), 3000);
    };

    // NOTE: Duration timer is handled entirely by the inline script in host.html
    // to avoid double-ticking. Do NOT start a setInterval here.
}
