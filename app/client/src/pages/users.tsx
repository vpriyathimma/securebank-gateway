import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Users as UsersIcon, Plus, Eye, Edit, Trash2, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserForm } from '@/components/UserForm';
import { EditProfileModal } from '@/components/modals/edit-profile-modal';
import { ProfileApprovalModal } from '@/components/modals/profile-approval-modal';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { roleColors } from '@/lib/auth';

export function Users() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isProfileEditOpen, setIsProfileEditOpen] = useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  
  const { data: users, isLoading } = useQuery({
    queryKey: ['/api/users'],
  });

  const createMutation = useMutation({
    mutationFn: (userData: any) => 
      apiRequest('/api/users', { 
        method: 'POST', 
        body: JSON.stringify(userData) 
      }),
    onSuccess: () => {
      toast({
        title: "User Created",
        description: "The new user has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/login-users'] });
      setIsCreateOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Creation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...userData }: any) => 
      apiRequest(`/api/users/${id}`, { 
        method: 'PATCH', 
        body: JSON.stringify(userData) 
      }),
    onSuccess: () => {
      toast({
        title: "User Updated",
        description: "The user has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/login-users'] });
      setIsEditOpen(false);
      setSelectedUser(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => 
      apiRequest(`/api/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({
        title: "User Deleted",
        description: "The user has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/login-users'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Only bank staff can see users
  if (user?.role === 'Account Holder') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <p className="text-gray-600">You don't have permission to view users.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <div className="bg-white rounded-lg shadow-sm border animate-pulse">
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      case 'suspended': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        {user?.role === 'Bank Manager' && (
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New User
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">All Users</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users?.map((userItem: any) => (
                <tr key={`user-${userItem.id}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-gray-200 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-600">
                          {userItem.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {userItem.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          ID: {userItem.id.slice(0, 8)}...
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{userItem.email}</div>
                    <div className="text-sm text-gray-500">{userItem.phone || 'N/A'}</div>
                    {userItem.role === 'Account Holder' && userItem.pendingProfileChanges && (
                      <Badge variant="outline" className="mt-1">
                        <Clock className="h-3 w-3 mr-1" />
                        Pending Approval
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge variant="outline" className={roleColors[userItem.role]}>
                      {userItem.role}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(userItem.status)}`}>
                      {userItem.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(userItem.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setSelectedUser(userItem);
                          setIsViewOpen(true);
                        }}
                        data-testid={`button-view-${userItem.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      
                      {/* Account Holder Profile Management - Only Bank Staff can access */}
                      {userItem.role === 'Account Holder' && (user?.role === 'Bank Manager' || user?.role === 'Bank Teller') && (
                        <>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => {
                              setSelectedUser(userItem);
                              setIsProfileEditOpen(true);
                            }}
                            data-testid={`button-edit-profile-${userItem.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          
                          {/* Approval button for Bank Managers when there are pending changes */}
                          {userItem.pendingProfileChanges && user?.role === 'Bank Manager' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-blue-600 hover:text-blue-700"
                              onClick={() => {
                                setSelectedUser(userItem);
                                setIsApprovalOpen(true);
                              }}
                              data-testid={`button-approve-changes-${userItem.id}`}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                      
                      {/* Bank Staff User Management - Only Bank Managers can edit Bank Staff */}
                      {userItem.role !== 'Account Holder' && user?.role === 'Bank Manager' && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setSelectedUser(userItem);
                            setIsEditOpen(true);
                          }}
                          data-testid={`button-edit-staff-${userItem.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      
                      {/* Delete button for Bank Managers only */}
                      {user?.role === 'Bank Manager' && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
                              deleteMutation.mutate(userItem.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${userItem.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(!users || users.length === 0) && (
          <div className="text-center py-12">
            <UsersIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-sm font-medium text-gray-900 mb-2">No users found</h3>
            <p className="text-sm text-gray-500">
              No users have been created yet.
            </p>
            {user?.role === 'Bank Manager' && (
              <Button className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create First User
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <UserForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setIsCreateOpen(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Bank Staff User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <UserForm
              user={selectedUser}
              onSubmit={(data) => updateMutation.mutate({ id: selectedUser.id, ...data })}
              onCancel={() => {
                setIsEditOpen(false);
                setSelectedUser(null);
              }}
              isLoading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Account Holder Profile Edit Modal */}
      {selectedUser && (
        <EditProfileModal
          user={selectedUser}
          open={isProfileEditOpen}
          onOpenChange={(open) => {
            setIsProfileEditOpen(open);
            if (!open) setSelectedUser(null);
          }}
          currentUserRole={user?.role || ''}
        />
      )}

      {/* Profile Approval Modal */}
      {selectedUser && (
        <ProfileApprovalModal
          user={selectedUser}
          open={isApprovalOpen}
          onOpenChange={(open) => {
            setIsApprovalOpen(open);
            if (!open) setSelectedUser(null);
          }}
        />
      )}

      {/* User Details View Modal */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Name</label>
                  <p className="text-sm text-gray-900">{selectedUser.name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Email</label>
                  <p className="text-sm text-gray-900">{selectedUser.email}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Phone</label>
                  <p className="text-sm text-gray-900">{selectedUser.phone || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Role</label>
                  <Badge variant="outline" className={roleColors[selectedUser.role]}>
                    {selectedUser.role}
                  </Badge>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Status</label>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedUser.status)}`}>
                    {selectedUser.status}
                  </span>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">User ID</label>
                  <p className="text-sm text-gray-900 font-mono">{selectedUser.id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Created Date</label>
                  <p className="text-sm text-gray-900">{new Date(selectedUser.createdAt).toLocaleDateString()}</p>
                </div>
                {selectedUser.address && (
                  <div className="col-span-2">
                    <label className="text-sm font-medium text-gray-500">Address</label>
                    <p className="text-sm text-gray-900">{selectedUser.address}</p>
                  </div>
                )}
                {selectedUser.pendingProfileChanges && (
                  <div className="col-span-2">
                    <label className="text-sm font-medium text-gray-500">Pending Changes</label>
                    <div className="text-sm text-gray-900 bg-yellow-50 p-2 rounded border border-yellow-200">
                      This user has pending profile changes that require approval.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}