/**
 * Shared renderer for org chart nodes.
 * Ensures the dashboard, editor, and export pipeline stay visually in sync.
 */
(function (global) {
    const STYLE_BLOCK_ID = 'org-node-renderer-styles';
    const NODE_STYLE_CSS = `
.org-chart-node {
    background: white;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s ease;
}

.org-chart-node.multi-person {
    background: white;
    border: 2px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    padding: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
}

.org-chart-node .node-header {
    background: linear-gradient(135deg, var(--primary-500) 0%, var(--primary-700) 100%);
    color: white;
    width: 100%;
    padding: 0 14px;
    min-height: 26px;
    height: 16%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 13px;
    border-bottom: 3px solid var(--accent-500);
    text-align: center;
    letter-spacing: 0.3px;
    box-sizing: border-box;
}

/* Department-Specific Node Header Gradients */
.org-chart-node[data-department*="engineering"] .node-header,
.org-chart-node[data-department*="product"] .node-header,
.org-chart-node[data-department*="tech"] .node-header,
.org-chart-node[data-department*="development"] .node-header {
    background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
    border-bottom-color: #60a5fa;
}

.org-chart-node[data-department*="sales"] .node-header,
.org-chart-node[data-department*="revenue"] .node-header,
.org-chart-node[data-department*="business"] .node-header {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-bottom-color: #34d399;
}

.org-chart-node[data-department*="marketing"] .node-header,
.org-chart-node[data-department*="brand"] .node-header {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    border-bottom-color: #fbbf24;
}

.org-chart-node[data-department*="operations"] .node-header,
.org-chart-node[data-department*="ops"] .node-header {
    background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
    border-bottom-color: #a78bfa;
}

.org-chart-node[data-department*="finance"] .node-header,
.org-chart-node[data-department*="accounting"] .node-header {
    background: linear-gradient(135deg, #06b6d4 0%, #0e7490 100%);
    border-bottom-color: #22d3ee;
}

.org-chart-node[data-department*="hr"] .node-header,
.org-chart-node[data-department*="people"] .node-header,
.org-chart-node[data-department*="human"] .node-header {
    background: linear-gradient(135deg, #ec4899 0%, #be185d 100%);
    border-bottom-color: #f472b6;
}

.org-chart-node .node-body {
    padding: 12px;
    background: white;
}

.org-chart-node .role-section {
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #f0f0f0;
}

.org-chart-node .role-section:last-child {
    margin-bottom: 0;
    border-bottom: none;
    padding-bottom: 0;
}

.org-chart-node .role-title {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 6px;
    font-weight: 500;
    text-align: center;
}

.org-chart-node .people-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.org-chart-node .person-row {
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
}

.org-chart-node .person-name {
    font-weight: 700;
    font-size: 12.5px;
    color: #000;
    line-height: 1.4;
    width: 100%;
}

.org-chart-node.legacy .node-name {
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 0.25rem;
    text-align: center;
}

.org-chart-node.legacy .node-title {
    font-size: 0.875rem;
    color: #64748b;
    margin-bottom: 0.25rem;
    text-align: center;
}

.org-chart-node.legacy .node-department {
    font-size: 0.75rem;
    color: #2563eb;
    font-weight: 500;
    text-align: center;
}
`;

    function ensureStylesInjected() {
        if (typeof document === 'undefined') {
            return;
        }
        if (document.getElementById(STYLE_BLOCK_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_BLOCK_ID;
        style.textContent = NODE_STYLE_CSS;
        document.head.appendChild(style);
    }

    function escapeHtml(text) {
        if (!text) return '';
        if (typeof document === 'undefined') {
            return String(text).replace(/[&<>"']/g, (char) => {
                const map = {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                };
                return map[char] || char;
            });
        }
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function calculateNodeHeight(node = {}) {
        if (!node || !Array.isArray(node.members) || node.members.length === 0) {
            return 150;
        }

        const baseHeight = 60;
        const roleHeight = node.members.length * 20;
        const totalPeople = node.members.reduce((sum, role) =>
            sum + (role.entries?.length || 0), 0
        );
        const peopleHeight = totalPeople * 22;
        return Math.max(baseHeight + roleHeight + peopleHeight, 100);
    }

    function renderNodeContent(d, options = {}) {
        const node = d.data || d;
        const width = typeof d.width === 'number' ? d.width : (options.defaultWidth || 250);
        const height = typeof d.height === 'number' ? d.height : (options.defaultHeight || 150);
        const hasMembers = node.members && node.members.length > 0;

        if (hasMembers) {
            let rolesHTML = '';

            node.members.forEach(roleGroup => {
                const roleTitle = roleGroup.roleLabel ? escapeHtml(roleGroup.roleLabel) : '';
                const people = roleGroup.entries || [];

                // Skip empty names, render non-empty names
                const peopleHTML = people
                    .filter(person => person.name && person.name.trim())
                    .map(person => {
                        const escapedName = escapeHtml(person.name);
                        return `
                        <div class="person-row">
                            <div class="person-name">${escapedName}</div>
                        </div>
                    `;
                    }).join('');

                // Only render role-title div if title is non-empty
                const roleTitleHTML = roleTitle ? `<div class="role-title">${roleTitle}</div>` : '';

                rolesHTML += `
                    <div class="role-section">
                        ${roleTitleHTML}
                        <div class="people-list">${peopleHTML}</div>
                    </div>
                `;
            });

            // Use measured height if available (from export two-pass layout), otherwise estimate
            const effectiveHeight = node.__measuredHeight || height || calculateNodeHeight(node);
            const department = node.meta?.department || node.department || '';
            const headerText = department ? escapeHtml(department) : '';
            const departmentLower = department.toLowerCase();

            // Use fixed height when measured to ensure layout alignment
            const heightStyle = node.__measuredHeight
                ? `height: ${effectiveHeight}px;`
                : `min-height: ${effectiveHeight}px; height: auto;`;

            return `
                <div class="org-chart-node multi-person" data-department="${escapeHtml(departmentLower)}" style="width: ${width}px; ${heightStyle}">
                    <div class="node-header">${headerText}</div>
                    <div class="node-body">${rolesHTML}</div>
                </div>
            `;
        }

        const escapedName = node.name ? escapeHtml(node.name) : '';
        const escapedTitle = node.title ? escapeHtml(node.title) : '';
        const escapedDept = node.department ? escapeHtml(node.department) : '';

        return `
            <div class="org-chart-node legacy" style="width: ${width}px; height: ${height}px; display: flex; flex-direction: column; justify-content: center;">
                <div class="node-name">${escapedName}</div>
                <div class="node-title">${escapedTitle}</div>
                ${escapedDept ? `<div class="node-department">${escapedDept}</div>` : ''}
            </div>
        `;
    }

    const OrgNodeRenderer = {
        ensureStylesInjected,
        getNodeStyles: () => NODE_STYLE_CSS,
        calculateNodeHeight,
        renderNodeContent,
        escapeHtml
    };

    ensureStylesInjected();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OrgNodeRenderer;
    }
    global.OrgNodeRenderer = OrgNodeRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
