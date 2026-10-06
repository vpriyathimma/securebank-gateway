import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Check, X, Clock, User as UserIcon, Calendar, MapPin, DollarSign, CreditCard } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { User } from '../../../shared/schema';

interface ProfileApprovalModalProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingChanges {
  fullName?: string;
  dateOfBirth?: string;
  homeAddress?: string;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  employerName?: string;
  annualIncome?: string;
  creditScore?: number;
  requestedBy: string;
  requestDate: string;
  status: string;
}

export function ProfileApprovalModal({ user, open, onOpenChange }: ProfileApprovalModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  // Fetch pending changes
  const { data: pendingData, isLoading } = useQuery({
    queryKey: ['/api/users', user.id, 'pending-changes'],
    queryFn: () => apiRequest(`/api/users/${user.id}/pending-changes`),
    enabled: open,
  });

  const approveMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => 
      apiRequest(`/api/users/${user.id}/approve-changes`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes: notes || undefined }),
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', user.id] });
      
      toast({
        title: response.approved ? "Changes Approved" : "Changes Rejected",
        description: response.message,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to process approval",
        variant: "destructive",
      });
    },
  });

  const handleApprove = () => {
    approveMutation.mutate('approved');
  };

  const handleReject = () => {
    approveMutation.mutate('rejected');
  };

  const handleClose = () => {
    setNotes('');
    onOpenChange(false);
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent data-testid="modal-profile-approval">
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <Clock className="h-8 w-8 animate-spin mx-auto mb-2" />
              <p>Loading pending changes...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const pendingChanges: PendingChanges | null = pendingData?.pendingChanges;

  if (!pendingChanges) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent data-testid="modal-profile-approval">
          <DialogHeader>
            <DialogTitle>Profile Change Approval</DialogTitle>
          </DialogHeader>
          <div className="text-center p-6">
            <p className="text-muted-foreground">No pending changes for this user.</p>
            <Button onClick={handleClose} className="mt-4">Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(amount));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="modal-profile-approval">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            Profile Change Approval - {user.fullName || user.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Request Information */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-900">Request Details</span>
            </div>
            <p className="text-sm text-blue-800">
              Requested on {formatDate(pendingChanges.requestDate)} by {pendingChanges.requestedBy}
            </p>
            <Badge variant="outline" className="mt-2">
              {pendingChanges.status}
            </Badge>
          </div>

          {/* Changes Comparison */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg">Proposed Changes</h3>
            
            {pendingChanges.fullName && (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <UserIcon className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">Full Name</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Current:</p>
                    <p className="font-medium">{user.fullName || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Proposed:</p>
                    <p className="font-medium text-green-700">{pendingChanges.fullName}</p>
                  </div>
                </div>
              </div>
            )}

            {pendingChanges.dateOfBirth && (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">Date of Birth</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Current:</p>
                    <p className="font-medium">
                      {user.dateOfBirth ? formatDate(user.dateOfBirth.toString()) : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Proposed:</p>
                    <p className="font-medium text-green-700">{formatDate(pendingChanges.dateOfBirth)}</p>
                  </div>
                </div>
              </div>
            )}

            {pendingChanges.homeAddress && (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">Home Address</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Current:</p>
                    <p className="font-medium">{user.homeAddress || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Proposed:</p>
                    <p className="font-medium text-green-700">{pendingChanges.homeAddress}</p>
                  </div>
                </div>
              </div>
            )}

            {pendingChanges.annualIncome && (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">Annual Income</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Current:</p>
                    <p className="font-medium">
                      {user.annualIncome ? formatCurrency(user.annualIncome) : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Proposed:</p>
                    <p className="font-medium text-green-700">{formatCurrency(pendingChanges.annualIncome)}</p>
                  </div>
                </div>
              </div>
            )}

            {pendingChanges.creditScore && (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="h-4 w-4 text-gray-600" />
                  <span className="font-medium">Credit Score</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Current:</p>
                    <p className="font-medium">{user.creditScore || 'Not set'}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Proposed:</p>
                    <p className="font-medium text-green-700">{pendingChanges.creditScore}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Contact Information Changes */}
            {(pendingChanges.phone || pendingChanges.alternatePhone || pendingChanges.email) && (
              <div className="border rounded-lg p-4">
                <h4 className="font-medium mb-3">Contact Information</h4>
                <div className="space-y-3">
                  {pendingChanges.phone && (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Primary Phone (Current):</p>
                        <p className="font-medium">{user.phone || 'Not set'}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Primary Phone (Proposed):</p>
                        <p className="font-medium text-green-700">{pendingChanges.phone}</p>
                      </div>
                    </div>
                  )}
                  {pendingChanges.email && (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">Email (Current):</p>
                        <p className="font-medium">{user.email}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Email (Proposed):</p>
                        <p className="font-medium text-green-700">{pendingChanges.email}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Approval Notes */}
          <div>
            <Label htmlFor="notes">Approval Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about the approval/rejection decision..."
              rows={3}
              data-testid="textarea-approval-notes"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button 
              variant="outline" 
              onClick={handleClose}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={approveMutation.isPending}
              data-testid="button-reject"
            >
              <X className="h-4 w-4 mr-2" />
              Reject Changes
            </Button>
            <Button 
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              data-testid="button-approve"
            >
              <Check className="h-4 w-4 mr-2" />
              Approve Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}