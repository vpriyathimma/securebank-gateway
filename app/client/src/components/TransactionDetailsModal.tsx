import React from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Receipt, User, DollarSign, Calendar, ArrowRight, Building } from 'lucide-react';

interface TransactionDetailsModalProps {
  transaction: any;
  onEdit?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function TransactionDetailsModal({ transaction, onEdit, onDelete, canEdit, canDelete }: TransactionDetailsModalProps) {
  const formatCurrency = (amount: string) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(parseFloat(amount));

  const formatDate = (date: string) => 
    new Date(date).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

  const getTransactionTypeColor = (type: string) => {
    switch (type) {
      case 'deposit': return 'bg-green-100 text-green-800 border-green-200';
      case 'withdrawal': return 'bg-red-100 text-red-800 border-red-200';
      case 'transfer': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'payment': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'cancelled': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'deposit': return '↓';
      case 'withdrawal': return '↑';
      case 'transfer': return '↔';
      case 'payment': return '→';
      default: return '•';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Receipt className="h-8 w-8 text-blue-600" />
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Transaction Details</h3>
            <p className="text-sm text-gray-500">ID: {transaction.id}</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Badge className={getStatusColor(transaction.status)}>
            {transaction.status.toUpperCase()}
          </Badge>
          <Badge variant="outline" className={getTransactionTypeColor(transaction.type)}>
            {getTransactionIcon(transaction.type)} {transaction.type.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* Transaction Amount */}
      <div className="bg-blue-50 p-6 rounded-lg text-center">
        <h4 className="font-medium text-blue-900 mb-2">Transaction Amount</h4>
        <p className="text-3xl font-bold text-blue-800">
          {transaction.type === 'withdrawal' ? '-' : '+'}{formatCurrency(transaction.amount)}
        </p>
        <p className="text-sm text-blue-600 mt-2 capitalize">{transaction.type} Transaction</p>
      </div>

      {/* Transaction Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Transaction Details */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center">
            <Receipt className="h-4 w-4 mr-2" />
            Transaction Information
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Type:</span>
              <span className="ml-2 font-medium capitalize">{transaction.type}</span>
            </div>
            <div>
              <span className="text-gray-600">Amount:</span>
              <span className="ml-2 font-medium">{formatCurrency(transaction.amount)}</span>
            </div>
            <div>
              <span className="text-gray-600">Status:</span>
              <span className="ml-2 capitalize">{transaction.status}</span>
            </div>
            <div>
              <span className="text-gray-600">Date:</span>
              <span className="ml-2">{formatDate(transaction.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Account Information */}
        <div className="bg-green-50 p-4 rounded-lg">
          <h4 className="font-medium text-green-900 mb-3 flex items-center">
            <Building className="h-4 w-4 mr-2" />
            Account Information
          </h4>
          <div className="space-y-2 text-sm">
            {transaction.fromAccount && (
              <div>
                <span className="text-green-700">From Account:</span>
                <span className="ml-2 font-medium">{transaction.fromAccount.accountNumber}</span>
                <div className="text-xs text-green-600 ml-5">
                  {transaction.fromAccount.accountType} • {formatCurrency(transaction.fromAccount.balance)}
                </div>
              </div>
            )}
            {transaction.toAccount && (
              <div>
                <span className="text-green-700">To Account:</span>
                <span className="ml-2 font-medium">{transaction.toAccount.accountNumber}</span>
                <div className="text-xs text-green-600 ml-5">
                  {transaction.toAccount.accountType} • {formatCurrency(transaction.toAccount.balance)}
                </div>
              </div>
            )}
            {!transaction.fromAccount && !transaction.toAccount && (
              <div>
                <span className="text-green-700">Associated Account:</span>
                <span className="ml-2 font-medium">Primary Account</span>
              </div>
            )}
          </div>
        </div>

        {/* Transaction Flow */}
        {transaction.type === 'transfer' && transaction.fromAccount && transaction.toAccount && (
          <div className="bg-blue-50 p-4 rounded-lg col-span-2">
            <h4 className="font-medium text-blue-900 mb-3 flex items-center">
              <ArrowRight className="h-4 w-4 mr-2" />
              Transfer Flow
            </h4>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="bg-white p-3 rounded-lg border">
                  <div className="font-medium text-blue-900">{transaction.fromAccount.accountNumber}</div>
                  <div className="text-sm text-blue-700">{transaction.fromAccount.accountType}</div>
                  <div className="text-xs text-blue-600">{transaction.fromAccount.user?.name}</div>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <ArrowRight className="h-6 w-6 text-blue-600" />
                <span className="mx-2 font-medium text-blue-800">{formatCurrency(transaction.amount)}</span>
                <ArrowRight className="h-6 w-6 text-blue-600" />
              </div>
              <div className="text-center">
                <div className="bg-white p-3 rounded-lg border">
                  <div className="font-medium text-blue-900">{transaction.toAccount.accountNumber}</div>
                  <div className="text-sm text-blue-700">{transaction.toAccount.accountType}</div>
                  <div className="text-xs text-blue-600">{transaction.toAccount.user?.name}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Processing Information */}
        <div className="bg-orange-50 p-4 rounded-lg">
          <h4 className="font-medium text-orange-900 mb-3 flex items-center">
            <User className="h-4 w-4 mr-2" />
            Processing Information
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-orange-700">Processed By:</span>
              <span className="ml-2">
                {transaction.processedByUser?.name || 'System Automated'}
              </span>
            </div>
            {transaction.processedByUser && (
              <div>
                <span className="text-orange-700">Processor Role:</span>
                <span className="ml-2">{transaction.processedByUser.role}</span>
              </div>
            )}
            <div>
              <span className="text-orange-700">Transaction ID:</span>
              <span className="ml-2 font-mono text-xs">{transaction.id}</span>
            </div>
          </div>
        </div>

        {/* Additional Details */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center">
            <Calendar className="h-4 w-4 mr-2" />
            Additional Details
          </h4>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600">Description:</span>
              <span className="ml-2">{transaction.description}</span>
            </div>
            <div>
              <span className="text-gray-600">Reference:</span>
              <span className="ml-2 font-mono text-xs">{transaction.id.slice(-8)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {(canEdit || canDelete) && (
        <div className="flex justify-end space-x-3 pt-4 border-t">
          {canEdit && (
            <Button variant="outline" onClick={onEdit}>
              Edit Transaction
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete Transaction
            </Button>
          )}
        </div>
      )}
    </div>
  );
}