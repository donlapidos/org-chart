/**
 * Authentication Module
 *
 * Handles user authentication and session management
 * Integrates with Azure Static Web Apps authentication
 */

(async function initAuth() {
    'use strict';

    // Check if we're in local development mode
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Check if SWA CLI auth is available (port 4280 indicates SWA CLI)
    const isSWAEnvironment = window.location.port === '4280';

    // Wait for API client to be available
    if (!window.apiClient) {
        console.error('API Client not loaded');
        return;
    }

    // Check authentication status
    try {
        // In local dev WITHOUT SWA CLI, first check if we have a stored mock user
        if (isLocalDev && !isSWAEnvironment) {
            const storedMockUser = sessionStorage.getItem('mockUser');
            if (storedMockUser) {
                try {
                    const mockUser = JSON.parse(storedMockUser);
                    // Restore mock user to API client
                    window.apiClient.currentUser = mockUser;
                    window.apiClient.isAuthenticated = true;
                    window.currentUser = mockUser;
                    onAuthSuccess(mockUser);
                    return;
                } catch (e) {
                    console.error('Failed to parse stored mock user:', e);
                    sessionStorage.removeItem('mockUser');
                }
            }
        }

        const user = await window.apiClient.checkAuth();

        if (user) {
            // User is authenticated
            onAuthSuccess(user);
        } else {
            // User is not authenticated
            onAuthFailure();
        }
    } catch (error) {
        console.error('Authentication check failed:', error);
        onAuthFailure();
    }

    /**
     * Handle successful authentication
     */
    function onAuthSuccess(user) {
        console.log('User authenticated:', user.userDetails);

        // Store user info globally
        window.currentUser = user;

        // Update UI to show user info
        updateUIForAuthenticatedUser(user);

        // Update dashboard UI to remove guest banner and reload charts
        if (window.app?.updateUIForAuthState) {
            window.app.updateUIForAuthState();
        }

        // Re-render charts now that user is authenticated
        if (window.app?.renderCharts) {
            window.app.renderCharts();
        }

        // Show welcome message (only once per session)
        if (!sessionStorage.getItem('welcome_shown')) {
            if (window.toast?.success) {
                window.toast.success(`Welcome, ${user.userDetails}!`);
            } else {
                console.log(`Welcome, ${user.userDetails}!`);
            }
            sessionStorage.setItem('welcome_shown', 'true');
        }

        // Enable authenticated features
        enableAuthenticatedFeatures();
    }

    /**
     * Handle authentication failure
     */
    function onAuthFailure() {
        console.log('User not authenticated');

        // Check if SWA CLI auth is available
        const isSWAEnvironment = window.location.port === '4280';

        // In local dev WITHOUT SWA CLI, show mock auth prompt
        // In SWA environment or production, redirect to real login
        if (isLocalDev && !isSWAEnvironment) {
            showLocalDevAuthPrompt();
        } else {
            // In production or SWA CLI, redirect to login
            redirectToLogin();
        }
    }

    /**
     * Update UI elements for authenticated user
     */
    function updateUIForAuthenticatedUser(user) {
        // Add user info to header
        const headerContent = document.querySelector('.header-content');
        if (headerContent && !document.getElementById('user-info')) {
            const userInfo = document.createElement('div');
            userInfo.id = 'user-info';
            userInfo.className = 'user-info';

            const userDetails = document.createElement('div');
            userDetails.className = 'user-details';

            const userName = document.createElement('span');
            userName.className = 'user-name';
            userName.textContent = user.userDetails; // Safe: textContent auto-escapes

            const logoutBtn = document.createElement('button');
            logoutBtn.className = 'btn btn-sm btn-outline-secondary';
            logoutBtn.textContent = 'Logout';
            logoutBtn.onclick = logout;

            userDetails.appendChild(userName);
            userDetails.appendChild(logoutBtn);
            userInfo.appendChild(userDetails);
            headerContent.appendChild(userInfo);
        }

        // Add logout function to window
        window.logout = function() {
            if (confirm('Are you sure you want to log out?')) {
                // Clear mock user from sessionStorage
                sessionStorage.removeItem('mockUser');
                sessionStorage.removeItem('welcome_shown');

                // Detect environment and use appropriate logout
                if (isSWAEnvironment) {
                    // SWA CLI: use proper logout to clear SWA cookies
                    window.apiClient.logout();
                } else if (isLocalDev) {
                    // Mock-only local dev (e.g., Python server): just reload
                    window.location.reload();
                } else {
                    // Production: use proper logout
                    window.apiClient.logout();
                }
            }
        };
    }

    /**
     * Show login prompt for local development
     */
    function showLocalDevAuthPrompt() {
        // Create login banner
        const banner = document.createElement('div');
        banner.id = 'auth-banner';
        banner.className = 'auth-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        banner.innerHTML = `
            <h2 style="margin: 0 0 10px 0;">Welcome to Org Chart Creator</h2>
            <p style="margin: 0 0 15px 0;">Local Development Mode - Mock Authentication</p>
            <button
                id="mock-login-btn"
                style="
                    background: white;
                    color: #667eea;
                    border: none;
                    padding: 12px 30px;
                    border-radius: 6px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    transition: transform 0.2s;
                "
                onmouseover="this.style.transform='scale(1.05)'"
                onmouseout="this.style.transform='scale(1)'"
            >
                🔐 Continue as Test User
            </button>
            <p style="margin: 15px 0 0 0; font-size: 14px; opacity: 0.9;">
                Using mock authentication for local testing
            </p>
        `;
        document.body.prepend(banner);

        // Add mock login handler
        document.getElementById('mock-login-btn').addEventListener('click', function() {
            // Create mock user
            const mockUser = {
                userId: 'dev-user-001',
                userDetails: 'Developer User',
                identityProvider: 'aad',
                userRoles: ['authenticated']
            };

            // Set in API client
            window.apiClient.currentUser = mockUser;
            window.apiClient.isAuthenticated = true;
            window.currentUser = mockUser;

            // Persist mock user in sessionStorage so it survives page navigation
            sessionStorage.setItem('mockUser', JSON.stringify(mockUser));

            // Remove banner
            banner.remove();

            // Enable main content
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.style.opacity = '1';
                mainContent.style.pointerEvents = 'auto';
            }

            // Show success and update UI
            onAuthSuccess(mockUser);
        });

        // Disable main content
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.style.opacity = '0.3';
            mainContent.style.pointerEvents = 'none';
        }
    }

    /**
     * Redirect to login (production)
     */
    function redirectToLogin() {
        // Pass current page as redirect target to avoid login appearing in browser history
        const currentPath = window.location.pathname + window.location.search;
        window.apiClient.login(currentPath);
    }

    /**
     * Enable features that require authentication
     */
    function enableAuthenticatedFeatures() {
        // The dashboard will handle loading user's charts
        // Enable cloud save/load buttons (will be added later)
        console.log('Authenticated features enabled');
    }

})();
