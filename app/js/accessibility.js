/**
 * Accessibility JavaScript Enhancements
 * Keyboard navigation detection, focus management, and modal handling
 */

class AccessibilityManager {
    constructor() {
        this.isKeyboardUser = false;
        this.focusTrapStack = [];
        this.init();
    }

    init() {
        this.setupKeyboardDetection();
        this.setupModalHandling();
        this.setupEscapeKeyHandling();
        this.makeCardsKeyboardAccessible();
    }

    /**
     * Detect keyboard vs mouse navigation
     * Adds 'keyboard-nav' or 'mouse-nav' class to body
     */
    setupKeyboardDetection() {
        // Initially assume mouse navigation
        document.body.classList.add('mouse-nav');

        // Detect Tab key for keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                this.isKeyboardUser = true;
                document.body.classList.remove('mouse-nav');
                document.body.classList.add('keyboard-nav');
            }
        });

        // Detect mouse click to switch back
        document.addEventListener('mousedown', () => {
            if (this.isKeyboardUser) {
                this.isKeyboardUser = false;
                document.body.classList.remove('keyboard-nav');
                document.body.classList.add('mouse-nav');
            }
        });

        // Also detect pointer events
        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') {
                this.isKeyboardUser = false;
                document.body.classList.remove('keyboard-nav');
                document.body.classList.add('mouse-nav');
            }
        });
    }

    /**
     * Setup modal focus trap and ARIA attributes
     */
    setupModalHandling() {
        // Monitor when modals open/close
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;

                    // Check if modal was opened
                    if (target.classList.contains('modal') && target.classList.contains('active')) {
                        this.trapFocusInModal(target);
                    }

                    // Check if sidebar was opened
                    if (target.classList.contains('node-editor-sidebar') && target.classList.contains('active')) {
                        this.trapFocusInElement(target);
                    }
                }
            });
        });

        // Observe all modals and sidebars
        document.querySelectorAll('.modal, .node-editor-sidebar').forEach((element) => {
            observer.observe(element, { attributes: true });
        });
    }

    /**
     * Trap focus within a modal
     * @param {HTMLElement} modal - The modal element
     */
    trapFocusInModal(modal) {
        // Store previously focused element
        const previouslyFocused = document.activeElement;

        // Find all focusable elements in modal
        const focusableElements = this.getFocusableElements(modal);

        if (focusableElements.length === 0) return;

        // Focus first element
        setTimeout(() => {
            focusableElements[0].focus();
        }, 100);

        // Create focus trap
        const handleTabKey = (e) => {
            if (e.key !== 'Tab') return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.shiftKey) {
                // Shift + Tab
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                // Tab
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        // Add event listener
        modal.addEventListener('keydown', handleTabKey);

        // Store for cleanup
        this.focusTrapStack.push({
            element: modal,
            handler: handleTabKey,
            previouslyFocused: previouslyFocused
        });

        // Hide background from screen readers
        this.setBackgroundInert(true);
    }

    /**
     * Trap focus within an element (generic)
     * @param {HTMLElement} element - The element to trap focus in
     */
    trapFocusInElement(element) {
        const previouslyFocused = document.activeElement;
        const focusableElements = this.getFocusableElements(element);

        if (focusableElements.length === 0) return;

        setTimeout(() => {
            focusableElements[0].focus();
        }, 100);

        const handleTabKey = (e) => {
            if (e.key !== 'Tab') return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        element.addEventListener('keydown', handleTabKey);

        this.focusTrapStack.push({
            element: element,
            handler: handleTabKey,
            previouslyFocused: previouslyFocused
        });
    }

    /**
     * Release focus trap and restore previous focus
     * @param {HTMLElement} element - The element to release focus from
     */
    releaseFocusTrap(element) {
        const trapIndex = this.focusTrapStack.findIndex(trap => trap.element === element);

        if (trapIndex === -1) return;

        const trap = this.focusTrapStack[trapIndex];

        // Remove event listener
        trap.element.removeEventListener('keydown', trap.handler);

        // Restore focus
        if (trap.previouslyFocused && trap.previouslyFocused.focus) {
            setTimeout(() => {
                trap.previouslyFocused.focus();
            }, 100);
        }

        // Remove from stack
        this.focusTrapStack.splice(trapIndex, 1);

        // Restore background accessibility
        if (this.focusTrapStack.length === 0) {
            this.setBackgroundInert(false);
        }
    }

    /**
     * Get all focusable elements within a container
     * @param {HTMLElement} container - The container to search
     * @returns {Array} Array of focusable elements
     */
    getFocusableElements(container) {
        const selector = [
            'a[href]',
            'button:not([disabled])',
            'textarea:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');

        return Array.from(container.querySelectorAll(selector))
            .filter(el => el.offsetParent !== null); // Only visible elements
    }

    /**
     * Make background content inert (not accessible to screen readers)
     * @param {boolean} inert - Whether to make background inert
     */
    setBackgroundInert(inert) {
        const mainContent = document.querySelector('main, .container');

        if (mainContent) {
            if (inert) {
                mainContent.setAttribute('inert', '');
                mainContent.setAttribute('aria-hidden', 'true');
            } else {
                mainContent.removeAttribute('inert');
                mainContent.removeAttribute('aria-hidden');
            }
        }
    }

    /**
     * Setup ESC key to close modals and sidebars
     */
    setupEscapeKeyHandling() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                // Check for active modal
                const activeModal = document.querySelector('.modal.active');
                if (activeModal) {
                    this.closeModal(activeModal);
                    return;
                }

                // Check for active sidebar
                const activeSidebar = document.querySelector('.node-editor-sidebar.active');
                if (activeSidebar) {
                    this.closeSidebar(activeSidebar);
                    return;
                }
            }
        });
    }

    /**
     * Close modal with proper cleanup
     * @param {HTMLElement} modal - The modal to close
     */
    closeModal(modal) {
        // Release focus trap first
        this.releaseFocusTrap(modal);

        // Close via existing app methods
        if (window.app && typeof window.app.closeModal === 'function') {
            window.app.closeModal();
        } else if (window.editor && typeof window.editor.closeSettingsModal === 'function') {
            window.editor.closeSettingsModal();
        } else {
            // Fallback: just remove active class
            modal.classList.remove('active');
        }
    }

    /**
     * Close sidebar with proper cleanup
     * @param {HTMLElement} sidebar - The sidebar to close
     */
    closeSidebar(sidebar) {
        // Release focus trap first
        this.releaseFocusTrap(sidebar);

        // Close via existing app methods
        if (window.editor && typeof window.editor.closeSidebar === 'function') {
            window.editor.closeSidebar();
        } else {
            // Fallback: just remove active class
            sidebar.classList.remove('active');
        }
    }

    /**
     * Make chart cards keyboard accessible
     */
    makeCardsKeyboardAccessible() {
        // Wait for DOM to be fully loaded
        setTimeout(() => {
            const cards = document.querySelectorAll('.chart-card');

            cards.forEach(card => {
                // Make card focusable
                if (!card.hasAttribute('tabindex')) {
                    card.setAttribute('tabindex', '0');
                }

                // Add keyboard activation
                card.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        card.click();
                    }
                });
            });
        }, 500);
    }

    /**
     * Announce status update to screen readers
     * @param {string} message - The message to announce
     * @param {boolean} assertive - Whether to use assertive or polite
     */
    announceStatus(message, assertive = false) {
        const regionId = assertive ? 'alertAnnouncer' : 'statusAnnouncer';
        const region = document.getElementById(regionId);

        if (region) {
            region.textContent = '';
            setTimeout(() => {
                region.textContent = message;
            }, 100);
            setTimeout(() => {
                region.textContent = '';
            }, 1000);
        }
    }

    /**
     * Add keyboard shortcut
     * @param {string} key - The key to bind
     * @param {Function} callback - The callback to execute
     * @param {Object} options - Options (ctrlKey, shiftKey, altKey)
     */
    addKeyboardShortcut(key, callback, options = {}) {
        document.addEventListener('keydown', (e) => {
            const ctrlMatch = options.ctrlKey ? (e.ctrlKey || e.metaKey) : !e.ctrlKey && !e.metaKey;
            const shiftMatch = options.shiftKey ? e.shiftKey : !e.shiftKey;
            const altMatch = options.altKey ? e.altKey : !e.altKey;

            if (e.key === key && ctrlMatch && shiftMatch && altMatch) {
                e.preventDefault();
                callback(e);
            }
        });
    }
}

// Initialize accessibility manager when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.accessibilityManager = new AccessibilityManager();
    });
} else {
    window.accessibilityManager = new AccessibilityManager();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AccessibilityManager;
}
