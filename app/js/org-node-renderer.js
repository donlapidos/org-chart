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
}

.org-chart-node .node-header {
    background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%);
    color: white;
    padding: 10px 14px;
    font-weight: 600;
    font-size: 13px;
    border-bottom: 3px solid #FF6B35;
    text-align: center;
    letter-spacing: 0.3px;
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
                const roleTitle = escapeHtml(roleGroup.roleLabel || 'Team Members');
                const people = roleGroup.entries || [];

                const peopleHTML = people.map(person => {
                    const escapedName = escapeHtml(person.name || 'Unnamed');
                    return `
                        <div class="person-row">
                            <div class="person-name">${escapedName}</div>
                        </div>
                    `;
                }).join('');

                rolesHTML += `
                    <div class="role-section">
                        <div class="role-title">${roleTitle}</div>
                        <div class="people-list">${peopleHTML}</div>
                    </div>
                `;
            });

            const calculatedHeight = calculateNodeHeight(node);
            const department = node.meta?.department || node.department || '';
            const headerText = department ? escapeHtml(department) : '';

            return `
                <div class="org-chart-node multi-person" style="width: ${width}px; min-height: ${calculatedHeight}px; height: auto;">
                    <div class="node-header">${headerText}</div>
                    <div class="node-body">${rolesHTML}</div>
                </div>
            `;
        }

        const escapedName = escapeHtml(node.name || 'Unnamed');
        const escapedTitle = escapeHtml(node.title || 'No Title');
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
