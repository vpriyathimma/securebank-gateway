import React from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CreditCard, User, DollarSign, Calendar, Building } from 'lucide-react';

interface AccountDetailsModalProps {
  account: any;
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function AccountDetailsModal({ account, onEdit, onDelete, canEdit, canDelete }: AccountDetailsModalProps) {
  const formatCurrency = (amount: string) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(amount));

  const formatDate = (date: string) => 
    new Date(date).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

  const getAccountTypeColor = (type: string) => {
    switch (type) {
      case 'checking': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'savings': return 'bg-green-100 text-green-800 border-green-200';
      case 'business': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'joint': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-red-100 text-red-800';
      case 'frozen': return 'bg-yellow-100 text-yellow-800';
      case 'closed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <CreditCard className="h-8 w-8 text-blue-600" />
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Account Details</h3>
            <p className="text-sm text-gray-500">Account #{account.accountNumber}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Badge className={getStatusColor(account.status)}>
            {account.status.toUpperCase()}
          </Badge>
          <Badge variant="outline" className={getAccountTypeColor(account.accountType)}>
            {account.accountType.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* Account Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Account Details */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-3 flex items-center">
            <Building className="h-4 w-4 mr-2" />
            Account Information
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-blue-700">Account Number:</span>
              <span className="ml-2 font-medium">{account.accountNumber}</span>
            </div>
            <div>
              <span className="text-blue-700">Account Type:</span>
              <span className="ml-2 capitalize">{account.accountType}</span>
            </div>
            <div>
              <span className="text-blue-700">Status:</span>
              <span className="ml-2 capitalize">{account.status}</span>
            </div>
            <div>
              <span className="text-blue-700">Created:</span>
              <span className="ml-2">{formatDate(account.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Account Balance */}
        <div className="bg-green-50 p-4 rounded-lg">
          <h4 className="font-medium text-green-900 mb-3 flex items-center">
            <DollarSign className="h-4 w-4 mr-2" />
            Balance Information
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-green-700">Current Balance:</span>
              <span className="ml-2 font-bold text-lg text-green-900">
                {formatCurrency(account.balance)}
              </span>
            </div>
            <div>
              <span className="text-green-700">Account ID:</span>
              <span className="ml-2 font-mono text-xs">{account.id}</span>
            </div>
          </div>
        </div>

        {/* Account Holder Information */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center">
            <User className="h-4 w-4 mr-2" />
            Account Holder
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Name:</span>
              <span className="ml-2 font-medium">{account.user?.name}</span>
            </div>
            {account.user?.fullName && account.user.fullName !== account.user.name && (
              <div>
                <span className="text-gray-600">Full Name:</span>
                <span className="ml-2 font-medium">{account.user?.fullName}</span>
              </div>
            )}
            <div>
              <span className="text-gray-600">Email:</span>
              <span className="ml-2">{account.user?.email}</span>
            </div>
            <div>
              <span className="text-gray-600">Phone:</span>
              <span className="ml-2">{account.user?.phone}</span>
            </div>
            {account.user?.alternatePhone && (
              <div>
                <span className="text-gray-600">Alternate Phone:</span>
                <span className="ml-2">{account.user?.alternatePhone}</span>
              </div>
            )}
            <div>
              <span className="text-gray-600">Role:</span>
              <span className="ml-2">{account.user?.role}</span>
            </div>
          </div>
        </div>

        {/* Personal Information - Only show if available */}
        {(account.user?.ssn || account.user?.dateOfBirth || account.user?.homeAddress) && (
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-3 flex items-center">
              <User className="h-4 w-4 mr-2" />
              Personal Information
            </h4>
            <div className="space-y-2 text-sm">
              {account.user?.ssn && (
                <div>
                  <span className="text-blue-700">SSN:</span>
                  <span className="ml-2 font-medium">{account.user.ssn}</span>
                </div>
              )}
              {account.user?.dateOfBirth && (
                <div>
                  <span className="text-blue-700">Date of Birth:</span>
                  <span className="ml-2">{formatDate(account.user.dateOfBirth)}</span>
                </div>
              )}
              {account.user?.homeAddress && (
                <div>
                  <span className="text-blue-700">Home Address:</span>
                  <span className="ml-2">{account.user.homeAddress}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Employment & Financial Information - Only show if available */}
        {(account.user?.employerName || account.user?.annualIncome || account.user?.creditScore) && (
          <div className="bg-green-50 p-4 rounded-lg">
            <h4 className="font-medium text-green-900 mb-3 flex items-center">
              <Building className="h-4 w-4 mr-2" />
              Employment & Financial
            </h4>
            <div className="space-y-2 text-sm">
              {account.user?.employerName && (
                <div>
                  <span className="text-green-700">Employer:</span>
                  <span className="ml-2">{account.user.employerName}</span>
                </div>
              )}
              {account.user?.annualIncome && (
                <div>
                  <span className="text-green-700">Annual Income:</span>
                  <span className="ml-2">{formatCurrency(account.user.annualIncome)}</span>
                </div>
              )}
              {account.user?.creditScore && (
                <div>
                  <span className="text-green-700">Credit Score:</span>
                  <span className="ml-2 font-medium">{account.user.creditScore}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Verification Status - Only show if available */}
        {(account.user?.identityVerified || account.user?.kycCompleted) && (
          <div className="bg-purple-50 p-4 rounded-lg">
            <h4 className="font-medium text-purple-900 mb-3 flex items-center">
              <User className="h-4 w-4 mr-2" />
              Verification Status
            </h4>
            <div className="space-y-2 text-sm">
              {account.user?.identityVerified && (
                <div>
                  <span className="text-purple-700">Identity Verified:</span>
                  <span className="ml-2 capitalize">{account.user.identityVerified}</span>
                </div>
              )}
              {account.user?.kycCompleted && (
                <div>
                  <span className="text-purple-700">KYC Status:</span>
                  <span className="ml-2 capitalize">{account.user.kycCompleted}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Account Statistics */}
        <div className="bg-orange-50 p-4 rounded-lg">
          <h4 className="font-medium text-orange-900 mb-3 flex items-center">
            <Calendar className="h-4 w-4 mr-2" />
            Account Statistics
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-orange-700">Account Age:</span>
              <span className="ml-2">
                {Math.floor((new Date().getTime() - new Date(account.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days
              </span>
            </div>
            <div>
              <span className="text-orange-700">User ID:</span>
              <span className="ml-2 font-mono text-xs">{account.userId}</span>
            </div>
            {account.user?.lastProfileUpdate && (
              <div>
                <span className="text-orange-700">Profile Updated:</span>
                <span className="ml-2">{formatDate(account.user.lastProfileUpdate)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Account Type Information */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h4 className="font-medium text-gray-900 mb-2">Account Type Features</h4>
        <div className="text-sm text-gray-700">
          {account.accountType === 'checking' && (
            <ul className="list-disc list-inside space-y-1">
              <li>Unlimited debit card transactions</li>
              <li>Online banking and mobile app access</li>
              <li>Direct deposit available</li>
              <li>Check writing privileges</li>
            </ul>
          )}
          {account.accountType === 'savings' && (
            <ul className="list-disc list-inside space-y-1">
              <li>Interest earning account</li>
              <li>Limited monthly transactions</li>
              <li>Higher interest rates than checking</li>
              <li>Automatic savings programs available</li>
            </ul>
          )}
          {account.accountType === 'business' && (
            <ul className="list-disc list-inside space-y-1">
              <li>Business banking features</li>
              <li>Merchant services available</li>
              <li>Business debit cards</li>
              <li>Payroll processing options</li>
            </ul>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      {(canEdit || canDelete) && (
        <div className="flex justify-end space-x-3 pt-4 border-t">
          {canEdit && (
            <Button variant="outline" onClick={onEdit}>
              Edit Account
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete Account
            </Button>
          )}
        </div>
      )}
    </div>
  );
}