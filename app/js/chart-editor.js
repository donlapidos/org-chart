/**
 * Chart Editor Application Logic
 * Handles chart editing, node management, and d3-org-chart integration
 */

class ChartEditor {
    constructor() {
        this.chartId = null;
        this.chart = null;
        this.chartData = null;
        this.orgChart = null;
        this.editingNodeId = null;
        this.autoSaveTimer = null;
        this.draftMembers = []; // Draft state for node editing (new or existing)

        this.init();
    }

    /**
     * Escape HTML to prevent XSS attacks
     * @param {string} text - Text to escape
     * @returns {string} Escaped text safe for HTML insertion
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Calculate node height based on content
     * @param {Object} node - Node data
     * @returns {number} Calculated height in pixels
     */
    calculateNodeHeight(node) {
        const hasMembers = node.members && node.members.length > 0;

        if (hasMembers) {
            // NEW FORMAT: Dynamic height based on roles and people
            const baseHeight = 60;
            const roleHeight = node.members.length * 20;
            const totalPeople = node.members.reduce((sum, role) =>
                sum + (role.entries?.length || 0), 0
            );
            const peopleHeight = totalPeople * 22;
            return Math.max(baseHeight + roleHeight + peopleHeight, 100);
        } else {
            // LEGACY FORMAT: Fixed height
            return 150;
        }
    }

    /**
     * Ensure hierarchy always has exactly one root and no dangling parents
     * @param {Object} options
     * @param {boolean} options.persist - whether to save fixes immediately
     */
    repairHierarchy({ persist = false } = {}) {
        if (!this.chartData || !Array.isArray(this.chartData.nodes) || this.chartData.nodes.length === 0) {
            return;
        }

        const nodes = this.chartData.nodes;
        const idToNode = new Map(nodes.map(node => [node.id, node]));
        let changed = false;

        nodes.forEach(node => {
            if (node.parentId === '') {
                node.parentId = null;
                changed = true;
            }
            if (node.parentId && (!idToNode.has(node.parentId) || node.parentId === node.id)) {
                node.parentId = null;
                changed = true;
            }
        });

        let roots = nodes.filter(node => !node.parentId);
        if (roots.length === 0) {
            nodes[0].parentId = null;
            roots = [nodes[0]];
            changed = true;
        }

        const canonicalRootId = roots[0].id;
        if (roots.length > 1) {
            roots.slice(1).forEach(node => {
                node.parentId = canonicalRootId;
                changed = true;
            });
        }

        if (changed) {
            console.warn('Org chart hierarchy contained invalid references and was automatically corrected.');
            if (persist && this.chartId) {
                const updated = storage.updateChart(this.chartId, { nodes });
                if (updated) {
                    this.chartData = updated;
                }
            }
        }
    }

    /**
     * Collect descendant ids for a node to avoid cycles
     * @param {string} nodeId
     * @returns {Set<string>}
     */
    getDescendantIds(nodeId) {
        const descendants = new Set();
        if (!nodeId || !this.chartData || !Array.isArray(this.chartData.nodes)) {
            return descendants;
        }

        const childrenMap = this.chartData.nodes.reduce((map, node) => {
            if (node.parentId) {
                if (!map[node.parentId]) {
                    map[node.parentId] = [];
                }
                map[node.parentId].push(node.id);
            }
            return map;
        }, {});

        const stack = [...(childrenMap[nodeId] || [])];
        while (stack.length) {
            const current = stack.pop();
            if (descendants.has(current)) {
                continue;
            }
            descendants.add(current);
            const kids = childrenMap[current];
            if (kids) {
                kids.forEach(childId => {
                    if (!descendants.has(childId)) {
                        stack.push(childId);
                    }
                });
            }
        }

        return descendants;
    }

    /**
     * Initialize the editor
     */
    init() {
        // Get chart ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.chartId = urlParams.get('id');

        if (!this.chartId) {
            alert('No chart ID provided');
            window.location.href = 'index.html';
            return;
        }

        // Load chart data
        this.loadChart();

        // Initialize auto-save
        this.setupAutoSave();
    }

    /**
     * Load chart from storage
     */
    loadChart() {
        this.chartData = storage.getChart(this.chartId);

        if (!this.chartData) {
            alert('Chart not found');
            window.location.href = 'index.html';
            return;
        }

        // Ensure stored hierarchy is valid (auto-heal if needed)
        this.repairHierarchy({ persist: true });

        // Update UI
        document.getElementById('chartTitle').textContent = this.chartData.chartName;
        document.title = `${this.chartData.chartName} - Chart Editor`;

        // Set layout
        if (this.chartData.layout) {
            document.getElementById('layoutSelect').value = this.chartData.layout;
        }

        // Initialize org chart
        this.initOrgChart();
    }

    /**
     * Initialize d3-org-chart
     */
    initOrgChart() {
        const self = this;

        // Transform data for d3-org-chart format
        const chartNodes = this.chartData.nodes.map(node => ({
            id: node.id,
            parentId: node.parentId || '',
            members: node.members || [],
            meta: node.meta || {},
            _expanded: true,
            // Legacy fields for backward compatibility
            name: node.name,
            title: node.title,
            department: node.department || (node.meta && node.meta.department)
        }));

        // Create org chart instance
        this.orgChart = new d3.OrgChart()
            .container('#chartCanvas')
            .data(chartNodes)
            .nodeWidth(() => 250)
            .nodeHeight((d) => {
                const node = d.data || d;
                return self.calculateNodeHeight(node);
            })
            .childrenMargin(() => 80)
            .compactMarginBetween(() => 25)
            .compactMarginPair(() => 100)
            .compact(false)
            .layout(this.chartData.layout || 'top')
            .onNodeClick((d) => {
                self.editNode(d.data.id);
            })
            .nodeContent((d) => {
                const node = d.data;

                // Check if this is a multi-person node (new format) or legacy single-person node
                const hasMembers = node.members && node.members.length > 0;

                if (hasMembers) {
                    // NEW FORMAT: Multi-person node
                    let rolesHTML = '';

                    node.members.forEach(roleGroup => {
                        const roleTitle = self.escapeHtml(roleGroup.roleLabel || 'Team Members');
                        const people = roleGroup.entries || [];

                        const peopleHTML = people.map(person => {
                            const escapedName = self.escapeHtml(person.name || 'Unnamed');

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

                    // Use shared height calculation
                    const calculatedHeight = self.calculateNodeHeight(node);

                    // Escape department/header text (leave blank if not provided)
                    const department = node.meta?.department || node.department || '';
                    const headerText = department ? self.escapeHtml(department) : '';

                    return `
                        <div class="org-chart-node multi-person" style="width: ${d.width}px; min-height: ${calculatedHeight}px; height: auto;">
                            <div class="node-header">${headerText}</div>
                            <div class="node-body">${rolesHTML}</div>
                        </div>
                    `;
                } else {
                    // LEGACY FORMAT: Single-person node (backward compatibility)
                    // Escape all legacy fields
                    const escapedName = self.escapeHtml(node.name || 'Unnamed');
                    const escapedTitle = self.escapeHtml(node.title || 'No Title');
                    const escapedDept = node.department ? self.escapeHtml(node.department) : '';

                    return `
                        <div class="org-chart-node legacy" style="width: ${d.width}px; height: ${d.height}px; display: flex; flex-direction: column; justify-content: center;">
                            <div class="node-name">${escapedName}</div>
                            <div class="node-title">${escapedTitle}</div>
                            ${escapedDept ? `<div class="node-department">${escapedDept}</div>` : ''}
                        </div>
                    `;
                }
            })
            .render();
    }

    /**
     * Setup auto-save functionality
     */
    setupAutoSave() {
        // Auto-save every 30 seconds
        this.autoSaveTimer = setInterval(() => {
            this.saveChart(false);
        }, 30000);
    }

    /**
     * Save chart to storage
     */
    saveChart(showNotification = true) {
        if (!this.chartData) return;

        // Update save status
        const saveStatus = document.getElementById('saveStatus');
        saveStatus.textContent = 'Saving...';
        saveStatus.className = 'save-status saving';

        // Get current chart data from d3-org-chart
        if (this.orgChart) {
            const currentData = this.orgChart.data();
            this.chartData.nodes = currentData.map(node => {
                // Preserve the existing node structure (already has members or migrated)
                const existingNode = this.chartData.nodes.find(n => n.id === node.id);
                if (existingNode) {
                    // Keep existing node data (members structure intact)
                    return {
                        ...existingNode,
                        parentId: node.parentId || null
                    };
                }
                // Shouldn't happen, but fallback
                return node;
            });
        }

        // Save to storage
        storage.updateChart(this.chartId, this.chartData);

        // Update save status
        setTimeout(() => {
            saveStatus.textContent = 'All changes saved';
            saveStatus.className = 'save-status saved';

            if (showNotification) {
                alert('Chart saved successfully!');
            }
        }, 300);
    }

    /**
     * Show add node sidebar
     */
    addNode() {
        this.editingNodeId = null;
        document.getElementById('sidebarTitle').textContent = 'Add Node';
        document.getElementById('nodeAction').value = 'add';
        document.getElementById('deleteNodeBtn').style.display = 'none';

        // Clear department
        document.getElementById('nodeDepartment').value = '';

        // Populate parent dropdown
        this.populateParentDropdown();

        // Initialize draft with empty members
        this.draftMembers = [];

        // Render empty role builder
        this.renderRoleBuilder(this.draftMembers);

        this.showSidebar();
    }

    /**
     * Edit existing node
     */
    editNode(nodeId) {
        const node = this.chartData.nodes.find(n => n.id === nodeId);

        if (!node) {
            alert('Node not found');
            return;
        }

        this.editingNodeId = nodeId;
        document.getElementById('sidebarTitle').textContent = 'Edit Node';
        document.getElementById('nodeAction').value = 'edit';

        // Populate parent dropdown
        this.populateParentDropdown(nodeId);
        document.getElementById('nodeParent').value = node.parentId || '';

        // Populate department
        const department = node.meta?.department || node.department || '';
        document.getElementById('nodeDepartment').value = department;

        // Copy existing members to draft (deep copy to avoid mutation)
        const members = node.members || [];
        this.draftMembers = JSON.parse(JSON.stringify(members));

        // Render role builder with draft members
        this.renderRoleBuilder(this.draftMembers);

        document.getElementById('deleteNodeBtn').style.display = 'block';

        this.showSidebar();
    }

    /**
     * Get display name for a node (for dropdowns and confirmations)
     */
    getNodeDisplayName(node) {
        // Check if new format (has members)
        if (node.members && node.members.length > 0) {
            const department = node.meta?.department || 'Unit';
            const firstRole = node.members[0];
            const firstPerson = firstRole?.entries?.[0]?.name || 'Unnamed';
            const peopleCount = node.members.reduce((sum, role) => sum + (role.entries?.length || 0), 0);

            if (peopleCount === 1) {
                return `${firstPerson} (${firstRole.roleLabel || 'Role'})`;
            } else {
                return `${department} (${peopleCount} people)`;
            }
        }

        // Legacy format
        return `${node.name || 'Unnamed'} (${node.title || 'No Title'})`;
    }

    /**
     * Populate parent dropdown
     */
    populateParentDropdown(excludeNodeId = null) {
        const select = document.getElementById('nodeParent');
        select.innerHTML = '<option value="">-- Top Level (No Manager) --</option>';

        // Get all nodes except the one being edited (to prevent circular references)
        const availableNodes = this.chartData.nodes.filter(node =>
            node.id !== excludeNodeId
        );

        availableNodes.forEach(node => {
            const option = document.createElement('option');
            option.value = node.id;
            option.textContent = this.getNodeDisplayName(node);
            select.appendChild(option);
        });
    }

    /**
     * Save node
     */
    saveNode(event) {
        event.preventDefault();

        const nodeId = this.editingNodeId || storage.generateNodeId();
        const action = document.getElementById('nodeAction').value;
        const parentSelect = document.getElementById('nodeParent');
        const parentId = parentSelect.value ? parentSelect.value : null;

        const roots = (this.chartData?.nodes || []).filter(n => n.id !== nodeId && !n.parentId);

        if (!parentId && roots.length > 0) {
            alert('Only one top-level node is allowed. Please choose a manager under "Reports To".');
            return;
        }

        if (parentId === nodeId) {
            alert('A node cannot report to itself.');
            return;
        }

        if (parentId && this.editingNodeId) {
            const descendants = this.getDescendantIds(nodeId);
            if (descendants.has(parentId)) {
                alert('You selected a descendant as the manager, which would create a cycle.');
                return;
            }
        }

        // Collect members data from the role builder
        const members = this.collectRoleBuilderData();

        if (members.length === 0) {
            alert('Please add at least one person to this node');
            return;
        }

        const nodeData = {
            id: nodeId,
            parentId: parentId,
            members: members,
            meta: {
                department: document.getElementById('nodeDepartment').value.trim(),
                notes: ''
            }
        };

        if (action === 'add') {
            // Add new node
            this.chartData.nodes.push(nodeData);
        } else {
            // Update existing node
            const index = this.chartData.nodes.findIndex(n => n.id === nodeId);
            if (index !== -1) {
                this.chartData.nodes[index] = nodeData;
            }
        }

        this.repairHierarchy({ persist: false });

        // Re-render the chart
        this.orgChart.data(this.chartData.nodes).render();

        this.saveChart(false);
        this.closeSidebar();
    }

    /**
     * Delete node
     */
    deleteNode() {
        if (!this.editingNodeId) return;

        const node = this.chartData.nodes.find(n => n.id === this.editingNodeId);
        if (!node) return;

        // Check if node has children
        const hasChildren = this.chartData.nodes.some(n => n.parentId === this.editingNodeId);

        const nodeName = this.getNodeDisplayName(node);
        let confirmMessage = `Delete "${nodeName}"?`;
        if (hasChildren) {
            confirmMessage = `"${nodeName}" has subordinates. Deleting this node will also delete all subordinates. Continue?`;
        }

        if (!confirm(confirmMessage)) {
            return;
        }

        // Remove node and all descendants
        this.removeNodeAndDescendants(this.editingNodeId);

        // Ensure hierarchy still has a valid root
        this.repairHierarchy({ persist: false });

        // Update org chart
        this.orgChart.data(this.chartData.nodes).render();

        this.saveChart(false);
        this.closeSidebar();
    }

    /**
     * Remove node and all its descendants recursively
     */
    removeNodeAndDescendants(nodeId) {
        // Find all children
        const children = this.chartData.nodes.filter(n => n.parentId === nodeId);

        // Recursively remove children
        children.forEach(child => {
            this.removeNodeAndDescendants(child.id);
        });

        // Remove the node itself
        this.chartData.nodes = this.chartData.nodes.filter(n => n.id !== nodeId);
    }

    /**
     * Show sidebar
     */
    showSidebar() {
        document.getElementById('nodeSidebar').classList.add('active');
    }

    /**
     * Close sidebar
     */
    closeSidebar() {
        document.getElementById('nodeSidebar').classList.remove('active');
        this.editingNodeId = null;
        this.draftMembers = []; // Clear draft state on cancel
    }

    /**
     * Expand all nodes
     */
    expandAll() {
        this.orgChart.expandAll();
    }

    /**
     * Collapse all nodes
     */
    collapseAll() {
        this.orgChart.collapseAll();
    }

    /**
     * Zoom in
     */
    zoomIn() {
        this.orgChart.zoomIn();
    }

    /**
     * Zoom out
     */
    zoomOut() {
        this.orgChart.zoomOut();
    }

    /**
     * Fit to screen
     */
    fitToScreen() {
        this.orgChart.fit();
    }

    /**
     * Change layout
     */
    changeLayout(layout) {
        this.chartData.layout = layout;
        this.orgChart.layout(layout).render().fit();
        this.saveChart(false);
    }

    /**
     * Export as PNG
     */
    exportPNG() {
        this.orgChart.exportImg({
            full: true,
            save: true
        });
    }

    /**
     * Export as JPEG
     */
    exportJPEG() {
        this.orgChart.exportImg({
            full: true,
            save: false,
            onLoad: (base64) => {
                // Convert PNG to JPEG
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');

                    // Fill white background for JPEG
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Draw image
                    ctx.drawImage(img, 0, 0);

                    // Convert to JPEG and download
                    canvas.toBlob((blob) => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${this.chartData.chartName || 'org-chart'}.jpg`;
                        a.click();
                        URL.revokeObjectURL(url);
                    }, 'image/jpeg', 0.95);
                };
                img.src = base64;
            }
        });
    }

    /**
     * Export as PDF
     */
    exportPDF() {
        const self = this;

        this.orgChart.exportImg({
            full: true,
            save: false,
            onLoad: (base64) => {
                const { jsPDF } = window.jspdf;
                const img = new Image();

                img.onload = function() {
                    const imgWidth = img.width;
                    const imgHeight = img.height;

                    // Calculate PDF page dimensions (A4 landscape)
                    const pdfWidth = 297; // A4 landscape width in mm
                    const pdfHeight = 210; // A4 landscape height in mm

                    // Calculate scaling
                    const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
                    const scaledWidth = imgWidth * ratio;
                    const scaledHeight = imgHeight * ratio;

                    // Center image on page
                    const x = (pdfWidth - scaledWidth) / 2;
                    const y = (pdfHeight - scaledHeight) / 2;

                    // Create PDF
                    const pdf = new jsPDF('l', 'mm', 'a4');
                    pdf.addImage(img, 'PNG', x, y, scaledWidth, scaledHeight);
                    pdf.save(`${self.chartData.chartName || 'org-chart'}.pdf`);
                };

                img.src = base64;
            }
        });
    }

    /**
     * Show chart settings modal
     */
    showChartSettings() {
        document.getElementById('settingsChartName').value = this.chartData.chartName;
        document.getElementById('settingsDepartment').value = this.chartData.departmentTag || '';
        document.getElementById('settingsDescription').value = this.chartData.description || '';
        document.getElementById('settingsModal').classList.add('active');
    }

    /**
     * Close settings modal
     */
    closeSettingsModal() {
        document.getElementById('settingsModal').classList.remove('active');
    }

    /**
     * Save chart settings
     */
    saveSettings(event) {
        event.preventDefault();

        this.chartData.chartName = document.getElementById('settingsChartName').value.trim();
        this.chartData.departmentTag = document.getElementById('settingsDepartment').value.trim();
        this.chartData.description = document.getElementById('settingsDescription').value.trim();

        document.getElementById('chartTitle').textContent = this.chartData.chartName;
        document.title = `${this.chartData.chartName} - Chart Editor`;

        this.saveChart(false);
        this.closeSettingsModal();
    }

    /**
     * Render role builder UI with current members data
     * Uses DOM APIs to prevent XSS in form fields
     */
    renderRoleBuilder(members = []) {
        const container = document.getElementById('rolesContainer');
        container.innerHTML = '';

        members.forEach((roleGroup, roleIndex) => {
            // Create role group container
            const roleDiv = document.createElement('div');
            roleDiv.className = 'role-group';

            // Create role header
            const roleHeader = document.createElement('div');
            roleHeader.className = 'role-group-header';

            // Create role label input (safe - uses .value property)
            const roleLabelInput = document.createElement('input');
            roleLabelInput.type = 'text';
            roleLabelInput.className = 'form-input role-label-input';
            roleLabelInput.placeholder = 'Role Title';
            roleLabelInput.value = roleGroup.roleLabel || ''; // Safe assignment via property
            roleLabelInput.dataset.roleIndex = roleIndex;

            // Create delete role button
            const deleteRoleBtn = document.createElement('button');
            deleteRoleBtn.type = 'button';
            deleteRoleBtn.className = 'btn btn-danger btn-sm';
            deleteRoleBtn.textContent = '✖';
            deleteRoleBtn.onclick = () => this.removeRole(roleIndex);

            roleHeader.appendChild(roleLabelInput);
            roleHeader.appendChild(deleteRoleBtn);
            roleDiv.appendChild(roleHeader);

            // Create people container
            const peopleContainer = document.createElement('div');
            peopleContainer.className = 'people-container';
            peopleContainer.id = `peopleContainer${roleIndex}`;

            // Render people in this role
            roleGroup.entries.forEach((person, personIndex) => {
                const personDiv = document.createElement('div');
                personDiv.className = 'person-entry';

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'form-input';
                nameInput.placeholder = 'Name *';
                nameInput.value = person.name || '';
                nameInput.required = true;
                nameInput.dataset.roleIndex = roleIndex;
                nameInput.dataset.personIndex = personIndex;
                nameInput.dataset.field = 'name';

                const deletePersonBtn = document.createElement('button');
                deletePersonBtn.type = 'button';
                deletePersonBtn.className = 'btn btn-danger btn-sm';
                deletePersonBtn.textContent = '✖';
                deletePersonBtn.onclick = () => this.removePerson(roleIndex, personIndex);

                personDiv.appendChild(nameInput);
                personDiv.appendChild(deletePersonBtn);

                peopleContainer.appendChild(personDiv);
            });

            roleDiv.appendChild(peopleContainer);

            // Create "Add Person" button
            const addPersonBtn = document.createElement('button');
            addPersonBtn.type = 'button';
            addPersonBtn.className = 'btn btn-secondary btn-sm';
            addPersonBtn.textContent = '+ Add Person';
            addPersonBtn.onclick = () => this.addPersonToRole(roleIndex);

            roleDiv.appendChild(addPersonBtn);
            container.appendChild(roleDiv);
        });
    }

    /**
     * Capture current sidebar inputs into draftMembers so typing isn't lost
     */
    captureDraftMembersFromUI() {
        const container = document.getElementById('rolesContainer');
        if (!container) return;

        const draft = [];
        container.querySelectorAll('.role-group').forEach(roleEl => {
            const roleInput = roleEl.querySelector('.role-label-input');
            const roleLabel = roleInput ? roleInput.value : '';

            const entries = [];
            roleEl.querySelectorAll('input[data-field="name"]').forEach(input => {
                entries.push({ name: input.value || '' });
            });

            draft.push({ roleLabel, entries: entries.length ? entries : [{ name: '' }] });
        });

        this.draftMembers = draft;
    }

    /**
     * Add a new empty role
     */
    addRole() {
        this.captureDraftMembersFromUI();

        // Works for both new and existing nodes via draft state
        this.draftMembers.push({
            roleLabel: '',
            entries: [{ name: '' }]
        });

        this.renderRoleBuilder(this.draftMembers);
    }

    /**
     * Remove a role by index
     */
    removeRole(roleIndex) {
        if (!this.draftMembers || !this.draftMembers[roleIndex]) return;

        this.captureDraftMembersFromUI();

        if (confirm('Remove this entire role and all people in it?')) {
            this.draftMembers.splice(roleIndex, 1);
            this.renderRoleBuilder(this.draftMembers);
        }
    }

    /**
     * Add a person to a specific role
     */
    addPersonToRole(roleIndex) {
        if (!this.draftMembers || !this.draftMembers[roleIndex]) return;

        this.captureDraftMembersFromUI();

        this.draftMembers[roleIndex].entries.push({ name: '' });
        this.renderRoleBuilder(this.draftMembers);
    }

    /**
     * Remove a person from a role
     */
    removePerson(roleIndex, personIndex) {
        if (!this.draftMembers || !this.draftMembers[roleIndex]) return;

        this.captureDraftMembersFromUI();

        this.draftMembers[roleIndex].entries.splice(personIndex, 1);

        // If role is now empty, remove it
        if (this.draftMembers[roleIndex].entries.length === 0) {
            this.draftMembers.splice(roleIndex, 1);
        }

        this.renderRoleBuilder(this.draftMembers);
    }

    /**
     * Collect data from role builder form
     */
    collectRoleBuilderData() {
        const members = [];
        const roleLabelInputs = document.querySelectorAll('.role-label-input');

        roleLabelInputs.forEach(input => {
            const roleIndex = parseInt(input.dataset.roleIndex);
            const roleLabel = input.value.trim() || 'Team Members';

            const peopleInputs = document.querySelectorAll(`[data-role-index="${roleIndex}"][data-field="name"]`);
            const entries = [];

            peopleInputs.forEach(nameInput => {
                const personIndex = nameInput.dataset.personIndex;
                const name = nameInput.value.trim();
                if (!name) return; // Skip empty names

                entries.push({ name });
            });

            if (entries.length > 0) {
                members.push({ roleLabel, entries });
            }
        });

        return members;
    }
}

// Initialize editor when DOM is loaded
let editor;
document.addEventListener('DOMContentLoaded', () => {
    editor = new ChartEditor();
});

// Save before unload
window.addEventListener('beforeunload', (e) => {
    if (editor) {
        editor.saveChart(false);
    }
});
