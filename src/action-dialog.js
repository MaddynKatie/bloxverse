// Dialog + confirm plumbing ported from the reference uirevamp action-dialog.js.
// Adds focus trapping, escape/backdrop dismissal, the closing animation, and
// focus restoration on top of the native <dialog> element.
window.closeDialog = async dialog => {
    if (!dialog?.open || dialog.dataset.motionState === 'closing') return;
    await BloxVerseMotion.state(dialog, 'closing');
    if (dialog.open) dialog.close();
};

window.openDialog = (dialog, { initialFocus, isBusy = () => false, onClose = () => {}, removeOnClose = true } = {}) => {
    if (dialog.open) return;
    const trigger = document.activeElement;
    const events = new AbortController();
    const options = { signal: events.signal };
    const blocked = () => isBusy() || dialog.dataset.motionState === 'closing';

    dialog.classList.add('ui-dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;

    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        if (!blocked()) closeDialog(dialog);
    }, options);

    dialog.addEventListener('keydown', event => {
        if (dialog.dataset.motionState === 'closing') { event.preventDefault(); return; }
        if (event.key !== 'Tab') return;
        const controls = [...dialog.querySelectorAll('button, select, textarea, input, a[href], [tabindex], [contenteditable="true"]')]
            .filter(element => !element.disabled
                && element.tabIndex >= 0
                && !element.closest('[hidden], [inert]')
                && getComputedStyle(element).display !== 'none'
                && getComputedStyle(element).visibility !== 'hidden');
        if (isBusy() || !controls.length) { event.preventDefault(); return; }
        const first = controls[0];
        const last = controls.at(-1);
        const focused = document.activeElement;
        if (event.shiftKey && (focused === first || focused === dialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (focused === last || focused === dialog)) {
            event.preventDefault();
            first.focus();
        }
    }, options);

    // Click outside the dialog box (i.e. on the ::backdrop) closes it.
    dialog.addEventListener('click', event => {
        if (blocked() || event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
    }, options);

    dialog.addEventListener('close', () => {
        events.abort();
        delete dialog.dataset.motionState;
        if (removeOnClose) dialog.remove();
        onClose();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }, { once: true });

    if (!dialog.isConnected) document.body.appendChild(dialog);
    BloxVerseMotion.state(dialog, 'open', () => dialog.showModal());
    (initialFocus || dialog).focus();
};

// Promise-based confirm dialog used for destructive / transactional actions.
window.confirmAction = ({
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    pendingLabel = 'Working',
    intent = 'primary',
    onConfirm = async () => {},
}) => {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'action-dialog';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'action-dialog-title');
        dialog.setAttribute('aria-describedby', 'action-dialog-description');
        dialog.tabIndex = -1;

        const heading = document.createElement('h2');
        heading.id = 'action-dialog-title';
        heading.textContent = title;

        const message = document.createElement('p');
        message.id = 'action-dialog-description';
        message.className = 'ui-dialog-description action-dialog-description';
        message.textContent = description;

        const error = document.createElement('p');
        error.className = 'ui-dialog-error action-dialog-error';
        error.setAttribute('role', 'alert');
        error.hidden = true;

        const actions = document.createElement('div');
        actions.className = 'ui-dialog-actions action-dialog-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-secondary';
        cancel.textContent = cancelLabel;
        cancel.autofocus = true;

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = intent === 'danger' ? 'btn-danger' : 'btn-primary';
        confirm.textContent = confirmLabel;

        actions.append(cancel, confirm);
        dialog.append(heading, message, error, actions);

        let pending = false;
        let confirmed = false;

        cancel.addEventListener('click', () => { if (!pending) closeDialog(dialog); });

        confirm.addEventListener('click', async () => {
            if (pending) return;
            pending = true;
            error.hidden = true;
            cancel.disabled = true;
            confirm.disabled = true;
            BloxVerseMotion.setPending(confirm, true, pendingLabel);
            dialog.setAttribute('aria-busy', 'true');
            dialog.focus();
            try {
                await onConfirm();
                confirmed = true;
                await closeDialog(dialog);
            } catch (failure) {
                error.textContent = typeof failure?.message === 'string' && failure.message
                    ? failure.message
                    : 'The action could not be completed. Please try again.';
                error.hidden = false;
            } finally {
                pending = false;
                cancel.disabled = false;
                confirm.disabled = false;
                BloxVerseMotion.setPending(confirm, false);
                dialog.removeAttribute('aria-busy');
                if (dialog.open) confirm.focus();
            }
        });

        openDialog(dialog, {
            initialFocus: cancel,
            isBusy: () => pending,
            onClose: () => resolve(confirmed),
        });
    });
};
