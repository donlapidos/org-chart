/**
 * Toast Notification System
 * Modern replacement for alert() and confirm() dialogs
 */

class ToastManager {
    constructor() {
        this.container = null;
        this.toasts = new Map();
        this.toastCounter = 0;
        this.init();
    }

    init() {
        // Create toast container if it doesn't exist
        if (typeof document === 'undefined') return;

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.createContainer());
        } else {
            this.createContainer();
        }
    }

    createContainer() {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.style.cssText = `
            position: fixed;
            bottom: var(--space-3, 1.5rem);
            right: var(--space-3, 1.5rem);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: var(--space-2, 1rem);
            max-width: 400px;
            pointer-events: none;
        `;
        document.body.appendChild(this.container);
    }

    /**
     * Show a toast notification
     * @param {Object} options - Toast configuration
     * @param {string} options.message - The message to display
     * @param {string} options.type - Toast type: 'success', 'error', 'warning', 'info'
     * @param {number} options.duration - Duration in ms (0 = no auto-dismiss)
     * @param {string} options.title - Optional title
     */
    showToast({ message, type = 'info', duration = 4000, title = '' }) {
        if (!this.container) this.createContainer();

        const toastId = `toast-${++this.toastCounter}`;
        const toast = this.createToastElement(toastId, message, type, title);

        this.container.appendChild(toast);
        this.toasts.set(toastId, toast);

        // Announce to screen readers via ARIA live region
        this.announceToScreenReader(message, type);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.style.animation = 'toast-slide-in 0.3s ease forwards';
        });

        // Auto-dismiss if duration > 0
        if (duration > 0) {
            setTimeout(() => this.dismissToast(toastId), duration);
        }

        return toastId;
    }

    /**
     * Announce message to screen readers via ARIA live regions
     * @param {string} message - The message to announce
     * @param {string} type - The notification type
     */
    announceToScreenReader(message, type) {
        // Use assertive for errors, polite for everything else
        const regionId = type === 'error' ? 'alertAnnouncer' : 'statusAnnouncer';
        const region = document.getElementById(regionId);

        if (region) {
            // Clear previous announcement
            region.textContent = '';

            // Wait a moment then add new announcement (ensures screen reader picks it up)
            setTimeout(() => {
                region.textContent = message;
            }, 100);

            // Clear after announcement has been made
            setTimeout(() => {
                region.textContent = '';
            }, 1000);
        }
    }

    createToastElement(id, message, type, title) {
        const toast = document.createElement('div');
        toast.id = id;
        toast.className = `toast toast-${type}`;

        // Add ARIA attributes
        const ariaRole = type === 'error' ? 'alert' : 'status';
        toast.setAttribute('role', ariaRole);
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.setAttribute('aria-atomic', 'true');

        toast.style.cssText = `
            pointer-events: auto;
            background: var(--surface, #ffffff);
            border: 1px solid var(--border-color, #e2e8f0);
            border-radius: var(--radius, 8px);
            padding: var(--space-2, 1rem) var(--space-3, 1.5rem);
            box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1));
            display: flex;
            align-items: flex-start;
            gap: var(--space-2, 1rem);
            min-width: 300px;
            max-width: 400px;
            opacity: 0;
            transform: translateX(100%);
        `;

        // Add colored left border
        const borderColors = {
            success: 'var(--success-color, #10b981)',
            error: 'var(--danger-color, #ef4444)',
            warning: 'var(--warning-color, #f59e0b)',
            info: 'var(--accent-color, #06b6d4)'
        };
        toast.style.borderLeftWidth = '4px';
        toast.style.borderLeftColor = borderColors[type] || borderColors.info;

        // Icon
        const iconSvgs = {
            success: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            error: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            warning: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            info: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };

        const iconWrapper = document.createElement('div');
        iconWrapper.style.cssText = `
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            color: ${borderColors[type]};
        `;
        iconWrapper.innerHTML = `<div class="icon-svg" style="stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;">${iconSvgs[type] || iconSvgs.info}</div>`;
        toast.appendChild(iconWrapper);

        // Content
        const content = document.createElement('div');
        content.style.cssText = 'flex: 1; min-width: 0;';

        if (title) {
            const titleEl = document.createElement('div');
            titleEl.style.cssText = `
                font-weight: var(--font-semibold, 600);
                margin-bottom: 0.25rem;
                color: var(--text-primary, #1e293b);
            `;
            titleEl.textContent = title;
            content.appendChild(titleEl);
        }

        const messageEl = document.createElement('div');
        messageEl.style.cssText = `
            font-size: var(--text-sm, 0.875rem);
            color: var(--text-secondary, #64748b);
            line-height: 1.5;
        `;
        messageEl.textContent = message;
        content.appendChild(messageEl);

        toast.appendChild(content);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            padding: 0;
            border: none;
            background: transparent;
            color: var(--text-secondary, #64748b);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: var(--radius-sm, 4px);
            transition: all 0.15s ease;
        `;
        closeBtn.innerHTML = `
            <svg class="icon-svg sm" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; width: 16px; height: 16px;">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        closeBtn.onmouseenter = () => {
            closeBtn.style.background = 'var(--background-secondary, #f8fafc)';
            closeBtn.style.color = 'var(--text-primary, #1e293b)';
        };
        closeBtn.onmouseleave = () => {
            closeBtn.style.background = 'transparent';
            closeBtn.style.color = 'var(--text-secondary, #64748b)';
        };
        closeBtn.onclick = () => this.dismissToast(id);
        toast.appendChild(closeBtn);

        return toast;
    }

    dismissToast(toastId) {
        const toast = this.toasts.get(toastId);
        if (!toast) return;

        // Slide out animation
        toast.style.animation = 'toast-slide-out 0.3s ease forwards';

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            this.toasts.delete(toastId);
        }, 300);
    }

    // Convenience methods
    success(message, title = '') {
        return this.showToast({ message, type: 'success', title, duration: 4000 });
    }

    error(message, title = '') {
        return this.showToast({ message, type: 'error', title, duration: 6000 });
    }

    warning(message, title = '') {
        return this.showToast({ message, type: 'warning', title, duration: 5000 });
    }

    info(message, title = '') {
        return this.showToast({ message, type: 'info', title, duration: 4000 });
    }

    /**
     * Show a confirmation dialog (replacement for window.confirm)
     * @param {Object} options - Confirmation options
     * @param {string} options.message - The confirmation message
     * @param {string} options.title - Optional title (default: "Confirm")
     * @param {string} options.confirmText - Confirm button text (default: "Confirm")
     * @param {string} options.cancelText - Cancel button text (default: "Cancel")
     * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
     */
    confirm({ message, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel' }) {
        return new Promise((resolve) => {
            if (!this.container) this.createContainer();

            const modalId = `confirm-${++this.toastCounter}`;
            const overlay = this.createConfirmOverlay(modalId, message, title, confirmText, cancelText, resolve);

            document.body.appendChild(overlay);

            // Trigger animation
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                const modal = overlay.querySelector('.confirm-modal');
                if (modal) {
                    modal.style.transform = 'scale(1)';
                    modal.style.opacity = '1';
                }
            });
        });
    }

    createConfirmOverlay(id, message, title, confirmText, cancelText, resolve) {
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10001;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;

        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.style.cssText = `
            background: var(--surface, #ffffff);
            border-radius: var(--radius-lg, 12px);
            padding: var(--space-4, 2rem);
            max-width: 400px;
            width: 90%;
            box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1));
            transform: scale(0.95);
            opacity: 0;
            transition: all 0.2s ease;
        `;

        const titleEl = document.createElement('h3');
        titleEl.style.cssText = `
            font-size: var(--text-xl, 1.25rem);
            font-weight: var(--font-bold, 700);
            color: var(--text-primary, #1e293b);
            margin-bottom: var(--space-2, 1rem);
        `;
        titleEl.textContent = title;
        modal.appendChild(titleEl);

        const messageEl = document.createElement('p');
        messageEl.style.cssText = `
            font-size: var(--text-base, 1rem);
            color: var(--text-secondary, #64748b);
            line-height: 1.6;
            margin-bottom: var(--space-4, 2rem);
        `;
        messageEl.textContent = message;
        modal.appendChild(messageEl);

        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display: flex; gap: var(--space-2, 1rem); justify-content: flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-outline-secondary';
        cancelBtn.textContent = cancelText;
        cancelBtn.onclick = () => {
            this.dismissConfirm(overlay);
            resolve(false);
        };
        buttonRow.appendChild(cancelBtn);

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => {
            this.dismissConfirm(overlay);
            resolve(true);
        };
        buttonRow.appendChild(confirmBtn);

        modal.appendChild(buttonRow);
        overlay.appendChild(modal);

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                this.dismissConfirm(overlay);
                resolve(false);
            }
        };

        return overlay;
    }

    dismissConfirm(overlay) {
        overlay.style.opacity = '0';
        const modal = overlay.querySelector('.confirm-modal');
        if (modal) {
            modal.style.transform = 'scale(0.95)';
            modal.style.opacity = '0';
        }

        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 200);
    }
}

// Add toast animations to document
if (typeof document !== 'undefined') {
    const styleId = 'toast-animations';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            @keyframes toast-slide-in {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes toast-slide-out {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialize global toast manager
if (typeof window !== 'undefined') {
    window.toast = new ToastManager();
}
