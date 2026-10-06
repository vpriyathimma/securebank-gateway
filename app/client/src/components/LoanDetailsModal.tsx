import React from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Calendar, User, DollarSign, Percent, Clock, FileText } from 'lucide-react';

interface LoanDetailsModalProps {
  loan: any;
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function LoanDetailsModal({ loan, onEdit, onDelete, canEdit, canDelete }: LoanDetailsModalProps) {
  const formatCurrency = (amount: string) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(amount));

  const formatDate = (date: string) => 
    new Date(date).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'approved': return 'bg-blue-100 text-blue-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'paid_off': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getLoanTypeColor = (type: string) => {
    switch (type) {
      case 'personal': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'mortgage': return 'bg-green-100 text-green-800 border-green-200';
      case 'business': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'auto': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'home': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <FileText className="h-8 w-8 text-blue-600" />
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Loan Details</h3>
            <p className="text-sm text-gray-500">ID: {loan.id}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Badge className={getStatusColor(loan.status)}>
            {loan.status.replace('_', ' ').toUpperCase()}
          </Badge>
          <Badge variant="outline" className={getLoanTypeColor(loan.type)}>
            {loan.type.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* Loan Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Borrower Information */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center">
            <User className="h-4 w-4 mr-2" />
            Borrower Information
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Name:</span>
              <span className="ml-2 font-medium">{loan.user?.name}</span>
            </div>
            <div>
              <span className="text-gray-600">Email:</span>
              <span className="ml-2">{loan.user?.email}</span>
            </div>
            <div>
              <span className="text-gray-600">Phone:</span>
              <span className="ml-2">{loan.user?.phone}</span>
            </div>
            <div>
              <span className="text-gray-600">Status:</span>
              <span className="ml-2 capitalize">{loan.user?.status}</span>
            </div>
          </div>
        </div>

        {/* Loan Financial Details */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-3 flex items-center">
            <DollarSign className="h-4 w-4 mr-2" />
            Financial Details
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-blue-700">Loan Amount:</span>
              <span className="ml-2 font-bold text-blue-900">{formatCurrency(loan.amount)}</span>
            </div>
            <div>
              <span className="text-blue-700">Remaining Balance:</span>
              <span className="ml-2 font-medium text-blue-900">{formatCurrency(loan.remainingBalance)}</span>
            </div>
            <div>
              <span className="text-blue-700">Monthly Payment:</span>
              <span className="ml-2 font-medium text-blue-900">{formatCurrency(loan.monthlyPayment)}</span>
            </div>
            <div>
              <span className="text-blue-700">Interest Rate:</span>
              <span className="ml-2 font-medium text-blue-900">{loan.interestRate}% APR</span>
            </div>
          </div>
        </div>

        {/* Loan Terms */}
        <div className="bg-green-50 p-4 rounded-lg">
          <h4 className="font-medium text-green-900 mb-3 flex items-center">
            <Clock className="h-4 w-4 mr-2" />
            Loan Terms
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-green-700">Term Length:</span>
              <span className="ml-2 font-medium">{loan.termMonths} months ({Math.round(loan.termMonths / 12)} years)</span>
            </div>
            <div>
              <span className="text-green-700">Application Date:</span>
              <span className="ml-2">{formatDate(loan.createdAt)}</span>
            </div>
            {loan.approvedByUser && (
              <div>
                <span className="text-green-700">Approved By:</span>
                <span className="ml-2">{loan.approvedByUser.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Payment Information */}
        <div className="bg-orange-50 p-4 rounded-lg">
          <h4 className="font-medium text-orange-900 mb-3 flex items-center">
            <Percent className="h-4 w-4 mr-2" />
            Payment Information
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-orange-700">Total Paid:</span>
              <span className="ml-2 font-medium">
                {formatCurrency((parseFloat(loan.amount) - parseFloat(loan.remainingBalance)).toString())}
              </span>
            </div>
            <div>
              <span className="text-orange-700">Progress:</span>
              <span className="ml-2">
                {(((parseFloat(loan.amount) - parseFloat(loan.remainingBalance)) / parseFloat(loan.amount)) * 100).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-orange-700">Payments Remaining:</span>
              <span className="ml-2">
                {Math.ceil(parseFloat(loan.remainingBalance) / parseFloat(loan.monthlyPayment))} payments
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes Section */}
      {loan.notes && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-2">Notes</h4>
          <p className="text-sm text-gray-700">{loan.notes}</p>
        </div>
      )}

      {/* Action Buttons */}
      {(canEdit || canDelete) && (
        <div className="flex justify-end space-x-3 pt-4 border-t">
          {canEdit && (
            <Button variant="outline" onClick={onEdit}>
              Edit Loan
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete Loan
            </Button>
          )}
        </div>
      )}
    </div>
  );
}