/**
 * Tests for Authorization Module
 *
 * Tests the critical RBAC logic that all handlers depend on
 */

const { canAccessChart, canPerformAction, shareChart, revokeAccess, ROLES } = require('./authorization');

describe('Authorization Module', () => {
    let mockClient;
    let mockDb;
    let mockCollection;

    beforeEach(() => {
        // Mock MongoDB
        mockCollection = {
            findOne: jest.fn(),
            updateOne: jest.fn()
        };

        mockDb = {
            collection: jest.fn().mockReturnValue(mockCollection)
        };

        mockClient = {
            db: jest.fn().mockReturnValue(mockDb)
        };
    });

    describe('canAccessChart', () => {
        describe('Owner Access', () => {
            it('should grant access to chart owner with OWNER role', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'owner-user', ROLES.OWNER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.OWNER);
                expect(result.reason).toBeUndefined();
            });

            it('should grant owner access even when only VIEWER role required', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'owner-user', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.OWNER);
            });

            it('should bypass permissions array for owner', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'other-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'owner-user', ROLES.OWNER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.OWNER);
            });
        });

        describe('Role Hierarchy', () => {
            it('should allow EDITOR when VIEWER required (hierarchy)', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'editor-user', role: ROLES.EDITOR }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'editor-user', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.EDITOR);
            });

            it('should allow EDITOR when EDITOR required', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'editor-user', role: ROLES.EDITOR }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'editor-user', ROLES.EDITOR, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.EDITOR);
            });

            it('should deny EDITOR when OWNER required', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'editor-user', role: ROLES.EDITOR }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'editor-user', ROLES.OWNER, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toContain('Requires owner role');
            });

            it('should deny VIEWER when EDITOR required', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'viewer-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'viewer-user', ROLES.EDITOR, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toContain('Requires editor role');
            });

            it('should allow VIEWER when VIEWER required', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'viewer-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'viewer-user', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.VIEWER);
            });
        });

        describe('Default Authenticated Viewer Access', () => {
            it('should grant viewer access to any authenticated user', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'other-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'random-authenticated-user', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.VIEWER);
                expect(result.source).toBe('authenticated-user');
            });

            it('should grant viewer access when permissions array is empty', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'random-user', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.VIEWER);
                expect(result.source).toBe('authenticated-user');
            });

            it('should grant viewer access when permissions is undefined', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user'
                    // No permissions field
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'random-user', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.VIEWER);
                expect(result.source).toBe('authenticated-user');
            });

        });

        describe('Access Denial', () => {
            it('should deny edit access to authenticated users without permissions', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'random-user', ROLES.EDITOR, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toContain('No permissions');
            });

            it('should deny owner access to authenticated users without permissions', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', 'random-user', ROLES.OWNER, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toContain('No permissions');
            });

            it('should deny access when userId is null', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);

                const result = await canAccessChart('chart-123', null, ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toBe('Authentication required');
            });

            it('should return 404-style response when chart not found', async () => {
                mockCollection.findOne.mockResolvedValue(null);

                const result = await canAccessChart('nonexistent-chart', 'user-123', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toBe('Chart not found');
            });
        });

        describe('Error Handling', () => {
            it('should handle database errors gracefully', async () => {
                mockCollection.findOne.mockRejectedValue(new Error('Database connection failed'));

                const result = await canAccessChart('chart-123', 'user-123', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(false);
                expect(result.reason).toBe('Authorization check failed');
            });

            it('should handle malformed chart data (grant viewer access)', async () => {
                mockCollection.findOne.mockResolvedValue({
                    id: 'chart-123'
                    // Missing ownerId - but authenticated users still get viewer access
                });

                const result = await canAccessChart('chart-123', 'user-123', ROLES.VIEWER, mockClient);

                expect(result.allowed).toBe(true);
                expect(result.userRole).toBe(ROLES.VIEWER);
                expect(result.source).toBe('authenticated-user');
            });
        });
    });

    describe('canPerformAction', () => {
        it('should map "read" action to VIEWER role', async () => {
            const mockChart = {
                id: 'chart-123',
                ownerId: 'owner-user',
                permissions: [
                    { userId: 'viewer-user', role: ROLES.VIEWER }
                ]
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            const result = await canPerformAction('chart-123', 'viewer-user', 'read', mockClient);

            expect(result.allowed).toBe(true);
        });

        it('should map "edit" action to EDITOR role', async () => {
            const mockChart = {
                id: 'chart-123',
                ownerId: 'owner-user',
                permissions: [
                    { userId: 'editor-user', role: ROLES.EDITOR }
                ]
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            const result = await canPerformAction('chart-123', 'editor-user', 'edit', mockClient);

            expect(result.allowed).toBe(true);
        });

        it('should map "delete" action to OWNER role', async () => {
            const mockChart = {
                id: 'chart-123',
                ownerId: 'owner-user',
                permissions: []
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            const result = await canPerformAction('chart-123', 'owner-user', 'delete', mockClient);

            expect(result.allowed).toBe(true);
        });

        it('should map "share" action to OWNER role', async () => {
            const mockChart = {
                id: 'chart-123',
                ownerId: 'owner-user',
                permissions: []
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            const result = await canPerformAction('chart-123', 'owner-user', 'share', mockClient);

            expect(result.allowed).toBe(true);
        });

        it('should map "export" action to VIEWER role', async () => {
            const mockChart = {
                id: 'chart-123',
                ownerId: 'owner-user',
                permissions: [
                    { userId: 'viewer-user', role: ROLES.VIEWER }
                ]
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            const result = await canPerformAction('chart-123', 'viewer-user', 'export', mockClient);

            expect(result.allowed).toBe(true);
        });

        it('should reject unknown actions', async () => {
            const result = await canPerformAction('chart-123', 'user-123', 'unknown-action', mockClient);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Unknown action');
        });

        it('should deny VIEWER from editing', async () => {
            const mockChart = {
                id: 'chart-123',
                ownerId: 'owner-user',
                permissions: [
                    { userId: 'viewer-user', role: ROLES.VIEWER }
                ]
            };

            mockCollection.findOne.mockResolvedValue(mockChart);

            const result = await canPerformAction('chart-123', 'viewer-user', 'edit', mockClient);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Requires editor role');
        });
    });

    describe('shareChart', () => {
        describe('Successful Sharing', () => {
            it('should grant new VIEWER permission', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.VIEWER, mockClient);

                expect(result.success).toBe(true);
                expect(result.message).toContain('Granted viewer access');
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    { id: 'chart-123' },
                    expect.objectContaining({
                        $push: expect.objectContaining({
                            permissions: expect.objectContaining({
                                userId: 'target-user',
                                role: ROLES.VIEWER
                            })
                        })
                    })
                );
            });

            it('should grant new EDITOR permission', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.EDITOR, mockClient);

                expect(result.success).toBe(true);
                expect(result.message).toContain('Granted editor access');
            });

            it('should update existing permission role', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'target-user', role: ROLES.VIEWER, grantedAt: new Date() }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.EDITOR, mockClient);

                expect(result.success).toBe(true);
                expect(result.message).toContain("Updated target-user's role to editor");
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    { id: 'chart-123', 'permissions.userId': 'target-user' },
                    expect.objectContaining({
                        $set: expect.objectContaining({
                            'permissions.$.role': ROLES.EDITOR
                        })
                    })
                );
            });

            it('should update lastModified timestamp', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                await shareChart('chart-123', 'owner-user', 'target-user', ROLES.VIEWER, mockClient);

                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    expect.any(Object),
                    expect.objectContaining({
                        $currentDate: { lastModified: true }
                    })
                );
            });
        });

        describe('Validation', () => {
            it('should reject invalid role (not viewer or editor)', async () => {
                const result = await shareChart('chart-123', 'owner-user', 'target-user', 'admin', mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('Invalid role');
                expect(mockCollection.findOne).not.toHaveBeenCalled();
            });

            it('should reject OWNER role (cannot grant ownership)', async () => {
                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.OWNER, mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('Invalid role');
            });

            it('should reject sharing with self', async () => {
                const result = await shareChart('chart-123', 'owner-user', 'owner-user', ROLES.VIEWER, mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('Cannot share chart with yourself');
            });
        });

        describe('Authorization', () => {
            it('should reject when chart not found', async () => {
                mockCollection.findOne.mockResolvedValue(null);

                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.VIEWER, mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('Chart not found');
            });

            it('should reject when caller is not owner', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'real-owner',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(null); // findOne with ownerId check fails

                const result = await shareChart('chart-123', 'fake-owner', 'target-user', ROLES.VIEWER, mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('do not have permission');
            });
        });

        describe('Error Handling', () => {
            it('should handle database errors gracefully', async () => {
                mockCollection.findOne.mockRejectedValue(new Error('Database error'));

                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.VIEWER, mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toBe('Failed to share chart');
            });

            it('should handle update errors', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: []
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockRejectedValue(new Error('Update failed'));

                const result = await shareChart('chart-123', 'owner-user', 'target-user', ROLES.VIEWER, mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toBe('Failed to share chart');
            });
        });
    });

    describe('revokeAccess', () => {
        describe('Successful Revocation', () => {
            it('should revoke existing permission', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'target-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                const result = await revokeAccess('chart-123', 'owner-user', 'target-user', mockClient);

                expect(result.success).toBe(true);
                expect(result.message).toContain('Revoked access for target-user');
                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    { id: 'chart-123' },
                    expect.objectContaining({
                        $pull: {
                            permissions: { userId: 'target-user' }
                        }
                    })
                );
            });

            it('should update lastModified timestamp', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'target-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

                await revokeAccess('chart-123', 'owner-user', 'target-user', mockClient);

                expect(mockCollection.updateOne).toHaveBeenCalledWith(
                    expect.any(Object),
                    expect.objectContaining({
                        $currentDate: { lastModified: true }
                    })
                );
            });
        });

        describe('Failed Revocation', () => {
            it('should report when no permission exists to revoke', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'other-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockResolvedValue({ modifiedCount: 0 });

                const result = await revokeAccess('chart-123', 'owner-user', 'target-user', mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('No permissions found');
            });
        });

        describe('Authorization', () => {
            it('should reject when chart not found', async () => {
                mockCollection.findOne.mockResolvedValue(null);

                const result = await revokeAccess('chart-123', 'owner-user', 'target-user', mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('Chart not found');
            });

            it('should reject when caller is not owner', async () => {
                mockCollection.findOne.mockResolvedValue(null); // findOne with ownerId check fails

                const result = await revokeAccess('chart-123', 'fake-owner', 'target-user', mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toContain('do not have permission');
            });
        });

        describe('Error Handling', () => {
            it('should handle database errors gracefully', async () => {
                mockCollection.findOne.mockRejectedValue(new Error('Database error'));

                const result = await revokeAccess('chart-123', 'owner-user', 'target-user', mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toBe('Failed to revoke access');
            });

            it('should handle update errors', async () => {
                const mockChart = {
                    id: 'chart-123',
                    ownerId: 'owner-user',
                    permissions: [
                        { userId: 'target-user', role: ROLES.VIEWER }
                    ]
                };

                mockCollection.findOne.mockResolvedValue(mockChart);
                mockCollection.updateOne.mockRejectedValue(new Error('Update failed'));

                const result = await revokeAccess('chart-123', 'owner-user', 'target-user', mockClient);

                expect(result.success).toBe(false);
                expect(result.message).toBe('Failed to revoke access');
            });
        });
    });
});
