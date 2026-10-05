// Sliding selection indicator for the mobile nav bar, ported from the
// reference uirevamp navigation-indicator.js. Adds .ui-selection-indicator to
// the bar and moves it under the active item, animating the travel.
window.createNavigationIndicator = (bar, enabled) => {
    if (!bar) return { select() {}, reset() {} };
    const items = [...bar.querySelectorAll('[data-nav-key]')];
    const pageItem = items.find(item => item.classList.contains('btn-primary'));
    const indicator = document.createElement('span');
    indicator.className = 'ui-selection-indicator site-mobile-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.hidden = true;
    bar.prepend(indicator);

    items.forEach(item => {
        item.classList.remove('btn-primary', 'btn-ghost');
        item.classList.add('btn-selection');
    });

    let selected = pageItem;

    function select(item, animate = true, origin) {
        const previousLeft = !indicator.hidden ? indicator.getBoundingClientRect().left : null;
        selected = item;
        items.forEach(link => { link.dataset.selected = String(link === item); });
        // `item.offsetWidth` also covers auth-gated tabs: the shell hides
        // [data-needs-auth] for signed-out visitors, so the page's own tab can be
        // display:none and there is no pill to draw.
        if (!item || !enabled.matches || !bar.offsetWidth || !item.offsetWidth) {
            BloxVerseMotion.cancel(indicator);
            indicator.hidden = true;
            return;
        }
        const target = item.getBoundingClientRect();
        const start = origin?.getBoundingClientRect().left ?? previousLeft ?? target.left;
        indicator.style.width = `${item.offsetWidth}px`;
        indicator.style.height = `${item.offsetHeight}px`;
        indicator.style.translate = `${item.offsetLeft}px ${item.offsetTop}px`;
        indicator.hidden = false;
        if (animate && Math.abs(start - target.left) > 1) {
            BloxVerseMotion.animate(indicator, [
                { transform: `translateX(${start - target.left}px)` },
                { transform: 'translateX(0)' },
            ]);
        } else {
            BloxVerseMotion.cancel(indicator);
        }
    }

    // Coming back via bfcache / back-forward should restore the previous item
    // and animate from it, so the indicator appears to travel.
    function restore(fromHistory = false) {
        let previous;
        try { previous = JSON.parse(sessionStorage.getItem('bv-mobile-selection')); } catch { /* ignore */ }
        const returning = fromHistory || performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
        const origin = previous?.url !== location.href && (returning || previous?.url === document.referrer)
            ? items.find(item => item.dataset.navKey === previous?.key)
            : null;
        select(fromHistory ? selected : pageItem, !!origin, origin);
    }

    window.addEventListener('pagehide', () => {
        if (!enabled.matches || !selected) return;
        try {
            sessionStorage.setItem('bv-mobile-selection', JSON.stringify({
                key: selected.dataset.navKey,
                url: location.href,
            }));
        } catch { /* storage blocked */ }
    });

    window.addEventListener('pageshow', event => { if (event.persisted) restore(true); });

    let width = bar.offsetWidth;
    const observer = new ResizeObserver(() => {
        if (bar.offsetWidth === width) return;
        width = bar.offsetWidth;
        select(selected, false);
    });
    observer.observe(bar);
    // Signing out hides [data-needs-auth] tabs, which reflows the grid without
    // resizing the bar itself, so watch the items too. A hidden item reports a
    // zero box and select() withdraws the pill.
    if (typeof ResizeObserver === 'function') {
        const itemObserver = new ResizeObserver(() => select(selected, false));
        items.forEach(item => itemObserver.observe(item));
    }

    restore();
    return { select, reset: () => select(pageItem) };
};
