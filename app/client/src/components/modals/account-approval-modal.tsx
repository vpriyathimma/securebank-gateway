import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Check, 
  X, 
  Clock, 
  User as UserIcon, 
  CreditCard, 
  DollarSign,
  Shield,
  Calendar,
  MapPin,
  Building,
  Mail,
  Phone
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface AccountApprovalModalProps {
  account: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingAccountChanges {
  accountChanges: {
    balance?: string;
    status?: string;
    interestRate?: string;
    overdraftLimit?: string;
    monthlyFee?: string;
    minimumBalance?: string;
    creditLimit?: string;
    notes?: string;
  };
  holderChanges: {
    fullName?: string;
    ssn?: string;
    dateOfBirth?: string;
    homeAddress?: string;
    phone?: string;
    alternatePhone?: string;
    email?: string;
    employerName?: string;
    annualIncome?: string;
    creditScore?: number;
  };
  changedBy: string;
  changedAt: string;
  reason: string;
}

export function AccountApprovalModal({ account, open, onOpenChange }: AccountApprovalModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  // Fetch pending changes
  const { data: pendingData, isLoading } = useQuery({
    queryKey: ['/api/accounts', account.id, 'pending-changes'],
    queryFn: () => apiRequest(`/api/accounts/${account.id}/pending-changes`),
    enabled: open,
  });

  const approveMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => 
      apiRequest(`/api/accounts/${account.id}/approve-changes`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes: notes || undefined }),
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounts', account.id] });
      
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
        <DialogContent data-testid="modal-account-approval">
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

  const pendingChanges: PendingAccountChanges | null = pendingData?.pendingChanges;

  if (!pendingChanges) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent data-testid="modal-account-approval">
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <X className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p>No pending changes found</p>
            </div>
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
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: string | undefined) => {
    if (!amount) return 'Not set';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(amount));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-account-approval">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Account Change Approval - {account.accountNumber}
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
              Requested on {formatDate(pendingChanges.changedAt)} by Bank Teller
            </p>
            <p className="text-sm text-blue-700 mt-1">
              {pendingChanges.reason}
            </p>
          </div>

          {/* Account Changes */}
          {Object.keys(pendingChanges.accountChanges).length > 0 && (
            <div className="space-y-4">
              <h3 className="font-medium text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Account Changes
              </h3>
              
              {pendingChanges.accountChanges.balance && String(pendingChanges.accountChanges.balance) !== String(account.balance || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Balance</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{formatCurrency(account.balance)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatCurrency(pendingChanges.accountChanges.balance)}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.accountChanges.interestRate && String(pendingChanges.accountChanges.interestRate) !== String(account.interestRate || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Interest Rate</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.interestRate || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.accountChanges.interestRate}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.accountChanges.overdraftLimit && String(pendingChanges.accountChanges.overdraftLimit) !== String(account.overdraftLimit || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Overdraft Limit</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{formatCurrency(account.overdraftLimit)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatCurrency(pendingChanges.accountChanges.overdraftLimit)}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.accountChanges.creditLimit && String(pendingChanges.accountChanges.creditLimit) !== String(account.creditLimit || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Credit Limit</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{formatCurrency(account.creditLimit)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatCurrency(pendingChanges.accountChanges.creditLimit)}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.accountChanges.monthlyFee && String(pendingChanges.accountChanges.monthlyFee) !== String(account.monthlyFee || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Monthly Fee</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{formatCurrency(account.monthlyFee)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatCurrency(pendingChanges.accountChanges.monthlyFee)}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.accountChanges.minimumBalance && String(pendingChanges.accountChanges.minimumBalance) !== String(account.minimumBalance || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Minimum Balance</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{formatCurrency(account.minimumBalance)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatCurrency(pendingChanges.accountChanges.minimumBalance)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Account Holder Changes */}
          {Object.keys(pendingChanges.holderChanges).length > 0 && (
            <div className="space-y-4">
              <h3 className="font-medium text-lg flex items-center gap-2">
                <UserIcon className="h-5 w-5" />
                Account Holder Changes
              </h3>
              
              {pendingChanges.holderChanges.fullName && pendingChanges.holderChanges.fullName !== (account.user?.fullName || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <UserIcon className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Full Name</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.fullName || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.fullName}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.ssn && 
                pendingChanges.holderChanges.ssn !== (account.user?.ssn || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">SSN</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.ssn || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.ssn}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.dateOfBirth && pendingChanges.holderChanges.dateOfBirth !== (account.user?.dateOfBirth?.toString().split('T')[0] || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Date of Birth</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">
                        {account.user?.dateOfBirth ? formatDate(account.user.dateOfBirth.toString()) : 'Not set'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatDate(pendingChanges.holderChanges.dateOfBirth)}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.homeAddress && pendingChanges.holderChanges.homeAddress !== (account.user?.homeAddress || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Home Address</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.homeAddress || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.homeAddress}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.creditScore !== undefined && String(pendingChanges.holderChanges.creditScore) !== String(account.user?.creditScore || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Credit Score</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.creditScore || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.creditScore}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.annualIncome && String(pendingChanges.holderChanges.annualIncome) !== String(account.user?.annualIncome || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Building className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Annual Income</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.annualIncome ? formatCurrency(account.user.annualIncome) : 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{formatCurrency(pendingChanges.holderChanges.annualIncome)}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.email && pendingChanges.holderChanges.email !== (account.user?.email || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Mail className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Email Address</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.email || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.email}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.phone && pendingChanges.holderChanges.phone !== (account.user?.phone || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Phone className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Phone Number</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.phone || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.phone}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.alternatePhone && pendingChanges.holderChanges.alternatePhone !== (account.user?.alternatePhone || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Phone className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Alternate Phone</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.alternatePhone || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.alternatePhone}</p>
                    </div>
                  </div>
                </div>
              )}

              {pendingChanges.holderChanges.employerName && pendingChanges.holderChanges.employerName !== (account.user?.employerName || '') && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Building className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">Employer Name</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Current:</p>
                      <p className="font-medium">{account.user?.employerName || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Proposed:</p>
                      <p className="font-medium text-green-700">{pendingChanges.holderChanges.employerName}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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