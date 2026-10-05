// Motion primitives ported from the reference uirevamp motion.js.
// Exposed as a global because the reference site chrome (nav indicator, dialogs,
// popups) is plain scripts, not modules.
window.BloxVerseMotion = (() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const active = new Map();
    const hints = new Map();
    const compositedProperties = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate']);
    const pendingLabels = new WeakMap();
    const token = (name, element = document.documentElement) => getComputedStyle(element).getPropertyValue(name).trim();
    const duration = (name, element) => {
        const value = token(name, element);
        return preference.matches ? 0 : (parseFloat(value) || 0) * (value.endsWith('ms') ? 1 : 1000);
    };

    function prepare(element, properties) {
        const selected = [...new Set(properties)].filter(property => compositedProperties.has(property));
        if (preference.matches || !selected.length) return () => {};
        const previous = hints.get(element);
        const hint = {
            value: previous?.value ?? element.style.getPropertyValue('will-change'),
            priority: previous?.priority ?? element.style.getPropertyPriority('will-change'),
        };
        hints.set(element, hint);
        element.style.setProperty('will-change', selected.join(', '));
        const release = () => {
            if (hints.get(element) !== hint) return;
            if (hint.value) element.style.setProperty('will-change', hint.value, hint.priority);
            else element.style.removeProperty('will-change');
            hints.delete(element);
        };
        hint.release = release;
        return release;
    }

    function cancel(element) {
        active.get(element)?.cancel();
    }

    function animate(element, frames, timing = '--motion-layout', easing = '--ease-out') {
        cancel(element);
        const milliseconds = duration(timing, element);
        if (!milliseconds || !element.animate) return Promise.resolve();
        const release = prepare(element, frames.flatMap(frame => Object.keys(frame)));
        let animation;
        try {
            animation = element.animate(frames, {
                duration: milliseconds,
                easing: token(easing, element) || 'ease-out',
            });
        } catch (error) {
            release();
            throw error;
        }
        active.set(element, animation);
        return animation.finished.catch(() => {}).finally(() => {
            release();
            if (active.get(element) === animation) active.delete(element);
        });
    }

    // Stagger-in helper: each direct child fades/slides in sequence.
    function reveal(container, selector = ':scope > *') {
        if (!container) return;
        container.querySelectorAll(selector).forEach((element, index) => {
            element.style.setProperty('--reveal-order', index);
            element.classList.add('ui-reveal');
        });
    }

    function fade(element) {
        return animate(element, [{ opacity: 0 }, { opacity: 1 }], '--motion-tab', '--ease-tab');
    }

    // FLIP: keep elements visually still while their position changes.
    function layout(elements, mutate, revealTarget) {
        if (preference.matches) { mutate(); return; }
        const targets = [...elements];
        const positions = targets.map(element => element.getBoundingClientRect().top);
        targets.forEach(element => element.getAnimations().forEach(animation => animation.cancel()));
        mutate();
        const offsets = targets.map((element, index) => positions[index] - element.getBoundingClientRect().top);
        targets.forEach((element, index) => {
            if (Math.abs(offsets[index]) > 1) {
                animate(element, [{ transform: `translateY(${offsets[index]}px)` }, { transform: 'translateY(0)' }]);
            }
        });
        const revealed = typeof revealTarget === 'function' ? revealTarget() : revealTarget;
        if (revealed) fade(revealed);
    }

    function finished(element) {
        return Promise.allSettled(element.getAnimations().map(animation => animation.finished));
    }

    // Drives the CSS [data-motion-state] open/closing animations.
    function state(element, value, activate = () => {}) {
        const release = prepare(element, ['opacity', 'scale', 'translate']);
        try {
            element.dataset.motionState = value;
            activate();
            return finished(element).finally(release);
        } catch (error) {
            release();
            throw error;
        }
    }

    function setPending(button, pending, label) {
        if (pending) {
            if (!pendingLabels.has(button)) pendingLabels.set(button, button.getAttribute('aria-label'));
            if (label) button.setAttribute('aria-label', label);
            button.dataset.loading = 'true';
            button.setAttribute('aria-busy', 'true');
        } else {
            delete button.dataset.loading;
            button.removeAttribute('aria-busy');
            if (pendingLabels.has(button)) {
                const previous = pendingLabels.get(button);
                if (previous === null) button.removeAttribute('aria-label');
                else button.setAttribute('aria-label', previous);
                pendingLabels.delete(button);
            }
        }
    }

    preference.addEventListener('change', () => {
        if (preference.matches) {
            active.forEach(animation => animation.cancel());
            active.clear();
            hints.forEach(hint => hint.release());
        }
    });

    return { animate, cancel, reveal, fade, layout, finished, state, setPending, duration, token };
})();
